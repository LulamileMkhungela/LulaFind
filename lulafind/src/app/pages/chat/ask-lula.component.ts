import { Component, ViewChild, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IonBackButton } from '@ionic/angular/ion-back-button';
import { IconComponent } from '../../shared/components/icon.component';
import { LogoComponent } from '../../shared/components/logo.component';
import { LULA_GREETING, LULA_SUGGESTIONS, LulaAnswer, askLula } from '../../core/data/ask-lula';
import { uid } from '../../core/utils/format';

interface Line { id: string; from: 'me' | 'lula'; text: string; links?: LulaAnswer['links'] }

/** Ask Lula: a help chat. Reached only from the pinned row on the Chats page. */
@Component({
  selector: 'lf-ask-lula',
  standalone: true,
  imports: [IonContent, IonHeader, IonToolbar, IonButtons, IonBackButton, IconComponent, LogoComponent],
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/chats" text=""></ion-back-button></ion-buttons>
        <div class="peer">
          <span class="badge"><lf-logo [size]="26" label="Lula" /></span>
          <div><strong>Ask Lula</strong><span class="lf-tiny lf-muted">Help with LulaFind</span></div>
        </div>
      </ion-toolbar>
    </ion-header>

    <ion-content class="lf-page lf-plain room" #content>
      <p class="notice"><lf-icon name="info" [size]="14" /> Lula gives written guidance, not a live person. In an emergency call 10111.</p>
      <div class="msgs">
        @for (l of lines(); track l.id) {
          <div class="msg" [class.mine]="l.from === 'me'">
            @if (l.from === 'lula') { <span class="badge sm"><lf-logo [size]="20" label="Lula" /></span> }
            <div class="bubble">
              <p>{{ l.text }}</p>
              @if (l.links?.length) {
                <div class="links">
                  @for (k of l.links; track k.route) {
                    <button type="button" (click)="go(k.route)">{{ k.label }} <lf-icon name="chevronRight" [size]="13" /></button>
                  }
                </div>
              }
            </div>
          </div>
        }
        @if (typing()) { <div class="msg"><span class="badge sm"><lf-logo [size]="20" label="Lula" /></span><div class="bubble typing"><i></i><i></i><i></i></div></div> }
      </div>
      @if (lines().length < 2) {
        <div class="chips">
          @for (s of suggestions; track s) { <button type="button" (click)="ask(s)">{{ s }}</button> }
        </div>
      }
    </ion-content>

    <form class="composer" (submit)="$event.preventDefault(); ask(draft)">
      <input class="fld" name="q" autocomplete="off" placeholder="Ask Lula anything…" enterkeyhint="send"
             [value]="draft" (input)="draft = $any($event.target).value" />
      <button type="submit" class="send" [disabled]="!draft.trim()" aria-label="Send"><lf-icon name="send" [size]="20" [filled]="true" /></button>
    </form>
  `,
  styles: [`
    .peer { display: flex; align-items: center; gap: 10px; }
    .peer div { display: flex; flex-direction: column; line-height: 1.2; }
    .badge { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: var(--lf-card-2); }
    .badge.sm { width: 28px; height: 28px; flex-shrink: 0; }
    .room { --padding-bottom: 12px; }
    .notice { display: flex; gap: 6px; align-items: center; margin: 10px var(--lf-gap) 4px; font-size: 12px; color: var(--lf-muted); }
    .msgs { display: flex; flex-direction: column; gap: 10px; padding: 8px var(--lf-gap) 8px; }
    .msg { display: flex; gap: 8px; align-items: flex-end; max-width: 86%; }
    .msg.mine { align-self: flex-end; flex-direction: row-reverse; }
    .bubble { padding: 9px 13px; border-radius: 18px; background: var(--lf-card-2); }
    .msg.mine .bubble { background: var(--lf-primary-fill); color: #fff; }
    .bubble p { margin: 0; font-size: 15px; line-height: 1.38; white-space: pre-wrap; }
    .links { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .links button { display: inline-flex; align-items: center; justify-content: space-between; gap: 6px; padding: 8px 12px;
      border: 1px solid var(--lf-line); border-radius: 999px; background: var(--lf-card); color: var(--lf-link);
      font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .typing { display: flex; gap: 4px; padding: 13px 14px; }
    .typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--lf-muted); animation: b 1s infinite ease-in-out; }
    .typing i:nth-child(2) { animation-delay: .15s; } .typing i:nth-child(3) { animation-delay: .3s; }
    @keyframes b { 0%, 80%, 100% { opacity: .3; transform: none; } 40% { opacity: 1; transform: translateY(-3px); } }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 6px var(--lf-gap) 20px; }
    .chips button { padding: 8px 12px; border: 1px solid var(--lf-line); border-radius: 999px; background: var(--lf-card);
      color: var(--ion-text-color); font: inherit; font-size: 13px; cursor: pointer; }
    .composer { display: flex; align-items: center; gap: 8px; padding: 8px var(--lf-gap) calc(8px + var(--lf-safe-bottom) + var(--keyboard-offset));
      background: var(--lf-card); border-top: 1px solid var(--lf-line-soft); }
    .fld { flex: 1; min-width: 0; height: 40px; padding: 0 16px; border: 0; border-radius: 20px; outline: 0;
      background: var(--lf-card-2); color: var(--ion-text-color); font: inherit; font-size: 15px; }
    .send { width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent; color: var(--lf-primary); cursor: pointer; }
    .send:disabled { opacity: .4; }
  `]
})
export class AskLulaComponent {
  private router = inject(Router);
  @ViewChild('content') content?: IonContent;

  protected readonly suggestions = LULA_SUGGESTIONS;
  readonly lines = signal<Line[]>([{ id: 'g', from: 'lula', text: LULA_GREETING.text }]);
  readonly typing = signal(false);
  draft = '';

  ask(text: string): void {
    const q = text.trim();
    if (!q || this.typing()) return;
    this.draft = '';
    this.lines.update((l) => [...l, { id: uid('l'), from: 'me', text: q }]);
    this.typing.set(true);
    void this.scroll();
    const answer = askLula(q);
    setTimeout(() => {
      this.typing.set(false);
      this.lines.update((l) => [...l, { id: uid('l'), from: 'lula', text: answer.text, links: answer.links }]);
      void this.scroll();
    }, 550);
  }

  go(route: string): void {
    void this.router.navigateByUrl(route);
  }

  private async scroll(): Promise<void> {
    await new Promise((r) => setTimeout(r, 30));
    await this.content?.scrollToBottom(200);
  }
}
