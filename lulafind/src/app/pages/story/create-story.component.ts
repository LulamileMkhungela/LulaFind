import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonTextarea } from '@ionic/angular/ion-textarea';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { DataService } from '../../core/services/data.service';
import { MediaService } from '../../core/services/media.service';
import { Audience, MediaItem } from '../../core/models/types';
import { storyBg } from '../../core/data/seed';

const AUDIENCES: { key: Audience; icon: string; label: string }[] = [
  { key: 'public', icon: 'globe', label: 'Everyone' },
  { key: 'surname', icon: 'award', label: 'My Spotlight' },
  { key: 'followers', icon: 'users', label: 'My followers' }
];

/** A 24-hour story. You choose who can see it. */
@Component({
  selector: 'lf-create-story',
  standalone: true,
  imports: [IonContent, IonTextarea, IconComponent],
  template: `
    <ion-content class="lf-page">
      <div class="preview" [style.background]="bg()">
        <button class="lf-icon-btn close" (click)="cancel()" aria-label="Close"><lf-icon name="x" [size]="22" /></button>
        @if (media().length) { <img [src]="media()[0].src" class="shot" alt="" /> }
        <ion-textarea class="txt" rows="4" placeholder="Say something to your community…"
                      [value]="text" (ionInput)="text = $any($event.target).value"></ion-textarea>
        <p class="lf-tiny exp">Disappears in 24 hours</p>
      </div>

      <div class="who">
        <p class="lf-small lf-muted">Who can see this story?</p>
        <div class="opts">
          @for (a of audiences; track a.key) {
            <button class="opt" [class.on]="audience() === a.key" (click)="pick(a.key)">
              <lf-icon [name]="a.icon" [size]="15" /> {{ a.label }}
            </button>
          }
        </div>
        @if (audience() === 'surname') {
          @if (mySpotlights().length) {
            <div class="opts">
              @for (sp of mySpotlights(); track sp.id) {
                <button class="opt" [class.on]="spotlightId() === sp.id" (click)="spotlightId.set(sp.id)">
                  <lf-icon name="users" [size]="15" /> {{ sp.surname }}
                </button>
              }
            </div>
          } @else {
            <p class="warn">You have not joined a Spotlight yet, so this story will go to everyone.</p>
          }
        }
      </div>

      <div class="tools">
        <button class="t" (click)="addPhoto()"><lf-icon name="camera" [size]="20" /><span>Photo</span></button>
        <button class="t" (click)="cycleBg()"><lf-icon name="sparkle" [size]="20" /><span>Colour</span></button>
        <button class="t publish" (click)="publish()" [disabled]="busy()">
          <lf-icon name="send" [size]="18" /><span>{{ busy() ? 'Posting…' : 'Post story' }}</span>
        </button>
      </div>
    </ion-content>
  `,
  styles: [`
    .preview { position: relative; min-height: 58vh; display: flex; flex-direction: column; justify-content: flex-end;
      padding: 16px; background-size: cover; }
    .close { position: absolute; top: 12px; left: 8px; color: #fff; }
    .shot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .txt { position: relative; z-index: 2; --color: #fff; --placeholder-color: rgba(255,255,255,.7);
      font-size: 20px; font-weight: 700; }
    .exp { color: rgba(255,255,255,.8); text-align: center; position: relative; z-index: 2; }
    .who { padding: 14px var(--lf-gap) 0; display: flex; flex-direction: column; gap: 8px; }
    .who p { margin: 0; }
    .opts { display: flex; gap: 8px; flex-wrap: wrap; }
    .opt { display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border-radius: 999px;
      border: 1px solid var(--lf-line); background: var(--lf-card); color: var(--lf-muted);
      font-size: 12.5px; font-weight: 700; cursor: pointer; }
    .opt.on { background: var(--lf-beacon); color: #1a1200; border-color: var(--lf-beacon); }
    .warn { color: var(--lf-marigold); font-size: 12.5px; }
    .tools { display: flex; align-items: center; gap: 10px; padding: 16px; }
    .t { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 12px;
      border-radius: 14px; border: 1px solid var(--lf-line); background: var(--lf-card); color: inherit;
      font-size: 12px; font-weight: 700; cursor: pointer; }
    .t.publish { background: var(--lf-beacon); color: #1a1200; border-color: var(--lf-beacon); }
    .t[disabled] { opacity: .5; }
  `]
})
export class CreateStoryComponent {
  private data = inject(DataService);
  private mediaSvc = inject(MediaService);
  private router = inject(Router);
  private toast = inject(ToastController);

  text = '';
  hue = 28;
  busy = signal(false);
  readonly media = signal<MediaItem[]>([]);
  readonly audience = signal<Audience>('public');
  readonly spotlightId = signal<string | null>(null);

  protected readonly audiences = AUDIENCES;
  readonly mySpotlights = computed(() => this.data.mySpotlights());

  bg(): string {
    return storyBg(this.hue);
  }

  pick(a: Audience): void {
    this.audience.set(a);
    if (a === 'surname' && !this.spotlightId()) {
      this.spotlightId.set(this.mySpotlights()[0]?.id ?? null);
    }
  }

  cycleBg(): void {
    this.hue = (this.hue + 47) % 360;
  }

  async addPhoto(): Promise<void> {
    const item = await this.mediaSvc.pickImage({ quality: 72 });
    if (item) this.media.set([item]);
  }

  async publish(): Promise<void> {
    if (!this.text.trim() && !this.media().length) {
      const t = await this.toast.create({ message: 'Add a photo or some words', duration: 2000, position: 'bottom' });
      await t.present();
      return;
    }
    this.busy.set(true);
    try {
      const audience = this.audience() === 'surname' && !this.spotlightId() ? 'public' : this.audience();
      const s = await this.data.createStory({
        text: this.text,
        media: this.media(),
        bgHue: this.hue,
        audience,
        spotlightId: this.spotlightId()
      });
      await this.router.navigate(['/story', s.id]);
    } catch (e: any) {
      const t = await this.toast.create({ message: e?.message ?? 'Could not post the story', duration: 2600, position: 'bottom' });
      await t.present();
    } finally {
      this.busy.set(false);
    }
  }

  cancel(): void {
    void this.router.navigate(['/home']);
  }
}
