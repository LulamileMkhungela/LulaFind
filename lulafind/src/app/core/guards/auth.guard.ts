import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Routes that require a signed-in user; everyone else goes to the auth screen.
 *
 * The `await` matters. `signedIn()` is false for the first moments of every cold
 * start - the stored session has not been read yet - so a guard that answered
 * immediately would push a signed-in person out to the login screen on every
 * reload. Waiting for the first check means the answer is the real one, and the
 * decision happens before the page paints, so nothing flashes.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();
  if (auth.signedIn()) return true;
  return router.createUrlTree(['/auth'], { queryParams: { next: state.url } });
};

/**
 * Routes that require the signed-in user to have isAdmin = true.
 * Non-admin signed-in users are redirected to home, not to the auth screen.
 */
export const adminGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();
  if (!auth.signedIn()) {
    return router.createUrlTree(['/auth'], { queryParams: { next: state.url } });
  }
  if (auth.user()?.isAdmin) return true;
  return router.createUrlTree(['/home']);
};

/**
 * Write actions (post, comment, vote, chat) are gated in-place with a toast or a
 * sign-in prompt rather than a hard redirect. This helper centralises that
 * decision for the few places that can still be reached without an account - a
 * shared link to a case or a Spotlight.
 */
export const requireUser = (): boolean => {
  const auth = inject(AuthService);
  return auth.signedIn();
};
