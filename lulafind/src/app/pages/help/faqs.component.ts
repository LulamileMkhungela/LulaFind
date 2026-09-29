import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { FAQ_CATEGORIES, FAQS, FaqCategory, searchFaqs } from '../../core/data/faqs';
import { AuthService } from '../../core/services/auth.service';

/**
 * FAQs - the answers, one line per row, and nothing else on the page.
 *
 * The list is the same answer bank Lula uses, so a question answered in chat is
 * answered here too. Rows open in place; each answer links to the page that
 * does the job (the report form, the poster page, the safety centre).
 */
@Component({
  selector: 'lf-faqs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonContent, RouterLink, IconComponent, TopNavComponent],
  template: `
    <lf-top-nav title="FAQs" backTo="/me" />

    <ion-content class="lf-page">
      <div class="head">
        <label class="search">
          <lf-icon name="search" [size]="16" />
          <input #box type="search" placeholder="Search a question" [value]="query()"
                 (input)="query.set(box.value)" aria-label="Search questions" />
        </label>
        <div class="chips" role="tablist" aria-label="FAQ categories">
          <button type="button" role="tab" [class.on]="category() === 'all'" [attr.aria-selected]="category() === 'all'"
                  (click)="category.set('all')">All {{ total }}</button>
          @for (c of categories; track c) {
            <button type="button" role="tab" [class.on]="category() === c" [attr.aria-selected]="category() === c"
                    (click)="category.set(c)">{{ c }}</button>
          }
        </div>
      </div>

      @if (!rows().length) {
        <p class="empty">No question matches that. <a routerLink="/ask-lula">Ask Lula instead</a>.</p>
      }

      <div class="list">
        @for (f of rows(); track f.id) {
          <article class="item" [class.open]="open() === f.id">
            <button type="button" class="q" [attr.aria-expanded]="open() === f.id" (click)="toggle(f.id)">
              <span>{{ f.q }}</span>
              <lf-icon [name]="open() === f.id ? 'chevronDown' : 'chevronRight'" [size]="18" />
            </button>
            @if (open() === f.id) {
              <div class="a">
                <p>{{ f.a }}</p>
                @if (f.links?.length) {
                  <div class="acts">
                    @for (l of f.links; track l.route) {
                      <a class="go" [routerLink]="l.route">{{ l.label }} <lf-icon name="chevronRight" [size]="13" /></a>
                    }
                  </div>
                }
              </div>
            }
          </article>
        }
      </div>

      <div class="foot">
        <button class="lf-btn lf-btn--primary lf-btn--block" type="button" (click)="askLula()">
          <lf-icon name="chat" [size]="16" /> Still stuck? Ask Lula
        </button>
        <a class="lf-btn lf-btn--block" routerLink="/help"><lf-icon name="phone" [size]="16" /> Phone numbers</a>
      </div>
    </ion-content>
  `,
  styles: [`
    .head { background: var(--lf-card); padding: 12px 16px 10px; border-bottom: 1px solid var(--lf-line-soft); }
    .search { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: 20px;
      background: var(--lf-card-2); color: var(--lf-muted); }
    .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ion-text-color);
      font: inherit; font-size: 15px; }
    .chips { display: flex; gap: 8px; margin-top: 10px; overflow-x: auto; scrollbar-width: none; }
    .chips::-webkit-scrollbar { display: none; }
    .chips button { flex: none; height: 32px; padding: 0 12px; border: 1px solid var(--lf-line); border-radius: 16px;
      background: transparent; color: var(--ion-text-color); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .chips button.on { background: var(--lf-primary-soft); border-color: transparent; color: var(--lf-primary-soft-text); }

    .list { background: var(--lf-card); margin-top: 8px; }
    .item { border-bottom: 1px solid var(--lf-line-soft); }
    .q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 16px;
      border: 0; background: transparent; color: var(--ion-text-color); text-align: left; font: inherit;
      font-size: 15px; font-weight: 600; cursor: pointer; }
    .q lf-icon { color: var(--lf-muted); flex-shrink: 0; }
    .item.open .q { color: var(--lf-primary); }
    .a { padding: 0 16px 16px; }
    .a p { margin: 0; font-size: 14.5px; line-height: 1.5; color: var(--ion-text-color); }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .go { display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 12px; border-radius: 16px;
      background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); font-size: 13px; font-weight: 700; text-decoration: none; }

    .empty { margin: 16px; font-size: 14px; color: var(--lf-muted); }
    .foot { display: flex; flex-direction: column; gap: 8px; padding: 16px; }
    a.lf-btn { text-decoration: none; }
    @media (min-width: 700px) {
      .head, .list, .foot, .empty { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; }
    }
  `]
})
export class FaqsComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  protected readonly categories = FAQ_CATEGORIES;
  protected readonly total = FAQS.length;

  readonly query = signal('');
  readonly category = signal<FaqCategory | 'all'>('all');
  readonly open = signal<string | null>(null);

  readonly rows = computed(() => {
    const cat = this.category();
    const list = cat === 'all' ? FAQS : FAQS.filter((f) => f.category === cat);
    return searchFaqs(this.query(), list);
  });

  toggle(id: string): void {
    this.open.set(this.open() === id ? null : id);
  }

  askLula(): void {
    void this.router.navigateByUrl(this.auth.signedIn() ? '/ask-lula' : '/auth?next=/ask-lula');
  }
}
