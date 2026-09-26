import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Routes that require a signed-in user. Guests are sent to the auth flow. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.signedIn()) return true;
  return router.createUrlTree(['/auth'], { queryParams: { next: state.url } });
};

/**
 * Write actions (post, comment, vote, chat) are gated in-place with a toast or a
 * sign-in prompt rather than a hard redirect, so guests can still browse.
 * This helper centralises that decision.
 */
export const requireUser = (): boolean => {
  const auth = inject(AuthService);
  return auth.signedIn();
};
