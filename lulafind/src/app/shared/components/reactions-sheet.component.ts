import { Component, EventEmitter, Input, Output, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Post, REACTIONS, ReactionKind, UserProfile, isReaction } from '../../core/models/types';
import { AvatarComponent } from './avatar.component';
import { ReactionIconComponent } from './reaction-icon.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

type Tab = 'all' | ReactionKind;

/**
 * “Who reacted” bottom sheet.
 *
 * LinkedIn shows the faces behind the numbers — this does the same for each
 * reaction (Have an idea, Like, Support, Sad) on any post.
 */
@Component({
  selector: 'lf-reactions-sheet',
  standalone: true,
  imports: [RouterLink, AvatarComponent, ReactionIconComponent],
  template: `
    @if (open) {
      <div class="sheetwrap" (click)="close.emit()">
        <div class="sheet" role="dialog" aria-label="People who reacted" (click)="$event.stopPropagation()">
          <div class="sheet__head">
            <h3>Reactions</h3>
            <button class="x" type="button" (click)="close.emit()" aria-label="Close">
              &times;
            </button>
          </div>

          <div class="tabs" role="tablist">
            <button role="tab" [class.on]="tab() === 'all'" (click)="tab.set('all')">All {{ voters().length }}</button>
            @for (r of kinds(); track r.key) {
              <button role="tab" [class.on]="tab() === r.key" (click)="tab.set(r.key)">
                <lf-reaction-icon [kind]="r.key" [size]="16" /> {{ r.count }}
              </button>
            }
          </div>

          <div class="rows">
            @if (loading()) {
              <p class="muted">Loading…</p>
            } @else if (!rows().length) {
              <p class="muted">
No reactions yet.
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

  /** Everyone who reacted, with the reaction they chose. */
  readonly voters = computed(() =>
    Object.entries(this.post?.voterIds ?? {}).filter(([, v]) => isReaction(v)).map(([id, v]) => ({ id, kind: v as ReactionKind })));

  /** One tab per reaction that someone actually chose. */
  readonly kinds = computed(() =>
    REACTIONS.map((r) => ({ key: r.key, count: this.voters().filter((v) => v.kind === r.key).length })).filter((r) => r.count > 0));

  readonly rows = computed(() => {
    const t = this.tab();
    const list = this.people();
    const kindOf = (id: string) => this.post.voterIds[id];
    const shown = t === 'all' ? list : list.filter((u) => kindOf(u.id) === t);
    return [...shown].sort((a, b) => a.displayName.localeCompare(b.displayName));
  });

  constructor() {
    effect(() => {
      if (this.open && this.post) void this.load();
    });
  }

  voteLabel(id: string): string {
    const k = this.post?.voterIds[id];
    return REACTIONS.find((r) => r.key === k)?.label ?? 'Reacted';
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const ids = this.voters().map((v) => v.id).slice(0, 200);
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
