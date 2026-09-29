import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Story, UserProfile } from '../../core/models/types';
import { storyBg } from '../../core/data/seed';
import { IconComponent } from './icon.component';
import { AvatarComponent } from './avatar.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

/**
 * Facebook-style top-of-feed rail: stories AND people you may know in ONE
 * horizontally scrolling section, all cards the same size and look.
 *
 * Order: Create story, story covers, then person cards (photo top, name,
 * Add friend button). Never renders empty: with no stories and no people it
 * still shows Create story plus a Find people card that opens Search.
 */
@Component({
  selector: 'lf-discover-rail',
  standalone: true,
  imports: [RouterLink, IconComponent, AvatarComponent],
  template: `
    <section class="discover" aria-label="Stories and people you may know">
      <div class="discover__head">
        <h2>Stories &amp; People</h2>
        <button type="button" class="see-all" (click)="seeAll.emit()">See all</button>
      </div>
      <div class="discover__rail">
        <!-- Create story -->
        <button class="card card--create" type="button" (click)="addStory.emit()" aria-label="Create a story">
          <span class="card__photo">
            <lf-avatar [src]="myAvatar()" [name]="myName()" [size]="100" />
          </span>
          <span class="card__plus"><lf-icon name="plus" [size]="16" [weight]="2.6" /></span>
          <span class="card__label">Create story</span>
        </button>

        <!-- Story covers -->
        @for (s of stories(); track s.id) {
          <a class="card" [routerLink]="'/story/' + s.id" [style.background]="bgOf(s)">
            @if (mediaOf(s)) {
              <img class="card__cover" [src]="mediaOf(s)" [alt]="nameOf(s)" loading="lazy" />
            }
            <span class="card__avatar" [class.seen]="isSeen(s)">
              <lf-avatar [src]="avatarOf(s)" [name]="nameOf(s)" [size]="32" />
            </span>
            <span class="card__name">{{ nameOf(s) }}</span>
          </a>
        }

        <!-- People you may know, same card look -->
        @for (u of people; track u.id) {
          <div class="card card--person">
            <a class="person__photo" [routerLink]="'/user/' + u.id" [attr.aria-label]="u.displayName">
              <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="100" />
            </a>
            <a class="person__name" [routerLink]="'/user/' + u.id">{{ u.displayName }}</a>
            @if (stateOf(u.id) === 'following') {
              <span class="person__add done"><lf-icon name="check" [size]="13" /> Following</span>
            } @else if (stateOf(u.id) === 'requested') {
              <span class="person__add done">Requested</span>
            } @else {
              <button class="person__add" type="button" [disabled]="busy() === u.id" (click)="add(u)">
                <lf-icon name="plus" [size]="13" [weight]="2.6" />
                {{ busy() === u.id ? 'Adding…' : 'Add friend' }}
              </button>
            }
            <button class="person__x" type="button" (click)="dismiss(u)" [attr.aria-label]="'Remove ' + u.displayName">
              <lf-icon name="x" [size]="13" />
            </button>
          </div>
        }

        <!-- Always a way forward when there are no suggestions -->
        @if (!people.length) {
          <button class="card card--find" type="button" (click)="goSearch()" aria-label="Find people">
            <span class="card--find__icon"><lf-icon name="search" [size]="22" /></span>
            <span class="card__label">Find people</span>
            <span class="card--find__sub">No suggestions yet</span>
          </button>
        }
      </div>
    </section>
  `,
  styles: [`
    .discover {
      background: var(--lf-card);
      box-shadow: var(--lf-shadow);
      margin-bottom: 8px;
      padding: 12px 0 14px;
    }
    @media (min-width: 700px) {
      .discover { max-width: var(--lf-maxw); margin: 0 auto 12px; border-radius: var(--lf-radius); box-sizing: border-box; }
    }
    .discover__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px 10px;
    }
    .discover__head h2 { margin: 0; font-size: 17px; font-weight: 700; }
    .see-all {
      border: 0; background: none;
      color: var(--lf-link);
      font-family: inherit; font-size: 15px; font-weight: 600;
      cursor: pointer; padding: 4px 0 4px 8px;
    }
    .discover__rail {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 0 16px 2px;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .discover__rail::-webkit-scrollbar { display: none; }

    /* One card size for stories and people alike, like Facebook. */
    .card {
      position: relative;
      flex: 0 0 108px;
      width: 108px;
      height: 184px;
      border: 0;
      border-radius: 10px;
      overflow: hidden;
      background: var(--lf-card-2);
      color: #fff;
      text-decoration: none;
      cursor: pointer;
      font-family: inherit;
      padding: 0;
      display: block;
    }
    .card:active { transform: scale(.98); }
    a.card::after {
      content: '';
      position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(0,0,0,.28) 0%, transparent 30%, transparent 62%, rgba(0,0,0,.55) 100%);
      z-index: 1;
    }

    /* Create story card */
    .card--create {
      background: var(--lf-card);
      box-shadow: inset 0 0 0 1px var(--lf-line);
      display: flex;
      flex-direction: column;
    }
    .card__photo { height: 122px; width: 100%; overflow: hidden; background: var(--lf-card-2); display: block; }
    .card__photo lf-avatar { width: 100%; height: 100%; }
    .card__photo ::ng-deep img,
    .card__photo ::ng-deep .fallback {
      width: 100% !important;
      height: 100% !important;
      border-radius: 0 !important;
    }
    .card__plus {
      position: absolute;
      top: 104px;
      left: 50%;
      transform: translateX(-50%);
      width: 34px; height: 34px;
      border-radius: 50%;
      background: var(--lf-primary);
      color: #fff;
      box-shadow: 0 0 0 4px var(--lf-card);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card__label {
      flex: 1;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding-bottom: 9px;
      font-size: 12.5px;
      font-weight: 700;
      color: var(--ion-text-color);
    }

    /* Story cover cards */
    .card__cover { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .card__avatar {
      position: absolute;
      top: 8px; left: 8px;
      z-index: 2;
      border-radius: 50%;
      padding: 2px;
      background: var(--lf-primary);
      display: flex;
    }
    .card__avatar lf-avatar { border-radius: 50%; box-shadow: 0 0 0 2px var(--lf-card); }
    .card__avatar.seen { background: var(--lf-card-2); }
    .card__name {
      position: absolute;
      bottom: 8px; left: 8px; right: 8px;
      z-index: 2;
      font-size: 12.5px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Person cards: same footprint, photo top, name + Add button bottom. */
    .card--person {
      background: var(--lf-card);
      box-shadow: inset 0 0 0 1px var(--lf-line);
      display: flex;
      flex-direction: column;
      cursor: default;
    }
    .person__photo { height: 96px; width: 100%; overflow: hidden; background: var(--lf-card-2); display: block; }
    .person__photo lf-avatar { width: 100%; height: 100%; }
    .person__photo ::ng-deep img,
    .person__photo ::ng-deep .fallback {
      width: 100% !important;
      height: 100% !important;
      border-radius: 0 !important;
    }
    .person__name {
      display: block;
      padding: 6px 6px 0;
      font-size: 12.5px;
      font-weight: 700;
      color: var(--ion-text-color);
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: center;
    }
    .person__add {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      margin: 6px 8px 8px;
      height: 30px;
      border: 0;
      border-radius: 6px;
      background: var(--lf-primary-soft);
      color: var(--lf-primary-soft-text);
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
    }
    .person__add:active { filter: brightness(.94); }
    .person__add:disabled { opacity: .7; }
    span.person__add.done { background: var(--lf-card-2); color: var(--lf-muted); cursor: default; }
    .person__x {
      position: absolute;
      top: 5px;
      right: 5px;
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 50%;
      background: rgba(0,0,0,.45);
      color: #fff;
      cursor: pointer;
      display: grid;
      place-items: center;
    }

    /* Find people fallback card */
    .card--find {
      background: var(--lf-card);
      box-shadow: inset 0 0 0 1px var(--lf-line);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 7px;
    }
    .card--find__icon {
      width: 44px; height: 44px;
      border-radius: 50%;
      background: var(--lf-primary-soft);
      color: var(--lf-primary-soft-text);
      display: grid;
      place-items: center;
    }
    .card--find .card__label { flex: none; padding: 0; }
    .card--find__sub { font-size: 11.5px; color: var(--lf-muted); padding: 0 8px; text-align: center; }
  `]
})
export class DiscoverRailComponent {
  @Input({ required: true }) people: UserProfile[] = [];
  @Output() addStory = new EventEmitter<void>();
  @Output() seeAll = new EventEmitter<void>();
  @Output() removed = new EventEmitter<string>();

  protected data = inject(DataService);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly stories = computed(() => this.data.visibleStories().slice(0, 12));
  readonly myAvatar = computed(() => this.data.avatarFor(this.auth.user()));
  readonly myName = computed(() => this.auth.user()?.displayName ?? 'You');

  readonly busy = signal<string | null>(null);
  private states = signal<Record<string, 'following' | 'requested'>>({});

  stateOf(id: string): 'following' | 'requested' | null {
    return this.states()[id] ?? null;
  }

  nameOf(s: Story): string {
    return this.data.authorOf(s.authorId)?.displayName.split(' ')[0] ?? 'Member';
  }

  avatarOf(s: Story): string {
    return this.data.avatarFor(this.data.authorOf(s.authorId));
  }

  mediaOf(s: Story): string | null {
    return s.media[0]?.src ?? null;
  }

  isSeen(s: Story): boolean {
    const me = this.auth.viewerId;
    return !!me && (s.authorId === me || s.viewers.includes(me));
  }

  bgOf(s: Story): string {
    return storyBg(s.bgHue);
  }

  async add(u: UserProfile): Promise<void> {
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { next: '/home' } });
      return;
    }
    this.busy.set(u.id);
    try {
      const following = await this.data.toggleFollow(u.id);
      const status = await this.data.followStatus(u.id);
      this.states.update((s) => ({
        ...s,
        [u.id]: following || status === 'accepted' ? 'following' : 'requested'
      }));
    } catch {
      /* the profile page has the full follow control with feedback */
    } finally {
      this.busy.set(null);
    }
  }

  dismiss(u: UserProfile): void {
    this.removed.emit(u.id);
  }

  goSearch(): void {
    void this.router.navigate(['/search']);
  }
}
