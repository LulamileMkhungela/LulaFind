import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../supabase/', import.meta.url);
const marker = '-- BEGIN GENERATED SEARCH COORDINATION (scripts/sync-search-schema.mjs)';
const module = readFileSync(new URL('search-coordination.sql', root), 'utf8');
const path = new URL('schema.sql', root);
const schema = readFileSync(path, 'utf8').split(marker)[0].trimEnd();
const expected = `${schema}\n\n${marker}\n${module}`;
const legacyPath = new URL('lula-patch-post.sql', root);
const ownerOnly = '-- Compatibility install: owner-only post edits. Install search-coordination.sql for the search board.\n' + module.slice(module.indexOf('create or replace function public.lula_patch_post'), module.indexOf('-- Defence in depth')).trimEnd() + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== expected || readFileSync(legacyPath, 'utf8') !== ownerOnly) {
    throw new Error('Search SQL copies differ. Run node scripts/sync-search-schema.mjs');
  }
} else {
  writeFileSync(path, expected);
  writeFileSync(legacyPath, ownerOnly);
}
