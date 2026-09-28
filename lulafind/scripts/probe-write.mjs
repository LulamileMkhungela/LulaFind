// Does the app's upsert fail where a plain insert succeeds?
const apiKey = 'AIzaSyAn_rXPhvO0MZvpFhkycbIqM-qkv4rHPi8';
const supabase = 'https://srwdtguxdjsjlkaydhet.supabase.co';
const publishable = 'sb_publishable_bs3aTBGzkc3N6kpAH0oZGg_-i4v5AT3';
const stamp = Date.now();

async function identity(path, body) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${apiKey}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  return res.json();
}
const signed = await identity('accounts:signUp', {
  email: `lulaprobe${stamp}@example.com`, password: `Probe-${stamp}-Aa1`, returnSecureToken: true
});
const token = signed.idToken;
const uid = signed.localId;
console.log('user', uid, 'token', token ? token.length : 0);
if (!token) process.exit(0);

async function send(label, path, prefer, row) {
  const res = await fetch(`${supabase}${path}`, {
    method: 'POST',
    headers: {
      apikey: publishable,
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      Prefer: prefer
    },
    body: JSON.stringify(row)
  });
  const text = await res.text();
  console.log(label, res.status, text.slice(0, 180) || '(empty)');
  return res.status;
}

function row(collection, id, payload) {
  return { id, collection, owner_id: uid, payload: { id, ...payload }, updated_at: stamp };
}

const story = (id) => row('stories', id, {
  authorId: uid, createdAt: stamp, expiresAt: stamp + 86400000, audience: 'public',
  text: 'test', media: [], replies: [], viewers: [], spotlightId: null, bgHue: 168
});
const post = (id) => row('posts', id, {
  authorId: uid, type: 'general', title: 'test', body: 'test', province: 'KZN', town: '',
  media: [], createdAt: stamp, updatedAt: stamp, status: 'active', audience: 'public',
  spotlightId: null, upvotes: 0, downvotes: 0, commentCount: 0, shares: 0, lookingCount: 0
});
const spot = (id) => row('spotlights', id, {
  ownerId: uid, surname: 'probe', tagline: '', about: '', adminIds: [uid], memberIds: [uid],
  postIds: [], coverHue: 1, province: 'KZN', verified: false, createdAt: stamp, followers: 1
});

await send('story-insert', '/rest/v1/records', 'return=minimal', story(`s_i_${stamp}`));
await send('story-upsert', '/rest/v1/records?on_conflict=collection,id', 'resolution=merge-duplicates,return=minimal', story(`s_u_${stamp}`));
await send('post-insert', '/rest/v1/records', 'return=minimal', post(`p_i_${stamp}`));
await send('post-upsert', '/rest/v1/records?on_conflict=collection,id', 'resolution=merge-duplicates,return=minimal', post(`p_u_${stamp}`));
await send('spot-insert', '/rest/v1/records', 'return=minimal', spot(`sp_i_${stamp}`));
await send('spot-upsert', '/rest/v1/records?on_conflict=collection,id', 'resolution=merge-duplicates,return=minimal', spot(`sp_u_${stamp}`));

// Second upsert of a row we just inserted — an edit, not a create.
await send('story-edit', '/rest/v1/records?on_conflict=collection,id', 'resolution=merge-duplicates,return=minimal', story(`s_i_${stamp}`));
await send('story-update', `/rest/v1/records?collection=eq.stories&id=eq.s_i_${stamp}`, 'return=minimal', null);

const updated = await fetch(`${supabase}/rest/v1/records?collection=eq.stories&id=eq.s_i_${stamp}`, {
  method: 'PATCH',
  headers: {
    apikey: publishable, Authorization: `Bearer ${token}`, 'content-type': 'application/json', Prefer: 'return=minimal'
  },
  body: JSON.stringify({ payload: { ...story(`s_i_${stamp}`).payload, text: 'edited' }, updated_at: stamp + 1 })
});
console.log('story-patch', updated.status, (await updated.text()).slice(0, 180) || '(empty)');

for (const id of [`s_i_${stamp}`, `s_u_${stamp}`, `p_i_${stamp}`, `p_u_${stamp}`, `sp_i_${stamp}`, `sp_u_${stamp}`]) {
  const del = await fetch(`${supabase}/rest/v1/records?id=eq.${id}`, {
    method: 'DELETE',
    headers: { apikey: publishable, Authorization: `Bearer ${token}`, Prefer: 'return=representation' }
  });
  const body = await del.text();
  console.log('del', id, del.status, body.length > 2 ? 'removed' : 'none');
}
console.log('deleted-user', (await identity('accounts:delete', { idToken: token })).error?.message || 'ok');
