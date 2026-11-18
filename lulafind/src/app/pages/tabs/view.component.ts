import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { DataService } from '../../core/services/data.service';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { StoryRailComponent } from '../../shared/components/story-rail.component';
import { AvatarComponent } from '../../shared/components/avatar.component';

type Scope = 'following' | 'followers' | 'public';

@Component({
  selector: 'lf-view', standalone: true,
  imports: [IonContent, RouterLink, TopNavComponent, StoryRailComponent, AvatarComponent],
  template: `
    <lf-top-nav heading="View" />
    <ion-content class="lf-page">
      <main class="view">
        <h1>Stories and statuses</h1>
        <div class="filters" role="group" aria-label="Whose stories and statuses to view">
          @for (option of options; track option.key) {
            <button type="button" [class.on]="scope() === option.key" [attr.aria-pressed]="scope() === option.key" (click)="scope.set(option.key)">{{ option.label }}</button>
          }
        </div>
        <h2>Stories</h2>
        <lf-story-rail [scope]="scope()" (addStory)="createStory()" />
        <div class="status-head"><h2>Statuses</h2><a routerLink="/discover" [queryParams]="{ tab: 'statuses' }">Manage my status</a></div>
        @if (scope() === 'public') {
          <p class="empty">Public status browsing is not available. Public stories appear above.</p>
        } @else if (!statuses().length) {
          <p class="empty">No statuses from {{ scope() === 'following' ? 'people you follow' : 'your followers' }} yet.</p>
        } @else {
          @for (u of statuses(); track u.id) {
            <a class="person" [routerLink]="'/user/' + u.id">
              <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="42" [status]="u.checkIn?.status ?? null" />
              <span><strong>{{ u.displayName }}</strong><small>{{ label(u.checkIn?.status) }}@if (u.checkIn?.note) { · {{ u.checkIn!.note }} }</small></span>
            </a>
          }
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .view { max-width: var(--lf-maxw); margin: auto; padding: 16px var(--lf-gap); }
    h1 { font-size: 20px; margin: 0 0 16px; } h2 { font-size: 16px; margin: 18px 0 10px; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; }
    .filters button { border: 1px solid var(--lf-line); border-radius: 999px; background: var(--lf-card); color: var(--lf-muted); padding: 8px 14px; font: inherit; cursor: pointer; }
    .filters button.on { color: var(--lf-primary-soft-text); background: var(--lf-primary-soft); border-color: var(--lf-primary); font-weight: 700; }
    .status-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .status-head a { color:var(--lf-primary); font-size:13px; }
    .person { display:flex; align-items:center; gap:10px; padding:12px 0; border-bottom:1px solid var(--lf-line); color:inherit; text-decoration:none; }
    .person span { min-width:0; display:flex; flex-direction:column; gap:3px; } .person small,.empty { color:var(--lf-muted); overflow-wrap:anywhere; }
  `]
})
export class ViewComponent {
  protected readonly data = inject(DataService);
  readonly scope = signal<Scope>('following');
  readonly options: { key: Scope; label: string }[] = [
    { key: 'following', label: 'Following' }, { key: 'followers', label: 'Followers' }, { key: 'public', label: 'Public' }
  ];
  readonly statuses = computed(() => {
    const ids = this.scope() === 'following' ? this.data.followingIds() : this.data.followerIds();
    return this.data.networkStatuses().filter((person) => ids.includes(person.id));
  });
  createStory(): void { void this.router.navigateByUrl('/create-story'); }
  private readonly router = inject(Router);
  label(status: string | undefined): string {
    return ({ safe: "I'm safe", need_help: 'Needs help', watch_me: 'Watch me', unfamiliar: 'Status update' } as Record<string, string>)[status ?? ''] ?? 'Status update';
  }
}
