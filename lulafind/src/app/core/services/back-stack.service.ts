import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { NavController } from '@ionic/angular/nav-controller';
import { filter } from 'rxjs/operators';

/**
 * The app's own back stack.
 *
 * Ionic's tab outlets rewrite the browser history (replaceState/pushState on
 * every tab render), so window.history.back() does not reliably land on the
 * page the person came from - it can strand you on a tab or even jump past it
 * to a page you already left. This service records only Angular navigations
 * and goes back through that record; on a cold deep link the stack holds a
 * single entry and back lands on the page's declared fallback.
 */
@Injectable({ providedIn: 'root' })
export class BackStackService {
  private readonly router = inject(Router);
  private readonly nav = inject(NavController);
  private stack: string[] = [];
  private suppressPop = false;
  private static readonly MAX = 40;

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const url = e.urlAfterRedirects;
        if (this.suppressPop) {
          this.suppressPop = false;
          // The navigation is the "back" action itself: drop the page we just left.
          this.stack.pop();
          return;
        }
        if (this.stack[this.stack.length - 1] === url) return;
        this.stack.push(url);
        if (this.stack.length > BackStackService.MAX) this.stack.shift();
      });
  }

  /** Go to the previous in-app page; on a cold deep link, land on the fallback. */
  go(fallback: string): void {
    const current = this.router.url;
    if (this.stack.length < 2) {
      // A deep link has no known in-app predecessor. Never rely on the
      // browser/Ionic history, which can point to another app or the same page.
      if (current !== fallback) void this.nav.navigateBack(fallback);

      return;
    }
    const previous = this.stack[this.stack.length - 2];
    if (previous === current) {
      if (current !== fallback) void this.nav.navigateBack(fallback);
      return;
    }
    this.suppressPop = true;
    void this.nav.navigateBack(previous).then((ok) => {
      if (!ok) { this.suppressPop = false; if (this.router.url !== fallback) void this.router.navigateByUrl(fallback); }
    }).catch(() => { this.suppressPop = false; if (this.router.url !== fallback) void this.router.navigateByUrl(fallback); });
  }
}
