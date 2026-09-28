import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { MediaService } from '../../core/services/media.service';
import {
  Audience, DANGER_KINDS, DangerKind, MediaItem, Post, PostType, PROVINCES,
  ProvinceCode, VehicleDetails
} from '../../core/models/types';

const CATEGORIES: { key: PostType; label: string; icon: string }[] = [
  { key: 'missing', label: 'Missing person', icon: 'search' },
  { key: 'khumbulekhaya', label: 'Left home', icon: 'home' },
  { key: 'vehicle', label: 'Stolen vehicle', icon: 'car' },
  { key: 'pet', label: 'Lost pet', icon: 'paw' },
  { key: 'sighting', label: 'Sighting', icon: 'pin' },
  { key: 'danger', label: 'Danger nearby', icon: 'alert' }
];

const blankSubject = () => ({
  name: '', age: '', gender: 'unknown' as 'female' | 'male' | 'other' | 'unknown',
  height: '', clothing: '', distinguishing: '', hair: '', vehicle: ''
});

const blankVehicle = (): VehicleDetails => ({ makeModel: '', registration: '', colour: '', bodyType: '' });

interface ComposerForm {
  title: string; body: string; media: MediaItem[]; province: ProvinceCode | null; town: string;
  lastSeenAt: string; lastSeenWhere: string; caseNumber: string; audience: Audience;
  spotlightId: string | null; chatEnabled: boolean; allowComments: boolean; anonymous: boolean;
  askWanted: boolean; contactLabel: string; contactValue: string;
  contactVisibleTo: 'everyone' | 'verified' | 'owner';
}

/** One unfilled required field, used for both the checklist and the inline error. */
interface MissingField { key: string; label: string; }

@Component({
  selector: 'lf-create-post',
  standalone: true,
  imports: [IonContent, IonHeader, IonToolbar, IonTitle, IonButtons, IconComponent, AvatarComponent],
  template: `
    <ion-header class="fb-create-header" [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="icon-button" type="button" (click)="close()" aria-label="Close composer">
            <lf-icon name="x" [size]="20" />
          </button>
        </ion-buttons>
        <ion-title>{{ editing() ? 'Edit post' : 'Create post' }}</ion-title>
        <ion-buttons slot="end">
          <button class="post-button" type="button" [disabled]="busy()" [class.ready]="canPost()" (click)="submit()">
            {{ busy() ? 'Posting…' : 'Post' }}
          </button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="lf-page">
      <main class="composer lf-fade-in">
        <div class="author-row">
          <lf-avatar [src]="userAvatar()" [name]="userName()" [size]="40" />
          <div class="author-meta">
            <strong>{{ userName() }}</strong>
            <label class="audience-picker" aria-label="Who can see this post">
              <lf-icon [name]="audienceIcon()" [size]="13" />
              <select [value]="f().audience" (change)="setAudience($any($event.target).value)">
                <option value="public">Public</option>
                <option value="followers">Followers</option>
                <option value="surname">Spotlight</option>
              </select>
              <lf-icon name="chevronDown" [size]="12" />
            </label>
          </div>
        </div>

        @if (f().audience === 'surname') {
          @if (mySpotlights().length) {
            <label class="spotlight-picker">
              <span>Share with</span>
              <select [value]="f().spotlightId ?? ''" (change)="patch({ spotlightId: $any($event.target).value || null })">
                <option value="">Choose a Spotlight</option>
                @for (sp of mySpotlights(); track sp.id) { <option [value]="sp.id">{{ sp.surname }}</option> }
              </select>
            </label>
          } @else {
            <p class="inline-note">Join a Spotlight first to share with one surname community.</p>
          }
        }

        <section class="category-block" aria-labelledby="category-title">
          <div class="section-heading">
            <strong id="category-title">What are you posting?</strong>
            <span>Choose one</span>
          </div>
          <div class="category-grid">
            @for (category of categories; track category.key) {
              <button type="button" class="category" [class.selected]="type() === category.key"
                      [disabled]="editing()" (click)="setType(category.key)">
                <lf-icon [name]="category.icon" [size]="17" />
                <span>{{ category.label }}</span>
                @if (type() === category.key) { <lf-icon class="selected-check" name="check" [size]="14" /> }
              </button>
            }
          </div>
          @if (editing()) { <p class="inline-note">A post's category cannot be changed after it is shared.</p> }
        </section>

        @if (showFieldErrors() && missing().length) {
          <div class="missing" role="alert">
            <strong><lf-icon name="alert" [size]="15" /> Before you post</strong>
            <ul>
              @for (item of missing(); track item.key) { <li>{{ item.label }}</li> }
            </ul>
          </div>
        }

        @if (!type()) {
          <div class="start-hint">
            <span class="hint-icon"><lf-icon name="edit" [size]="18" /></span>
            <p>Choose a category to start your post.</p>
          </div>
        } @else {
          <section class="post-fields" aria-label="Post content">
            <input class="heading-input" type="text" maxlength="120" placeholder="Add a short heading (optional)"
                   [value]="f().title" (input)="patch({ title: $any($event.target).value })" />
            <textarea class="body-input" rows="5" maxlength="5000" data-field="body" [placeholder]="bodyPlaceholder()"
                      [value]="f().body" (input)="patch({ body: $any($event.target).value })"></textarea>
            @if (fieldError('body')) { <p class="field-error">{{ fieldError('body') }}</p> }

            <div class="location-grid">
              <label class="field" [class.invalid]="fieldError('province')">
                <span>Province <b aria-hidden="true">*</b></span>
                <select [value]="f().province ?? ''" (change)="patch({ province: $any($event.target).value || null })">
                  <option value="">Choose province</option>
                  @for (province of provinces; track province.code) {
                    <option [value]="province.code">{{ province.name }}</option>
                  }
                </select>
                @if (fieldError('province')) { <small class="field-error">{{ fieldError('province') }}</small> }
              </label>
              <label class="field" [class.invalid]="fieldError('town')">
                <span>Town or suburb <b aria-hidden="true">*</b></span>
                <input type="text" maxlength="80" placeholder="e.g. Soweto" [value]="f().town"
                       (input)="patch({ town: $any($event.target).value })" />
                @if (fieldError('town')) { <small class="field-error">{{ fieldError('town') }}</small> }
              </label>
            </div>

            @if (f().media.length) {
              <div class="media-preview" aria-label="Attached media">
                @for (item of f().media; track item.id) {
                  <div class="media-tile">
                    @if (item.kind === 'video') {
                      <video [src]="item.src" controls preload="metadata"></video>
                    } @else {
                      <img [src]="item.src" alt="Post attachment" />
                    }
                    <button type="button" class="remove-media" (click)="removeMedia(item.id)" aria-label="Remove attachment">
                      <lf-icon name="x" [size]="14" />
                    </button>
                  </div>
                }
              </div>
            }

            <div class="attachment-actions">
              <button type="button" class="attachment-button" (click)="addPhoto()"
                      [disabled]="busy() || hasVideo() || f().media.length >= 4">
                <lf-icon name="image" [size]="18" /> <span>Photo</span>
              </button>
              <button type="button" class="attachment-button" (click)="addVideo()"
                      [disabled]="busy() || hasVideo() || f().media.length > 0">
                <lf-icon name="video" [size]="18" /> <span>Video</span>
              </button>
              <span class="attachment-hint">Up to 4 photos or 1 video</span>
            </div>

            <button type="button" class="details-toggle" [attr.aria-expanded]="moreOpen()" (click)="moreOpen.set(!moreOpen())">
              <span class="details-icon"><lf-icon name="plus" [size]="17" /></span>
              <span class="details-copy"><strong>{{ detailsLabel() }}</strong><small>Optional details help people respond accurately</small></span>
              <lf-icon [name]="moreOpen() ? 'chevronDown' : 'chevronRight'" [size]="17" />
            </button>

            @if (moreOpen()) {
              <section class="extra-fields lf-fade-in" aria-label="Additional post details">
                @if (type() === 'missing' || type() === 'khumbulekhaya') {
                  <div class="section-heading compact"><strong>{{ type() === 'missing' ? 'Person details' : 'About the person' }}</strong><span>Optional</span></div>
                  <label class="field full"><span>Full name</span><input placeholder="Name used by family" [value]="s().name" (input)="patchSubject({ name: $any($event.target).value })" /></label>
                  <div class="fields-two">
                    <label class="field"><span>Age</span><input type="number" min="0" max="120" inputmode="numeric" placeholder="Age" [value]="s().age" (input)="patchSubject({ age: $any($event.target).value })" /></label>
                    <label class="field"><span>Gender</span><select [value]="s().gender" (change)="patchSubject({ gender: $any($event.target).value })">
                      <option value="unknown">Not specified</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
                    </select></label>
                  </div>
                  <label class="field full"><span>Clothing or identifying details</span><textarea rows="2" placeholder="What were they wearing? Any details that could help identify them?" [value]="s().clothing" (input)="patchSubject({ clothing: $any($event.target).value })"></textarea></label>
                  @if (type() === 'missing') {
                    <label class="field full"><span>Private identifying detail <small>(kept off the public poster)</small></span><input placeholder="A mark only the family knows" [value]="s().distinguishing" (input)="patchSubject({ distinguishing: $any($event.target).value })" /></label>
                  }
                }

                @if (type() === 'vehicle') {
                  <div class="section-heading compact"><strong>Vehicle details</strong><span>Optional</span></div>
                  <label class="field full"><span>Make and model</span><input placeholder="e.g. Toyota Hilux" [value]="v().makeModel" (input)="patchVehicle({ makeModel: $any($event.target).value })" /></label>
                  <div class="fields-two">
                    <label class="field"><span>Registration</span><input placeholder="Plate number" [value]="v().registration" (input)="patchVehicle({ registration: $any($event.target).value })" /></label>
                    <label class="field"><span>Colour</span><input placeholder="e.g. White" [value]="v().colour" (input)="patchVehicle({ colour: $any($event.target).value })" /></label>
                  </div>
                  <label class="field full"><span>SAPS case number <small>(optional)</small></span><input placeholder="Police case reference" [value]="f().caseNumber" (input)="patch({ caseNumber: $any($event.target).value })" /></label>
                }

                @if (type() === 'pet') {
                  <div class="section-heading compact"><strong>Pet details</strong><span>Optional</span></div>
                  <label class="field full"><span>Pet's name</span><input placeholder="Name and breed" [value]="s().name" (input)="patchSubject({ name: $any($event.target).value })" /></label>
                  <label class="field full"><span>Colour, collar or identifying marks</span><input placeholder="A short description" [value]="s().distinguishing" (input)="patchSubject({ distinguishing: $any($event.target).value })" /></label>
                }

                @if (type() === 'sighting') {
                  <div class="section-heading compact"><strong>Sighting details</strong><span>Optional</span></div>
                  <label class="field full"><span>Where did you see them?</span><input placeholder="Nearest landmark or public place" [value]="f().lastSeenWhere" (input)="patch({ lastSeenWhere: $any($event.target).value })" /></label>
                  <label class="field full"><span>Appearance or vehicle</span><input placeholder="Describe only what you actually saw" [value]="s().clothing" (input)="patchSubject({ clothing: $any($event.target).value })" /></label>
                }

                @if (type() === 'danger') {
                  <div class="section-heading compact"><strong>Safety alert</strong><span>Keep it factual</span></div>
                  <label class="field full" [class.invalid]="fieldError('dangerKind')"><span>What is happening?</span><select [value]="dangerKind() ?? ''" (change)="dangerKind.set($any($event.target).value || null)">
                    <option value="">Choose alert type</option>
                    @for (kind of dangerKinds; track kind.key) { <option [value]="kind.key">{{ kind.label }}</option> }
                  </select>
                  @if (fieldError('dangerKind')) { <small class="field-error">{{ fieldError('dangerKind') }}</small> }
                  </label>
                  <label class="field full"><span>Where did you see this?</span><input placeholder="Public place or landmark" [value]="f().lastSeenWhere" (input)="patch({ lastSeenWhere: $any($event.target).value })" /></label>
                }

                @if (type() !== 'danger' && type() !== 'sighting' && type() !== 'vehicle') {
                  <label class="field full"><span>Last seen near</span><input placeholder="Neighbourhood or public place" [value]="f().lastSeenWhere" (input)="patch({ lastSeenWhere: $any($event.target).value })" /></label>
                }
                @if (type() !== 'vehicle' && type() !== 'pet' && type() !== 'danger' && type() !== 'sighting') {
                  <label class="field full"><span>SAPS case number <small>(optional)</small></span><input placeholder="Police case reference" [value]="f().caseNumber" (input)="patch({ caseNumber: $any($event.target).value })" /></label>
                }
                @if (type() === 'vehicle' || type() === 'pet') {
                  <label class="field full"><span>Last seen near</span><input placeholder="Neighbourhood or public place" [value]="f().lastSeenWhere" (input)="patch({ lastSeenWhere: $any($event.target).value })" /></label>
                }
                @if (type() === 'khumbulekhaya') {
                  <label class="field full"><span>What might the family want them to know?</span><input placeholder="Optional — don't assume they want to come home" [value]="khumbuReason()" (input)="khumbuReason.set($any($event.target).value)" /></label>
                  <label class="switch-row"><input type="checkbox" [checked]="f().askWanted" (change)="patch({ askWanted: $any($event.target).checked })" /><span><strong>Ask the community if they are being looked for</strong><small>People can answer yes or no.</small></span></label>
                }

                <label class="field full"><span>Last seen date and time <small>(optional)</small></span><input type="datetime-local" [value]="f().lastSeenAt" (input)="patch({ lastSeenAt: $any($event.target).value })" /></label>
                <label class="field full"><span>Contact label</span><input placeholder="Family contact" [value]="f().contactLabel" (input)="patch({ contactLabel: $any($event.target).value })" /></label>
                <label class="field full"><span>Contact details <small>(optional)</small></span><input placeholder="Phone or email" [value]="f().contactValue" (input)="patch({ contactValue: $any($event.target).value })" /></label>
                <label class="field full"><span>Contact visibility</span><select [value]="f().contactVisibleTo" (change)="patch({ contactVisibleTo: $any($event.target).value })">
                  <option value="everyone">Everyone</option><option value="verified">Verified members</option><option value="owner">Only me</option>
                </select></label>

                <div class="privacy-switches">
                  <label class="switch-row"><input type="checkbox" [checked]="f().anonymous" (change)="patch({ anonymous: $any($event.target).checked })" /><span><strong>Post anonymously</strong><small>Your profile stays private on this post.</small></span></label>
                  <label class="switch-row"><input type="checkbox" [checked]="f().allowComments" (change)="patch({ allowComments: $any($event.target).checked })" /><span><strong>Allow comments</strong><small>People can share leads in the thread.</small></span></label>
                  <label class="switch-row"><input type="checkbox" [checked]="f().chatEnabled" (change)="patch({ chatEnabled: $any($event.target).checked })" /><span><strong>Allow private chat</strong><small>Chat still needs an idea vote and mutual follow.</small></span></label>
                </div>
              </section>
            }
          </section>
        }

        @if (error()) { <p class="error-message" role="alert"><lf-icon name="alert" [size]="15" /> {{ error() }}</p> }
        <p class="footnote">Share only information you are allowed to post. In an emergency, call 10111.</p>
      </main>
    </ion-content>
  `,
  styles: [`
    :host { --fb-blue: var(--lf-primary); --fb-text: var(--ion-text-color); --fb-muted: var(--lf-muted); --fb-line: var(--lf-line); --fb-soft: var(--lf-input); }
    .fb-create-header { background: var(--lf-card); border-bottom: 1px solid var(--fb-line); }
    .fb-create-topbar { min-height: 50px; display: grid; grid-template-columns: 40px 1fr 56px; align-items: center; gap: 8px; padding: 0 12px; }
    .fb-create-topbar h1 { margin: 0; text-align: center; font-size: 16px; font-weight: 700; color: var(--fb-text); }
    .icon-button { width: 36px; height: 36px; border: 0; border-radius: 50%; display: grid; place-items: center; background: var(--fb-soft); color: var(--fb-text); cursor: pointer; transition: background .16s ease, transform .16s ease; }
    .icon-button:active { transform: scale(.94); }
    .post-button { justify-self: end; min-width: 54px; height: 32px; padding: 0 12px; border: 0; border-radius: 6px; background: var(--fb-blue); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; transition: filter .15s ease, transform .15s ease; }
    .post-button:disabled { opacity: .45; cursor: default; }
    .post-button.ready { box-shadow: 0 0 0 2px color-mix(in srgb, var(--lf-primary) 22%, transparent); }
    .post-button:active:not(:disabled) { transform: scale(.96); }
    .composer { width: min(100%, 600px); margin: 0 auto; padding: 14px 14px calc(26px + var(--lf-safe-bottom)); color: var(--fb-text); }
    .author-row { display: flex; align-items: center; gap: 10px; padding: 0 0 12px; }
    .author-meta { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
    .author-meta > strong { font-size: 14px; }
    .audience-picker { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: 5px; background: var(--fb-soft); color: var(--fb-text); font-size: 13px; font-weight: 600; }
    .audience-picker select, .spotlight-picker select { border: 0; outline: 0; background: transparent; color: inherit; font: inherit; appearance: none; cursor: pointer; }
    .spotlight-picker { display: flex; gap: 8px; align-items: center; min-height: 36px; padding: 0 10px; margin: 0 0 12px 50px; border: 1px solid var(--fb-line); border-radius: 7px; color: var(--fb-muted); font-size: 14px; }
    .spotlight-picker select { flex: 1; color: var(--fb-text); }
    .inline-note { margin: 0 0 12px 50px; color: var(--fb-muted); font-size: 14px; line-height: 1.4; }
    .category-block { padding: 12px 0 10px; border-top: 1px solid var(--lf-line-soft); border-bottom: 1px solid var(--lf-line-soft); }
    .section-heading { display: flex; align-items: center; justify-content: space-between; margin: 0 0 9px; color: var(--fb-text); font-size: 15px; }
    .section-heading span { color: var(--fb-muted); font-size: 13px; font-weight: 500; }
    .category-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
    .category { position: relative; display: flex; align-items: center; gap: 9px; min-height: 40px; padding: 7px 10px; border: 1px solid var(--fb-line); border-radius: 8px; background: var(--lf-card); color: var(--fb-text); text-align: left; font-size: 14px; font-weight: 600; cursor: pointer; transition: background .16s ease, border-color .16s ease, transform .16s ease; }
    .category lf-icon { color: var(--fb-blue); }
    .category.selected { border-color: var(--lf-primary); background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
    .category:active { transform: scale(.98); }
    .category:disabled { cursor: default; opacity: .85; }
    .selected-check { margin-left: auto; color: var(--fb-blue) !important; }
    .start-hint { display: flex; align-items: center; gap: 10px; margin: 14px 0 4px; padding: 12px; border-radius: 8px; background: var(--lf-card); border: 1px solid var(--fb-line); color: var(--fb-muted); }
    .start-hint p { margin: 0; font-size: 15px; }
    .hint-icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
    .post-fields { display: flex; flex-direction: column; gap: 11px; padding-top: 13px; }
    .heading-input, .body-input { width: 100%; box-sizing: border-box; border: 0; background: transparent; color: var(--fb-text); font: inherit; outline: 0; resize: vertical; }
    .heading-input { min-height: 36px; font-size: 16px; font-weight: 600; }
    .heading-input::placeholder { color: var(--lf-muted); font-weight: 500; }
    .body-input { min-height: 112px; padding: 8px 0; font-size: 15px; line-height: 1.5; }
    .body-input::placeholder { color: var(--lf-muted); }
    .location-grid, .fields-two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field.full { width: 100%; }
    .field > span { color: var(--fb-muted); font-size: 13px; font-weight: 600; }
    .field b { color: var(--lf-signal); }
    .field small { font-size: 12px; font-weight: 500; }
    .field input, .field select, .field textarea { width: 100%; min-height: 38px; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--fb-line); border-radius: 6px; background: var(--lf-card); color: var(--fb-text); font: inherit; font-size: 15px; outline: none; transition: border-color .16s ease, box-shadow .16s ease; }
    .field textarea { resize: vertical; min-height: 58px; }
    .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--lf-primary); box-shadow: 0 0 0 2px rgba(var(--lf-primary-rgb), .18); }
    .media-preview { display: flex; flex-wrap: wrap; gap: 7px; }
    .media-tile { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; background: var(--fb-soft); }
    .media-tile img, .media-tile video { width: 100%; height: 100%; object-fit: cover; }
    .remove-media { position: absolute; right: 4px; top: 4px; display: grid; place-items: center; width: 23px; height: 23px; border: 0; border-radius: 50%; background: rgba(0,0,0,.68); color: #fff; cursor: pointer; }
    .attachment-actions { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--lf-line-soft); border-bottom: 1px solid var(--lf-line-soft); }
    .attachment-button { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 9px; border: 0; border-radius: 6px; background: transparent; color: var(--fb-muted); font-size: 14px; font-weight: 600; cursor: pointer; }
    .attachment-button:first-child lf-icon { color: #45bd62; }
    .attachment-button:nth-child(2) lf-icon { color: #9360d8; }
    .attachment-button:disabled { opacity: .4; cursor: default; }
    .attachment-hint { margin-left: auto; color: var(--fb-muted); font-size: 12px; }
    .details-toggle { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 54px; padding: 7px 9px; border: 1px solid var(--fb-line); border-radius: 8px; background: var(--lf-card); color: var(--fb-text); text-align: left; cursor: pointer; transition: background .15s ease; }
    .details-toggle:active { background: var(--fb-soft); }
    .details-icon { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
    .details-copy { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .details-copy strong { font-size: 14px; }
    .details-copy small { color: var(--fb-muted); font-size: 12px; }
    .extra-fields { display: flex; flex-direction: column; gap: 9px; padding: 12px; border: 1px solid var(--fb-line); border-radius: 8px; background: var(--lf-bg); }
    .section-heading.compact { margin: 0; }
    .switch-row { display: flex; align-items: flex-start; gap: 9px; padding: 9px 0; border-top: 1px solid var(--lf-line-soft); color: var(--fb-text); }
    .switch-row input { width: 16px; height: 16px; margin: 1px 0 0; accent-color: var(--fb-blue); }
    .switch-row span { display: flex; flex-direction: column; gap: 2px; }
    .switch-row strong { font-size: 14px; }
    .switch-row small { color: var(--fb-muted); font-size: 12px; line-height: 1.35; }
    .privacy-switches { margin-top: 4px; }
    .error-message { display: flex; align-items: center; gap: 6px; padding: 9px 10px; margin: 12px 0 0; border-radius: 6px; background: color-mix(in srgb, var(--lf-signal) 12%, transparent); color: var(--lf-signal); font-size: 14px; }
    .field-error { margin: 1px 0 0; color: var(--lf-signal); font-size: 13px; font-weight: 600; }
    .field.invalid input, .field.invalid select, .field.invalid textarea,
    .body-input.field-error { border-color: var(--lf-signal); box-shadow: 0 0 0 2px color-mix(in srgb, var(--lf-signal) 18%, transparent); }
    .missing { margin: 12px 0 0; padding: 11px 13px; border-radius: 8px; background: color-mix(in srgb, var(--lf-signal) 9%, transparent); color: var(--fb-text); }
    .missing strong { display: flex; align-items: center; gap: 6px; color: var(--lf-signal); font-size: 14px; }
    .missing ul { margin: 7px 0 0; padding-left: 20px; }
    .missing li { font-size: 14px; line-height: 1.45; color: var(--fb-muted); }
    .fb-create-header { background: var(--lf-card); }
    .footnote { margin: 14px 0 0; color: var(--fb-muted); font-size: 12px; line-height: 1.4; }
    @media (max-width: 370px) { .composer { padding-inline: 10px; } .category-grid { gap: 5px; } .category { padding-inline: 7px; font-size: 13px; } .location-grid, .fields-two { grid-template-columns: 1fr; } }
  `]
})
export class CreatePostComponent implements OnInit {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private media = inject(MediaService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  protected readonly provinces = PROVINCES;
  protected readonly categories = CATEGORIES;
  protected readonly dangerKinds = DANGER_KINDS;
  protected readonly moreOpen = signal(false);
  protected readonly dangerKind = signal<DangerKind | null>(null);

  type = signal<PostType | null>(null);
  editing = signal(false);
  busy = signal(false);
  error = signal('');
  postId: string | null = null;

  /**
   * The whole composer lives in signals. The app runs zoneless, so a plain
   * field object mutated from an `(input)` handler never re-renders the Post
   * button - the button stayed grey with every field filled in. Signals make
   * every binding, and the validation below, update the moment something is
   * typed.
   */
  readonly f = signal<ComposerForm>({
    title: '', body: '', media: [], province: null, town: '', lastSeenAt: '', lastSeenWhere: '',
    caseNumber: '', audience: 'public', spotlightId: null, chatEnabled: true, allowComments: true,
    anonymous: false, askWanted: false, contactLabel: 'Family contact', contactValue: '', contactVisibleTo: 'verified'
  });
  readonly s = signal(blankSubject());
  readonly v = signal<VehicleDetails>(blankVehicle());
  readonly khumbuReason = signal('');

  readonly userAvatar = computed(() => this.data.avatarFor(this.auth.user()));
  readonly userName = computed(() => this.auth.user()?.displayName ?? 'You');
  readonly mySpotlights = computed(() => this.data.mySpotlights());

  patch(p: Partial<ComposerForm>): void {
    this.f.update((f) => ({ ...f, ...p }));
    if (this.error()) this.error.set('');
  }

  patchSubject(p: Partial<ReturnType<typeof blankSubject>>): void {
    this.s.update((s) => ({ ...s, ...p }));
  }

  patchVehicle(p: Partial<VehicleDetails>): void {
    this.v.update((v) => ({ ...v, ...p }));
  }

  /**
   * Everything still missing before this post can be shared, in the order the
   * person will meet it. Empty means the Post button is live.
   */
  readonly missing = computed<MissingField[]>(() => {
    const f = this.f();
    const out: MissingField[] = [];
    if (!this.type()) out.push({ key: 'type', label: 'Choose what you are posting' });
    if (!f.body.trim()) out.push({ key: 'body', label: 'Write what happened so people know how to help' });
    if (!f.province) out.push({ key: 'province', label: 'Choose the province' });
    if (!f.town.trim()) out.push({ key: 'town', label: 'Add the town or suburb' });
    if (f.audience === 'surname' && !f.spotlightId) out.push({ key: 'spotlightId', label: 'Choose a Spotlight community' });
    if (this.type() === 'danger' && !this.dangerKind()) out.push({ key: 'dangerKind', label: 'Choose what kind of danger' });
    return out;
  });

  readonly canPost = computed(() => this.missing().length === 0);
  /** Only highlighted once someone has actually tried to post. */
  readonly showFieldErrors = signal(false);

  /** The message under a field, or '' when it is fine. */
  fieldError(key: string): string {
    if (!this.showFieldErrors()) return '';
    return this.missing().some((m) => m.key === key) ? 'This one is required.' : '';
  }

  async ngOnInit(): Promise<void> {
    await this.data.loadStatic();
    const routeType = this.route.snapshot.paramMap.get('type');
    if (routeType && CATEGORIES.some((category) => category.key === routeType)) this.setType(routeType as PostType);

    const editId = this.route.snapshot.paramMap.get('id');
    if (editId) {
      const post = await this.data.loadPost(editId);
      if (!post || !this.data.canEdit(post)) {
        this.error.set('You can only edit a post you shared.');
        return;
      }
      this.postId = post.id;
      this.editing.set(true);
      this.type.set(post.type);
      this.f.update((f) => ({
        ...f,
        title: post.title,
        body: post.body,
        media: [...post.media],
        province: post.province,
        town: post.town,
        lastSeenAt: this.toLocalDateTime(post.lastSeenAt),
        lastSeenWhere: post.lastSeenWhere,
        caseNumber: post.caseNumber ?? '',
        audience: post.audience,
        spotlightId: post.spotlightId,
        chatEnabled: post.chatEnabled,
        allowComments: post.allowComments,
        anonymous: post.anonymous,
        askWanted: post.askWanted,
        contactLabel: post.contactLabel,
        contactValue: post.contactValue,
        contactVisibleTo: post.contactVisibleTo
      }));
      if (post.subject) {
        this.s.set({
          ...this.s(), name: post.subject.name, age: post.subject.age === null ? '' : String(post.subject.age),
          gender: post.subject.gender, height: post.subject.height, clothing: post.subject.clothing,
          distinguishing: post.subject.distinguishing, hair: post.subject.hair
        });
      }
      this.v.set({ ...this.v(), ...(post.vehicleDetails ?? {}) });
      this.dangerKind.set(post.danger?.kind ?? null);
      if (post.khumbu) this.khumbuReason.set(post.khumbu.reasonGuess);
      this.moreOpen.set(true);
    }
  }

  setType(type: PostType): void {
    if (this.editing()) return;
    this.type.set(type);
    this.moreOpen.set(false);
    this.s.set(blankSubject());
    this.v.set(blankVehicle());
    this.f.update((f) => ({
      ...f,
      caseNumber: '',
      lastSeenAt: '',
      lastSeenWhere: '',
      askWanted: type === 'khumbulekhaya'
    }));
    this.dangerKind.set(null);
    this.khumbuReason.set('');
    this.error.set('');
    this.showFieldErrors.set(false);
  }

  setAudience(value: string): void {
    const audience = value as Audience;
    this.f.update((f) => ({
      ...f,
      audience,
      spotlightId: audience === 'surname' ? (f.spotlightId ?? this.mySpotlights()[0]?.id ?? null) : null
    }));
  }

  audienceIcon(): string {
    const audience = this.f().audience;
    return audience === 'public' ? 'globe' : audience === 'followers' ? 'users' : 'award';
  }

  categoryLabel(): string {
    return this.categories.find((category) => category.key === this.type())?.label ?? 'Post';
  }

  bodyPlaceholder(): string {
    switch (this.type()) {
      case 'missing': return 'Share the important details. Where were they last seen? What might help someone recognise them?';
      case 'khumbulekhaya': return 'Tell the family what they need to know. Keep in mind they may not want to return home.';
      case 'vehicle': return 'Describe what happened and where the vehicle was last seen. Do not include a home address.';
      case 'pet': return 'Describe when and where your pet went missing and how people can help.';
      case 'sighting': return 'Share only what you personally saw, when and where. Avoid guesses or naming suspects.';
      case 'danger': return 'Describe the immediate safety risk clearly. Do not approach or confront anyone.';
      default: return 'Write a short update for your community…';
    }
  }

  detailsLabel(): string {
    switch (this.type()) {
      case 'missing': return 'Add person and case details';
      case 'khumbulekhaya': return 'Add family context';
      case 'vehicle': return 'Add vehicle details';
      case 'pet': return 'Add pet details';
      case 'sighting': return 'Add sighting details';
      case 'danger': return 'Add alert details';
      default: return 'Add more details';
    }
  }

  hasVideo(): boolean { return this.f().media.some((item) => item.kind === 'video'); }

  async addPhoto(): Promise<void> {
    const f = this.f();
    if (f.media.length >= 4 || this.hasVideo()) return;
    const item = await this.media.pickImage({ quality: 76 });
    if (!item) {
      if (this.media.lastError()) this.error.set(this.media.lastError()!);
      return;
    }
    const src = await this.media.compress(item.src, 1200);
    this.f.update((current) => ({ ...current, media: [...current.media, { ...item, src }] }));
  }

  async addVideo(): Promise<void> {
    if (this.f().media.length) return;
    const item = await this.media.pickVideo();
    if (!item) {
      if (this.media.lastError()) this.error.set(this.media.lastError()!);
      return;
    }
    this.f.update((current) => ({ ...current, media: [item] }));
  }

  removeMedia(id: string): void {
    this.f.update((current) => ({ ...current, media: current.media.filter((item) => item.id !== id) }));
  }

  async submit(): Promise<void> {
    this.error.set('');
    const f = this.f();
    const s = this.s();
    const v = this.v();
    const type = this.type();

    // The Post button always answers a tap, so an unfinished form explains
    // itself instead of sitting there looking broken.
    this.showFieldErrors.set(true);
    if (this.missing().length) {
      this.error.set(this.missing()[0].label + '.');
      this.scrollToError();
      return;
    }

    const timestamp = f.lastSeenAt ? new Date(f.lastSeenAt).getTime() : null;
    const personType = type === 'missing' || type === 'khumbulekhaya' || type === 'pet';
    const subject = personType ? {
      name: s.name.trim(),
      age: s.age ? Number(s.age) : null,
      gender: s.gender,
      height: s.height.trim(), build: '', skinTone: '', hair: s.hair.trim(), eyes: '',
      clothing: s.clothing.trim(), distinguishing: s.distinguishing.trim(), medical: '',
      vehicle: '', languages: '', surname: s.name.trim().split(/\s+/).at(-1) ?? '', relationship: ''
    } : (type === 'sighting' && (s.name || s.clothing) ? {
      name: s.name.trim(), age: null, gender: 'unknown' as const, height: '', build: '', skinTone: '', hair: '', eyes: '',
      clothing: s.clothing.trim(), distinguishing: '', medical: '', vehicle: '', languages: '', surname: '', relationship: ''
    } : null);
    const vehicleDetails = type === 'vehicle' ? {
      makeModel: v.makeModel.trim(), registration: v.registration.trim(), colour: v.colour.trim(), bodyType: v.bodyType.trim()
    } : null;
    const title = f.title.trim() || this.generatedTitle(type!, subject?.name ?? '', vehicleDetails?.makeModel ?? '');
    const khumbu = type === 'khumbulekhaya' ? {
      daysOut: timestamp ? Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000)) : null,
      leftHomeAt: timestamp,
      reasonGuess: this.khumbuReason().trim(), claimedByUserId: null, claimedAt: null,
      subjectResponse: 'none' as const, subjectNote: '', wantedAnswers: { yes: 0, no: 0, myVote: null }
    } : null;

    this.busy.set(true);
    try {
      if (this.editing() && this.postId) {
        await this.data.updatePost(this.postId, {
          title, body: f.body, media: f.media, province: f.province!, town: f.town.trim(),
          lastSeenAt: timestamp, lastSeenWhere: (f.lastSeenWhere || f.town).trim(), caseNumber: f.caseNumber || null,
          subject, vehicleDetails, audience: f.audience, spotlightId: f.spotlightId,
          chatEnabled: f.chatEnabled, allowComments: f.allowComments, anonymous: f.anonymous,
          askWanted: f.askWanted, contactLabel: f.contactLabel, contactValue: f.contactValue,
          contactVisibleTo: f.contactVisibleTo, khumbu
        });
      } else {
        await this.data.createPost({
          type: type!, title, body: f.body, media: f.media, province: f.province!, town: f.town.trim(),
          lastSeenAt: timestamp, lastSeenWhere: (f.lastSeenWhere || f.town).trim(), geo: null,
          contactLabel: f.contactLabel || 'Family contact', contactValue: f.contactValue,
          contactVisibleTo: f.contactVisibleTo, caseNumber: f.caseNumber || null, reward: null,
          subject, vehicleDetails, audience: f.audience, spotlightId: f.spotlightId,
          chatEnabled: f.chatEnabled, allowComments: f.allowComments, anonymous: f.anonymous,
          askWanted: f.askWanted, khumbu,
          danger: type === 'danger' ? { kind: this.dangerKind()!, stillIds: [], clearIds: [], clearedAt: null } : null
        });
      }
      this.showFieldErrors.set(false);
      await this.router.navigate(['/home']);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not share this post');
    } finally {
      this.busy.set(false);
    }
  }

  /** Brings the first empty required field into view. */
  private scrollToError(): void {
    if (typeof document === 'undefined') return;
    const target = document.querySelector('[data-field="body"]')
      ?? document.querySelector('.post-fields');
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }

  private generatedTitle(type: PostType, name: string, vehicle: string): string {
    if (type === 'vehicle' && vehicle) return `Stolen vehicle: ${vehicle}`;
    if (name) return `${this.categoryLabel()}: ${name}`;
    const opening = this.f().body.trim().split(/[.!?\n]/)[0]?.trim() ?? '';
    return `${this.categoryLabel()}: ${opening.slice(0, 64) || 'Community update'}`;
  }

  private toLocalDateTime(timestamp: number | null): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }

  close(): void { void this.router.navigate(['/home']); }
}
