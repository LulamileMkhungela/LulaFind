import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provideIonicAngular } from '@ionic/angular';
import { VoiceRecorderService } from './services/voice-recorder.service';
import { DictationService } from './services/dictation.service';

/**
 * The voice note is the one feature a family may rely on when they cannot type,
 * so the failure modes matter more than the happy path: a mic that opens and
 * records nothing, a permission that is refused silently, or a note that is
 * attached empty. Each of those is driven here.
 */

class FakeRecorder {
  static instance: FakeRecorder | null = null;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public stream: unknown, public opts?: { mimeType?: string }) {
    FakeRecorder.instance = this;
    if (opts?.mimeType) this.mimeType = opts.mimeType;
  }
  static isTypeSupported(): boolean { return true; }
  start(): void { this.state = 'recording'; }
  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice-bytes'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const trackStop = vi.fn();
const fakeStream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;

describe('Voice recorder: real audio, honestly reported', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideIonicAngular()] });
    trackStop.mockClear();
    FakeRecorder.instance = null;
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => fakeStream) }
    });
    // FileReader is used to turn the blob into a data: URL, exactly like a photo.
    (globalThis as unknown as { FileReader: unknown }).FileReader = class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(blob: Blob): void {
        this.result = `data:${blob.type};base64,AAAA`;
        setTimeout(() => this.onload?.(), 0);
      }
    };
  });

  it('records a note and hands back playable audio with its length', async () => {
    const r = TestBed.inject(VoiceRecorderService);
    expect(r.available).toBe(true);

    const pending = r.record();
    // The mic permission resolves first, so the timer starts a tick later -
    // the UI shows "starting" until then rather than a running clock.
    await new Promise((res) => setTimeout(res, 10));
    expect(r.recording()).toBe(true);
    r.stop();
    const note = await pending;

    expect(note).toBeTruthy();
    expect(note!.kind).toBe('audio');
    // A data URL, so the existing uploader stores it without knowing audio exists.
    expect(note!.src.startsWith('data:audio')).toBe(true);
    expect(note!.durationSec).toBeGreaterThanOrEqual(1);
    expect(r.recording()).toBe(false);
    // The microphone light goes out.
    expect(trackStop).toHaveBeenCalled();
  });

  it('cancelling throws the note away and closes the mic', async () => {
    const r = TestBed.inject(VoiceRecorderService);
    const pending = r.record();
    await new Promise((res) => setTimeout(res, 10));
    r.cancel();
    expect(await pending).toBeNull();
    expect(r.recording()).toBe(false);
    expect(trackStop).toHaveBeenCalled();
  });

  it('says why when the microphone is refused, and never pretends to record', async () => {
    (navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia =
      vi.fn(async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); });
    const r = TestBed.inject(VoiceRecorderService);
    const note = await r.record();
    expect(note).toBeNull();
    expect(r.recording()).toBe(false);
    expect(r.error()).toContain('Microphone blocked');
    expect(r.error()).toContain('phone settings');
  });

  it('offers no record button on a device that cannot record', async () => {
    delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    const r = TestBed.inject(VoiceRecorderService);
    expect(r.available).toBe(false);
    expect(await r.record()).toBeNull();
    expect(r.error()).toContain('type instead');
  });

  it('reports an empty recording rather than attaching a silent note', async () => {
    const r = TestBed.inject(VoiceRecorderService);
    const pending = r.record();
    await new Promise((res) => setTimeout(res, 10));
    // A recorder that stops without ever delivering data - seen on some Android WebViews.
    FakeRecorder.instance!.ondataavailable = null;
    r.stop();
    expect(await pending).toBeNull();
    expect(r.error()).toContain('Nothing was recorded');
  });

  it('stops itself at the two-minute limit instead of recording past what uploads', () => {
    const r = TestBed.inject(VoiceRecorderService);
    r.seconds.set(120);
    expect(r.limitReached).toBe(true);
    expect(r.clock).toBe('2:00');
    r.seconds.set(64);
    expect(r.clock).toBe('1:04');
  });

  it('writes down what was said, and leaves the words out when the device cannot hear them', async () => {
    // The words are saved beside the audio, so someone who cannot hear the note
    // can still read it. When the phone has no speech engine the note records
    // exactly as before - it just carries no transcript, and the player offers
    // no "Read it instead" it could not honour.
    const dictation = TestBed.inject(DictationService);
    const service = TestBed.inject(VoiceRecorderService);
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    w.SpeechRecognition = class {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start(): void { this.started = true; }
      stop(): void { this.stopped = true; }
      started = false;
      stopped = false;
    };
    const seen: { apply: ((text: string) => void) | null } = { apply: null };
    const started = vi.spyOn(dictation, 'start').mockImplementation((target) => { seen.apply = target.apply; });
    const stoppedSpy = vi.spyOn(dictation, 'stop');

    const pending = service.record();
    await new Promise((r) => setTimeout(r, 10));
    // The speech engine is asked to listen beside the recording, into its own slot.
    expect(started).toHaveBeenCalledTimes(1);
    seen.apply!('she was wearing a grey cardigan');
    service.stop();
    const note = await pending;
    expect(note?.transcript).toBe('she was wearing a grey cardigan');
    // The listener that wrote it is closed when the recording ends.
    expect(stoppedSpy).toHaveBeenCalled();

    // A device with no speech engine: still records, and claims no transcript.
    // `supported` is a computed that is read once and cached, exactly as it is in
    // the app, so it is replaced here to stand in for a phone that never had it.
    Object.defineProperty(dictation, 'supported', { configurable: true, value: () => false });
    started.mockClear();
    const second = service.record();
    await new Promise((r) => setTimeout(r, 10));
    expect(started).not.toHaveBeenCalled();
    service.stop();
    const plain = await second;
    expect(plain?.transcript).toBeUndefined();
    expect(plain?.src.startsWith('data:audio/')).toBe(true);

    // And a device that listens but hears nothing says nothing: no empty claim.
    Object.defineProperty(dictation, 'supported', { configurable: true, value: () => true });
    const third = service.record();
    await new Promise((r) => setTimeout(r, 10));
    service.stop();
    const silent = await third;
    expect(silent?.transcript).toBeUndefined();
  });
});
