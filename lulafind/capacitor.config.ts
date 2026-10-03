import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lulafind.app',
  appName: 'LulaFind',
  // Where `ng build` actually writes (angular.json: outputPath browser = '').
  // This said 'www/browser', which is not a directory this project ever
  // produces, so `cap sync` failed before it could copy a single asset.
  webDir: 'www',
  server: { androidScheme: 'https', iosScheme: 'https' },
  android: {
    allowMixedContent: false,
    // `captureInput: true` used to sit here. It is not an option in Capacitor 8
    // - nothing in @capacitor/* reads it - so it was silently doing nothing.
    // The phone keyboard is handled by windowSoftInputMode in the manifest and
    // by the Keyboard plugin below.
    webContentsDebuggingEnabled: false
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#FFFFFF',
      androidSplashResourceName: 'splash',
      showSpinner: false
    },
    Keyboard: { resize: 'ionic', resizeOnFullScreen: true },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    // Native Google sheet; the Firebase JS SDK then holds the session (skipNativeAuth).
    FirebaseAuthentication: { skipNativeAuth: true, providers: ['google.com'] }
  }
};

export default config;
