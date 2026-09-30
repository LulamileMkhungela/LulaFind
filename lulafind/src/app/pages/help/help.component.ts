import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IonTitle } from '@ionic/angular/ion-title';
import { IconComponent } from '../../shared/components/icon.component';
import { SUPPORT_EMAIL, SUPPORT_NAME } from '../../core/config';
import {
  GBV_CHANNEL_NOTE,
  HELP_GROUPS,
  HELP_LINES,
  INFORMED_NOTE,
  NOT_OUR_PANIC,
  SAPS_MISSING_LIST,
  SAPS_MISSING_STEPS
} from '../../core/data/sa-help';

@Component({
  selector: 'lf-help',
  standalone: true,
  imports: [IonContent, IonHeader, IonToolbar, IonButtons, IonTitle, RouterLink, IconComponent],
  template: `
    <!-- Deliberately no back button: leaving help clears history on purpose (see leave()). -->
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-title>Get help</ion-title>
        <ion-buttons slot="end">
          <button class="leave" type="button" (click)="leave()">Leave</button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="lf-page">
      <div class="lf-banner lf-banner--danger">
        <lf-icon name="phone" [size]="20" />
        <div>
          <strong>This page is not posted.</strong>
          LulaFind does not call the police, an ambulance, or a response team. You tap the number.
        </div>
      </div>

      <p class="quiet">Tap Leave to go straight back to the feed: this page does not stay in Back.</p>
      <a class="lf-btn lf-btn--block" routerLink="/faqs"><lf-icon name="info" [size]="16" /> Questions and answers</a>
      <section>
        <h2>Contact LulaFind</h2>
        <a class="line" [href]="'mailto:' + support">
          <span class="num">Email</span>
          <span class="meta">
            <strong>{{ supportName }}</strong>
            <span>{{ support }}. This opens your mail app. It is not a chat inside LulaFind.</span>
          </span>
          <lf-icon name="chevronRight" [size]="16" />
        </a>
      </section>
      <section>
        <h2>Private note</h2>
        <p class="note">Saved on this phone only. Not posted. Someone who can unlock this phone can still open it. This is not an encrypted vault.</p>
        <textarea [value]="note" (input)="note = $any($event.target).value" rows="4" placeholder="What happened, in your words"></textarea>
        <button class="lf-btn lf-btn--sm" type="button" (click)="saveNote()">Save on this phone</button>
      </section>

      @for (group of groups; track group.key) {
        <section>
          <h2>{{ group.label }}</h2>
          @for (line of lines(group.key); track line.id) {
            <a class="line" [href]="line.href"
               [attr.target]="line.href.startsWith('http') ? '_blank' : null"
               [attr.rel]="line.href.startsWith('http') ? 'noopener' : null">
              <span class="num">{{ line.number }}</span>
              <span class="meta">
                <strong>{{ line.name }}</strong>
                <span>{{ line.detail }}</span>
              </span>
              <lf-icon name="chevronRight" [size]="16" />
            </a>
          }
          @if (group.key === 'violence') {
            <p class="note">{{ gbvNote }}</p>
          }
          @if (group.key === 'missing') {
            <ol class="steps">
              @for (step of steps; track step) { <li>{{ step }}</li> }
            </ol>
            <a class="line" [href]="sapsList" target="_blank" rel="noopener">
              <span class="num">SAPS list</span>
              <span class="meta">
                <strong>Official missing-person list</strong>
                <span>Crime Stop publishes this. LulaFind does not.</span>
              </span>
              <lf-icon name="chevronRight" [size]="16" />
            </a>
            <p class="note">An Amber Alert is issued by SAPS, not by LulaFind. Ask the investigating officer.</p>
          }
          @if (group.key === 'apps') {
            <p class="note">{{ informed }}</p>
            <p class="note">{{ notUs }}</p>
          }
        </section>
      }
    </ion-content>
  `,
  styles: [`
    .leave { margin-right: 8px; border: 0; background: var(--lf-signal); color: #fff;
      font-weight: 700; font-size: 14px; border-radius: 999px; padding: 6px 14px; }
    .quiet { margin: 4px var(--lf-gap) 0; font-size: 13px; color: var(--lf-muted); }
    section { padding: 8px var(--lf-gap) 4px; }
    h2 { margin: 12px 0 8px; font-size: 13px; letter-spacing: .4px; text-transform: uppercase; color: var(--lf-muted); }
    .line { display: flex; align-items: center; gap: 12px; text-decoration: none; color: inherit;
      padding: 12px; margin-bottom: 8px; border-radius: var(--lf-radius);
      border: 0; box-shadow: var(--lf-shadow); background: var(--lf-card); }
    .line:active { transform: scale(.99); }
    .num { min-width: 92px; font-size: 16px; font-weight: 800; letter-spacing: -.3px; color: var(--lf-signal-text); }
    .meta { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .meta strong { font-size: 14px; }
    .meta span { font-size: 12.5px; line-height: 1.35; color: var(--lf-muted); }
    textarea { width: 100%; box-sizing: border-box; margin: 0 0 8px; padding: 10px; border-radius: var(--lf-radius);
      border: 0; box-shadow: var(--lf-shadow); background: var(--lf-card); color: inherit; font: inherit; }
    .note, .steps { font-size: 12.5px; line-height: 1.45; color: var(--lf-muted); }
    .steps { margin: 4px 0 8px; padding-left: 18px; }
    .steps li { margin: 0 0 4px; }
  `]
})
export class HelpComponent {
  private router = inject(Router);
  protected readonly groups = HELP_GROUPS;
  protected readonly steps = SAPS_MISSING_STEPS;
  protected readonly gbvNote = GBV_CHANNEL_NOTE;
  protected readonly notUs = NOT_OUR_PANIC;
  protected readonly informed = INFORMED_NOTE;
  protected readonly sapsList = SAPS_MISSING_LIST;
  protected readonly support = SUPPORT_EMAIL;
  protected readonly supportName = SUPPORT_NAME;
  note = '';

  constructor() {
    try { this.note = localStorage.getItem('lulafind.privateNote') ?? ''; } catch { /* private mode */ }
  }

  saveNote(): void {
    try { localStorage.setItem('lulafind.privateNote', this.note); } catch { /* private mode */ }
  }

  lines(group: string) {
    return HELP_LINES.filter((line) => line.group === group);
  }

  leave(): void {
    void this.router.navigateByUrl('/home', { replaceUrl: true });
  }
}
