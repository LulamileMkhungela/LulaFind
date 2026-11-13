import { Injectable, inject, signal } from '@angular/core';
import { AUDIO_MAX_BYTES, AUDIO_MAX_SECONDS } from '../models/media-rules';
import { MediaItem } from '../models/types';
import { uid } from '../utils/format';
import { PlatformService } from './platform.service';
import { DictationService } from './dictation.service';

/**
 * Recording a voice note.
 *
 * This is the thing that works *in the app*, which browser dictation does not.
 * It records real audio with `MediaRecorder` over `navigator.mediaDevices`,
 * which runs inside the Android WebView and in every modern browser. iOS gets
 * it too, from WebKit 14.3 onwards.
 *
 * Why a voice note at all: the person opening a case is often frightened,
 * typing one-handed on a borrowed phone, and writing "she was wearing a grey
 * cardigan with a broken zip" takes minutes they do not have. Speaking it takes
 * seconds, and their own voice carries detail that a form does not ask for.
 *
 * The file is kept on the device until the post is published - LulaFind has no
 * server that hears audio before the family chooses to post it.
 *
 * The transcript is the exception, and it is said out loud in the composer while
 * it happens: the device's own speech engine writes the words down (in Chrome
 * that engine sends the audio to Google, in Safari to Apple). It is offered
 * because a deaf reader cannot hear a voice note, and it is refused on a phone
 * with no speech engine rather than faked. A note is still recorded, and still
 * stays local, when the transcript is off.
 *
 * Two honesty rules, because this is a missing-person app:
 * - The mic opens only when the person taps record, and the recording is visible
 *   the whole time it runs (a timer, and a stop button that is not hidden).
 * - If the device refuses the microphone, the UI says why and offers the
 *   keyboard. It never silently records nothing.
 */
@Injectable({ providedIn: 'root' })
export class VoiceRecorderService {
  private platform = inject(PlatformService);
  private dictation = inject(DictationService);

  readonly recording = signal(false);
  /** Seconds elapsed, so the UI can count up and stop itself at the limit. */
  readonly seconds = signal(0);
  readonly error = signal('');

  /**
   * Whether the recording is "locked" - WhatsApp's slide-up-to-lock.
   *
   * Unlocked, the person must keep their finger on the button and the recording
   * stops when it lifts. Locked, the finger can come off and the recording keeps
   * going until they press stop, which is what lets someone talk for a minute
   * without holding the phone at an awkward angle.
   */
  readonly locked = signal(false);

  /**
   * The words of the note as it is being spoken, when this device can hear them.
   *
   * A deaf reader, or someone on a loud taxi, should not be locked out of what a
   * family said. The phone's own speech engine writes the words while the
   * recording runs, and they are saved beside the audio; when the device has no
   * speech engine the player simply has no "Read it instead" - it never offers a
   * transcript that is not there.
   */
  readonly transcript = signal('');

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private stopResolve: ((item: MediaItem | null) => void) | null = null;

  /**
   * Whether this device can record at all.
   *
   * Checked by capability, not by platform guess: an old WebView without
   * MediaRecorder gets no record button rather than a broken one.
   */
  get available(): boolean {
    try {
      return typeof navigator !== 'undefined'
        && !!navigator.mediaDevices?.getUserMedia
        && typeof MediaRecorder !== 'undefined';
    } catch {
      return false;
    }
  }

  /** The one MIME type this device will actually produce, or '' if none. */
  get mimeType(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = this.platform.isNative
      // Android WebView and iOS both handle these; webm is not universally
      // playable in Safari, which is why mp4 comes first.
      ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
      : ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'];
    for (const type of candidates) {
      try {
        if (MediaRecorder.isTypeSupported?.(type)) return type;
      } catch {
        // isTypeSupported is missing on very old builds; try the next one.
      }
    }
    return '';
  }

  /** "1:04" - the timer the person watches while they speak. */
  get clock(): string {
    const total = this.seconds();
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  get limitReached(): boolean {
    return this.seconds() >= AUDIO_MAX_SECONDS;
  }

  /**
   * Ask for the microphone and start recording.
   *
   * Resolves to the finished voice note when the person stops, or null if the
   * recording could not start. The promise stays pending while recording so a
   * caller can simply `await record()` and get the item back.
   */
  async record(): Promise<MediaItem | null> {
    if (this.recording()) return null;
    this.error.set('');
    this.transcript.set('');
    if (!this.available) {
      this.error.set('This device cannot record audio. You can type instead.');
      return null;
    }

    const mimeType = this.mimeType;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Speech, not music: cutting the low end and the noise floor makes a
          // frightened voice on a street corner far easier to understand.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (e: unknown) {
      this.stream = null;
      const name = (e as { name?: string })?.name ?? '';
      this.error.set(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone blocked. Allow it for LulaFind in your phone settings to record a voice note.'
          : name === 'NotFoundError'
            ? 'No microphone was found on this device. You can type instead.'
            : 'The microphone could not be opened. You can type instead.'
      );
      return null;
    }

    try {
      this.recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
    } catch {
      this.cleanup();
      this.error.set('Recording is not supported on this device. You can type instead.');
      return null;
    }

    this.chunks = [];
    this.transcript.set('');
    this.startedAt = Date.now();
    this.seconds.set(0);
    this.locked.set(false);

    const done = new Promise<MediaItem | null>((resolve) => { this.stopResolve = resolve; });

    this.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };

    this.recorder.onerror = () => {
      this.error.set('Recording stopped unexpectedly. Please try again, or type instead.');
      this.finish();
    };

    // Some Android WebViews only fire onstop, never ondataavailable with data,
    // so the item is assembled from whatever chunks arrived, and an empty
    // result is reported rather than attached as a silent zero-length file.
    this.recorder.onstop = async () => {
      const type = this.recorder?.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(this.chunks, { type });
      const duration = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
      this.finish();
      if (!blob.size) {
        this.error.set('Nothing was recorded. Please try again, or type instead.');
        this.stopResolve?.(null);
        this.stopResolve = null;
        return;
      }
      if (blob.size > AUDIO_MAX_BYTES) {
        this.error.set('That recording is too long to upload. Keep it under two minutes.');
        this.stopResolve?.(null);
        this.stopResolve = null;
        return;
      }
      // Same shape as a photo: a data: URL, so the existing uploader stores it
      // without knowing audio exists. A failure to read the blob is reported,
      // never attached as an empty note.
      let src = '';
      try {
        src = await this.toDataUrl(blob);
      } catch {
        this.error.set('The recording could not be prepared. Please try again, or type instead.');
        this.stopResolve?.(null);
        this.stopResolve = null;
        return;
      }
      this.stopResolve?.({
        id: uid('a'), kind: 'audio', src, durationSec: duration, caption: '',
        ...(this.transcript().trim() ? { transcript: this.transcript().trim() } : {})
      });
      this.stopResolve = null;
    };

    try {
      this.recorder.start();
    } catch {
      this.cleanup();
      this.error.set('Recording could not start. You can type instead.');
      return null;
    }

    this.recording.set(true);
    /*
     * Transcription runs beside the recording, never instead of it. It is
     * best-effort by design: a device without a speech engine still records.
     */
    this.listenForWords();
    this.ticker = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
      this.seconds.set(elapsed);
      // Stop at the limit rather than letting someone record past what uploads.
      if (elapsed >= AUDIO_MAX_SECONDS) this.stop();
    }, 250);

    return done;
  }

  /** Stop and hand back the finished note (the promise from `record()`). */
  stop(): void {
    if (!this.recording()) return;
    this.locked.set(false);
    this.recording.set(false);
    try {
      this.recorder?.stop();
    } catch {
      this.finish();
    }
  }

  /** Throw the recording away - the person changed their mind. */
  cancel(): void {
    this.error.set('');
    this.locked.set(false);
    if (this.recorder?.state === 'recording') {
      this.recorder.onstop = null;
      try {
        this.recorder.stop();
      } catch {
        // already stopped
      }
    }
    this.finish();
    this.stopResolve?.(null);
    this.stopResolve = null;
  }

  /** Release the microphone. Called on stop, cancel and when leaving the screen. */
  private cleanup(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    // The mic light must go out even if the recorder failed to stop.
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    this.recording.set(false);
    this.locked.set(false);
  }

  private finish(): void {
    this.stopListeningForWords();
    this.cleanup();
  }

  /**
   * Write down what is being said, while it is said.
   *
   * This is the phone's own speech engine, used as a second, quiet listener - it
   * writes into `transcript` only, never into the composer's text box, so the
   * words of a voice note cannot appear in the middle of a typed post.
   *
   * Best-effort, and silent about failure: a device with no speech engine, or one
   * whose recognition is refused, still records perfectly, and the player simply
   * carries no transcript.
   */
  private listenForWords(): void {
    try {
      if (!this.dictation.supported()) return;
      this.listeningForWords = true;
      this.dictation.start({
        existing: '',
        // Every settled word is handed over whole; the flag tells the two kinds
        // of listening apart, so a value arriving after this recording ended is
        // dropped instead of landing on the next note.
        apply: (text) => { if (this.listeningForWords) this.transcript.set(text.trim()); }
      });
    } catch {
      this.listeningForWords = false;
    }
  }

  private stopListeningForWords(): void {
    if (!this.listeningForWords) return;
    this.listeningForWords = false;
    this.dictation.stop();
  }

  /** True while the quiet transcript listener belongs to this recording. */
  private listeningForWords = false;

  /** A recorded blob as a data: URL, matching how a picked photo arrives. */
  private toDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('not a data url')));
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(blob);
    });
  }

  clearError(): void {
    this.error.set('');
  }
}
