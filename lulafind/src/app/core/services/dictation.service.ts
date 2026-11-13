import { Injectable, computed, inject, signal } from '@angular/core';
import { PlatformService } from './platform.service';

/**
 * Typing a case one-handed on a phone is the slowest part of the worst day a
 * family will have. This lets them speak it instead.
 *
 * How it works matters, so it is stated plainly rather than hidden:
 *
 * - **Web / Android WebView** use the browser's own speech recognition
 *   (`SpeechRecognition`). Support is real but uneven, and in some browsers it
 *   sends audio to a server to transcribe it.
 * - **iOS WebView** has no such API at all. The mic button is not shown there,
 *   rather than shown and broken.
 * - **LulaFind keeps no audio.** The words are placed in the text box as the
 *   person speaks, so they can read and correct them before posting. There is no
 *   audio file in LulaFind, and nothing is stored after the tap.
 *
 * That is different from the **voice note recorder** (voice-recorder.service.ts),
 * which records a real audio file on the device and attaches it to the post. When
 * someone truly cannot type - or wants their own voice on the case - that is the
 * feature to use, and it does not depend on this browser API.
 *
 * The copy in the UI says this in one line, because "tap the mic on a missing
 * child's case" deserves to know where the words go.
 */

export interface DictationTarget {
  /** the text already in the box; dictation appends to it */
  existing: string;
  /** called with the full new text, never just the fragment */
  apply: (text: string) => void;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: { isFinal: boolean; 0: { transcript: string } };
  };
}

type WindowWithSpeech = Window & {
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
};

@Injectable({ providedIn: 'root' })
export class DictationService {
  private platform = inject(PlatformService);

  /** True while the microphone is open. */
  readonly listening = signal(false);
  /** A live fragment the browser is still guessing at, shown greyed out. */
  readonly interim = signal('');
  /** Set when the last attempt failed, so the UI can explain instead of nothing happening. */
  readonly error = signal('');

  /**
   * Whether this device can offer dictation at all.
   *
   * Checked once: a browser without the API cannot gain it mid-session, and
   * iOS never has it inside the app shell.
   */
  readonly supported = computed(() => !!this.ctor());

  private recognition: SpeechRecognitionLike | null = null;
  private target: DictationTarget | null = null;
  /** The text as it was when dictation started, plus everything already settled. */
  private settled = '';

  private ctor(): RecognitionCtor | null {
    if (typeof window === 'undefined') return null;
    const w = window as WindowWithSpeech;
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }

  /**
   * Start listening, appending to `target.existing`.
   *
   * Calling this twice is safe; the second call does nothing while the first is
   * still running.
   */
  start(target: DictationTarget): void {
    const Ctor = this.ctor();
    if (!Ctor || this.listening()) return;
    this.error.set('');
    this.target = target;
    this.settled = target.existing.trim() ? target.existing.replace(/\s+$/, '') + ' ' : '';
    this.interim.set('');

    const rec = new Ctor();
    // South African English is the one to default to; the API has no isiZulu or
    // Sesotho model in these browsers, and offering a menu of accents nobody can
    // verify is worse than one honest default.
    rec.lang = 'en-ZA';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.recognition = rec;

    rec.onresult = (event) => {
      let live = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const words = result[0]?.transcript ?? '';
        if (result.isFinal) {
          this.settled = (this.settled + words.trim() + ' ').replace(/\s{2,}/g, ' ');
        } else {
          live += words;
        }
      }
      this.interim.set(live);
      this.target?.apply((this.settled + live).trim());
    };

    rec.onerror = (e) => {
      const code = e?.error ?? '';
      this.error.set(
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Microphone blocked. Allow it in your browser settings to speak instead of typing.'
          : code === 'no-speech'
            ? 'Nothing was heard. Tap the mic and speak again.'
            : code === 'network'
              ? 'Dictation needs a connection in this browser. You can type instead.'
              : 'Dictation stopped. You can type instead.'
      );
      this.stop();
    };

    rec.onend = () => {
      // The browser ends on its own after a pause. If the person did not stop it,
      // close cleanly rather than leaving a mic light on.
      this.listening.set(false);
      this.interim.set('');
      this.recognition = null;
    };

    try {
      rec.start();
      this.listening.set(true);
    } catch {
      // Some browsers throw if start() is called too soon after a previous stop.
      this.error.set('Dictation could not start. Try again in a moment, or type instead.');
      this.listening.set(false);
    }
  }

  stop(): void {
    const rec = this.recognition;
    this.recognition = null;
    this.listening.set(false);
    this.interim.set('');
    try {
      rec?.stop();
    } catch {
      // Already stopped - nothing to do.
    }
  }

  toggle(target: DictationTarget): void {
    if (this.listening()) this.stop();
    else this.start(target);
  }

  clearError(): void {
    this.error.set('');
  }

  /**
   * What the mic does with a voice, in one line, without flattering the app.
   *
   * Dictation is not a private channel: the browser's speech engine transcribes
   * it, and in Chrome that happens on Google's servers. LulaFind keeps no audio,
   * but saying "nothing is uploaded" would be untrue of the act of dictating, so
   * the two are separated - no file is kept, and the browser does the listening.
   */
  get privacyLine(): string {
    return 'Turns speech into text as you talk. LulaFind keeps no audio, and the browser does the listening.';
  }

  /** Dictation is not offered in the iOS app shell, where the API is absent. */
  get available(): boolean {
    return this.supported() && !(this.platform.isNative && this.isIos());
  }

  private isIos(): boolean {
    try {
      return /iP(hone|ad|od)/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    } catch {
      return false;
    }
  }
}
