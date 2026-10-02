import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * The continue URL Firebase is asked to return a person to after they act on an
 * account email.
 *
 * This is the second time this host has bitten. `sendEmailVerification` and
 * `sendPasswordResetEmail` both take a continue URL, and Firebase rejects the
 * ENTIRE request - not just the email - when the URL's host is not on the
 * project's Authorised domains list:
 *
 *     auth/unauthorized-continue-uri
 *     Domain not allowlisted by project
 *
 * `continueUrl()` used to forward `window.location.origin` unconditionally, so
 * on any host that had not been allowlisted - the Arena preview, whose host
 * changes every session - step 5 of account creation failed after the account
 * had already been created. The fix is to only send a host we can know is
 * allowlisted, and to send nothing otherwise.
 */
describe('FirebaseAuthBridge continueUrl', () => {
  // `location` is stubbed rather than `window`: replacing `window` wholesale -
  // even by spreading it - loses the Location prototype, and every other spec
  // in this run that renders an Ionic screen then fails on
  // window.location.search. `origin` itself cannot be shadowed either - it is
  // non-configurable - so the whole `location` is replaced and unstubbed.
  const setOrigin = (origin: string) => {
    vi.stubGlobal('location', { origin });
  };

  let bridge: any;

  const continueUrl = (url?: string) =>
    (bridge as { continueUrl(u?: string): unknown }).continueUrl(url);

  beforeEach(async () => {
    const mod = await import('./firebase-auth');
    bridge = new (mod as any).FirebaseAuthBridge();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the app origin on localhost, which Firebase allows by default', () => {
    setOrigin('http://localhost:4200');
    expect(continueUrl()).toEqual({ url: 'http://localhost:4200/auth', handleCodeInApp: false });
  });

  it('sends the app origin on 127.0.0.1, port included', () => {
    // location.origin carries the port, and it must survive: the allowlist is
    // host-based but the URL has to be one the app actually answers on.
    setOrigin('http://127.0.0.1:4200');
    expect(continueUrl()).toEqual({ url: 'http://127.0.0.1:4200/auth', handleCodeInApp: false });
  });

  it("sends the project's own authDomain, which Firebase adds automatically", () => {
    setOrigin('https://lulafinds-app.firebaseapp.com');
    expect(continueUrl()).toEqual({
      url: 'https://lulafinds-app.firebaseapp.com/auth',
      handleCodeInApp: false
    });
  });

  it('sends nothing on a host that is not allowlisted', () => {
    // The Arena preview. Its host changes every session, so it can never be
    // relied upon to be on the list, and guessing takes the signup down.
    setOrigin('https://4200-iha287cgo5k5lzrv6ejge.e2b.app');
    expect(continueUrl()).toBeUndefined();
  });

  it('sends nothing for an unrecognised custom domain', () => {
    setOrigin('https://lulafind.example');
    expect(continueUrl()).toBeUndefined();
  });

  it('ignores an explicit redirect that points somewhere unsafe', () => {
    setOrigin('http://localhost:4200');
    // A caller-supplied URL must not be able to steer the action link.
    expect(continueUrl('https://evil.example.com/auth')).toBeUndefined();
    expect(continueUrl('not-a-url')).toBeUndefined();
    // Not http(s) at all - a javascript: or data: URL must never be forwarded.
    expect(continueUrl('javascript:alert(1)')).toBeUndefined();
  });

  it('treats an empty redirect as "use the app" rather than as unsafe', () => {
    // '' is falsy, so it falls through to the app origin - which is the same
    // thing a caller who passed nothing asked for.
    setOrigin('http://localhost:4200');
    expect(continueUrl('')).toEqual({ url: 'http://localhost:4200/auth', handleCodeInApp: false });
  });

  it('still accepts an explicit redirect on an allowlisted host', () => {
    setOrigin('http://localhost:4200');
    expect(continueUrl('http://localhost:4200/auth?mode=newpass')).toEqual({
      url: 'http://localhost:4200/auth?mode=newpass',
      handleCodeInApp: false
    });
  });
});
