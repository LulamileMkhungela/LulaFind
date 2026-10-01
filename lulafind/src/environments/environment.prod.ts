import { CASE_CONTACTS } from '../app/core/data/sa-help';

export const environment = {
  production: true,
  appName: 'LulaFind',
  appVersion: '1.0.0',
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
    measurementId: ''
  },
  escalationPartners: CASE_CONTACTS
};
