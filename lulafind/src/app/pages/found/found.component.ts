import { Component, OnInit, signal, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { DataService } from '../../core/services/data.service';
import { Post, provinceName } from '../../core/models/types';
import { DAY, HOUR, timeAgo } from '../../core/utils/format';

/**
 * People who came home.
 *
 * Every other platform in this space shows a list of open cases, which is why
 * they feel like a wall of grief and people stop opening them. This page is the
 * counterweight: the cases that closed, the person who was named as finding
 * them, and how long it took - the proof that sharing a case does something.
 */
@Component({
  selector: 'lf-found',
  standalone: true,
  imports: [IonContent, RouterLink, TopNavComponent, IconComponent, EmptyComponent, AvatarComponent],
  template: `
    <lf-top-nav title="Found" backTo="/home" />

    <ion-content class="lf-page lf-plain">
      <div class="head">
        <h1>They came home</h1>
        <p class="lf-small lf-muted">Cases that closed on LulaFind. Names are kept off this page - only the people who found them are shown.</p>
      </div>

      @if (!found().length) {
        <lf-empty icon="check" title="No cases closed yet"
                  message="When a case is marked found it appears here, so people can see that sharing one works." />
      }

      <div class="list">
        @for (p of found(); track p.id) {
          <a class="card" [routerLink]="'/post/' + p.id">
            <div class="card__top">
              <span class="tick"><lf-icon name="check" [size]="14" [weight]="'bold'" /></span>
              <span class="card__type">{{ typeLabel(p) }} · found</span>
              <span class="card__when">{{ timeAgo(p.updatedAt) }}</span>
            </div>
            <p class="card__title">{{ p.title }}</p>
            <p class="card__line">
              {{ p.town }}, {{ provinceName(p.province) }}@if (daysToFind(p); as d) { · {{ d }}}
            </p>
            @if (p.outcome.finderName) {
              <div class="finder">
                <lf-avatar [name]="p.outcome!.finderName" [size]="28" />
                <span><strong>{{ p.outcome!.finderName }}</strong> found them</span>
                <span class="badge">Contributor x{{ credits(p) }}</span>
              </div>
            }
            @if (p.outcome.whereaboutsFound) {
              <p class="card__note">{{ p.outcome!.whereaboutsFound }}</p>
            }
          </a>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    .head { padding: 4px var(--lf-gap) 10px; }
    .head h1 { margin: 0 0 4px; font-size: 22px; }
    .head p { margin: 0; max-width: var(--lf-maxw); }
    .list { display: flex; flex-direction: column; gap: 10px; padding: 4px var(--lf-gap) 30px; }
    @media (min-width: 768px) { .list, .head { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; } }
    .card { display: block; padding: 12px; border: 1px solid var(--lf-line); border-radius: 10px; background: var(--lf-card);
      color: inherit; text-decoration: none; }
    .card__top { display: flex; align-items: center; gap: 8px; }
    .tick { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--lf-ubuntu); color: #fff; }
    .card__type { font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--lf-ubuntu); }
    .card__when { margin-left: auto; font-size: 12.5px; color: var(--lf-muted); }
    .card__title { margin: 8px 0 3px; font-size: 15.5px; font-weight: 600; line-height: 1.3; }
    .card__line { margin: 0; font-size: 13px; color: var(--lf-muted); }
    .card__note { margin: 6px 0 0; font-size: 13.5px; color: var(--lf-muted); }
    .finder { display: flex; align-items: center; gap: 8px; margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--lf-line); font-size: 13.5px; }
    .finder strong { font-weight: 600; }
    .badge { margin-left: auto; padding: 2px 9px; border-radius: 999px; background: color-mix(in srgb, var(--lf-primary) 14%, transparent);
      color: var(--lf-primary); font-size: 12px; font-weight: 700; }
  `]
})
export class FoundComponent implements OnInit {
  private data = inject(DataService);
  protected readonly timeAgo = timeAgo;
  protected readonly provinceName = provinceName;

  /**
   * Closed cases, most recent first. This is its own query, not a filter over
   * the feed: the feed leaves found cases out, which is exactly why the first
   * version of this page showed "no cases closed yet" with a reunion sitting in
   * the database.
   */
  readonly found = signal<Post[]>([]);

  async ngOnInit(): Promise<void> {
    this.found.set(await this.data.closedCases());
  }

  /** "found after 2 days" - the number that shows a share was worth it. */
  daysToFind(p: Post): string {
    const at = p.outcome.foundAt ?? null;
    if (!at) return '';
    const ms = Math.max(0, at - p.createdAt);
    if (ms < HOUR) return 'found within the hour';
    if (ms < DAY) return `found after ${Math.round(ms / HOUR)} hours`;
    const days = Math.round(ms / DAY);
    return `found after ${days} ${days === 1 ? 'day' : 'days'}`;
  }

  /** What kind of case closed. Not every reunion is a missing person. */
  typeLabel(p: Post): string {
    return ({
      missing: 'Missing person', khumbulekhaya: 'Home Sweet Home', pet: 'Pet',
      vehicle: 'Vehicle', sighting: 'Sighting', story: 'Story'
    } as Record<string, string>)[p.type] ?? 'Case';
  }

  credits(p: Post): number {
    const id = p.outcome.finderUserId;
    return id ? this.data.authorOf(id)?.contributorCredits ?? 1 : 1;
  }
}

