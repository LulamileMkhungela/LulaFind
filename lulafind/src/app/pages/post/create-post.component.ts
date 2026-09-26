import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IonTitle } from '@ionic/angular/ion-title';
import { ToastController } from '@ionic/angular/toast-controller';
import { AlertController } from '@ionic/angular/alert-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { LocationService } from '../../core/services/location.service';
import { MediaService } from '../../core/services/media.service';
import { DANGER_KINDS, DangerAlert, DangerKind, PROVINCES, PostType, ProvinceCode, MediaItem, POST_TYPE_META, Post } from '../../core/models/types';

const CATEGORIES: { key: PostType; label: string }[] = [
  { key: 'missing', label: 'Missing Person' },
  { key: 'khumbulekhaya', label: 'KhumbulEkhaya (Left Home)' },
  { key: 'vehicle', label: 'Stolen / Hijacked Vehicle' },
  { key: 'pet', label: 'Lost Pet' },
  { key: 'sighting', label: 'Sighting Lead' },
  { key: 'danger', label: 'Danger Alert' }
];

/**
 * Facebook-style Create Post Screen (Matching Screenshot 7).
 * Single Facebook post composer: Avatar, Public audience dropdown,
 * "What's on your mind?" textarea, option list (Photos, Category, Location, Subject details),
 * and solid Facebook Blue POST button.
 */
@Component({
  selector: 'lf-create-post',
  standalone: true,
  imports: [IonContent, IonHeader, IconComponent, AvatarComponent],
  template: `
    <ion-header class="fb-create-header" [translucent]="false">
      <div class="fb-create-topbar">
        <button class="fb-back-btn" (click)="close()" aria-label="Back">
          <lf-icon name="arrowLeft" [size]="22" />
        </button>
        <span class="fb-create-title">{{ editing() ? 'Edit post' : 'Create post' }}</span>
        <button class="fb-post-action-btn" [disabled]="busy()" (click)="submit()">
          POST
        </button>
      </div>
    </ion-header>

    <ion-content class="lf-page">
      <div class="fb-composer-container lf-fade-in">
        <!-- Author Row & Audience Picker -->
        <div class="fb-author-box">
          <lf-avatar [src]="userAvatar()" [name]="userName()" [size]="44" />
          <div class="fb-author-info">
            <span class="fb-author-name">{{ userName() }}</span>
            <div class="fb-audience-pill" (click)="cycleAudience()">
              <lf-icon [name]="audienceIcon()" [size]="12" />
              <span>{{ audienceLabel() }}</span>
              <lf-icon name="chevronDown" [size]="12" />
            </div>
          </div>
        </div>

        <!-- Textarea: "What's on your mind?" -->
        <textarea class="fb-post-textarea" rows="5"
                  [placeholder]="titlePlaceholder()"
                  [value]="f.body"
                  (input)="f.body = $any($event.target).value; onBodyChange()"></textarea>

        <!-- Media Preview Grid -->
        @if (f.media.length) {
          <div class="fb-media-preview">
            @for (m of f.media; track m.id) {
              <div class="fb-media-item">
                <img [src]="m.src" alt="" />
                <button class="fb-rm-media" (click)="removeMedia(m.id)"><lf-icon name="x" [size]="14" /></button>
              </div>
            }
          </div>
        }

        <!-- Facebook Option List -->
        <div class="fb-options-list">
          <!-- Category Selector -->
          <div class="fb-option-row">
            <div class="fb-option-left">
              <span class="fb-opt-icon cat">🏷️</span>
              <span class="fb-opt-label">Category</span>
            </div>
            <select class="fb-opt-select" [value]="type()" (change)="setType($any($event.target).value)">
              @for (c of categories; track c.key) {
                <option [value]="c.key">{{ c.label }}</option>
              }
            </select>
          </div>

          <!-- Add Photos/Videos -->
          <button class="fb-option-row" type="button" (click)="addPhoto()">
            <div class="fb-option-left">
              <span class="fb-opt-icon photo">🖼️</span>
              <span class="fb-opt-label">Photos / Videos</span>
            </div>
            @if (f.media.length) {
              <span class="fb-opt-count">{{ f.media.length }} photo(s)</span>
            }
          </button>

          <!-- Add Location (Province & Town) -->
          <div class="fb-option-row">
            <div class="fb-option-left">
              <span class="fb-opt-icon location">📍</span>
              <span class="fb-opt-label">Province & Town</span>
            </div>
            <div class="fb-opt-inputs">
              <select class="fb-opt-select sm" [value]="f.province ?? ''" (change)="f.province = $any($event.target).value">
                <option value="" disabled>Province</option>
                @for (p of provinces; track p.code) {
                  <option [value]="p.code">{{ p.name }}</option>
                }
              </select>
              <input class="fb-opt-text sm" placeholder="Town/Suburb" [value]="f.town" (input)="f.town = $any($event.target).value" />
            </div>
          </div>

          <!-- Specific Category Fields (Person / Vehicle / Pet details) -->
          <button class="fb-option-row" type="button" (click)="moreOpen.set(!moreOpen())">
            <div class="fb-option-left">
              <span class="fb-opt-icon details">➕</span>
              <span class="fb-opt-label">{{ detailsLabel() }}</span>
            </div>
            <lf-icon [name]="moreOpen() ? 'chevronDown' : 'chevronRight'" [size]="16" />
          </button>

          @if (moreOpen()) {
            <div class="fb-extra-fields lf-fade-in">
              @if (type() === 'vehicle') {
                <input class="fb-opt-text" placeholder="Vehicle Make & Model (e.g. Toyota Quantum)" [value]="s.vehicle" (input)="s.vehicle = $any($event.target).value" />
                <input class="fb-opt-text" placeholder="Registration Plate / Color" [value]="f.caseNumber" (input)="f.caseNumber = $any($event.target).value" />
              } @else if (type() === 'pet') {
                <input class="fb-opt-text" placeholder="Pet Name & Breed" [value]="s.name" (input)="s.name = $any($event.target).value" />
                <input class="fb-opt-text" placeholder="Distinguishing marks / Collar" [value]="s.distinguishing" (input)="s.distinguishing = $any($event.target).value" />
              } @else {
                <input class="fb-opt-text" placeholder="Person's Full Name" [value]="s.name" (input)="s.name = $any($event.target).value" />
                <input class="fb-opt-text" placeholder="Age" type="number" [value]="s.age" (input)="s.age = $any($event.target).value" />
                <input class="fb-opt-text" placeholder="Clothing / Distinguishing marks" [value]="s.clothing" (input)="s.clothing = $any($event.target).value" />
                <input class="fb-opt-text" placeholder="SAPS Case Number (optional)" [value]="f.caseNumber" (input)="f.caseNumber = $any($event.target).value" />
              }
            </div>
          }
        </div>

        @if (error()) { <p class="fb-err"><lf-icon name="alert" [size]="15" /> {{ error() }}</p> }

        <!-- Facebook Solid Blue Submit Button -->
        <button class="fb-submit-btn" [disabled]="busy()" (click)="submit()">
          {{ busy() ? 'Posting…' : 'POST' }}
        </button>
      </div>
    </ion-content>
  `,
  styles: [`
    .fb-create-header {
      background: #ffffff;
      border-bottom: 1px solid #ced0d4;
    }
    .fb-create-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      height: 48px;
    }
    .fb-back-btn { background: none; border: 0; color: #050505; cursor: pointer; padding: 4px; }
    .fb-create-title { font-size: 17px; font-weight: 700; color: #050505; }
    .fb-post-action-btn {
      background: none; border: 0; color: #1877f2; font-weight: 800; font-size: 15px; cursor: pointer;
    }
    .fb-post-action-btn[disabled] { opacity: 0.4; }

    .fb-composer-container {
      padding: 16px;
      max-width: 520px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .fb-author-box {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .fb-author-info { display: flex; flex-direction: column; gap: 2px; }
    .fb-author-name { font-size: 16px; font-weight: 700; color: #050505; }
    .fb-audience-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 6px;
      background: #e4e6eb;
      color: #050505;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      width: fit-content;
    }

    .fb-post-textarea {
      width: 100%;
      border: 1px solid #ced0d4;
      border-radius: 8px;
      padding: 12px;
      font-size: 16px;
      color: #050505;
      background: #ffffff;
      outline: none;
      resize: none;
      font-family: inherit;
    }
    .fb-post-textarea:focus { border-color: #1877f2; }

    .fb-media-preview { display: flex; gap: 8px; flex-wrap: wrap; }
    .fb-media-item { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; }
    .fb-media-item img { width: 100%; height: 100%; object-fit: cover; }
    .fb-rm-media { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 50%; background: rgba(0,0,0,0.6); color: #fff; border: 0; cursor: pointer; display: flex; align-items: center; justify-content: center; }

    /* Facebook Option List */
    .fb-options-list {
      display: flex;
      flex-direction: column;
      border: 1px solid #ced0d4;
      border-radius: 8px;
      background: #ffffff;
      overflow: hidden;
    }
    .fb-option-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid #f0f2f5;
      background: #ffffff;
      border: 0;
      width: 100%;
      text-align: left;
      cursor: pointer;
    }
    .fb-option-left { display: flex; align-items: center; gap: 10px; }
    .fb-opt-icon { font-size: 18px; }
    .fb-opt-label { font-size: 14px; font-weight: 600; color: #050505; }
    .fb-opt-select {
      border: 1px solid #ced0d4; border-radius: 6px; padding: 6px 10px; font-size: 13.5px; background: #ffffff; outline: none;
    }
    .fb-opt-select.sm { width: 110px; }
    .fb-opt-inputs { display: flex; gap: 6px; }
    .fb-opt-text { width: 100%; height: 38px; border-radius: 6px; border: 1px solid #ced0d4; padding: 0 10px; font-size: 13.5px; outline: none; margin-bottom: 8px; }
    .fb-opt-text.sm { width: 110px; height: 32px; }
    .fb-opt-count { font-size: 12px; color: #1877f2; font-weight: 600; }

    .fb-extra-fields { padding: 12px; background: #f0f2f5; border-top: 1px solid #ced0d4; }

    .fb-submit-btn {
      height: 42px;
      border-radius: 8px;
      background: #1877f2;
      color: #ffffff;
      font-size: 15px;
      font-weight: 700;
      border: 0;
      cursor: pointer;
      width: 100%;
    }
    .fb-submit-btn:disabled { opacity: 0.5; }

    .fb-err { color: #e41e3f; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; margin: 0; }
  `]
})
export class CreatePostComponent implements OnInit {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private location = inject(LocationService);
  private media = inject(MediaService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private alert = inject(AlertController);

  protected readonly provinces = PROVINCES;
  protected readonly categories = CATEGORIES;
  protected readonly moreOpen = signal(false);

  type = signal<PostType>('missing');
  editing = signal(false);
  busy = signal(false);
  error = signal('');
  postId: string | null = null;

  f = {
    title: '', body: '', media: [] as MediaItem[], province: 'GP' as ProvinceCode | null, town: '',
    lastSeenAt: Date.now(), lastSeenWhere: '',
    caseNumber: '', reward: '', audience: 'public' as any, spotlightId: null as string | null
  };

  s = { name: '', age: '', vehicle: '', clothing: '', distinguishing: '' };

  readonly userAvatar = computed(() => this.data.avatarFor(this.auth.user()));
  readonly userName = computed(() => this.auth.user()?.displayName ?? 'You');
  readonly mySpotlights = computed(() => this.data.mySpotlights());

  async ngOnInit(): Promise<void> {
    await this.data.loadStatic();
    const editId = this.route.snapshot.paramMap.get('id');
    if (editId) {
      const p = await this.data.loadPost(editId);
      if (p) {
        this.postId = p.id;
        this.editing.set(true);
        this.type.set(p.type);
        this.f.title = p.title;
        this.f.body = p.body;
        this.f.media = [...p.media];
        this.f.province = p.province;
        this.f.town = p.town;
        if (p.subject) this.s = { ...this.s, name: p.subject.name, age: String(p.subject.age ?? '') };
      }
    }
  }

  setType(t: PostType): void {
    this.type.set(t);
  }

  cycleAudience(): void {
    this.f.audience = this.f.audience === 'public' ? 'followers' : 'public';
  }

  audienceLabel(): string {
    return this.f.audience === 'public' ? 'Public' : 'Followers only';
  }

  audienceIcon(): string {
    return this.f.audience === 'public' ? 'globe' : 'users';
  }

  titlePlaceholder(): string {
    switch (this.type()) {
      case 'vehicle': return "What's on your mind? Stolen vehicle details...";
      case 'pet': return "What's on your mind? Lost pet details...";
      default: return "What's on your mind? Report a case...";
    }
  }

  detailsLabel(): string {
    switch (this.type()) {
      case 'vehicle': return 'Add Vehicle Details';
      case 'pet': return 'Add Pet Details';
      default: return 'Add Subject Details';
    }
  }

  onBodyChange(): void {
    if (!this.f.title) {
      this.f.title = this.f.body.slice(0, 50) || 'LulaFind Case';
    }
  }

  async addPhoto(): Promise<void> {
    const item = await this.media.pickImage({ quality: 75 });
    if (item) this.f.media = [...this.f.media, item];
  }

  removeMedia(id: string): void {
    this.f.media = this.f.media.filter((m) => m.id !== id);
  }

  async submit(): Promise<void> {
    this.error.set('');
    if (!this.f.body.trim()) {
      this.error.set("Please write what's on your mind.");
      return;
    }
    this.busy.set(true);
    try {
      const subject = {
        name: this.s.name.trim() || (this.type() === 'vehicle' ? 'Stolen Vehicle' : 'Missing Person'),
        age: this.s.age ? Number(this.s.age) : null,
        gender: 'unknown' as const,
        height: '', build: '', skinTone: '', hair: '', eyes: '',
        clothing: this.s.clothing.trim(),
        distinguishing: this.s.distinguishing.trim(),
        medical: '', vehicle: this.s.vehicle.trim(), languages: '', surname: '', relationship: ''
      };

      if (this.editing() && this.postId) {
        await this.data.updatePost(this.postId, {
          title: this.f.title || this.f.body.slice(0, 50),
          body: this.f.body,
          media: this.f.media,
          province: this.f.province ?? 'GP',
          town: this.f.town || 'Johannesburg',
          subject
        });
      } else {
        await this.data.createPost({
          type: this.type(),
          title: this.f.title || this.f.body.slice(0, 50),
          body: this.f.body,
          media: this.f.media,
          province: this.f.province ?? 'GP',
          town: this.f.town || 'Johannesburg',
          lastSeenAt: Date.now(),
          lastSeenWhere: this.f.town || 'Gauteng',
          geo: null,
          contactLabel: 'Call',
          contactValue: '',
          contactVisibleTo: 'everyone',
          caseNumber: this.f.caseNumber || null,
          reward: null,
          subject,
          audience: this.f.audience,
          spotlightId: null,
          chatEnabled: true,
          allowComments: true,
          anonymous: false,
          askWanted: false,
          khumbu: null,
          danger: null
        });
      }
      await this.router.navigate(['/home']);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not create post');
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    void this.router.navigate(['/home']);
  }
}
