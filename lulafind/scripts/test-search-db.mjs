import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, [new URL('./sync-search-schema.mjs', import.meta.url).pathname, '--check']);

// Real PostgreSQL engine + repository schema. Only Supabase platform-owned
// auth/storage objects are supplied by this fixture; application RLS/RPCs aren't mocked.
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema storage;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth, storage to anon, authenticated;
  grant execute on function auth.jwt() to anon, authenticated;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id text, bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
`);
await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
// Also prove the standalone upgrade is re-runnable, and the legacy installer cannot reopen the hole.
await db.exec(readFileSync(new URL('../supabase/search-coordination.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../supabase/lula-patch-post.sql', import.meta.url), 'utf8'));
const base = { id: 'case', type: 'missing', status: 'active', audience: 'public', authorId: 'owner', searchParty: null, voterIds: {}, lookingIds: [], flags: [], events: [], outcome: { found: false }, title: 'Synthetic case', updatedAt: 1 };
for (const id of ['owner', 'a', 'b', 'mod', 'suspended', 'blocked']) {
  await db.query(`insert into public.records(collection,id,owner_id,payload) values ('users',$1,$1,$2)`, [id, { id, displayName: id, suspended: id === 'suspended', blockedUserIds: id === 'owner' ? ['blocked'] : [] }]);
}
for (const post of [base, { ...base, id: 'private', audience: 'followers' }, { ...base, id: 'closed', status: 'found' }]) {
  await db.query(`insert into public.records(collection,id,owner_id,payload) values ('posts',$1,'owner',$2)`, [post.id, post]);
}
let count = 0;
async function identity(id) {
  await db.exec('reset role');
  const claims = id ? { iss: 'https://securetoken.google.com/lulafinds-app', aud: 'lulafinds-app', sub: id, email_verified: true, lulafind_role: id === 'mod' ? 'moderator' : 'member' } : {};
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(`set role ${id ? 'authenticated' : 'anon'}`);
}
async function command(id, cmd, post = 'case') {
  await identity(id);
  return (await db.query(`select public.lula_coordinate_search($1,$2) as post`, [post, cmd])).rows[0].post;
}
async function check(name, fn) {
  await fn(); count++; console.log(`PASS ${name}`);
}
const open = { action: 'open', meetAt: 'Public library entrance', zones: ['North park', 'Taxi rank'] };
// ── public profile view: impact aggregates reach the public surface, case data never does ──
await check('public profile exposes impact totals and still hides private fields', async () => {
  // write the way the app does for its own row: upsert into records as the owner
  await identity('a');
  await db.query(
    `update public.records set payload = payload || $2 where collection = 'users' and id = $1`,
    ['a', {
      impact: { signals: 3, searches: 1, posters: 0, communities: 2, care: 4 },
      privacy: { showStats: true, showLocation: false }
    }]
  );
  const open = (await db.query(`select payload from public.lula_user_profiles_public where id = 'a'`)).rows[0].payload;
  assert.equal(open.impact.signals, 3);
  assert.equal(open.impact.care, 4);
  assert.equal(open.email, '', 'email never leaves the private row');
  assert.equal(open.payload, undefined, 'no raw payload column');

  // hidden stats hide the aggregates too, exactly like followers and karma
  await db.query(
    `update public.records set payload = jsonb_set(payload, '{privacy,showStats}', 'false'::jsonb) where collection = 'users' and id = 'a'`
  );
  const hidden = (await db.query(`select payload from public.lula_user_profiles_public where id = 'a'`)).rows[0].payload;
  assert.equal(hidden.impact.signals, 0);
  assert.equal(hidden.karma, 0);
});

// ── verification badges: granted, never self-declared ──
await check('a member cannot set the verified flag on their own row', async () => {
  await identity('a');
  await assert.rejects(
    db.query(`update public.records set payload = payload || '{"verified":true}'::jsonb where collection = 'users' and id = 'a'`),
    /granted by LulaFind/
  );
});

await check('editing other profile fields still works', async () => {
  await identity('a');
  await db.query(`update public.records set payload = payload || '{"bio":"Volunteer searcher"}'::jsonb where collection = 'users' and id = 'a'`);
  const open = (await db.query(`select payload from public.lula_user_profiles_public where id = 'a'`)).rows[0].payload;
  assert.equal(open.bio, 'Volunteer searcher');
  assert.equal(open.verified, false);
});

await check('an admin grant makes the badge appear on the public profile', async () => {
  await identity('mod');
  await db.query(`select public.lula_set_verified('a', true, 'Verified community searcher')`);
  const open = (await db.query(`select payload from public.lula_user_profiles_public where id = 'a'`)).rows[0].payload;
  assert.equal(open.verified, true);
  // the grant table itself is not readable by clients - only the answer is
  await assert.rejects(db.query(`select * from public.lula_verifications where user_id = 'a'`), /permission denied/);
});

await check('a member cannot grant a badge to anyone', async () => {
  await identity('b');
  await assert.rejects(db.query(`select public.lula_set_verified('b', true, 'me')`), /admins/);
});

await check('a stale copy that drops the badge cannot remove the grant', async () => {
  await identity('a');
  await db.query(`update public.records set payload = payload || '{"verified":false,"bio":"still here"}'::jsonb where collection = 'users' and id = 'a'`);
  const open = (await db.query(`select payload from public.lula_user_profiles_public where id = 'a'`)).rows[0].payload;
  assert.equal(open.verified, true, 'the grant survives a write that does not know about it');
  assert.equal(open.bio, 'still here');
});

await check('an admin can withdraw the badge', async () => {
  await identity('mod');
  await db.query(`select public.lula_set_verified('a', false)`);
  const open = (await db.query(`select payload from public.lula_user_profiles_public where id = 'a'`)).rows[0].payload;
  assert.equal(open.verified, false);
});

await check('anonymous cannot execute coordination', () => assert.rejects(command(null, open), /permission denied/));
await check('unrelated member cannot open a board', () => assert.rejects(command('a', open), /Only the case owner/));
await check('suspended member denied', () => assert.rejects(command('suspended', open), /not available/));
await check('blocked member denied', () => assert.rejects(command('blocked', open), /not available/));
await check('private case denied', () => assert.rejects(command('a', { action: 'refresh' }, 'private'), /not available/));
await check('closed case refuses commands', () => assert.rejects(command('owner', open, 'closed'), /active search/));
await check('duplicate areas rejected', () => assert.rejects(command('owner', { ...open, zones: ['Park', 'park'] }), /different areas/));
await check('empty areas rejected', () => assert.rejects(command('owner', { ...open, zones: [] }), /different areas/));
await check('past meeting time rejected', () => assert.rejects(command('owner', { ...open, meetWhen: 1 }), /meeting time/));
await check('owner opens durable board', async () => {
  const p = await command('owner', open); assert.equal(p.searchParty.zones.length, 2);
});
await check('opening again cannot erase assignments', () => assert.rejects(command('owner', open), /already has/));
const zone1 = 'case-zone-1', zone2 = 'case-zone-2';
await check('first volunteer claims zone', async () => {
  const p = await command('a', { action: 'claim', zoneId: zone1, expectedVersion: 0 });
  assert.equal(p.searchParty.zones[0].takenBy, 'a'); assert.equal(p.searchParty.zones[0].version, 1);
});
await check('second claim from the same snapshot loses, without overwriting', () => assert.rejects(command('b', { action: 'claim', zoneId: zone1, expectedVersion: 0 }), /area changed/));
await check('independent zone claims preserve each other', async () => {
  const p = await command('b', { action: 'claim', zoneId: zone2, expectedVersion: 0 });
  assert.deepEqual(p.searchParty.zones.map(z => z.takenBy), ['a', 'b']);
});
await check('cannot release another volunteer', () => assert.rejects(command('b', { action: 'release', zoneId: zone1, expectedVersion: 1 }), /own unfinished/));
await check('cannot complete another volunteer', () => assert.rejects(command('b', { action: 'complete', zoneId: zone1, expectedVersion: 1 }), /own unfinished/));
await check('generic patch RPC rejects volunteer field replacement', async () => {
  await identity('b');
  await assert.rejects(db.query(`select public.lula_patch_post('case', '{"searchParty":null}')`), /Only the case owner/);
});
await check('old whole-post RPC cannot rewrite another volunteer assignment', async () => {
  const p = await command('b', { action: 'refresh' });
  p.searchParty.zones[0] = { ...p.searchParty.zones[0], takenBy: 'b', version: 2, updatedBy: 'b' };
  await assert.rejects(db.query(`select public.lula_post_interact('case',$1)`, [p]), /own search area/);
});
await check('anonymous cannot use old patch RPC', async () => {
  await identity(null); await assert.rejects(db.query(`select public.lula_patch_post('case', '{"searchParty":null}')`), /permission denied/);
});
await check('ordinary direct table update cannot mutate another case', async () => {
  await identity('b');
  const result = await db.query(`update public.records set payload = payload || '{"searchParty":null}'::jsonb where collection='posts' and id='case' returning id`);
  assert.equal(result.rows.length, 0);
});
await check('oversized completion note rejected', () => assert.rejects(command('a', { action: 'complete', zoneId: zone1, expectedVersion: 1, note: 'x'.repeat(501) }), /500 characters/));
await check('completion stores note, actor and timestamp', async () => {
  const p = await command('a', { action: 'complete', zoneId: zone1, expectedVersion: 1, note: 'Public area checked' });
  const z = p.searchParty.zones[0]; assert.equal(z.done, true); assert.equal(z.note, 'Public area checked'); assert.equal(z.updatedBy, 'a'); assert.ok(z.updatedAt > 0);
});
await check('repeat stale completion is rejected', () => assert.rejects(command('a', { action: 'complete', zoneId: zone1, expectedVersion: 1 }), /area changed/));
await check('volunteer cannot pause search', () => assert.rejects(command('a', { action: 'pause' }), /Only the case owner/));
await check('moderator can pause search', async () => assert.equal((await command('mod', { action: 'pause' })).searchParty.open, false));
await check('paused board refuses volunteer commands', () => assert.rejects(command('a', { action: 'reopen', zoneId: zone1, expectedVersion: 2 }), /paused/));
await check('owner resumes; assignee reopens then releases', async () => {
  await command('owner', { action: 'resume' });
  const reopened = await command('a', { action: 'reopen', zoneId: zone1, expectedVersion: 2 }); assert.equal(reopened.searchParty.zones[0].done, false);
  const p = await command('a', { action: 'release', zoneId: zone1, expectedVersion: 3 });
  assert.equal(p.searchParty.zones[0].takenBy, null); assert.equal(p.searchParty.zones[1].takenBy, 'b');
});
await check('closed board remains readable but refuses mutations', async () => {
  await identity('owner'); await db.query(`update public.records set payload = payload || '{"status":"found"}'::jsonb where collection='posts' and id='case'`);
  assert.equal((await command('a', { action: 'refresh' })).status, 'found');
  await assert.rejects(command('a', { action: 'claim', zoneId: zone1, expectedVersion: 4 }), /active search/);
});
await db.close();
console.log(`${count} PostgreSQL/RLS checks passed. PGlite is single-session: real multi-connection contention and deployed JWT verification still need staging tests.`);
