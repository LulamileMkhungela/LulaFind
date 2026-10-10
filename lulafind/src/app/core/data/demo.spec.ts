import { describe, expect, it } from 'vitest';
import { shouldDefaultToDemo } from './demo';

/**
 * Where the sample dataset starts on its own.
 *
 * The rule matters because it decides whether a reviewer sees real-looking
 * cases without creating an account - and it must never be able to do that in
 * a production build, whatever the hostname says.
 */
describe('sample-data default', () => {
  it('is refused in a production build on every host', () => {
    for (const host of ['4200-abc.e2b.app', 'preview.example.com', '192.168.4.20', 'localhost', '']) {
      expect(shouldDefaultToDemo(host, true), host).toBe(false);
    }
  });
  it('is on for the hosted preview even with odd casing', () => {
    expect(shouldDefaultToDemo('4200-abc123.e2b.app', false)).toBe(true);
    expect(shouldDefaultToDemo('4200-ABC123.E2B.APP', false)).toBe(true);
  });
  it('is on for a development build opened from another machine', () => {
    expect(shouldDefaultToDemo('192.168.4.20', false)).toBe(true);
    expect(shouldDefaultToDemo('preview.internal', false)).toBe(true);
  });
  it('stays off for a development build on this machine', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '']) {
      expect(shouldDefaultToDemo(host, false), host).toBe(false);
    }
  });
});
