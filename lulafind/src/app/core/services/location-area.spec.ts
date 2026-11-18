import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationService } from './location.service';
import { PlatformService } from './platform.service';

describe('Consent-based local area lookup', () => {
  const oldGeo = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: PlatformService, useValue: { isNative: false } }] });
    localStorage.removeItem('lulafind.lastLocation');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (oldGeo) Object.defineProperty(navigator, 'geolocation', oldGeo);
    else Reflect.deleteProperty(navigator, 'geolocation');
  });
  it('does not invent a position or call OpenStreetMap if permission is denied', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (_ok: unknown, fail: (error: unknown) => void) => fail({ code: 1 }) } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const service = TestBed.inject(LocationService);
    expect(await service.detectLocalArea()).toBeNull();
    expect(service.permission()).toBe('denied');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(service.current()).toBeNull();
    expect(localStorage.getItem('lulafind.lastLocation')).toBeNull();
  });
  it('sends a single consented fix to OpenStreetMap and does not persist the GPS point', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok: (position: unknown) => void) => ok({ coords: { latitude: -26.2, longitude: 28.04, accuracy: 5 }, timestamp: 12 }) } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ address: { country_code: 'za', state: 'Gauteng', city: 'Johannesburg' } }), { status: 200 }));
    const service = TestBed.inject(LocationService);
    expect(await service.detectLocalArea()).toEqual({ province: 'GP', town: 'Johannesburg' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('nominatim.openstreetmap.org/reverse?');
    expect(service.current()).toBeNull();
    expect(localStorage.getItem('lulafind.lastLocation')).toBeNull();
  });
  it('keeps a manual option when the lookup is unavailable', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok: (position: unknown) => void) => ok({ coords: { latitude: -26.2, longitude: 28.04 }, timestamp: 12 }) } });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const service = TestBed.inject(LocationService);
    expect(await service.detectLocalArea()).toBeNull();
    expect(service.error()).toContain('Profile');
  });
});
