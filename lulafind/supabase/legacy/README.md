# Legacy SQL (Supabase Auth era) — do not run

These scripts were written when accounts lived in Supabase Auth. They use
`auth.uid()` (a UUID) and would put back policies that no longer match
Firebase UIDs. Running any of them after `schema.sql` breaks sign-in writes.

Current scripts, in order:

1. `../schema.sql` — tables, RLS, RPCs; upgrades an old project in place.
2. `../post-interactions.sql` — Idea/No idea, comment counts, spotlight post links.

Both are safe to re-run.
