import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SettingsService } from './settings.service';

/**
 * Makes navigation feel instant.
 *
 * Every screen is its own lazily-loaded chunk. The first tap used to wait on
 * the network. This walks the route table and imports every screen as soon as
 * the app starts, a few at a time, so the code is already in memory.
 *
 * It is a real download - the whole app, roughly half a megabyte - so it is
 * skipped when the person asked to save data (the Data saver switch, or the
 * phone's own "reduce data" setting), on a slow connection (2G), and when the
 * app is offline. A tap can still warm one screen on demand (`warm`).
 */
@Injectable({ providedIn: 'root' })
export class PrefetchService {
  private router = inject(Router);
  private settings = inject(SettingsService);

  readonly done = signal(false);
  readonly count = signal(0);
  /** True when the background walk was skipped to save data. */
  readonly skipped = signal(false);

  private started = false;

  /** Call once, as early as the app is alive. */
  start(delayMs = 0): void {
    if (this.started) return;
    this.started = true;
    if (!prefetchAllowed(environmentForPrefetch(this.settings))) {
      this.skipped.set(true);
      this.done.set(true);
      return;
    }
    const kick = () => void this.run();
    if (delayMs > 0 && typeof setTimeout !== 'undefined') setTimeout(kick, delayMs);
    else kick();
  }

  /** Pull one screen's code now — used when a tap is imminent. */
  async warm(loader: () => Promise<unknown>): Promise<void> {
    try { await loader(); } catch { /* offline: the normal lazy load will retry */ }
  }

  private async run(): Promise<void> {
    const loaders = collectLoaders(this.router.config);
    const batch = 4;
    for (let i = 0; i < loaders.length; i += batch) {
      await Promise.all(loaders.slice(i, i + batch).map(async (load) => {
        try { await load(); } catch { /* a failed prefetch must never break the app */ }
        this.count.update((n) => n + 1);
      }));
      await this.yieldToUser();
    }
    this.done.set(true);
  }

  private yieldToUser(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  }
}

/** Pull every loadComponent / loadChildren out of the route tree. */
function collectLoaders(routes: unknown[], out: Array<() => Promise<unknown>> = []): Array<() => Promise<unknown>> {
  for (const r of routes as Array<Record<string, unknown>>) {
    const lc = r['loadComponent'];
    if (typeof lc === 'function') out.push(lc as () => Promise<unknown>);
    const ll = r['loadChildren'];
    if (typeof ll === 'function') out.push(ll as () => Promise<unknown>);
    const children = r['children'];
    if (Array.isArray(children)) collectLoaders(children, out);
  }
  return out;
}

/** What the decision needs to know. Kept as plain data so it can be tested. */
export interface PrefetchEnv {
  /** The person's own Data saver switch. */
  dataSaving: boolean;
  /** The phone or browser asking apps to reduce data. */
  saveData?: boolean;
  /** navigator.connection.effectiveType when the browser reports it. */
  effectiveType?: string;
  online?: boolean;
}

/**
 * Should the app pull every screen down in the background?
 *
 * Half a megabyte is worth it on wifi and cheap on a modern phone plan; it is
 * not worth it when someone has said they are saving data, when their phone
 * asks for less, or on a 2G link. The app still works - a screen loads when it
 * is opened, it just takes the network round-trip it would have taken anyway.
 */
export function prefetchAllowed(env: PrefetchEnv): boolean {
  if (env.online === false) return false;
  if (env.dataSaving) return false;
  if (env.saveData) return false;
  const type = (env.effectiveType ?? '').toLowerCase();
  if (type === 'slow-2g' || type === '2g') return false;
  return true;
}

/** Read the browser's connection facts, if it has any. */
function environmentForPrefetch(settings: SettingsService): PrefetchEnv {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  });
  const conn = nav?.connection;
  return {
    dataSaving: settings.settings().dataSaving,
    saveData: conn?.saveData,
    effectiveType: conn?.effectiveType,
    online: nav ? nav.onLine : true
  };
}
