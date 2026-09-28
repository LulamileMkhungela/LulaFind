// Create a throwaway Firebase user with the public web key, then see how the
// live database treats that token versus no token. Deletes the user after.
const apiKey = 'AIzaSyAn_rXPhvO0MZvpFhkycbIqM-qkv4rHPi8';
const supabase = 'https://srwdtguxdjsjlkaydhet.supabase.co';
const publishable = 'sb_publishable_bs3aTBGzkc3N6kpAH0oZGg_-i4v5AT3';

const stamp = Date.now();
const email = `lulaprobe${stamp}@example.com`;
const password = `Probe-${stamp}-Aa1`;

async function identity(path, body) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function claimsOf(token) {
  try {
    const json = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return {
      iss: json.iss, aud: json.aud, sub: json.sub,
      email_verified: json.email_verified, role: json.role ?? null,
      provider: json.firebase?.sign_in_provider ?? null
    };
  } catch (e) {
    return { parse: String(e) };
  }
}

async function supa(label, token, path, init = {}) {
  const headers = {
    apikey: publishable,
    'content-type': 'application/json',
    ...(init.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${supabase}${path}`, { ...init, headers });
  const text = await res.text();
  console.log(label, res.status, text.slice(0, 280));
}

const signed = await identity('accounts:signUp', { email, password, returnSecureToken: true });
console.log('signup', signed.status, signed.json.error?.message || 'ok', 'localId', signed.json.localId || null);
const token = signed.json.idToken;
if (!token) process.exit(0);
console.log('claims', claimsOf(token));

await supa('uid-firebase', token, '/rest/v1/rpc/lula_uid', { method: 'POST', body: '{}' });
await supa('uid-none', '', '/rest/v1/rpc/lula_uid', { method: 'POST', body: '{}' });
await supa('uid-garbage', 'not.a.jwt', '/rest/v1/rpc/lula_uid', { method: 'POST', body: '{}' });

const uid = signed.json.localId;
const story = {
  id: `s_probe_${stamp}`,
  collection: 'stories',
  owner_id: uid,
  payload: {
    id: `s_probe_${stamp}`, authorId: uid, createdAt: stamp, expiresAt: stamp + 86400000,
    audience: 'public', text: 'probe', media: [], replies: [], viewers: [], spotlightId: null, bgHue: 1
  },
  updated_at: stamp
};
await supa('story-firebase', token, '/rest/v1/records', {
  method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(story)
});
const spot = {
  id: `sp_probe_${stamp}`,
  collection: 'spotlights',
  owner_id: uid,
  payload: {
    id: `sp_probe_${stamp}`, ownerId: uid, surname: 'probe', tagline: '', about: '',
    adminIds: [uid], memberIds: [uid], postIds: [], coverHue: 1, province: 'KZN',
    verified: false, createdAt: stamp, followers: 1
  },
  updated_at: stamp
};
await supa('spot-firebase', token, '/rest/v1/records', {
  method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(spot)
});

const gone = await identity('accounts:delete', { idToken: token });
console.log('deleted', gone.status, gone.json.error?.message || 'ok');
