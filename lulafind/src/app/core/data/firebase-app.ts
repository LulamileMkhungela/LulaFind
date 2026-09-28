import type { FirebaseOptions } from 'firebase/app';
import { environment } from '../../../environments/environment';

/**
 * Return the single Firebase app shared by Firestore and Firebase Authentication.
 * Keeping one default app avoids the duplicate-app error when both services are used.
 */
export async function getFirebaseApp(config: FirebaseOptions = environment.firebase): Promise<import('firebase/app').FirebaseApp> {
  const { getApps, initializeApp } = await import('firebase/app');
  const existing = getApps().find((app) => app.name === '[DEFAULT]');
  if (existing) {
    if (existing.options.projectId !== config.projectId) {
      throw new Error('A different Firebase project is already initialized in this app.');
    }
    return existing;
  }

  if (!config.apiKey || !config.projectId || !config.appId) {
    throw new Error(
      'Firebase Web Authentication is not configured. Add the Web App ID from Firebase Console → Project settings → General → Your apps to src/environments/environment.ts and environment.prod.ts.'
    );
  }

  return initializeApp(config);
}
