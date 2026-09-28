#!/usr/bin/env node
// Give (or remove) LulaFind admin/moderator rights on a Firebase account.
// Supabase reads the `lulafind_role` claim from the Firebase ID token.
//
//   npm i --no-save firebase-admin
//   GOOGLE_APPLICATION_CREDENTIALS=/safe/place/service-account.json \
//     node scripts/set-admin.mjs person@example.com admin      # or moderator
//   node scripts/set-admin.mjs person@example.com none         # remove
//
// Keep the service-account key OUT of the repository. The person must log out
// and in again (or wait up to an hour) before the new role applies.
const [email, role = 'admin'] = process.argv.slice(2);
if (!email || !['admin', 'moderator', 'none'].includes(role)) {
  console.error('Usage: node scripts/set-admin.mjs <email> <admin|moderator|none>');
  process.exit(1);
}
let admin;
try { admin = (await import('firebase-admin')).default; } catch {
  console.error('Install the Admin SDK first: npm i --no-save firebase-admin');
  process.exit(1);
}
admin.initializeApp({ projectId: 'lulafinds-app' });
const user = await admin.auth().getUserByEmail(email);
const claims = { ...(user.customClaims ?? {}) };
if (role === 'none') delete claims.lulafind_role; else claims.lulafind_role = role;
await admin.auth().setCustomUserClaims(user.uid, claims);
console.log(`${email} (${user.uid}) -> ${role}`);
