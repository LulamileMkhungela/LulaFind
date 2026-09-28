// Compare the exact upsert the app sends with a plain insert, using a real
// Firebase token. Deletes the throwaway user and any rows it managed to write.
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
  return res.json();
}

const signed = await identity('accounts:signUp', {
  email: `lulaprobe${stamp}@example.com`,
  password: `Probe-${stamp}-Aa1`,
  returnSecureToken: true
});
const token = signed.idToken;
const uid = signed.localId;
console.log('signup', signed.error?.message || uid);
if (!token) process.exit(0);

async function supa(label, path, init = {}) {
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
  console.log(label, res.status, text.slice(0, 320) || '(empty)');
  return res.status;
}

function story(id) {
  return {
    id,
    collection: 'stories',
    owner_id: uid,
    payload: {
      id, authorId: uid, createdAt: stamp, expiresAt: stamp + 86400000,
      media: [], text: 'test', bgHue: 168, viewers: [], replies: [],
      audience: 'public', spotlightId: null
    },
    updated_at: stamp
  };
}

await supa('upsert-rep', '/rest/v1/records?on_conflict=collection,id', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify(story(`s_up_${stamp}`))
});
await supa('upsert-min', '/rest/v1/records?on_conflict=collection,id', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(story(`s_min_${stamp}`))
});
await supa('insert-rep', '/rest/v1/records', {
  method: 'POST',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify(story(`s_ir_${stamp}`))
});

// Mismatch: token uid vs a different owner. This is what a missing token looks
// like only if the policy requires a match — here the token is present.
await supa('mismatch', '/rest/v1/records', {
  method: 'POST',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({ ...story(`s_mm_${stamp}`), owner_id: 'GJQBXZSjHYPp2UmGtdEOC23Vgl32', payload: { ...story(`s_mm_${stamp}`).payload, authorId: 'GJQBXZSjHYPp2UmGtdEOC23Vgl32' } })
});

const post = {
  id: `p_${stamp}`,
  collection: 'posts',
  owner_id: uid,
  payload: {
    id: `p_${stamp}`, authorId: uid, type: 'general', title: 'test', body: 'test',
    province: 'KZN', town: '', media: [], createdAt: stamp, updatedAt: stamp,
    status: 'active', audience: 'public', spotlightId: null, upvotes: 0, downvotes: 0,
    commentCount: 0, shares: 0, lookingCount: 0
  },
  updated_at: stamp
};
await supa('post-upsert', '/rest/v1/records?on_conflict=collection,id', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify(post)
});

for (const id of [`s_up_${stamp}`, `s_min_${stamp}`, `s_ir_${stamp}`, `s_mm_${stamp}`, `p_${stamp}`]) {
  await supa('del ' + id, `/rest/v1/records?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}
console.log('deleted-user', (await identity('accounts:delete', { idToken: token })).error?.message || 'ok');
