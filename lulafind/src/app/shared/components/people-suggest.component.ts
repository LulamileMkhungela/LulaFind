import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { UserProfile } from '../../core/models/types';
import { AvatarComponent } from './avatar.component';
import { IconComponent } from './icon.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

/**
 * Facebook-style “People you may know”.
 *
 * The first section of the newsfeed: a horizontal row of people cards with
 * photos, names and an Add friend / Follow button, plus “See all”.
 */
@Component({
  selector: 'lf-people-suggest',
  standalone: true,
  imports: [RouterLink, AvatarComponent, IconComponent],
  template: `
    @if (people.length) {
      <section class="suggest" aria-label="People you may know">
        <div class="suggest__head">
          <h2>People you may know</h2>
          <button type="button" class="see-all" (click)="seeAll.emit()">See all</button>
        </div>
        <div class="suggest__rail">
          @for (u of people; track u.id) {
            <div class="person">
              <a class="person__who" [routerLink]="'/user/' + u.id">
                <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="76" />
                <strong>{{ u.displayName }}</strong>
                <small>
                  @if (u.town) { {{ u.town }} }
                  @else { &#64;{{ u.handle }} }
                </small>
              </a>
              @if (stateOf(u.id) === 'following') {
                <button class="add done" type="button" disabled>
                  <lf-icon name="check" [size]="15" /> Following
                </button>
              } @else if (stateOf(u.id) === 'requested') {
                <button class="add done" type="button" disabled>Requested</button>
              } @else {
                <button class="add" type="button" [disabled]="busy() === u.id" (click)="add(u)">
                  <lf-icon name="plus" [size]="15" />
                  {{ busy() === u.id ? 'Adding…' : 'Add friend' }}
                </button>
              }
              <button class="dismiss" type="button" (click)="dismiss(u)" aria-label="Remove {{ u.displayName }}">
                <lf-icon name="x" [size]="14" />
              </button>
            </div>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    .suggest {
      background: var(--lf-card);
      box-shadow: var(--lf-shadow);
      margin-bottom: 8px;
      padding: 12px 0 14px;
    }
    @media (min-width: 700px) {
      .suggest { max-width: var(--lf-maxw); margin: 0 auto 12px; border-radius: var(--lf-radius); box-sizing: border-box; }
    }
    .suggest__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px 10px;
    }
    .suggest__head h2 { margin: 0; font-size: 17px; font-weight: 700; }
    .see-all {
      border: 0; background: none;
      color: var(--lf-link);
      font-family: inherit; font-size: 15px; font-weight: 600;
      cursor: pointer; padding: 4px 0 4px 8px;
    }
    .suggest__rail {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding: 0 16px 2px;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .suggest__rail::-webkit-scrollbar { display: none; }
    .person {
      position: relative;
      flex: 0 0 148px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 14px 10px 12px;
      border-radius: 10px;
      background: var(--lf-card);
      box-shadow: inset 0 0 0 1px var(--lf-line);
      text-align: center;
    }
    .person__who {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      color: inherit;
      text-decoration: none;
      width: 100%;
    }
    .person__who strong {
      font-size: 14px;
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .person__who small { font-size: 12px; color: var(--lf-muted); }
    .add {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      width: 100%;
      height: 34px;
      border: 0;
      border-radius: 6px;
      background: var(--lf-primary-soft);
      color: var(--lf-primary-soft-text);
      font-family: inherit;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    }
    .add:active { filter: brightness(.94); }
    .add:disabled { opacity: .7; }
    .add.done { background: var(--lf-card-2); color: var(--lf-muted); }
    .dismiss {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 26px;
      height: 26px;
      border: 0;
      border-radius: 50%;
      background: var(--lf-card-2);
      color: var(--lf-muted);
      cursor: pointer;
      display: grid;
      place-items: center;
    }
  `]
})
export class PeopleSuggestComponent {
  @Input({ required: true }) people: UserProfile[] = [];
  @Output() seeAll = new EventEmitter<void>();
  @Output() removed = new EventEmitter<string>();

  protected data = inject(DataService);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly busy = signal<string | null>(null);
  private states = signal<Record<string, 'following' | 'requested'>>({});

  stateOf(id: string): 'following' | 'requested' | null {
    return this.states()[id] ?? null;
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
}
