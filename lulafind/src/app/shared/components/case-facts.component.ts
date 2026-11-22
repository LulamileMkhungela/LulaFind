import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Post } from '../../core/models/types';
import { IconComponent } from './icon.component';
import { alreadySaid } from '../../core/utils/format';

/**
 * The case facts that ride on every live case post, identical on the feed
 * card and on the post page:
 *
 *   Lost pet / subject's name and age
 *   Last seen: ...
 *   3d open · 12 looking · 2/4 areas done
 *
 * They were written once inside the feed card and never reached the post
 * page, so the two screens disagreed about the same post. Now this is the
 * one place they live.
 */
@Component({
  selector: 'lf-case-facts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (post(); as p) {
      @if (p.type === 'announcement') {
        <div class="fact-row">
          <lf-icon name="megaphone" [size]="14" />
          <span><strong>{{ p.status === 'found' ? 'Found:' : 'Lost:' }}</strong> {{ p.subject?.name || 'Announcement' }}</span>
        </div>
      } @else if (p.subject?.name && !said(p, p.subject.name)) {
        <div class="fact-row">
          <lf-icon name="user" [size]="14" />
          <strong>{{ p.subject!.name }}</strong>
          @if (p.subject!.age !== null && p.subject!.age !== undefined) {
            <span class="muted">· {{ p.subject!.age }} {{ ageWord(p) }}</span>
          }
        </div>
      }
      @if ((p.lastSeenWhere || p.town) && !said(p, (p.lastSeenWhere || p.town)!)) {
        <div class="fact-row">
          <lf-icon name="pin" [size]="14" />
          <span>Last seen: {{ p.lastSeenWhere || p.town }}</span>
        </div>
      }
      @if (isLiveCase(p)) {
        <div class="case-line" [attr.data-urgency]="caseUrgency(p)">
          <lf-icon name="clock" [size]="13" [weight]="'regular'" />
          <strong>{{ caseAge(p) }}</strong>
          <span>open</span>
          @if ((p.lookingIds?.length ?? 0) > 0) {
            <span class="sep">·</span>
            <lf-icon name="search" [size]="13" />
            <span [attr.title]="'People who marked themselves as looking for this case'">{{ p.lookingIds!.length }} {{ p.lookingIds!.length === 1 ? 'person looking' : 'people looking' }}</span>
          }
          @if (p.searchParty?.open && p.searchParty!.zones.length) {
            <span class="sep">·</span>
            <lf-icon name="map" [size]="13" />
            <span>{{ doneAreas(p) }}/{{ p.searchParty!.zones.length }} areas</span>
          }
        </div>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .fact-row { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--lf-muted); margin-bottom: 3px; }
    .fact-row strong { color: var(--ion-text-color); font-weight: 600; }
    .muted { color: var(--lf-muted); }
    /*
     * The case line. The clock is the only thing that turns red - on time,
     * never on engagement. A case about a child, or one still in its first
     * day, is red; after three days it goes quiet.
     */
    .case-line { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin: 2px 0 8px;
      font-size: 12.5px; font-weight: 500; line-height: 1.25; color: var(--lf-muted); }
    .case-line strong { color: var(--ion-text-color); font-weight: 700; font-variant-numeric: tabular-nums; }
    .case-line[data-urgency="critical"] > lf-icon:first-child,
    .case-line[data-urgency="critical"] strong,
    .case-line[data-urgency="high"] > lf-icon:first-child,
    .case-line[data-urgency="high"] strong { color: var(--lf-signal-text); }
    .sep { opacity: .7; }
  `]
})
export class CaseFactsComponent {
  readonly post = input.required<Post>();

  isLiveCase(p: Post): boolean {
    return (p.type === 'missing' || p.type === 'khumbulekhaya') && p.status === 'active' && !p.repostOf;
  }

  /** "3d", "9h", "40m" - the same units the app uses everywhere else. */
  caseAge(p: Post): string {
    const d = Math.max(0, Date.now() - p.createdAt);
    const m = Math.floor(d / 60_000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  caseUrgency(p: Post): 'critical' | 'high' | 'normal' {
    const age = p.subject?.age;
    const hours = (Date.now() - p.createdAt) / 3_600_000;
    if ((age !== null && age !== undefined && age < 18) || hours < 24) return 'critical';
    return hours < 72 ? 'high' : 'normal';
  }

  doneAreas(p: Post): number {
    return (p.searchParty?.zones ?? []).filter((z) => z.done).length;
  }

  said(p: Post, value: string | null | undefined): boolean {
    return alreadySaid(value, p.title, p.body);
  }

  ageWord(p: Post): string {
    return (p.subject?.age ?? 0) === 1 ? 'year old' : 'years old';
  }
}
