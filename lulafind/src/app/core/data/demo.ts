import { signal } from '@angular/core';
import { environment } from '../../../environments/environment';

/**
 * Demo mode - the built-in sample dataset instead of the live database.
 *
 * This exists so the app can be shown, reviewed and tested without a backend:
 * open any page with `?demo=1` (the choice is remembered for the tab, `?demo=0`
 * turns it off again). It is deliberately impossible in a production build - a
 * person tapping a link must always see real cases, never invented ones.
 *
 * Every screen shows a banner while it is on, so a demo can never be mistaken
 * for the live app.
 */

const KEY = 'lulafind.demo';
const LOCAL_KEY = 'lulafind.data.local';

/** True while the sample dataset is being served. Read by the app shell banner. */
export const demoMode = signal(false);

/** The tab's explicit choice, or null when the person has not made one. */
function remembered(): boolean | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

function remember(on: boolean): void {
  try {
    // Store the "off" answer too: on the preview host demo mode is on by
    // default, and ?demo=0 has to stick rather than be re-applied on reload.
    sessionStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode - the choice then lasts until the next navigation only */
  }
}

/**
 * The hosted preview (*.e2b.app) is a development server with no account to
 * sign in with, so the sample dataset is used there by default. It is still
 * refused outright in a production build, `?demo=0` still turns it off for the
 * tab, and the demo banner stays visible the whole time.
 */
export function shouldDefaultToDemo(hostname: string, production: boolean): boolean {
  if (production) return false;
  const host = (hostname || '').toLowerCase();
  // The hosted preview proxies a development server through *.e2b.app.
  if (host.endsWith('.e2b.app')) return true;
  // A development build opened from any other machine (a phone or a tablet on
  // the same network, another proxy) also has no account set up, so it starts
  // on the sample data too. localhost stays a clean install; `?demo=0` opts out.
  return host !== '' && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]';
}

function previewHost(): boolean {
  return typeof window !== 'undefined'
    && shouldDefaultToDemo(window.location.hostname, !!environment.production);
}

/**
 * Local data mode: the app's own store on this device is the database.
 *
 * Development builds only (`?data=local`), and there is no sample data in it -
 * accounts, cases and lookouts are created by using the app exactly as a person
 * would. It exists for two honest reasons: the app has to keep working when the
 * network is down, and reviewers and tests need to drive the real screens and
 * the real services without a reachable backend. A production build never takes
 * this branch, and every screen says while it is on.
 */
export const localMode = signal(false);

export function localRequested(): boolean {
  if (environment.production || typeof window === 'undefined') return false;
  let flag: string | null = null;
  try {
    const q = new URLSearchParams(window.location.search).get('data');
    if (q === 'local') { sessionStorage.setItem(LOCAL_KEY, '1'); flag = '1'; }
    else if (q === 'live') { sessionStorage.removeItem(LOCAL_KEY); flag = null; }
    else flag = sessionStorage.getItem(LOCAL_KEY);
  } catch {
    return false;
  }
  localMode.set(flag === '1');
  return flag === '1';
}

/** Decide once, at start-up, whether this tab is in demo mode. */
export function demoRequested(): boolean {
  if (environment.production || typeof window === 'undefined') return false;
  let flag: string | null = null;
  try {
    flag = new URL(window.location.href).searchParams.get('demo');
  } catch {
    flag = null;
  }
  if (flag === '1') { remember(true); demoMode.set(true); }
  else if (flag === '0') { remember(false); demoMode.set(false); }
  else demoMode.set(remembered() ?? previewHost());
  return demoMode();
}
