const apiKey = 'AIzaSyAn_rXPhvO0MZvpFhkycbIqM-qkv4rHPi8';
const supabase = 'https://srwdtguxdjsjlkaydhet.supabase.co';
const publishable = 'sb_publishable_bs3aTBGzkc3N6kpAH0oZGg_-i4v5AT3';
const stamp = Date.now();

async function identity(path, body) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  return { status: res.status, json };
}

const signed = await identity('accounts:signUp', {
  email: `lulaprobe${stamp}@example.com`,
  password: `Probe-${stamp}-Aa1`,
  returnSecureToken: true
});
const token = signed.json.idToken || '';
const uid = signed.json.localId || null;
console.log('signup', signed.status, signed.json.error?.message || uid, 'tokenLen', token.length);

async function supa(label, bearer, path, init = {}) {
  const headers = {
    apikey: publishable,
    'content-type': 'application/json',
    ...(init.headers || {})
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${supabase}${path}`, { ...init, headers });
  const text = await res.text();
  console.log(label, res.status, 'authLen', (headers.Authorization || '').length, text.slice(0, 240) || '(empty)');
}

await supa('uid', token, '/rest/v1/rpc/lula_uid', { method: 'POST', body: '{}' });

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
await supa('story', token, '/rest/v1/records', {
  method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(story)
});
await supa('story-again', token, '/rest/v1/records', {
  method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...story, id: `s_probeb_${stamp}`, payload: { ...story.payload, id: `s_probeb_${stamp}` } })
});

// Clean the earlier probe rows if this caller is allowed to. Harmless if not.
for (const id of ['s_probe_1790621681403', 'sp_probe_1790621681403', `s_probe_${stamp}`, `s_probeb_${stamp}`]) {
  await supa('del ' + id, token, `/rest/v1/records?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
}
if (token) console.log('deleted-user', (await identity('accounts:delete', { idToken: token })).json.error?.message || 'ok');
