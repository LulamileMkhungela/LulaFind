import { ChangeDetectionStrategy, Component, effect, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from './icon.component';
import { AvatarComponent } from './avatar.component';
import { PostActionsService, SendRecipient } from '../../core/services/post-actions.service';
import { DataService } from '../../core/services/data.service';

/**
 * "Send this post to", built like LinkedIn's: the post shown at the top, a list of
 * people you can send it to, an optional note, one Send button.
 *
 * LulaFind's difference is the list. A private thread only exists between two
 * people who follow each other, so those are the only names offered - and the
 * empty state says exactly that, with the way to fix it, rather than a share sheet
 * that quietly leaves the app.
 */
@Component({
  selector: 'lf-send-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent],
  template: `
    @if (post(); as p) {
      <div class="backdrop" (click)="close()" (keydown.escape)="close()" role="presentation">
        <div class="dialog" role="dialog" aria-modal="true" aria-label="Send this post" (click)="$event.stopPropagation()">
          <header class="top">
            <h2>Send this post to</h2>
            <button class="x" type="button" (click)="close()" aria-label="Close"><lf-icon name="x" [size]="20" /></button>
          </header>

          <div class="preview">
            <lf-avatar [src]="authorAvatar()" [name]="authorName()" [size]="40" />
            <div class="preview-copy">
              <strong>{{ p.title }}</strong>
              <span>{{ authorName() }} · {{ p.body.trim() ? p.body.trim().slice(0, 70) + '…' : 'Photo post' }}</span>
            </div>
          </div>

          <label class="search">
            <lf-icon name="search" [size]="16" />
            <input type="search" placeholder="Search a connection" [value]="query()" autocomplete="off"
                   (input)="onQuery($any($event.target).value)" aria-label="Search a connection" />
          </label>

          @if (loading()) {
            <p class="state"><span class="spin"></span> Finding your connections…</p>
          } @else if (!recipients().length) {
            <div class="state state--empty">
              <lf-icon name="lock" [size]="18" />
              <p>
                {{ query() ? 'Nobody called ' + query() + ' follows you back yet.' : 'Send reaches the people who follow you and you follow back.' }}
              </p>
              <button type="button" (click)="openNetwork()">Find people to follow</button>
            </div>
          } @else {
            <ul class="list" role="listbox" aria-multiselectable="true" aria-label="Choose people">
              @for (r of recipients(); track r.id) {
                <li>
                  <button type="button" role="option" [attr.aria-selected]="picked().includes(r.id)"
                          class="row" [class.on]="picked().includes(r.id)" (click)="toggle(r.id)">
                    <lf-avatar [src]="r.avatar" [name]="r.name" [size]="44" />
                    <span class="who"><strong>{{ r.name }}</strong><small>{{ r.headline }}</small></span>
                    <span class="tick" [class.on]="picked().includes(r.id)">
                      <lf-icon [name]="picked().includes(r.id) ? 'check' : 'plus'" [size]="16" [weight]="2.6" />
                    </span>
                  </button>
                </li>
              }
            </ul>
          }

          <textarea class="note" rows="2" maxlength="500" placeholder="Add a note (optional)" [value]="note()"
                    (input)="note.set($any($event.target).value)" aria-label="Note to go with this post"></textarea>

          <footer class="foot">
            <span class="count">{{ picked().length ? picked().length + (picked().length === 1 ? ' person chosen' : ' people chosen') : 'Choose who to send it to' }}</span>
            <div class="foot-acts">
              <button type="button" class="ghost" (click)="close()">Cancel</button>
              <button type="button" class="go" [disabled]="!picked().length || busy()" (click)="send()">
                {{ busy() ? 'Sending…' : 'Send' }}
              </button>
            </div>
          </footer>
          @if (error(); as message) { <p class="err" role="alert"><lf-icon name="alert" [size]="14" /> {{ message }}</p> }
        </div>
      </div>
    }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 1200; background: rgba(8, 10, 14, .62);
      display: flex; align-items: flex-end; justify-content: center; animation: lf-send-in .16s ease-out; }
    @media (min-width: 700px) { .backdrop { align-items: center; padding: 24px; } }
    @keyframes lf-send-in { from { opacity: 0; } to { opacity: 1; } }
    .dialog { width: 100%; max-width: 552px; max-height: min(88vh, 720px); overflow: auto; display: flex; flex-direction: column;
      gap: 10px; background: var(--lf-card); color: var(--ion-text-color); border-radius: 14px 14px 0 0; padding: 6px 0 12px; }
    @media (min-width: 700px) { .dialog { border-radius: 12px; padding-bottom: 6px; } }
    .top { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px 6px; }
    .top h2 { font-size: 16px; font-weight: 600; margin: 0; }
    .x { border: 0; background: none; color: var(--lf-muted); width: 34px; height: 34px; border-radius: 50%; cursor: pointer;
      display: grid; place-items: center; }
    .x:hover { background: var(--lf-hover); }
    .preview { display: flex; gap: 10px; align-items: center; padding: 6px 16px 10px; border-bottom: 1px solid var(--lf-line-soft); }
    .preview-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .preview-copy strong { font-size: 14px; font-weight: 600; }
    .preview-copy span { font-size: 12px; color: var(--lf-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .search { display: flex; align-items: center; gap: 8px; margin: 0 16px; padding: 0 12px; height: 40px; border-radius: 8px;
      background: var(--lf-card-2); color: var(--lf-muted); }
    .search input { flex: 1; min-width: 0; border: 0; background: none; color: var(--ion-text-color); font: inherit; font-size: 14px; }
    .list { list-style: none; margin: 4px 0 0; padding: 0; max-height: 40vh; overflow: auto; }
    .row { display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; padding: 10px 16px; border: 0;
      background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .row:hover { background: var(--lf-hover); }
    .row.on { background: var(--lf-primary-soft); }
    .who { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .who strong { font-size: 14px; font-weight: 600; }
    .who small { font-size: 12px; color: var(--lf-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tick { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; color: var(--lf-muted);
      border: 1px solid var(--lf-line-soft); }
    .tick.on { background: var(--lf-link); border-color: var(--lf-link); color: #fff; }
    .note { margin: 4px 16px 0; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--lf-line-soft); resize: vertical;
      background: var(--lf-card); color: var(--ion-text-color); font: inherit; font-size: 14px; }
    .state { display: flex; align-items: center; gap: 8px; justify-content: center; margin: 14px 16px; color: var(--lf-muted); font-size: 13.5px; }
    .state--empty { flex-direction: column; text-align: center; }
    .state--empty p { margin: 0; max-width: 40ch; line-height: 1.45; }
    .state--empty button { border: 1px solid var(--lf-link); background: none; color: var(--lf-link); font: inherit; font-weight: 600;
      font-size: 13px; padding: 7px 14px; border-radius: 999px; cursor: pointer; }
    .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--lf-line-soft); border-top-color: var(--lf-link);
      animation: lf-send-spin .8s linear infinite; }
    @keyframes lf-send-spin { to { transform: rotate(360deg); } }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 16px 0; margin-top: auto;
      border-top: 1px solid var(--lf-line-soft); }
    .count { font-size: 12.5px; color: var(--lf-muted); }
    .foot-acts { display: flex; gap: 8px; }
    .foot-acts button { font: inherit; font-weight: 600; font-size: 14px; border-radius: 999px; padding: 9px 18px; cursor: pointer; }
    .ghost { border: 1px solid var(--lf-line); background: none; color: var(--ion-text-color); }
    .go { border: 0; background: var(--lf-primary-fill); color: var(--lf-primary-text); }
    .go[disabled] { opacity: .5; cursor: default; }
    .err { display: flex; align-items: center; gap: 6px; margin: 6px 16px 0; color: var(--lf-signal-text); font-size: 13px; }
  `]
})
export class SendSheetComponent {
  protected actions = inject(PostActionsService);
  private data = inject(DataService);
  private router = inject(Router);

  /** Driven by the service, so any card or page can open the same sheet. */
  readonly post = computed(() => this.actions.sendTarget());
  query = signal('');
  note = signal('');
  picked = signal<string[]>([]);
  busy = signal(false);
  loading = signal(false);
  error = signal('');
  private all = signal<SendRecipient[]>([]);

  constructor() {
    // Opening the sheet reads the network once; closing it clears the picks.
    effect(() => {
      if (this.actions.sendTarget()) {
        this.picked.set([]);
        this.note.set('');
        this.error.set('');
        void this.load();
      }
    });
  }

  readonly recipients = computed(() => {
    const needle = this.query().trim().toLowerCase();
    const list = this.all();
    if (!needle) return list;
    return list.filter((r) => r.name.toLowerCase().includes(needle) || r.headline.toLowerCase().includes(needle));
  });

  readonly authorName = computed(() => {
    const p = this.post();
    if (!p) return '';
    return p.anonymous ? 'Anonymous' : this.data.authorOf(p.authorId)?.displayName ?? 'LulaFind member';
  });
  readonly authorAvatar = computed(() => {
    const p = this.post();
    return p && !p.anonymous ? this.data.avatarFor(this.data.authorOf(p.authorId)) : '';
  });

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.all.set(await this.actions.sendRecipients(this.query()));
      this.error.set('');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Could not read your connections.');
      this.all.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  onQuery(value: string): void {
    this.query.set(value);
    // The cached list is filtered live; a search nobody has typed yet needs no refetch.
  }

  toggle(id: string): void {
    this.picked.update((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }

  close(): void {
    this.picked.set([]);
    this.note.set('');
    this.error.set('');
    this.actions.closeSend();
  }

  openNetwork(): void {
    void this.router.navigate(['/connections']);
    this.close();
  }

  async send(): Promise<void> {
    const p = this.post();
    const ids = this.picked();
    if (!p || !ids.length || this.busy()) return;
    this.busy.set(true);
    try {
      const sent = await this.actions.sendTo(p, ids, this.note());
      this.close();
      if (sent === 0) await this.actions.toast('That post could not be sent. You can only message people who follow you back.');
      else await this.actions.toast(sent === 1 ? 'Sent. Open it in Chats.' : `Sent to ${sent} people. Open it in Chats.`);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'The post could not be sent.');
    } finally {
      this.busy.set(false);
    }
  }
}
