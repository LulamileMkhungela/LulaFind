import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';





import { IonSearchbar } from '@ionic/angular/ion-searchbar';
import { AlertController } from '@ionic/angular/alert-controller';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { ModerationService } from '../../core/services/moderation.service';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { Post, UserReport, UserProfile } from '../../core/models/types';
import { timeAgo } from '../../core/utils/format';

/**
 * Admin (the creator / trust & safety team).
 *
 * Only an admin can reach this page. From here you work the report queue,
 * remove a post, suspend or delete a person.
 */
@Component({
  selector: 'lf-admin',
  standalone: true,
  imports: [IonContent, IonSearchbar, RouterLink, IconComponent, EmptyComponent, AvatarComponent, TopNavComponent],
  template: `
    <lf-top-nav title="Admin" backTo="/me" />

    <ion-content class="lf-page">
      @if (!mod.isAdmin()) {
        <lf-empty icon="lock" title="Admins only"
                  message="This page is for the LulaFind creator and the trust & safety team." />
      } @else {
        <div class="lf-banner">
          <lf-icon name="shield" [size]="18" />
          <div>
            You are signed in as an admin. You can remove posts, suspend people and delete accounts.
            Every action is recorded on the report.
          </div>
        </div>

        <div class="tabs">
          <button class="tab" [class.on]="tab() === 'reports'" (click)="show('reports')">
            Reports @if (mod.openCount() > 0) { <span class="lf-badge">{{ mod.openCount() }}</span> }
          </button>
          <button class="tab" [class.on]="tab() === 'people'" (click)="show('people')">People</button>
          <button class="tab" [class.on]="tab() === 'review'" (click)="show('review')">
            Review @if (mod.pendingCases().length > 0) { <span class="lf-badge">{{ mod.pendingCases().length }}</span> }
          </button>
          <button class="tab" [class.on]="tab() === 'posts'" (click)="show('posts')">Posts</button>
        </div>

        @if (tab() === 'reports') {
          @if (!mod.openReports().length) {
            <lf-empty icon="check" title="No open reports" message="Anything members report lands here." />
          }
          @for (r of mod.openReports(); track r.id) {
            <div class="lf-card">
              <div class="lf-card__body">
                <div class="lf-row-between">
                  <span class="lf-chip lf-chip--danger">{{ r.target }}</span>
                  <span class="lf-meta">{{ timeAgo(r.at) }}</span>
                </div>
                <h3 class="lf-h2" style="margin:8px 0 2px">{{ r.summary }}</h3>
                <p class="lf-small lf-muted">Reason: <strong>{{ r.reason }}</strong></p>
                @if (r.detail) { <p class="lf-small">"{{ r.detail }}"</p> }
                <p class="lf-meta">Reported by {{ nameOf(r.byUserId) }}</p>
                <div class="acts">
                  @if (r.target === 'post') {
                    <button class="lf-btn lf-btn--sm lf-btn--ghost" [routerLink]="'/post/' + r.targetId">Open post</button>
                    <button class="lf-btn lf-btn--sm lf-btn--danger" (click)="removePost(r)">Remove post</button>
                  } @else if (r.target === 'user') {
                    <button class="lf-btn lf-btn--sm lf-btn--ghost" [routerLink]="'/user/' + r.targetId">Open profile</button>
                    <button class="lf-btn lf-btn--sm lf-btn--danger" (click)="suspend(r)">Suspend</button>
                    <button class="lf-btn lf-btn--sm lf-btn--danger" (click)="removeUser(r)">Delete</button>
                  }
                  <button class="lf-btn lf-btn--sm lf-btn--ghost" (click)="dismiss(r)">Dismiss</button>
                </div>
              </div>
            </div>
          }
        }

        @if (tab() === 'people') {
          <ion-searchbar placeholder="Search a name or username" [debounce]="200"
                         (ionInput)="query.set($any($event.detail).value ?? '')"></ion-searchbar>
          @for (u of people(); track u.id) {
            <div class="lf-card">
              <div class="lf-card__body">
                <div class="lf-row" style="gap:10px">
                  <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="42" />
                  <div class="lf-grow">
                    <strong>{{ u.displayName }}</strong>
                    <div class="lf-meta">@@{{ u.handle }} · {{ u.email }}</div>
                    @if (u.isAdmin) { <span class="lf-chip lf-chip--success lf-tiny">admin</span> }
                    @if (u.suspended) { <span class="lf-chip lf-chip--danger lf-tiny">suspended</span> }
                  </div>
                </div>
                <div class="acts">
                  <button class="lf-btn lf-btn--sm lf-btn--ghost" [routerLink]="'/user/' + u.id">Profile</button>
                  @if (!u.isAdmin) {
                    <button class="lf-btn lf-btn--sm" (click)="suspendUser(u)">
                      {{ u.suspended ? 'Unsuspend' : 'Suspend' }}
                    </button>
                    <button class="lf-btn lf-btn--sm lf-btn--danger" (click)="deleteUser(u)">Remove</button>
                  }
                </div>
              </div>
            </div>
          }
        }

        @if (tab() === 'review') {
          <p class="lf-small lf-muted" style="padding:0 var(--lf-gap) 4px">
            A child case waits here until you confirm it. Nobody is alerted until you publish it.
          </p>
          @if (!mod.pendingCases().length) {
            <lf-empty icon="check" title="Nothing waiting" message="Every child case has been checked." />
          }
          @for (p of mod.pendingCases(); track p.id) {
            <div class="lf-card">
              <div class="lf-card__body">
                <div class="lf-row-between">
                  <span class="lf-chip lf-chip--danger">{{ p.type }}</span>
                  <span class="lf-meta">{{ timeAgo(p.createdAt) }}</span>
                </div>
                <h3 class="lf-h2" style="margin:8px 0 2px">{{ p.title }}</h3>
                <p class="lf-small lf-muted">{{ subjectLine(p) }}</p>
                <p class="lf-small">{{ p.body }}</p>
                <div class="acts">
                  <button class="lf-btn lf-btn--sm lf-btn--success" (click)="approve(p.id)" [disabled]="mod.busy()">Publish and alert</button>
                  <button class="lf-btn lf-btn--sm lf-btn--ghost" [routerLink]="'/post/' + p.id">Open</button>
                  <button class="lf-btn lf-btn--sm lf-btn--danger" (click)="reject(p.id, p.title)">Reject</button>
                </div>
              </div>
            </div>
          }
        }

        @if (tab() === 'posts') {
          <ion-searchbar placeholder="Search posts" [debounce]="200"
                         (ionInput)="query.set($any($event.detail).value ?? '')"></ion-searchbar>
          @for (p of posts(); track p.id) {
            <div class="lf-card">
              <div class="lf-card__body">
                <div class="lf-row-between">
                  <span class="lf-chip" [class.lf-chip--danger]="p.type === 'missing'">{{ p.type }}</span>
                  <span class="lf-meta">{{ p.flags.length }} report(s)</span>
                </div>
                <h3 class="lf-h2" style="margin:8px 0 2px">{{ p.title }}</h3>
                <p class="lf-small lf-muted">by {{ nameOf(p.authorId) }} · {{ timeAgo(p.createdAt) }}</p>
                <div class="acts">
                  <button class="lf-btn lf-btn--sm lf-btn--ghost" [routerLink]="'/post/' + p.id">Open</button>
                  <button class="lf-btn lf-btn--sm lf-btn--ghost" [routerLink]="'/post/' + p.id + '/edit'">Edit</button>
                  <button class="lf-btn lf-btn--sm lf-btn--danger" (click)="removePostById(p.id, p.title)">Remove</button>
                </div>
              </div>
            </div>
          }
        }
      }
    </ion-content>
  `,
  styles: [`
    .tabs { display: flex; gap: 8px; padding: 12px var(--lf-gap); }
    .tab { position: relative; padding: 8px 16px; border-radius: 999px; border: 1px solid var(--lf-line);
      background: transparent; color: var(--lf-muted); font-weight: 700; font-size: 13px; cursor: pointer; }
    .tab.on { background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); border-color: transparent; }
    .tab .lf-badge { margin-left: 6px; }
    .acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  `]
})
export class AdminComponent implements OnInit {
  protected mod = inject(ModerationService);
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private alert = inject(AlertController);
  private toast = inject(ToastController);

  protected readonly timeAgo = timeAgo;

  tab = signal<'reports' | 'people' | 'review' | 'posts'>('reports');

  /** Opening the review tab re-reads the queue, so it is never stale. */
  show(tab: 'reports' | 'people' | 'review' | 'posts'): void {
    this.tab.set(tab);
    if (tab === 'review') void this.mod.loadPending();
  }
  query = signal('');
  users = signal<UserProfile[]>([]);

  async ngOnInit(): Promise<void> {
    if (!this.mod.isAdmin()) return;
    this.mod.load();
    await this.mod.loadPending();
    await this.refreshUsers();
    await this.data.refresh();
  }

  private async refreshUsers(): Promise<void> {
    try {
      this.users.set(await this.mod.allUsers());
    } catch {
      this.users.set([]);
    }
  }

  readonly people = computed(() => {
    const q = this.tab() === 'people' ? this.query().trim().toLowerCase() : '';
    const list = this.users();
    if (!q) return list;
    return list.filter((u) =>
      u.displayName.toLowerCase().includes(q) || u.handle.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  });

  readonly posts = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.data.feed();
    if (!q) return list.slice(0, 40);
    return list.filter((p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q));
  });

  /** "Thandi Mokoena, 34 · Soweto · by the family" - the one line an admin needs. */
  subjectLine(p: Post): string {
    const name = p.subject?.name?.trim() || 'Unnamed case';
    const age = p.subject?.age;
    const who = `${name}${typeof age === 'number' ? `, ${age}` : ''}`;
    return `${who} · ${p.town} · by ${this.nameOf(p.authorId)}`;
  }

  nameOf(id: string): string {
    if (id === this.auth.viewerId) return 'you';
    return this.data.authorOf(id)?.displayName ?? this.users().find((u) => u.id === id)?.displayName ?? 'Member';
  }

  /** Ask for a reason. Returns null if the admin cancelled. */
  private async note(header: string, message: string): Promise<string | null> {
    let confirmed = false;
    const a = await this.alert.create({
      header,
      message,
      inputs: [{ name: 'note', type: 'text', placeholder: 'Reason (the person will see this)' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          role: 'destructive',
          handler: (v: any) => {
            confirmed = true;
            this.pendingNote = String(v?.note ?? '').trim() || 'No reason given';
          }
        }
      ]
    });
    await a.present();
    await a.onDidDismiss();
    return confirmed ? this.pendingNote : null;
  }

  private pendingNote = '';

  private async say(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2200, position: 'bottom' });
    await t.present();
  }

  async removePost(r: UserReport): Promise<void> {
    const note = await this.note('Remove this post?', 'It disappears from the feed and the poster is told.');
    if (!note) return;
    await this.mod.removePost(r.targetId, note);
    await this.data.refresh();
    await this.say('Post removed');
  }

  async approve(id: string): Promise<void> {
    const reached = await this.mod.approveCase(id);
    await this.data.refresh();
    await this.say(reached ? `Live - ${reached} alert(s) sent` : 'Live - nobody in range to alert');
  }

  async reject(id: string, title: string): Promise<void> {
    const note = await this.note('Keep this case off the feed?', title);
    if (!note) return;
    await this.mod.rejectCase(id, note);
    await this.data.refresh();
    await this.say('Case not published');
  }

  async removePostById(id: string, title: string): Promise<void> {
    const note = await this.note('Remove this post?', title);
    if (!note) return;
    await this.mod.removePost(id, note);
    await this.data.refresh();
    await this.say('Post removed');
  }

  async suspend(r: UserReport): Promise<void> {
    const note = await this.note('Suspend this person?', 'They keep their account but cannot post, vote or chat.');
    if (!note) return;
    await this.mod.suspendUser(r.targetId, note, true);
    await this.refreshUsers();
    await this.say('Account suspended');
  }

  async removeUser(r: UserReport): Promise<void> {
    const note = await this.note('Delete this person?', 'Their profile and every post they made are removed.');
    if (!note) return;
    await this.mod.removeUser(r.targetId, note);
    await this.refreshUsers();
    await this.data.refresh();
    await this.say('Account deleted');
  }

  async suspendUser(u: UserProfile): Promise<void> {
    const note = await this.note(u.suspended ? 'Lift the suspension?' : 'Suspend this person?', u.displayName);
    if (!note) return;
    await this.mod.suspendUser(u.id, note, !u.suspended);
    await this.refreshUsers();
    await this.say(u.suspended ? 'Suspension lifted' : 'Account suspended');
  }

  async deleteUser(u: UserProfile): Promise<void> {
    const note = await this.note('Delete this person?', `${u.displayName} and all their posts will be removed.`);
    if (!note) return;
    await this.mod.removeUser(u.id, note);
    await this.refreshUsers();
    await this.data.refresh();
    await this.say('Account deleted');
  }

  async dismiss(r: UserReport): Promise<void> {
    const note = await this.note('Dismiss this report?', 'Nothing is removed and the report is closed.');
    if (!note) return;
    await this.mod.resolve(r.id, 'dismissed', note, null);
    await this.say('Report dismissed');
  }
}
