import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IonBackButton } from '@ionic/angular/ion-back-button';
import { IonTitle } from '@ionic/angular/ion-title';
import { IconComponent } from '../../shared/components/icon.component';
import { PosterVisualComponent } from '../../shared/components/poster-visual.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { PlatformService } from '../../core/services/platform.service';
import { Post } from '../../core/models/types';
import { publicPoster } from '../../core/utils/poster';
import { SAPS_MISSING_LIST } from '../../core/data/sa-help';

@Component({
  selector: 'lf-poster',
  standalone: true,
  imports: [IonContent, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IconComponent, PosterVisualComponent],
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button [defaultHref]="'/post/' + id" text=""></ion-back-button></ion-buttons>
        <ion-title>Poster</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="lf-page">
      @if (p(); as post) {
        <div class="lf-pad">
          <lf-poster-visual [post]="post" />
        </div>
        @if (isMine() && flyer().withheld) {
          <p class="note">Not on this poster: {{ flyer().withheld }}. Ask a caller to name that mark before you trust them.</p>
        }
        <div class="lf-pad actions">
          <button class="lf-btn lf-btn--primary lf-btn--block" type="button" (click)="share()">
            <lf-icon name="share" [size]="16" /> Share this poster
          </button>
          <a class="lf-btn lf-btn--block" [href]="sapsList" target="_blank" rel="noopener">Official SAPS missing list</a>
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .note { margin: 0 var(--lf-gap) 8px; font-size: 13px; color: var(--lf-muted); }
    .actions { display: flex; flex-direction: column; gap: 8px; }
    a.lf-btn { text-decoration: none; }
  `]
})
export class PosterComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private data = inject(DataService);
  private auth = inject(AuthService);
  private platform = inject(PlatformService);

  protected readonly sapsList = SAPS_MISSING_LIST;
  id = '';
  p = signal<Post | null>(null);

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    const cached = this.data.post(this.id);
    if (cached) this.p.set(cached);
    void this.data.loadPost(this.id).then((fresh) => { if (fresh) this.p.set(fresh); });
  }

  flyer() {
    return publicPoster(this.p()!);
  }

  isMine(): boolean {
    return this.p()?.authorId === this.auth.viewerId;
  }

  async share(): Promise<void> {
    const post = this.p();
    if (!post) return;
    await this.platform.share(post.title, publicPoster(post).shareText, this.platform.link(`/post/${post.id}/poster`));
  }
}
