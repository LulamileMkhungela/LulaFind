import { CASE_CONTACTS } from '../app/core/data/sa-help';

export const environment = {
  production: false,
  appName: 'LulaFind',
  appVersion: '1.0.0',
  /**
   * supabase = this project's database, accounts, chat and photos.
   * Firebase is not the database. It only sends the normal-email account emails. Cloud Messaging stays separate. No paid plan.
   */
  dataMode: 'supabase' as 'mock' | 'firebase' | 'supabase',
  supabaseUrl: 'https://srwdtguxdjsjlkaydhet.supabase.co',
  supabaseKey: 'sb_publishable_bs3aTBGzkc3N6kpAH0oZGg_-i4v5AT3',
  firebase: {
    // Firebase holds accounts only: email + password, and Google. The database,
    // chat and every photo live in Supabase.
    //
    // These are the values the lulafinds-app project actually issues. They are
    // publishable by design - an apiKey identifies the project, it does not
    // authorise anything on its own; row-level security in Supabase does that.
    apiKey: 'AIzaSyAn_rXPhvO0MZvpFhkycbIqM-qkv4rHPi8',
    authDomain: 'lulafinds-app.firebaseapp.com',
    projectId: 'lulafinds-app',
    // Deliberately empty. Storage is Supabase's job, so there is no Firebase
    // bucket to point at. Do not "fill this in" from google-services.json.
    storageBucket: '',
    messagingSenderId: '359295927708',
    appId: '1:359295927708:android:0c1ea47d7256c03e2cf459',
    // No Analytics in this project, so there is nothing to put here.
    measurementId: '',
    /*
     * Web Push key pair (VAPID), from Cloud Messaging -> Web Push certificates.
     *
     * NOT used by the app as it stands. Push goes through the native
     * @capacitor/push-notifications plugin, which authenticates with
     * google-services.json and needs no VAPID key at all - that key is only for
     * the browser's own Push API, via firebase/messaging getToken({ vapidKey }).
     *
     * It is kept here because it is a public key by design (safe to commit, it
     * identifies the server rather than authorising it), and because adding a
     * web build later should not mean digging it back out of the console.
     */
    vapidKey: 'BIvbbUoBiuH8WT2pvo3TmFzJA-78su9kbkr-Z8X09t8lAoF9Ag4CJvtRZSFrjy2Q8Ks6DnEZjhXBIUa5K-V-2xs'
  },
  /**
   * Real numbers the poster calls themselves. LulaFind does not transmit the case.
   * Source of truth: src/app/core/data/sa-help.ts
   */
  escalationPartners: CASE_CONTACTS
};
