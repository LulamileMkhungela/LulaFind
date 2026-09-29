import { Component, EventEmitter, Input, Output, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Post, UserProfile } from '../../core/models/types';
import { AvatarComponent } from './avatar.component';
import { IconComponent } from './icon.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

type Tab = 'all' | 'up' | 'down';

/**
 * “Who reacted” bottom sheet.
 *
 * Facebook shows the faces behind the numbers — this does the same for Idea
 * (“I have an idea”) and No idea reactions on any post.
 */
@Component({
  selector: 'lf-reactions-sheet',
  standalone: true,
  imports: [RouterLink, AvatarComponent, IconComponent],
  template: `
    @if (open) {
      <div class="sheetwrap" (click)="close.emit()">
        <div class="sheet" role="dialog" aria-label="People who reacted" (click)="$event.stopPropagation()">
          <div class="sheet__head">
            <h3>Reactions</h3>
            <button class="x" type="button" (click)="close.emit()" aria-label="Close">
              <lf-icon name="x" [size]="20" />
            </button>
          </div>

          <div class="tabs" role="tablist">
            <button role="tab" [class.on]="tab() === 'all'" (click)="tab.set('all')">
              All {{ upIds().length + downIds().length }}
            </button>
            <button role="tab" [class.on]="tab() === 'up'" (click)="tab.set('up')">
              <lf-icon name="bulb" [size]="14" /> Idea {{ upIds().length }}
            </button>
            <button role="tab" [class.on]="tab() === 'down'" (click)="tab.set('down')">
              <lf-icon name="bulbOff" [size]="14" /> No idea {{ downIds().length }}
            </button>
          </div>

          <div class="rows">
            @if (loading()) {
              <p class="muted">Loading…</p>
            } @else if (!rows().length) {
              <p class="muted">
                @if (tab() === 'up') { Nobody has tapped Idea yet. }
                @else if (tab() === 'down') { Nobody has tapped No idea yet. }
                @else { No reactions yet. }
              </p>
            } @else {
              @for (u of rows(); track u.id) {
                <div class="row">
                  <a class="who" [routerLink]="'/user/' + u.id" (click)="close.emit()">
                    <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="44" />
                    <span class="txt">
                      <strong>{{ u.displayName }}</strong>
                      <small>&#64;{{ u.handle }} · {{ voteLabel(u.id) }}</small>
                    </span>
                  </a>
                  @if (u.id !== me()) {
                    <button class="follow" type="button"
                            [class.on]="followingIds().includes(u.id)"
                            [disabled]="busy() === u.id"
                            (click)="toggleFollow(u)">
                      {{ followingIds().includes(u.id) ? 'Following' : 'Follow' }}
                    </button>
                  }
                </div>
              }
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .sheetwrap {
      position: fixed; inset: 0; z-index: 120;
      background: var(--lf-scrim);
      display: flex; align-items: flex-end; justify-content: center;
    }
    .sheet {
      width: 100%; max-width: 520px;
      max-height: 82vh;
      display: flex; flex-direction: column;
      background: var(--lf-card);
      border-radius: 18px 18px 0 0;
      padding: 14px 16px calc(20px + var(--lf-safe-bottom));
    }
    .sheet__head { display: flex; align-items: center; justify-content: space-between; }
    .sheet__head h3 { margin: 0; font-size: 18px; font-weight: 700; }
    .x {
      width: 36px; height: 36px;
      border: 0; border-radius: 50%;
      background: var(--lf-card-2);
      color: var(--ion-text-color);
      cursor: pointer;
      display: grid; place-items: center;
    }
    .tabs { display: flex; gap: 8px; margin: 12px 0; overflow-x: auto; }
    .tabs button {
      flex: none;
      display: inline-flex; align-items: center; gap: 6px;
      height: 34px; padding: 0 14px;
      border: 0; border-radius: 999px;
      background: var(--lf-card-2);
      color: var(--ion-text-color);
      font-family: inherit; font-size: 14px; font-weight: 700;
      cursor: pointer;
    }
    .tabs button.on { background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
    .rows { overflow-y: auto; display: flex; flex-direction: column; }
    .muted { color: var(--lf-muted); font-size: 14px; text-align: center; padding: 18px 0; }
    .row {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 0;
      border-top: 1px solid var(--lf-line-soft);
    }
    .who { flex: 1; min-width: 0; display: flex; align-items: center; gap: 11px; color: inherit; text-decoration: none; }
    .txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .txt strong { font-size: 15px; }
    .txt small { font-size: 12.5px; color: var(--lf-muted); }
    .follow {
      flex-shrink: 0;
      height: 34px; padding: 0 14px;
      border: 0; border-radius: 6px;
      background: var(--lf-primary-soft);
      color: var(--lf-primary-soft-text);
      font-family: inherit; font-size: 14px; font-weight: 700;
      cursor: pointer;
    }
    .follow.on { background: var(--lf-card-2); color: var(--lf-muted); }
    .follow:disabled { opacity: .6; }
  `]
})
export class ReactionsSheetComponent {
  @Input({ required: true }) post!: Post;
  @Input() open = false;
  @Output() close = new EventEmitter<void>();

  protected data = inject(DataService);
  private auth = inject(AuthService);

  readonly tab = signal<Tab>('all');
  readonly loading = signal(false);
  readonly people = signal<UserProfile[]>([]);
  readonly busy = signal<string | null>(null);

  readonly me = computed(() => this.auth.viewerId);
  readonly followingIds = computed(() => this.data.followingIds());

  readonly upIds = computed(() =>
    Object.entries(this.post?.voterIds ?? {}).filter(([, v]) => v === 'up').map(([id]) => id));
  readonly downIds = computed(() =>
    Object.entries(this.post?.voterIds ?? {}).filter(([, v]) => v === 'down').map(([id]) => id));

  readonly rows = computed(() => {
    const t = this.tab();
    const list = this.people();
    if (t === 'up') return list.filter((u) => this.upIds().includes(u.id));
    if (t === 'down') return list.filter((u) => this.downIds().includes(u.id));
    return [...list].sort((a, b) => {
      const av = this.post.voterIds[a.id] === 'up' ? 0 : 1;
      const bv = this.post.voterIds[b.id] === 'up' ? 0 : 1;
      return av - bv || a.displayName.localeCompare(b.displayName);
    });
  });

  constructor() {
    effect(() => {
      if (this.open && this.post) void this.load();
    });
  }

  voteLabel(id: string): string {
    return this.post?.voterIds[id] === 'down' ? 'No idea' : 'Idea';
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const ids = [...new Set([...this.upIds(), ...this.downIds()])].slice(0, 200);
      // Author cache first so repeat opens are instant.
      const cached = ids.map((id) => this.data.authorOf(id)).filter((u): u is UserProfile => !!u);
      const missing = ids.filter((id) => !cached.some((u) => u.id === id));
      const fresh = missing.length ? await this.data.people(missing) : [];
      for (const u of fresh) this.data.touchAuthor(u);
      this.people.set([...cached, ...fresh]);
    } finally {
      this.loading.set(false);
    }
  }

  async toggleFollow(u: UserProfile): Promise<void> {
    this.busy.set(u.id);
    try {
      await this.data.toggleFollow(u.id);
    } catch {
      /* signed-out or own profile — the profile page explains */
    } finally {
      this.busy.set(null);
    }
  }
}
