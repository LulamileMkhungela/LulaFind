// Anon probe of the live records insert policy. Prints statuses only.
const supabase = 'https://srwdtguxdjsjlkaydhet.supabase.co';
const key = 'sb_publishable_bs3aTBGzkc3N6kpAH0oZGg_-i4v5AT3';

async function call(path, init = {}) {
  const res = await fetch(`${supabase}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 400) };
}

const uid = 'GJQBXZSjHYPp2UmGtdEOC23Vgl32';
const now = Date.now();

async function insert(row, prefer = 'return=minimal') {
  const res = await call('/rest/v1/records', {
    method: 'POST',
    headers: { Prefer: prefer },
    body: JSON.stringify(row)
  });
  console.log(row.collection, row.id, prefer, res.status, res.body);
  if (res.status < 300) {
    const del = await call(`/rest/v1/records?collection=eq.${row.collection}&id=eq.${row.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    console.log('delete', row.collection, del.status, del.body);
  }
}

const story = (id, extra = {}) => ({
  id,
  collection: 'stories',
  owner_id: uid,
  payload: {
    id, authorId: uid, createdAt: now, expiresAt: now + 86400000,
    audience: 'public', text: 'probe', media: [], replies: [], viewers: [],
    spotlightId: null, bgHue: 168, ...extra
  },
  updated_at: now
});

await insert(story(`s_probe_${now}`));
await insert(story(`s_probe2_${now}`), 'return=representation');
await insert({ ...story(`s_probe3_${now}`), owner_id: null });

await insert({
  id: `p_probe_${now}`,
  collection: 'posts',
  owner_id: uid,
  payload: {
    id: `p_probe_${now}`, authorId: uid, createdAt: now, text: 'probe',
    media: [], audience: 'public', spotlightId: null
  },
  updated_at: now
});

await insert({
  id: `sp_probe_${now}`,
  collection: 'spotlights',
  owner_id: uid,
  payload: {
    id: `sp_probe_${now}`, ownerId: uid, surname: 'probe', tagline: 'probe', about: '',
    adminIds: [uid], memberIds: [uid], postIds: [], coverHue: 1, province: 'KZN',
    verified: false, createdAt: now, followers: 1
  },
  updated_at: now
});

console.log('rpc lula_uid', await call('/rest/v1/rpc/lula_uid', { method: 'POST', body: '{}' }));
console.log('rpc lula_put', await call('/rest/v1/rpc/lula_put_record', { method: 'POST', body: '{}' }));
