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
 * Snapchat/Instagram-style story rail. Tapping a bubble opens the full-screen
 * viewer; the first slot is always "Your story" for the signed-in user.
 */
@Component({
  selector: 'lf-story-rail',
  standalone: true,
  imports: [RouterLink, IconComponent, AvatarComponent],
  template: `
    <div class="lf-scroller rail">
      <button class="slot" (click)="addStory.emit()">
        <div class="ring ring--add">
          <lf-avatar [src]="myAvatar()" [name]="myName()" [size]="54" />
          <span class="plus"><lf-icon name="plus" [size]="16" /></span>
        </div>
        <span class="cap">Your story</span>
      </button>

      @for (s of grouped(); track s.id) {
        <a class="slot" [routerLink]="'/story/' + s.id">
          <div class="ring" [class.ring--seen]="isSeen(s)">
            <lf-avatar [src]="avatarOf(s)" [name]="nameOf(s)" [size]="54" />
          </div>
          <span class="cap lf-ellipsis">{{ nameOf(s) }}</span>
          <span class="when">{{ timeAgo(s.createdAt) }}</span>
        </a>
      }
    </div>
  `,
  styles: [`
    .rail { padding-top: 10px; }
    .slot { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 74px;
      background: none; border: 0; color: inherit; text-decoration: none; cursor: pointer; padding: 0 0 4px; }
    .ring { position: relative; width: 62px; height: 62px; border-radius: 50%; padding: 2.5px;
      background: conic-gradient(from 210deg, var(--lf-beacon), var(--lf-marigold), var(--lf-signal), var(--lf-beacon)); }
    .ring--seen { background: var(--lf-line); }
    .ring > lf-avatar { border: 2.5px solid var(--ion-background-color); border-radius: 50%; }
    .ring--add { background: var(--lf-card-2); }
    .plus { position: absolute; right: -2px; bottom: -2px; width: 22px; height: 22px; border-radius: 50%;
      background: var(--lf-beacon); color: #1a1200; display: flex; align-items: center; justify-content: center;
      border: 2px solid var(--ion-background-color); }
    .cap { font-size: 11.5px; font-weight: 600; max-width: 72px; }
    .when { font-size: 10px; color: var(--lf-muted); margin-top: -4px; }
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

  isSeen(s: Story): boolean {
    const me = this.auth.viewerId;
    return !!me && (s.authorId === me || s.viewers.includes(me));
  }

  bgOf(s: Story): string {
    return storyBg(s.bgHue);
  }
}
