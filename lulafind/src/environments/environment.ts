import { CASE_CONTACTS } from '../app/core/data/sa-help';

export const environment = {
  production: false,
  appName: 'LulaFind',
  appVersion: '1.0.0',
  /**
   * Supabase = app data, email/password accounts, recovery and RLS sessions.
   * Firebase Authentication obtains Google identity only; its Google ID token is exchanged for a Supabase session.
   */
  dataMode: 'supabase' as 'mock' | 'firebase' | 'supabase',
  supabaseUrl: 'https://srwdtguxdjsjlkaydhet.supabase.co',
  supabaseKey: 'sb_publishable_bs3aTBGzkc3N6kpAH0oZGg_-i4v5AT3',
  firebase: {
    apiKey: 'AIzaSyAn_rXPhvO0MZvpFhkycbIqM-qkv4rHPi8',
    authDomain: 'lulafinds-app.firebaseapp.com',
    projectId: 'lulafinds-app',
    storageBucket: '',
    messagingSenderId: '359295927708',
    // Copy the real Firebase Web App ID from Project settings → General → Your apps.
    appId: '',
    measurementId: ''
  },
  /**
   * Real numbers the poster calls themselves. LulaFind does not transmit the case.
   * Source of truth: src/app/core/data/sa-help.ts
   */
  escalationPartners: CASE_CONTACTS
};
