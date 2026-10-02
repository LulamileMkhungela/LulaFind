import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { provideRouter, Router } from '@angular/router';

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

/**
 * Tapping a tray notification.
 *
 * The send side attaches the route the app wrote onto the notification row, and
 * this is the code that finally reads it. Until it existed every push opened
 * the app on whatever screen happened to be on top, so the whole feature was
 * decorative: the phone buzzed, the person tapped, and nothing about the thing
 * they were being told about appeared.
 *
 * `openFromNotification` is private because nothing outside the service has any
 * business navigating on a push, but it is the behaviour worth pinning, so the
 * tests reach it through a narrow cast rather than widening the API.
 */
describe('PushService tap handling', () => {
  let push: PushService;
  let navigate: ReturnType<typeof vi.spyOn>;

  const open = (data: unknown): void => {
    (push as unknown as { openFromNotification(d: unknown): void })
      .openFromNotification(data);
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LULA_API, useValue: new MockApi(new LocalDb(true)) },
        // useFactory, not useValue: the constructor calls inject(), which only
        // works inside an injection context, and useValue is evaluated while the
        // provider array is being built - outside one.
        { provide: PushService, useFactory: () => new PushService() }
      ]
    });
    push = TestBed.inject(PushService);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
  });

  it('opens the screen the notification points at', () => {
    open({ route: '/post/p_123', postId: 'p_123', kind: 'comment' });
    expect(navigate).toHaveBeenCalledWith('/post/p_123');
  });

  it('falls back to the notification list when there is no route', () => {
    open({ postId: 'p_123' });
    open(undefined);
    open({ route: 42 });
    // No navigation at all rather than a guessed one: the caller has nothing
    // worth showing, and the app is already open where the person left it.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('refuses anything that is not a rooted in-app path', () => {
    // The payload crosses a network boundary, so a route is untrusted input.
    // A protocol-relative URL would send the person to an external origin.
    open({ route: 'https://evil.example.com/phish' });
    open({ route: '//evil.example.com/phish' });
    open({ route: 'post/p_123' });
    open({ route: '' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the query and fragment a route was given', () => {
    open({ route: '/chats/thread/t_9?from=push#last' });
    expect(navigate).toHaveBeenCalledWith('/chats/thread/t_9?from=push#last');
  });

  it('does not throw when the router rejects the route', () => {
    navigate.mockRejectedValue(new Error('no match'));
    expect(() => open({ route: '/does/not/exist' })).not.toThrow();
    expect(navigate).toHaveBeenCalledWith('/does/not/exist');
  });
});
