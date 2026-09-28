// One-shot diagnostic. Uses the historical Firebase admin key only to mint a
// token for an existing account, then asks the live database who it sees.
// Prints claims and HTTP results. Never prints the key or the raw token.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const keyPath = process.argv[2];
const uid = process.argv[3] || 'GJQBXZSjHYPp2UmGtdEOC23Vgl32';
const apiKey = 'AIzaSyAn_rXPhvO0MZvpFhkycbIqM-qkv4rHPi8';
const supabase = 'https://srwdtguxdjsjlkaydhet.supabase.co';
const publishable = 'sb_publishable_bs3aTBGzkc3N6kpAH0oZGg_-i4v5AT3';

const sa = JSON.parse(readFileSync(keyPath, 'utf8'));

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  const sig = signer.sign(sa.private_key).toString('base64url');
  return `${header}.${body}.${sig}`;
}

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase'
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`oauth ${res.status} ${json.error || ''} ${json.error_description || ''}`);
  return json.access_token;
}

async function customToken(bearer) {
  const now = Math.floor(Date.now() / 1000);
  // Firebase custom tokens are signed by the service account and exchanged below.
  return signJwt({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
    claims: {}
  });
}

async function idToken(custom) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`signInWithCustomToken ${res.status} ${json.error?.message || ''}`);
  return json.idToken;
}

function claimsOf(token) {
  const part = token.split('.')[1];
  const json = JSON.parse(Buffer.from(part, 'base64url').toString());
  return {
    iss: json.iss,
    aud: json.aud,
    sub: json.sub,
    user_id: json.user_id,
    email_verified: json.email_verified,
    role: json.role ?? null,
    provider: json.firebase?.sign_in_provider ?? null,
    emailPresent: !!json.email
  };
}

async function supa(path, token, init = {}) {
  const res = await fetch(`${supabase}${path}`, {
    ...init,
    headers: {
      apikey: publishable,
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 500) };
}

const bearer = await accessToken();
const userRes = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/lulafinds-app/accounts:lookup`, {
  method: 'POST',
  headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
  body: JSON.stringify({ localId: [uid] })
});
const userJson = await userRes.json();
const user = userJson.users?.[0];
console.log('user', user ? { localId: user.localId, emailVerified: user.emailVerified, provider: user.providerUserInfo?.map((p) => p.providerId), customAttrs: user.customAttributes || null } : userJson.error || userRes.status);

const token = await idToken(await customToken(bearer));
console.log('claims', claimsOf(token));
console.log('lula_uid', await supa('/rest/v1/rpc/lula_uid', token, { method: 'POST', body: '{}' }));

const story = {
  id: `s_probe_${Date.now()}`,
  collection: 'stories',
  owner_id: uid,
  payload: {
    id: `s_probe_${Date.now()}`,
    authorId: uid,
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000,
    audience: 'public',
    text: 'probe',
    media: [],
    replies: [],
    viewers: [],
    spotlightId: null,
    bgHue: 168
  },
  updated_at: Date.now()
};
story.payload.id = story.id;

console.log('upsert representation', await supa('/rest/v1/records?on_conflict=collection,id', token, {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify(story)
}));

const story2 = { ...story, id: `s_probe2_${Date.now()}` };
story2.payload = { ...story.payload, id: story2.id };
console.log('insert minimal', await supa('/rest/v1/records', token, {
  method: 'POST',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify(story2)
}));

const spot = {
  id: `sp_probe_${Date.now()}`,
  collection: 'spotlights',
  owner_id: uid,
  payload: {
    id: `sp_probe_${Date.now()}`,
    ownerId: uid,
    surname: 'probe',
    tagline: 'probe',
    about: '',
    adminIds: [uid],
    memberIds: [uid],
    postIds: [],
    coverHue: 1,
    province: 'KZN',
    verified: false,
    createdAt: Date.now(),
    followers: 1
  },
  updated_at: Date.now()
};
spot.payload.id = spot.id;
console.log('spotlight insert', await supa('/rest/v1/records', token, {
  method: 'POST',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify(spot)
}));
