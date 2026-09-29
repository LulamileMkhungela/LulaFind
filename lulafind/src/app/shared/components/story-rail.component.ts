import { Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Story, UserProfile } from '../../core/models/types';
import { timeAgo } from '../../core/utils/format';
import { storyBg } from '../../core/data/seed';
import { IconComponent } from './icon.component';
import { AvatarComponent } from './avatar.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

/**
 * Facebook-style tall rectangular Story Rail.
 * Card 1 is "Create story" with top photo + blue plus badge.
 * Subsequent cards are tall story covers with user avatar badge at top-left.
 */
@Component({
  selector: 'lf-story-rail',
  standalone: true,
  imports: [RouterLink, IconComponent, AvatarComponent],
  template: `
    <div class="fb-story-rail">
      <!-- Card 1: Create Story -->
      <button class="fb-story-card fb-story-card--create" (click)="addStory.emit()">
        <div class="fb-story-top-img">
          <lf-avatar [src]="myAvatar()" [name]="myName()" [size]="100" />
        </div>
        <div class="fb-story-plus-wrap">
          <div class="fb-story-plus-btn">
            <lf-icon name="plus" [size]="18" [weight]="2.5" />
          </div>
          <span class="fb-story-create-label">Create story</span>
        </div>
      </button>

      <!-- User Stories -->
      @for (s of grouped(); track s.id) {
        <a class="fb-story-card" [routerLink]="'/story/' + s.id" [style.background]="bgOf(s)">
          @if (mediaOf(s)) {
            <img class="fb-story-cover" [src]="mediaOf(s)" [alt]="nameOf(s)" loading="lazy" />
          }
          <div class="fb-story-avatar-badge" [class.seen]="isSeen(s)">
            <lf-avatar [src]="avatarOf(s)" [name]="nameOf(s)" [size]="34" />
          </div>
          <span class="fb-story-name">{{ nameOf(s) }}</span>
        </a>
      }
    </div>
  `,
  styles: [`
    .fb-story-rail {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 12px 16px;
      background: var(--lf-card);
      box-shadow: var(--lf-shadow);
      margin-bottom: 8px;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .fb-story-rail::-webkit-scrollbar { display: none; }
    @media (min-width: 700px) {
      .fb-story-rail { max-width: var(--lf-maxw); margin: 0 auto 12px; border-radius: var(--lf-radius); box-sizing: border-box; }
    }

    .fb-story-card {
      width: 108px;
      height: 192px;
      border-radius: 10px;
      flex-shrink: 0;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      border: 0;
      background: var(--lf-card-2);
      text-decoration: none;
      color: #fff;
      cursor: pointer;
      font-family: inherit;
    }
    .fb-story-card:active { transform: scale(0.98); }
    /* legibility scrim for the name, like Facebook */
    .fb-story-card:not(.fb-story-card--create)::after {
      content: '';
      position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(0,0,0,.28) 0%, transparent 30%, transparent 62%, rgba(0,0,0,.55) 100%);
      z-index: 1;
    }

    /* Create story card */
    .fb-story-card--create {
      background: var(--lf-card);
      box-shadow: inset 0 0 0 1px var(--lf-line);
      padding: 0;
    }
    .fb-story-top-img {
      height: 136px;
      width: 100%;
      overflow: hidden;
      background: var(--lf-card-2);
    }
    .fb-story-top-img lf-avatar { width: 100%; height: 100%; }
    .fb-story-top-img ::ng-deep img,
    .fb-story-top-img ::ng-deep .fallback {
      width: 100% !important;
      height: 100% !important;
      border-radius: 0 !important;
    }
    .fb-story-plus-wrap {
      flex: 1;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      padding-bottom: 10px;
    }
    .fb-story-plus-btn {
      position: absolute;
      top: -18px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--lf-primary);
      color: #fff;
      box-shadow: 0 0 0 4px var(--lf-card);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .fb-story-create-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--ion-text-color);
    }

    .fb-story-cover {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .fb-story-avatar-badge {
      position: absolute;
      top: 10px;
      left: 10px;
      border-radius: 50%;
      padding: 2px;
      background: var(--lf-primary);
      box-shadow: inset 0 0 0 2px var(--lf-primary);
      z-index: 2;
      display: flex;
    }
    .fb-story-avatar-badge lf-avatar { border-radius: 50%; box-shadow: 0 0 0 2px var(--lf-card); }
    .fb-story-avatar-badge.seen { background: var(--lf-card-2); box-shadow: none; }

    .fb-story-name {
      position: absolute;
      bottom: 8px;
      left: 8px;
      right: 8px;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      z-index: 2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `]
})
export class StoryRailComponent {
  @Output() addStory = new EventEmitter<void>();

  private data = inject(DataService);
  private auth = inject(AuthService);

  protected readonly timeAgo = timeAgo;

  readonly grouped = computed(() => this.data.visibleStories().slice(0, 30));
  readonly myAvatar = computed(() => this.data.avatarFor(this.auth.user()));
  readonly myName = computed(() => this.auth.user()?.displayName ?? 'You');

  nameOf(s: Story): string {
    const u = this.data.authorOf(s.authorId);
    return u?.displayName.split(' ')[0] ?? 'Member';
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
