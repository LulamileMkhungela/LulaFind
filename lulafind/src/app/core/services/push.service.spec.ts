import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { provideRouter } from '@angular/router';

import { LocalDb } from '../data/local-db';
import { LULA_API, MockApi } from '../data/api';
import { PushService } from './push.service';

/**
 * PushService in a browser.
 *
 * The service must be a polite no-op off a phone: no throw, no fake token,
 * no fake "registered". The native half (permission -> register -> token)
 * is exercised on a device; here we pin the contract the rest of the app
 * builds on.
 *
 * Since the token started being filed against the account, the service also
 * takes LULA_API and AuthService. Those are provided for real so a missing
 * provider fails loudly here rather than on a device.
 */
let saved: { token: string; platform: string; appVersion: string }[] = [];
let forgotten: string[] = [];

describe('PushService (web)', () => {
  let push: PushService;

  beforeEach(() => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('lulafind.'))
        .forEach((k) => localStorage.removeItem(k));
    } catch { /* node */ }

    saved = [];
    forgotten = [];

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LULA_API, useValue: new MockApi(new LocalDb(true)) },
        // A spy that records what the service tried to file, so the tests can
        // assert the token actually left the phone instead of only checking
        // the in-memory signal.
        {
          provide: PushService,
          useFactory: () => {
            const real = new PushService();
            const api = TestBed.inject(LULA_API) as unknown as {
              savePushToken(t: string, p: string, v: string): Promise<void>;
              forgetPushToken(t: string): Promise<void>;
            };
            api.savePushToken = async (t, p, v) => { saved.push({ token: t, platform: p, appVersion: v }); };
            api.forgetPushToken = async (t) => { forgotten.push(t); };
            return real;
          }
        }
      ]
    });
    push = TestBed.inject(PushService);
  });

  it('does nothing on app start in a browser', async () => {
    await push.init();
    expect(push.token()).toBeNull();
    expect(push.registered()).toBe(false);
    expect(push.registrationError()).toBeNull();
  });

  it('refuses to register in a browser and says nothing fake', async () => {
    const ok = await push.requestAndRegister();
    expect(ok).toBe(false);
    expect(push.registered()).toBe(false);
    expect(push.registrationError()).toBeNull();
  });

  it('clears the token back to a fresh state', async () => {
    await push.clearToken();
    expect(push.token()).toBeNull();
    expect(push.registered()).toBe(false);
    expect(push.registrationError()).toBeNull();
  });

  it('never files a token while there is no FCM on the device', async () => {
    await push.init();
    await push.requestAndRegister();
    // The web build has no plugin, so registration never fires and nothing is
    // written. A token that never existed cannot be leaked to the server.
    expect(saved).toEqual([]);
    expect(forgotten).toEqual([]);
  });

  it('does not throw when clearing a token that was never issued', async () => {
    await expect(push.clearToken()).resolves.toBeUndefined();
    expect(forgotten).toEqual([]);
  });
});
