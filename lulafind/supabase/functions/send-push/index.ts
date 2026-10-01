// Supabase Edge Function: deliver a LulaFind notification to a phone.
//
// Deploy:  npx supabase functions deploy send-push
// Secrets: npx supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
//
// WHY THIS EXISTS
//
// The app writes a notification into public.records under collection
// 'notifications', which is enough for the in-app bell and nothing else. A
// phone is reached by FCM, which needs an OAuth2 token minted from a service
// account - and that signing key must never sit in the app bundle. So the send
// half lives here, server-side, where the key is a secret rather than a file
// in an APK.
//
// HOW IT IS CALLED
//
// Supabase dashboard -> Database -> Webhooks -> Create a new hook:
//   table  public.records
//   events INSERT
//   filter record.collection = 'notifications'
//   URL    https://<project-ref>.functions.supabase.co/send-push
//
// The webhook sends the inserted row; this function reads the recipient out of
// the payload, looks up that person's device tokens, and sends one FCM message
// per token.
//
// It is deliberately best-effort. A failed push must never fail the write that
// triggered it: the in-app notification is already saved by the time this runs,
// so the worst case is a phone that did not buzz, not a lost record.

// ─── Types ──────────────────────────────────────────────────────────────────

interface WebhookRow {
  collection?: string;
  id?: string;
  owner_id?: string | null;
  payload?: Record<string, unknown>;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Import the service account's PKCS#8 key as an RSA signing key. */
async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    raw,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * Mint a short-lived OAuth2 access token for FCM.
 *
 * Google's service-account flow: sign a JWT with the private key, then trade it
 * for an access token at oauth2.googleapis.com. The token is scoped to
 * firebase.messaging only, so a leaked one can send notifications and nothing
 * else.
 */
async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));

  const key = await importKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claims}`)
  );

  const assertion = `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('token exchange returned no access_token');
  return data.access_token;
}

/** Send one message. Returns the FCM error code when Google refuses it. */
async function send(
  token: string,
  title: string,
  body: string,
  projectId: string,
  bearer: string
): Promise<string | null> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          // Tapping the notification opens the case rather than the launcher.
          data: { route: '/notifications' },
          android: { priority: 'HIGH' },
          apns: { headers: { 'apns-priority': '10' } }
        }
      })
    }
  );

  if (res.ok) return null;
  const text = await res.text();
  // UNREGISTERED and INVALID_ARGUMENT mean the token is dead and should be
  // dropped; anything else (quota, 5xx) is worth retrying later.
  if (/UNREGISTERED|INVALID_ARGUMENT/.test(text)) return 'dead';
  return `send failed: ${res.status} ${text}`;
}

// ─── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!raw) {
    // Say exactly what is missing rather than failing with a cryptic 500.
    return json({
      error: 'FCM_SERVICE_ACCOUNT is not set. Run: npx supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"'
    }, 500);
  }

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(raw);
  } catch {
    return json({ error: 'FCM_SERVICE_ACCOUNT is not valid JSON' }, 500);
  }

  let row: WebhookRow;
  try {
    row = await req.json();
  } catch {
    return json({ error: 'body is not JSON' }, 400);
  }

  // The webhook fires for every insert into public.records; only notifications
  // are ours.
  if (row.collection !== 'notifications') return json({ skipped: 'not a notification' });

  const payload = row.payload ?? {};
  const userId = typeof payload['userId'] === 'string' ? payload['userId'] : null;
  const title = typeof payload['title'] === 'string' ? payload['title'] : 'LulaFind';
  const body = typeof payload['body'] === 'string' ? payload['body'] : '';

  if (!userId) return json({ skipped: 'no recipient' }, 200);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    return json({ error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically; neither was found' }, 500);
  }

  // Every token this person has. The service-role key is used because the
  // function is acting on the recipient's behalf, not as the caller who caused
  // the notification - and row-level security would otherwise refuse the read.
  const tokensRes = await fetch(
    `${url}/rest/v1/push_tokens?user_id=eq.${encodeURIComponent(userId)}&select=token`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
  );
  if (!tokensRes.ok) {
    return json({ error: `token lookup failed: ${tokensRes.status}` }, 500);
  }
  const rows = (await tokensRes.json()) as { token: string }[];
  if (!rows.length) return json({ sent: 0, note: 'no registered devices' });

  let bearer: string;
  try {
    bearer = await accessToken(sa);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'token minting failed' }, 500);
  }

  const dead: string[] = [];
  const failed: string[] = [];

  // One message per token. A person with a phone and a tablet should get both,
  // and one dead token must not stop the other.
  await Promise.all(rows.map(async ({ token }) => {
    const outcome = await send(token, title, body, sa.project_id, bearer);
    if (outcome === 'dead') dead.push(token);
    else if (outcome) failed.push(outcome);
  }));

  // Prune dead tokens so the table does not fill with rows FCM will refuse
  // forever. Best-effort; a failure here costs nothing but a retry.
  for (const token of dead) {
    await fetch(
      `${url}/rest/v1/push_tokens?token=eq.${encodeURIComponent(token)}`,
      {
        method: 'DELETE',
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` }
      }
    ).catch(() => undefined);
  }

  return json({
    sent: rows.length - dead.length,
    pruned: dead.length,
    ...(failed.length ? { failed } : {})
  });
});
