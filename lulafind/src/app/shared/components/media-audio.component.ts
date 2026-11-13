import { Component, ElementRef, Input, OnChanges, inject, signal, viewChild } from '@angular/core';
import { LULA_API } from '../../core/data/api';
import { IconComponent } from './icon.component';

/**
 * A voice note, playable on a post.
 *
 * A family's own voice explaining what happened is the most human thing on a
 * missing-person case, and it must not look like a technical attachment. This is
 * a single, wide row: a play button, the length, and a progress bar that is also
 * the seek control. It carries a transcript slot so the words are never locked
 * inside audio for a reader who cannot hear them.
 *
 * Storage behaves exactly like a photo - the record holds `storage://photos/…`
 * and the link is signed on read - so a note that was stored still plays after
 * the signature expires, and a refused signature says so instead of sitting
 * there as a dead player.
 */
@Component({
  selector: 'lf-media-audio',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="note" [class.busy]="loading()">
      <button class="note__play" type="button" (click)="toggle()" [disabled]="!src || failed()"
              [attr.aria-label]="playing() ? 'Pause voice note' : 'Play voice note'">
        <lf-icon [name]="playing() ? 'pause' : 'play'" [size]="17" />
      </button>

      <div class="note__body">
        <div class="note__top">
          <strong>{{ label }}</strong>
          <span class="note__time">{{ clock(current()) }} / {{ clock(duration()) }}</span>
        </div>
        <div class="note__bar" (click)="seek($event)" role="presentation">
          <span class="note__fill" [style.width.%]="percent()"></span>
        </div>
        @if (failed()) {
          <span class="note__err">This voice note could not be loaded. <button type="button" (click)="retry()">Try again</button></span>
        } @else if (transcript) {
          <details class="note__text">
            <summary>Read it instead</summary>
            <p>{{ transcript }}</p>
          </details>
        }
      </div>

      <audio #el [src]="shown()" preload="metadata" (loadedmetadata)="onMeta(el)"
             (timeupdate)="onTime(el)" (ended)="onEnded()" (error)="onError()"></audio>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .note { display: flex; align-items: flex-start; gap: 11px; padding: 11px 13px; border-radius: 12px;
      background: var(--lf-card-2); }
    .note.busy { opacity: .7; }
    .note__play { flex: 0 0 40px; width: 40px; height: 40px; border-radius: 50%; border: 0; display: grid;
      place-items: center; background: var(--lf-primary); color: #fff; cursor: pointer; }
    .note__play:disabled { opacity: .5; cursor: default; }
    .note__play:focus-visible { outline: 3px solid var(--lf-primary); outline-offset: 3px; }
    .note__body { flex: 1; min-width: 0; }
    .note__top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .note__top strong { font-size: 13.5px; font-weight: 650; }
    .note__time { font-size: 12px; color: var(--lf-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .note__bar { height: 6px; margin-top: 7px; border-radius: 999px; background: color-mix(in srgb, var(--ion-text-color) 12%, transparent); cursor: pointer; }
    .note__fill { display: block; height: 100%; border-radius: 999px; background: var(--lf-primary); transition: width .15s linear; }
    .note__err { display: block; margin-top: 6px; font-size: 12px; color: var(--lf-signal-text); }
    .note__err button { border: 0; background: none; padding: 0; font: inherit; font-weight: 700;
      color: var(--lf-link); text-decoration: underline; cursor: pointer; }
    .note__text { margin-top: 6px; font-size: 12.5px; color: var(--lf-muted); }
    .note__text summary { cursor: pointer; font-weight: 600; }
    .note__text p { margin: 5px 0 0; line-height: 1.4; white-space: pre-line; }
    audio { display: none; }
    @media (prefers-reduced-motion: reduce) { .note__fill { transition: none; } }
  `]
})
export class MediaAudioComponent implements OnChanges {
  private api = inject(LULA_API);

  @Input() src = '';
  /** What this note is, in the post's words. */
  @Input() label = 'Voice note';
  /** Seconds, from the record. Used before the file loads. */
  @Input() durationSec = 0;
  /** The words, if anyone wrote them down. Optional by design. */
  @Input() transcript = '';

  readonly shown = signal('');
  readonly playing = signal(false);
  readonly current = signal(0);
  readonly duration = signal(0);
  readonly failed = signal(false);
  readonly loading = signal(false);

  private el: HTMLAudioElement | null = null;
  private triedAgain = false;
  private readonly audioRef = viewChild<ElementRef<HTMLAudioElement>>('el');

  ngOnChanges(): void {
    this.failed.set(false);
    this.playing.set(false);
    this.current.set(0);
    this.duration.set(this.durationSec || 0);
    void this.resolve();
  }

  private async resolve(): Promise<void> {
    if (!this.src) return;
    this.loading.set(true);
    try {
      this.shown.set(await this.api.resolveMedia(this.src));
    } catch {
      this.shown.set(this.src);
    } finally {
      this.loading.set(false);
    }
  }

  retry(): void {
    this.triedAgain = false;
    this.failed.set(false);
    this.ngOnChanges();
  }

  onMeta(el: HTMLAudioElement): void {
    this.el = el;
    // Some recorders write 0 or Infinity for a stream; keep the recorded length.
    if (isFinite(el.duration) && el.duration > 0.5) this.duration.set(el.duration);
  }

  onTime(el: HTMLAudioElement): void {
    this.current.set(el.currentTime);
  }

  onEnded(): void {
    this.playing.set(false);
    this.current.set(0);
  }

  onError(): void {
    // One silent retry: an expired signed link usually works on a fresh one.
    if (!this.triedAgain) {
      this.triedAgain = true;
      void this.resolve();
      return;
    }
    this.playing.set(false);
    this.failed.set(true);
  }

  toggle(): void {
    const el = this.el ?? this.anchor();
    if (!el) return;
    if (el.paused) {
      void el.play().then(() => this.playing.set(true)).catch(() => this.onError());
    } else {
      el.pause();
      this.playing.set(false);
    }
  }

  seek(event: MouseEvent): void {
    const el = this.el ?? this.anchor();
    if (!el || !isFinite(el.duration) || el.duration <= 0) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    this.current.set(el.currentTime);
  }

  percent(): number {
    const total = this.duration();
    return total > 0 ? Math.min(100, (this.current() / total) * 100) : 0;
  }

  clock(value: number): string {
    const total = Math.max(0, Math.floor(value || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  /** The hidden <audio> element, available before a first metadata event. */
  private anchor(): HTMLAudioElement | null {
    return this.audioRef()?.nativeElement ?? null;
  }
}
