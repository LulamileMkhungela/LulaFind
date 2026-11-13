import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonProgressBar } from '@ionic/angular/ion-progress-bar';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { BADGES, IMPACT_RULES, LEVELS, impactOf, pointsOf, progressFor } from '../../core/models/impact';
import { timeAgo } from '../../core/utils/format';

/**
 * Your impact - the one screen that explains the gamification out loud.
 *
 * The design brief here was a warning to itself: a missing-person app must
 * never become a place where people farm points. So this screen does two
 * things on purpose:
 *
 *   1. it shows what a person *gave* (leads, areas walked, posters, safety
 *      checks, communities held together) and nothing at all about cases;
 *   2. it says, in words, what is not counted and why, above the badges -
 *      not in a footnote nobody reads.
 */
@Component({
  selector: 'lf-progress',
  standalone: true,
  imports: [IonContent, IonProgressBar, RouterLink, IconComponent, TopNavComponent, AvatarComponent],
  template: `
    <lf-top-nav title="Your impact" backTo="/me" />

    <ion-content class="lf-page">
      @if (!me()) {
        <section class="pad">
          <h1 class="h1">Sign in to keep your impact</h1>
          <p class="muted">Every lead, area and poster is kept with your account, not this phone.</p>
          <a class="lf-btn lf-btn--primary lf-btn--block" routerLink="/auth">Sign in</a>
        </section>
      } @else {
        <!-- the level card -->
        <section class="hero" aria-label="Your level">
          <div class="hero__row">
            <div class="ring" [attr.data-level]="progress().level.level">
              <lf-avatar [src]="avatar()" [name]="me()!.displayName" [size]="64" />
            </div>
            <div class="hero__who">
              <span class="eyebrow">Level {{ progress().level.level }}</span>
              <h1 class="h1">{{ progress().level.name }}</h1>
              <p class="muted small">{{ progress().level.meaning }}</p>
            </div>
          </div>

          <div class="bar" role="group" [attr.aria-label]="barLabel()">
            <div class="bar__top">
              <strong>{{ progress().points }} points</strong>
              @if (progress().next; as n) {
                <span class="muted small">{{ progress().toNext }} to {{ n.name }}</span>
              } @else {
                <span class="muted small">Top level</span>
              }
            </div>
            <ion-progress-bar [value]="progress().percent / 100" [attr.aria-valuenow]="progress().percent"></ion-progress-bar>
          </div>

        </section>

        <!-- what is counted -->
        <section class="card" aria-label="What counts">
          <h2 class="h2">What counts</h2>
          <ul class="rules">
            @for (r of rules; track r.key) {
              <li>
                <span class="rules__label">{{ r.label }}</span>
                <span class="rules__pts">+{{ r.points }}</span>
                <em class="rules__have">{{ tally()[r.key] }} so far</em>
              </li>
            }
            <li class="rules__credit">
              <span class="rules__label">Named by a family as the person who found someone</span>
              <span class="rules__pts">+50</span>
              <em class="rules__have">{{ me()!.contributorCredits ?? 0 }} so far</em>
            </li>
          </ul>

          <div class="notcounted">
            <lf-icon name="shield" [size]="16" />
            <div>
              <strong>Never counted</strong>
              <p>Nothing about a family's worst day is scored. How many cases are missing, who posts the most, and
                 a sighting that could locate a child never enter a total.</p>
              <p>Nobody outside this screen sees your points unless you post them. This is not a leaderboard.</p>
            </div>
          </div>
        </section>

        <!--
          No ranking against other people: the app never turns a missing person
          into a reason for two volunteers to compete. What is shown is the size
          of the effort around this person and what their own work has done.
        -->
        <section class="card" aria-label="Around you">
          <h2 class="h2">Around you</h2>
          <div class="standing">
            <div class="standing__one">
              <span class="muted small">People helping near {{ townLabel() }}</span>
              <strong>{{ neighbours() }}</strong>
              <span class="muted small">in your province, on top of you</span>
            </div>
            <div class="standing__one">
              <span class="muted small">Families your work reached</span>
              <strong>{{ helpedCount() }}</strong>
              <span class="muted small">{{ helpedCount() === 1 ? 'case carries' : 'cases carry' }} something you did</span>
            </div>
            <div class="standing__one">
              <span class="muted small">Badges</span>
              <strong>{{ badges().length }} / {{ totalBadges }}</strong>
              <span class="muted small">earned</span>
            </div>
          </div>
        </section>

        <!-- badges -->
        <section class="card" aria-label="Badges">
          <h2 class="h2">Badges</h2>
          <p class="muted small">Each badge names something you did. Locked ones stay visible so the next step is obvious.</p>
          <div class="badges">
            @for (b of allBadges(); track b.spec.id) {
              <div class="badge" [class.on]="b.earned" [attr.data-tone]="b.spec.tone">
                <span class="badge__disc"><lf-icon [name]="b.spec.icon" [size]="20" [weight]="2.2" /></span>
                <div class="badge__text">
                  <strong>{{ b.spec.name }}</strong>
                  <span>{{ b.spec.how }}</span>
                  @if (b.earned && b.earnedAt) { <em class="badge__when">Earned {{ ago(b.earnedAt) }}</em> }
                </div>
                @if (!b.earned) { <lf-icon class="badge__lock" name="lock" [size]="14" /> }
              </div>
            }
          </div>
        </section>

        <section class="card" aria-label="Levels">
          <h2 class="h2">Levels</h2>
          <ol class="levels">
            @for (l of levels; track l.level) {
              <li [class.on]="progress().level.level >= l.level" [class.current]="progress().level.level === l.level">
                <span class="levels__dot"></span>
                <div>
                  <strong>{{ l.name }}</strong>
                  <span>{{ l.meaning }}</span>
                </div>
                <em>{{ l.min + '+' }}</em>
              </li>
            }
          </ol>
        </section>

        <p class="footnote">
          Impact is shown to you. Families see a "Contributor" badge only when they name you as the person who found someone.
        </p>
      }
    </ion-content>
  `,
  styles: [`
    .pad { padding: 24px var(--lf-gap); }
    .h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -.3px; }
    .h2 { margin: 0 0 8px; font-size: 17px; font-weight: 800; }
    .muted { color: var(--lf-muted); }
    .small { font-size: 12.5px; line-height: 1.4; }

    .hero { margin: 10px var(--lf-gap) 0; padding: 18px 16px; border-radius: 16px;
      background: linear-gradient(160deg, color-mix(in srgb, var(--lf-primary) 16%, var(--lf-card)), var(--lf-card) 68%);
      box-shadow: var(--lf-shadow); }
    .hero__row { display: flex; align-items: center; gap: 14px; }
    .hero__who { min-width: 0; }
    .eyebrow { display: inline-block; font-size: 11px; font-weight: 800; letter-spacing: .7px; text-transform: uppercase; color: var(--lf-primary-soft-text); }
    .ring { position: relative; display: grid; place-items: center; width: 84px; height: 84px; border-radius: 50%; flex: none;
      background: conic-gradient(var(--lf-primary) 0deg, var(--lf-primary) 300deg, color-mix(in srgb, var(--lf-primary) 18%, transparent) 300deg);
      }
    .ring lf-avatar { box-shadow: 0 0 0 3px var(--lf-card); border-radius: 50%; }
    .bar { margin-top: 16px; }
    .bar__top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
    .bar__top strong { font-size: 15px; }
    ion-progress-bar { --progress-background: var(--lf-primary); --background: color-mix(in srgb, var(--lf-primary) 16%, transparent); height: 10px; border-radius: 999px; }

    .card { margin: 10px var(--lf-gap) 0; padding: 14px 16px; border-radius: 14px; background: var(--lf-card); box-shadow: var(--lf-shadow); }

    .rules { list-style: none; margin: 0; padding: 0; }
    .rules li { display: grid; grid-template-columns: 1fr auto auto; align-items: baseline; gap: 10px;
      padding: 9px 0; border-top: 1px solid var(--lf-line-soft); font-size: 13.5px; }
    .rules li:first-child { border-top: 0; }
    .rules__label { min-width: 0; }
    .rules__pts { font-weight: 800; color: var(--lf-primary-soft-text); }
    .rules__have { font-style: normal; font-size: 11.5px; color: var(--lf-muted); }
    .notcounted { display: flex; gap: 9px; margin-top: 12px; padding: 11px 12px; border-radius: 10px;
      background: color-mix(in srgb, var(--lf-signal) 8%, var(--lf-card)); color: var(--ion-text-color); }
    .notcounted > lf-icon { color: var(--lf-signal-text); margin-top: 2px; }
    .notcounted strong { font-size: 13px; }
    .notcounted p { margin: 3px 0 0; font-size: 12px; line-height: 1.45; color: var(--lf-muted); }

    .standing { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .standing__one { display: flex; flex-direction: column; gap: 1px; padding: 11px; border-radius: 11px; background: var(--lf-card-2); }
    .standing__one strong { font-size: 20px; font-weight: 800; letter-spacing: -.4px; }
    .standing__one span { line-height: 1.3; }

    .badges { display: grid; gap: 8px; }
    .badge { display: flex; align-items: flex-start; gap: 10px; padding: 10px 11px; border-radius: 11px;
      background: var(--lf-card-2); opacity: .62; }
    .badge.on { opacity: 1; background: color-mix(in srgb, var(--lf-primary) 10%, var(--lf-card-2)); }
    .badge__disc { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; flex: none;
      background: var(--lf-card); color: var(--lf-muted); box-shadow: 0 0 0 1px var(--lf-line-soft); }
    .badge.on .badge__disc { color: #fff; background: var(--lf-primary); box-shadow: none; }
    .badge.on[data-tone="ubuntu"] .badge__disc { background: var(--lf-ubuntu); }
    .badge.on[data-tone="signal"] .badge__disc { background: var(--lf-signal); }
    .badge.on[data-tone="marigold"] .badge__disc { background: var(--lf-marigold); color: #3b2a00; }
    .badge.on[data-tone="ink"] .badge__disc { background: var(--ion-text-color); }
    .badge__text { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
    .badge__text strong { font-size: 13.5px; }
    .badge__text span { font-size: 11.5px; color: var(--lf-muted); line-height: 1.35; }
    .badge__when { font-style: normal; font-size: 11px; color: var(--lf-primary-soft-text); }
    .badge__lock { color: var(--lf-muted); margin-top: 8px; }

    .levels { list-style: none; margin: 0; padding: 0; }
    .levels li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--lf-line-soft); }
    .levels li:first-child { border-top: 0; }
    .levels__dot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--lf-line); }
    .levels li.on .levels__dot { background: var(--lf-primary); }
    .levels li.current .levels__dot { box-shadow: 0 0 0 4px color-mix(in srgb, var(--lf-primary) 22%, transparent); }
    .levels li > div { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .levels li strong { font-size: 13.5px; }
    .levels li span { font-size: 11.5px; color: var(--lf-muted); }
    .levels li em { font-style: normal; font-size: 11.5px; color: var(--lf-muted); }
    .levels li.current strong { color: var(--lf-primary-soft-text); }

    .footnote { margin: 12px var(--lf-gap) 24px; font-size: 11.5px; color: var(--lf-muted); text-align: center; line-height: 1.45; }
  `]
})
export class ProgressComponent {
  private auth = inject(AuthService);
  private data = inject(DataService);
  protected router = inject(Router);

  protected readonly me = computed(() => this.auth.user());
  protected readonly avatar = computed(() => this.data.avatarFor(this.me()));
  protected readonly levels = LEVELS;
  protected readonly rules = IMPACT_RULES;
  protected readonly totalBadges = BADGES.length;

  protected readonly progress = computed(() => progressFor(pointsOf(this.me())));
  protected readonly tally = computed(() => impactOf(this.me()));
  protected readonly barLabel = computed(
    () => `${this.progress().points} impact points, level ${this.progress().level.level} of ${LEVELS.length}`
  );

  protected readonly badges = computed(() => this.data.myBadges());

  /**
   * Every badge, earned first. Locked ones stay visible: the list is this
   * screen's "what else could I do", so hiding them would leave a person with
   * a badge count and no idea how to move it.
   */
  protected readonly allBadges = computed(() => {
    const earned = new Set(this.badges().map((b) => b.id));
    const notes = this.data.notifications();
    const rows = BADGES.map((spec) => {
      const on = earned.has(spec.id);
      const note = on ? notes.find((n) => n.kind === 'impact' && n.title === `Badge earned: ${spec.name}`) : undefined;
      return { spec, earned: on, earnedAt: note?.at ?? 0 };
    });
    return rows.sort((a, b) => Number(b.earned) - Number(a.earned));
  });

  /**
   * How many other members in this person's province have given anything.
   * A headcount of effort, not a ranking - the number never goes down because
   * someone else did well.
   */
  protected readonly neighbours = computed(() => {
    const me = this.me();
    if (!me) return 0;
    const province = me.province;
    return Object.values(this.data.authors())
      .filter((u) => u.id !== me.id && (!province || u.province === province))
      .filter((u) => pointsOf(u) > 0).length;
  });

  protected readonly townLabel = computed(() => this.me()?.town || this.me()?.province || 'South Africa');

  /**
   * Families this person has actually helped: every case they put a lead on,
   * every find they were named for, every area they finished that belonged to
   * someone else's case. Counted from the cases themselves, not the tally -
   * the tally is a lifetime number and this answers "who did it help".
   */
  protected readonly helpedCount = computed(() => {
    const me = this.me()?.id;
    if (!me) return 0;
    const mine = new Set<string>();
    for (const p of Object.values(this.data.cache())) {
      if (p.authorId === me) continue;
      const looked = (p.lookingIds ?? []).includes(me);
      const walked = (p.searchParty?.zones ?? []).some((z) => z.takenBy === me && z.done);
      const found = p.outcome?.finderUserId === me;
      if (looked || walked || found) mine.add(p.id);
    }
    return mine.size;
  });

  protected ago(ts: number): string {
    return ts ? timeAgo(ts) : '';
  }
}
