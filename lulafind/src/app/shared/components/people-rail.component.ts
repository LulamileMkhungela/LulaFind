import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AvatarComponent } from './avatar.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { UserProfile, provinceName } from '../../core/models/types';

/** "People you may know": a swipeable row of members you do not follow yet. */
@Component({
  selector: 'lf-people-rail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AvatarComponent],
  template: `
    @if (people().length) {
      <section class="people" aria-label="People you may know">
        <h2>People you may know</h2>
        <div class="row">
          @for (u of people(); track u.id) {
            <div class="card">
              <a [routerLink]="['/user', u.id]" class="who">
                <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="72" />
                <strong>{{ u.displayName }}</strong>
                <span>{{ place(u) }}</span>
              </a>
              <button type="button" class="follow" [class.on]="state()[u.id] === 'pending' || state()[u.id] === 'accepted'"
                      (click)="follow(u.id)">
                {{ state()[u.id] === 'accepted' ? 'Following' : state()[u.id] === 'pending' ? 'Requested' : 'Follow' }}
              </button>
            </div>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    .people { background: var(--lf-card); box-shadow: var(--lf-shadow); margin-bottom: 8px; padding: 12px 0 14px; }
    h2 { margin: 0 16px 10px; font-size: 16px; font-weight: 700; }
    .row { display: flex; gap: 10px; overflow-x: auto; padding: 0 16px; scrollbar-width: none; }
    .row::-webkit-scrollbar { display: none; }
    .card { flex: 0 0 152px; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px 10px 12px;
      border: 1px solid var(--lf-line); border-radius: 8px; background: var(--lf-card); }
    .who { display: flex; flex-direction: column; align-items: center; gap: 3px; text-decoration: none; color: inherit; width: 100%; }
    .who strong { font-size: 15px; font-weight: 600; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 6px; }
    .who span { font-size: 12.5px; color: var(--lf-muted); min-height: 16px; }
    .follow { width: 100%; height: 34px; border-radius: 17px; border: 1px solid var(--lf-primary); background: transparent;
      color: var(--lf-primary); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
    .follow.on { border-color: var(--lf-line); color: var(--lf-muted); }
    @media (min-width: 700px) { .people { max-width: var(--lf-maxw); margin: 0 auto 12px; border-radius: var(--lf-radius); box-sizing: border-box; } }
  `]
})
export class PeopleRailComponent {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly state = signal<Record<string, 'accepted' | 'pending' | null>>({});

  readonly people = computed(() => {
    const me = this.auth.viewerId;
    const following = new Set(this.data.followingIds());
    return Object.values(this.data.authors())
      .filter((u) => u.id !== me && !following.has(u.id) && !u.suspended)
      .slice(0, 12);
  });

  place(u: UserProfile): string {
    if (u.privacy?.showLocation === true && u.town) return u.town;
    return u.province ? provinceName(u.province) : '';
  }

  async follow(id: string): Promise<void> {
    if (!this.auth.signedIn()) { void this.router.navigate(['/auth']); return; }
    try {
      await this.data.toggleFollow(id);
      this.state.update((s) => ({ ...s }));
      const status = await this.data.followStatus(id);
      this.state.update((s) => ({ ...s, [id]: status }));
    } catch { /* the profile page reports follow errors in full */ }
  }
}
