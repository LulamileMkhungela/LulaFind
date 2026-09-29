import { Component, EventEmitter, Output, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Story } from '../../core/models/types';
import { storyBg } from '../../core/data/seed';
import { IconComponent } from './icon.component';
import { AvatarComponent } from './avatar.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

/**
 * Facebook-style Stories block that sits *inside* the newsfeed.
 *
 * Header row: “Stories” + “Create story” + “See all”.
 * Body: the Create card plus the latest story covers, horizontally scrolled.
 * Rendered between posts (after the 2nd post, then every few posts).
 */
@Component({
  selector: 'lf-feed-stories',
  standalone: true,
  imports: [RouterLink, IconComponent, AvatarComponent],
  template: `
    <section class="stories" aria-label="Stories">
      <div class="stories__head">
        <h2>Stories</h2>
        <div class="stories__links">
          <button type="button" class="link" (click)="addStory.emit()">
            <lf-icon name="plus" [size]="14" [weight]="2.6" /> Create story
          </button>
          <button type="button" class="link" (click)="seeAll.emit()">See all</button>
        </div>
      </div>
      <div class="stories__rail">
        <button class="card card--create" type="button" (click)="addStory.emit()" aria-label="Create a story">
          <span class="card__photo">
            <lf-avatar [src]="myAvatar()" [name]="myName()" [size]="100" />
          </span>
          <span class="card__plus"><lf-icon name="plus" [size]="16" [weight]="2.6" /></span>
          <span class="card__label">Create story</span>
        </button>

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
      </div>
    </section>
  `,
  styles: [`
    .stories {
      background: var(--lf-card);
      box-shadow: var(--lf-shadow);
      margin-bottom: 8px;
      padding: 12px 0 14px;
    }
    @media (min-width: 700px) {
      .stories { max-width: var(--lf-maxw); margin: 0 auto 12px; border-radius: var(--lf-radius); box-sizing: border-box; }
    }
    .stories__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 16px 10px;
    }
    .stories__head h2 { margin: 0; font-size: 17px; font-weight: 700; }
    .stories__links { display: flex; align-items: center; gap: 4px; }
    .link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 0;
      background: none;
      color: var(--lf-link);
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 6px;
      white-space: nowrap;
    }
    .stories__rail {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 0 16px 2px;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .stories__rail::-webkit-scrollbar { display: none; }
    .card {
      position: relative;
      flex: 0 0 104px;
      width: 104px;
      height: 178px;
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
    .card:not(.card--create)::after {
      content: '';
      position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(0,0,0,.28) 0%, transparent 30%, transparent 62%, rgba(0,0,0,.55) 100%);
      z-index: 1;
    }
    .card--create {
      background: var(--lf-card);
      box-shadow: inset 0 0 0 1px var(--lf-line);
      display: flex;
      flex-direction: column;
    }
    .card__photo { height: 118px; width: 100%; overflow: hidden; background: var(--lf-card-2); display: block; }
    .card__photo lf-avatar { width: 100%; height: 100%; }
    .card__photo ::ng-deep img,
    .card__photo ::ng-deep .fallback {
      width: 100% !important;
      height: 100% !important;
      border-radius: 0 !important;
    }
    .card__plus {
      position: absolute;
      top: 100px;
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
      padding-bottom: 8px;
      font-size: 12.5px;
      font-weight: 700;
      color: var(--ion-text-color);
    }
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
  `]
})
export class FeedStoriesComponent {
  @Output() addStory = new EventEmitter<void>();
  @Output() seeAll = new EventEmitter<void>();

  private data = inject(DataService);
  private auth = inject(AuthService);

  readonly stories = computed(() => this.data.visibleStories().slice(0, 12));
  readonly myAvatar = computed(() => this.data.avatarFor(this.auth.user()));
  readonly myName = computed(() => this.auth.user()?.displayName ?? 'You');

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
}
