import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lulafind.app',
  appName: 'LulaFind',
  // The Angular build writes to www/browser (outputMode: static), so this has
  // to point there - with plain 'www' cap sync finds no index.html and fails.
  webDir: 'www/browser',
  server: { androidScheme: 'https', iosScheme: 'https' },
  android: {
    allowMixedContent: false,
    captureInput: true,
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
