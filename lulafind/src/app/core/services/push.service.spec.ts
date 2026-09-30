import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import { PushService } from './push.service';

/**
 * PushService in a browser.
 *
 * The service must be a polite no-op off a phone: no throw, no fake token,
 * no fake "registered". The native half (permission -> register -> token)
 * is exercised on a device; here we pin the contract the rest of the app
 * builds on.
 */
describe('PushService (web)', () => {
  let push: PushService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
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
});
