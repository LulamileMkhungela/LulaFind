import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { getFirebaseApp } from '../data/firebase-app';

export interface FirebaseGoogleIdentity {
  /** Google-issued OAuth ID token. Do not substitute the Firebase Auth ID token. */
  idToken: string;
  email?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
}

/** Google sign-in through Firebase, with the provider ID token returned for Supabase. */
@Injectable({ providedIn: 'root' })
export class FirebaseGoogleAuthService {
  async signInWithGoogle(): Promise<FirebaseGoogleIdentity> {
    if (!environment.firebase.apiKey || !environment.firebase.projectId) {
      throw new Error('Firebase Authentication is not configured for this app.');
    }

    if (Capacitor.isNativePlatform()) {
      const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
      const result = await FirebaseAuthentication.signInWithGoogle();
      const idToken = result.credential?.idToken;
      if (!result.user || !idToken) {
        throw new Error('Google sign-in did not return a Google ID token. Please try again.');
      }
      return {
        idToken,
        email: result.user.email,
        displayName: result.user.displayName,
        photoUrl: result.user.photoUrl
      };
    }

    if (!environment.firebase.appId) {
      throw new Error(
        'Firebase Web App ID is missing. Add it from Firebase Console → Project settings → General → Your apps.'
      );
    }

    const [{ getAuth, GoogleAuthProvider, signInWithPopup }, app] = await Promise.all([
      import('firebase/auth'),
      getFirebaseApp()
    ]);
    const auth = getAuth(app);
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.idToken) {
      throw new Error('Google sign-in did not return a Google ID token. Please try again.');
    }
    return {
      idToken: credential.idToken,
      email: result.user.email,
      displayName: result.user.displayName,
      photoUrl: result.user.photoURL
    };
  }

  /** Clear the Firebase-side identity as well as the Supabase data session. */
  async signOut(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
      const { user } = await FirebaseAuthentication.getCurrentUser();
      if (user) await FirebaseAuthentication.signOut();
      return;
    }

    const { getApps } = await import('firebase/app');
    const app = getApps().find((item) => item.name === '[DEFAULT]');
    if (!app) return;
    const { getAuth, signOut } = await import('firebase/auth');
    const auth = getAuth(app);
    if (auth.currentUser) await signOut(auth);
  }
}
