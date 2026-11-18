import { BackStackService } from '../../core/services/back-stack.service';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonRefresher } from '@ionic/angular/ion-refresher';
import { IonRefresherContent } from '@ionic/angular/ion-refresher-content';
import { ActionSheetController } from '@ionic/angular/action-sheet-controller';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { DataService } from '../../core/services/data.service';
import { PlatformService } from '../../core/services/platform.service';
import { POST_TYPE_META, Post, provinceName } from '../../core/models/types';
import { timeAgo } from '../../core/utils/format';

/**
 * Saved - Facebook's "Saved items" for LulaFind.
 *
 * Every post you tap Save on lands here, newest first, and follows your
 * account to any phone. You are told when a saved post gets a new reaction or is
 * marked found (see DataService.checkWatched).
 */
@Component({
  selector: 'lf-saved',
  standalone: true,
  imports: [IonContent, TopNavComponent, IonRefresher, IonRefresherContent, RouterLink, IconComponent, EmptyComponent],
  template: `
    <lf-top-nav title="Saved" backTo="/me" />

    <ion-content class="lf-page">
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>

      <div class="seg" role="tablist" aria-label="Filter saved posts">
        @for (f of filters; track f.key) {
          <button class="pill" role="tab" [class.on]="show() === f.key" (click)="show.set(f.key)">{{ f.label }}</button>
        }
      </div>

      <p class="hint lf-small lf-muted">
        <lf-icon name="bell" [size]="14" /> We let you know when a saved post gets a new reaction or the person is found.
      </p>

      @if (loading() && !data.savedPosts().length) {
        <p class="lf-muted lf-small center">Loading your saved posts…</p>
      } @else if (!list().length) {
        <lf-empty icon="bookmark" [title]="show() === 'all' ? 'Nothing saved yet' : 'Nothing here'"
                  message="Tap ••• on any post and choose Save post. It stays here until you remove it."
                  actionLabel="Browse the feed" (action)="router.navigate(['/home'])" />
      } @else {
        <div class="list lf-safe-bottom">
          @for (p of list(); track p.id) {
            <div class="row">
              <a class="main" [routerLink]="'/post/' + p.id">
                @if (thumb(p); as t) { <img [src]="t" alt="" loading="lazy" /> }
                @else { <span class="ph"><lf-icon [name]="meta(p).icon" [size]="26" /></span> }
                <div class="txt">
                  <strong>{{ p.title }}</strong>
                  <span class="lf-tiny lf-muted">{{ meta(p).label }} · {{ provinceName(p.province) }} · {{ ago(p.createdAt) }}</span>
                  <span class="stats lf-tiny">
                    @if (p.status === 'found') { <em class="found"><lf-icon name="check" [size]="12" /> Found</em> }
                    <span class="lf-muted">{{ p.upvotes }} reactions · {{ p.commentCount }} comments</span>
                  </span>
                </div>
              </a>
              <button class="lf-round-btn dots" (click)="options(p)" aria-label="Options"><lf-icon name="more" [size]="20" /></button>
            </div>
          }
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .fb-head__title.sm { font-size: 20px; }
    .back { margin-right: 8px; }
    .fb-head__bar { justify-content: flex-start; }
    .seg { display: flex; gap: 8px; padding: 4px var(--lf-gap) 10px; overflow-x: auto; }
    .pill { flex: none; height: 34px; padding: 0 14px; border: 0; border-radius: 999px; cursor: pointer; font: inherit;
      font-size: 14px; font-weight: 600; background: var(--lf-card-2); color: var(--ion-text-color); }
    .pill.on { background: var(--lf-primary-soft); color: var(--lf-link); }
    .hint { display: flex; align-items: center; gap: 6px; margin: 10px var(--lf-gap) 6px; }
    .center { text-align: center; padding: 30px; }
    .list { background: var(--lf-card); box-shadow: var(--lf-shadow); }
    @media (min-width: 768px) { .list, .hint { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; border-radius: var(--lf-radius); } }
    .row { display: flex; align-items: center; gap: 4px; padding: 10px 8px 10px var(--lf-gap); border-bottom: 1px solid var(--lf-line-soft); }
    .row:last-child { border-bottom: 0; }
    .main { flex: 1; min-width: 0; display: flex; gap: 12px; align-items: center; color: inherit; text-decoration: none; }
    .main img, .ph { width: 72px; height: 72px; border-radius: 10px; object-fit: cover; flex: none; background: var(--lf-card-2); }
    .ph { display: grid; place-items: center; color: var(--lf-muted); }
    .txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .txt strong { font-size: 15px; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2;
      -webkit-box-orient: vertical; overflow: hidden; }
    .stats { display: flex; gap: 8px; align-items: center; }
    .found { font-style: normal; font-weight: 700; color: var(--lf-ubuntu); display: inline-flex; gap: 3px; align-items: center; }
    .dots { background: transparent; }
  `]
})
export class SavedComponent {
  private backStack = inject(BackStackService);
  protected data = inject(DataService);
  protected router = inject(Router);
  private sheet = inject(ActionSheetController);
  private toast = inject(ToastController);
  private platform = inject(PlatformService);

  protected readonly provinceName = provinceName;
  readonly loading = signal(true);
  readonly show = signal<'all' | 'active' | 'found'>('all');
  readonly filters = [
    { key: 'all' as const, label: 'All' },
    { key: 'active' as const, label: 'Still missing' },
    { key: 'found' as const, label: 'Found' }
  ];

  readonly list = computed(() => {
    const s = this.show();
    return this.data.savedPosts().filter((p) => s === 'all' || (s === 'found' ? p.status === 'found' : p.status !== 'found'));
  });

  constructor() {
    void this.data.loadSaved().finally(() => this.loading.set(false));
  }

  async refresh(ev: CustomEvent): Promise<void> {
    await this.data.loadSaved();
    await this.data.checkWatched(true);
    (ev.target as HTMLIonRefresherElement).complete();
  }

  meta(p: Post) { return POST_TYPE_META[p.type]; }
  ago(t: number): string { return timeAgo(t); }
  thumb(p: Post): string | null {
    const m = p.media?.[0];
    return m ? (m.kind === 'video' ? m.poster ?? null : m.src) : null;
  }

  back(): void {
    this.backStack.go('/me');
  }

  async options(p: Post): Promise<void> {
    const s = await this.sheet.create({
      buttons: [
        { text: 'Open post', icon: undefined, handler: () => { void this.router.navigate(['/post', p.id]); } },
        { text: 'Share', handler: () => { void this.share(p); } },
        { text: 'Remove from Saved', role: 'destructive', handler: () => { void this.unsave(p); } },
        { text: 'Cancel', role: 'cancel' }
      ]
    });
    await s.present();
  }

  private async share(p: Post): Promise<void> {
    await this.platform.share(p.title, `${p.title}\n\nShared from LulaFind`, this.platform.link(`/post/${p.id}`));
    await this.data.recordShare(p.id).catch(() => undefined);
  }

  private async unsave(p: Post): Promise<void> {
    await this.data.toggleSaved(p.id);
    const t = await this.toast.create({
      message: 'Removed from Saved', duration: 3000, position: 'bottom',
      buttons: [{ text: 'Undo', handler: () => { void this.data.toggleSaved(p.id); } }]
    });
    await t.present();
  }
}
