import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideIonicAngular } from '@ionic/angular';
import { DictationService } from './services/dictation.service';

/**
 * Dictation is the one feature that can quietly lie to a family: a mic that
 * looks live while nothing is captured, or that posts half a sentence they never
 * read. These tests drive a fake SpeechRecognition through the real service.
 */

interface FakeRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  started: boolean;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

let lastRec: FakeRec | null = null;

class FakeRecognition implements FakeRec {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  started = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start(): void {
    this.started = true;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the test drives the instance the service created
    lastRec = this;
  }
  stop(): void { this.started = false; }
  abort(): void { this.started = false; }
}

function heard(rec: FakeRec, final: string[], interim = ''): void {
  const results: Record<number, unknown> = {};
  let n = 0;
  for (const words of final) {
    results[n++] = { isFinal: true, 0: { transcript: words } };
  }
  if (interim) results[n] = { isFinal: false, 0: { transcript: interim } };
  rec.onresult?.({ resultIndex: 0, results: Object.assign(results, { length: n + (interim ? 1 : 0) }) });
}

describe('Dictation: speak into the box, never in secret', () => {
  beforeEach(() => {
    lastRec = null;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideIonicAngular()] });
  });

  it('appends speech to what is already typed instead of replacing it', () => {
    (globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    const d = TestBed.inject(DictationService);
    expect(d.available).toBe(true);

    let box = 'Full name:\nAma Ndlovu\nWhat happened:';
    d.start({ existing: box, apply: (t) => { box = t; } });
    lastRec!.onresult!({
      resultIndex: 0,
      results: Object.assign({ 0: { isFinal: true, 0: { transcript: 'She left school at two.' } }, length: 1 })
    });
    expect(box).toContain('Full name:');
    expect(box).toContain('She left school at two.');
    expect(box.startsWith('Full name:\nAma Ndlovu\nWhat happened:')).toBe(true);
    d.stop();
  });

  it('shows the guessed words as they arrive, then settles them', () => {
    (globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    const d = TestBed.inject(DictationService);
    let box = '';
    d.start({ existing: '', apply: (t) => { box = t; } });
    heard(lastRec!, [], 'She left');
    expect(d.interim()).toBe('She left');
    expect(box).toBe('She left');

    heard(lastRec!, ['She left school at two.']);
    expect(d.interim()).toBe('');
    expect(box).toContain('She left school at two.');
    d.stop();
  });

  it('stops cleanly and never leaves the mic light on', () => {
    (globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    const d = TestBed.inject(DictationService);
    d.start({ existing: '', apply: () => undefined });
    expect(d.listening()).toBe(true);
    d.stop();
    expect(d.listening()).toBe(false);
    expect(d.interim()).toBe('');
    // The browser ending on its own is handled the same way.
    d.start({ existing: '', apply: () => undefined });
    lastRec!.onend?.();
    expect(d.listening()).toBe(false);
  });

  it('explains a blocked microphone instead of doing nothing', () => {
    (globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    const d = TestBed.inject(DictationService);
    d.start({ existing: '', apply: () => undefined });
    lastRec!.onerror?.({ error: 'not-allowed' });
    expect(d.listening()).toBe(false);
    expect(d.error()).toContain('Microphone blocked');
    expect(d.error()).toContain('browser settings');
    d.clearError();
    expect(d.error()).toBe('');
  });

  it('says typing is still possible when dictation needs a connection', () => {
    (globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    const d = TestBed.inject(DictationService);
    d.start({ existing: '', apply: () => undefined });
    lastRec!.onerror?.({ error: 'network' });
    expect(d.error()).toContain('You can type instead');
  });

  it('offers no mic at all where the browser has no speech API', () => {
    delete (globalThis as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (globalThis as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    const d = TestBed.inject(DictationService);
    expect(d.supported()).toBe(false);
    expect(d.available).toBe(false);
    // Calling it anyway is a no-op, not a crash.
    d.start({ existing: '', apply: () => undefined });
    expect(d.listening()).toBe(false);
  });

  it('tells the person where their voice goes, without flattering the app', () => {
    const d = TestBed.inject(DictationService);
    // LulaFind keeps no audio - but it must not claim nothing is uploaded, because
    // the browser's own speech engine does the transcribing.
    expect(d.privacyLine).toContain('keeps no audio');
    expect(d.privacyLine).toContain('browser does the listening');
    expect(d.privacyLine).not.toContain('Nothing is recorded');
  });
});
