import { Router } from '@angular/router';

/**
 * Go back to wherever the person actually came from.
 *
 * The app's own Angular history knows the in-app tab/query/filter/scroll
 * context that opened the page; the browser's `history.length` does not (it
 * counts the page that hosted the app, which could eject a deep link out of
 * LulaFind entirely). A direct deep link has no prior in-app navigation, so
 * it lands on the page fallback instead.
 */
export function goBack(router: Router, fallback: string): void {
  if (typeof window !== 'undefined' && Number(window.history.state?.navigationId ?? 0) > 1) {
    window.history.back();
    return;
  }
  void router.navigateByUrl(fallback);
}
