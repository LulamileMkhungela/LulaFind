import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular/toast-controller';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IconComponent } from '../../shared/components/icon.component';
import { DictationService } from '../../core/services/dictation.service';
import { VoiceRecorderService } from '../../core/services/voice-recorder.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { MediaService } from '../../core/services/media.service';
import { PHOTO_MAX_BYTES, POST_MAX_PHOTOS, AUDIO_MAX_BYTES, VIDEO_MAX_BYTES, mb } from '../../core/models/media-rules';
import {
  Audience, MediaItem, Post, PostPoster, PostType, PROVINCES, ProvinceCode
} from '../../core/models/types';
import { uid } from '../../core/utils/format';
import { BackStackService } from '../../core/services/back-stack.service';
import { drawPoster, isPosterType, loadPosterImage, posterContent, POSTER_TEMPLATES, type PosterTemplateId } from '../../core/utils/poster';
import { PlatformService } from '../../core/services/platform.service';

/** A brand-new composer. Also what "Start fresh" returns to. */
const blankForm = (): ComposerForm => ({
  title: '', body: '', media: [], province: null, town: '', lastSeenAt: '', lastSeenWhere: '',
  caseNumber: '', audience: 'public', spotlightId: null, chatEnabled: true, allowComments: true,
  anonymous: false, askWanted: false, contactLabel: 'Family contact', contactValue: '', contactVisibleTo: 'verified',
  guardianConsent: false
});

const CATEGORIES: { key: PostType; label: string; icon: string }[] = [
  { key: 'missing', label: 'Missing & Found', icon: 'search' },
  { key: 'khumbulekhaya', label: 'Home Sweet Home', icon: 'home' },
  { key: 'announcement', label: 'Announcement', icon: 'megaphone' },
  { key: 'sighting', label: 'Sighting', icon: 'pin' }
];

const blankSubject = () => ({
  name: '', age: '', gender: 'unknown' as 'female' | 'male' | 'other' | 'unknown',
  height: '', clothing: '', distinguishing: '', hair: '', vehicle: ''
});

interface TemplateValues {
  name: string;
  age: number | null;
  gender: 'female' | 'male' | 'other' | 'unknown';
  location: string;
  town: string;
  province: ProvinceCode | null;
  when: number | null;
  happened: string;
  clothing: string;
  caseNumber: string;
  contact: string;
  privateMark: string;
  familyNote: string;
}

const TEMPLATE_SECTIONS: Record<string, keyof TemplateValues> = {
  'full name': 'name', 'pet name': 'name', 'name': 'name',
  'age': 'age', 'gender': 'gender',
  'location': 'location', 'location town suburb province': 'location',
  'location last seen town suburb province': 'location', 'location last seen': 'location', 'last seen location': 'location',
  'when last seen': 'when', 'when they left': 'when', 'when seen': 'when', 'date and time': 'when',
  'what happened': 'happened', 'what i personally saw': 'happened', 'what i saw': 'happened',
  'clothing identifying details': 'clothing', 'coat collar identifying details': 'clothing',
  'what they were wearing': 'clothing', 'appearance': 'clothing', 'coat collar or identifying details': 'clothing',
  'saps case number': 'caseNumber', 'case number': 'caseNumber',
  'contact details': 'contact', 'contact': 'contact',
  'private identifying detail': 'privateMark', 'private mark known only to family': 'privateMark',
  'what the family wants them to know': 'familyNote'
};

const sectionKey = (line: string): { key: keyof TemplateValues; value: string } | null => {
  const match = line.match(/^\s*([^:]{2,90}):\s*(.*)$/);
  if (!match) return null;
  const label = match[1].toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const key = TEMPLATE_SECTIONS[label];
  return key ? { key, value: match[2].trim() } : null;
};

/**
 * The prompts a person fills in to open a case.
 *
 * These are deliberately the *few* things a case cannot exist without: who,
 * when, where, and what happened. Everything else - clothing, the SAPS case
 * number, contact details, a mark only the family knows - used to be asked for
 * here *and* again in the "Optional details" panel below, which is the same
 * question twice and reads as a form that does not trust you. Those now live in
 * that panel alone, and all of them can be added after publishing from the post
 * itself, because a terrified parent should not be stopped by a field they do
 * not have to hand.
 */
function templateForType(type: PostType): string {
  switch (type) {
    case 'missing':
      return 'Full name:\nAge:\nGender:\nLocation (town/suburb, province):\nWhen last seen:\nWhat happened:';
    case 'khumbulekhaya':
      return 'Full name:\nAge:\nLocation last seen (town/suburb, province):\nWhen they left:\nWhat happened:';
    case 'announcement':
      return 'What I am announcing (lost or found):\nWhat it is:\nWhere:\nWhen:\nHow people can help:';
    case 'sighting':
      return 'Location (town/suburb, province):\nWhen seen:\nWhat I personally saw:';
    default:
      return 'What happened:\nLocation (town/suburb, province):';
  }
}

function parseTemplate(text: string): TemplateValues {
  const sections: Partial<Record<keyof TemplateValues, string[]>> = {};
  let current: keyof TemplateValues | null = null;
  for (const line of text.split(/\r?\n/)) {
    const parsed = sectionKey(line);
    if (parsed) {
      current = parsed.key;
      (sections[current] ??= []).push(parsed.value);
    } else if (current) {
      (sections[current] ??= []).push(line.trim());
    }
  }
  const value = (key: keyof TemplateValues): string => (sections[key] ?? []).join('\n').trim();
  const location = value('location');
  let province: ProvinceCode | null = null;
  let town = location;
  const normalizedLocation = location.toLowerCase().trim();
  for (const item of PROVINCES) {
    const endings = [item.name.toLowerCase(), item.code.toLowerCase()];
    const ending = endings.find((candidate) => {
      if (!normalizedLocation.endsWith(candidate)) return false;
      const before = normalizedLocation.slice(0, -candidate.length);
      return !before || /[,\s]$/.test(before);
    });
    if (ending) {
      province = item.code;
      town = location.slice(0, location.length - ending.length).replace(/[,\s]+$/, '').trim();
      break;
    }
  }
  const rawAge = value('age').match(/\d{1,3}/)?.[0];
  const ageNumber = rawAge === undefined ? null : Number(rawAge);
  const age = ageNumber !== null && ageNumber >= 0 && ageNumber <= 120 ? ageNumber : null;
  const rawGender = value('gender').toLowerCase();
  const gender: TemplateValues['gender'] = /female|woman|girl/.test(rawGender) ? 'female'
    : /male|man|boy/.test(rawGender) ? 'male'
      : /other|non.?binary/.test(rawGender) ? 'other' : 'unknown';
  const dateText = value('when');
  const date = dateText ? new Date(dateText) : null;
  const when = date && Number.isFinite(date.getTime()) ? date.getTime() : null;
  return {
    name: value('name'), age, gender, location, town, province, when,
    happened: value('happened'), clothing: value('clothing'), caseNumber: value('caseNumber'),
    contact: value('contact'), privateMark: value('privateMark'), familyNote: value('familyNote')
  };
}

interface ComposerForm {
  title: string; body: string; media: MediaItem[]; province: ProvinceCode | null; town: string;
  lastSeenAt: string; lastSeenWhere: string; caseNumber: string; audience: Audience;
  /* required when the missing person is under 18 */ guardianConsent: boolean;
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
          <button class="icon-button" type="button" (click)="posterMode() ? closeGenerator() : close()"
                  [attr.aria-label]="posterMode() ? 'Back to composer' : 'Close composer'">
            <lf-icon [name]="posterMode() ? 'chevronLeft' : 'x'" [size]="20" />
          </button>
        </ion-buttons>
        <ion-title>{{ posterMode() ? 'Generate post' : editing() ? 'Edit post' : 'Create post' }}</ion-title>
        @if (!posterMode()) {
          <ion-buttons slot="end">
            <button class="post-button" type="button" [disabled]="busy()" [class.ready]="canPost()" (click)="submit()">
              {{ busy() ? 'Posting…' : 'Post' }}
            </button>
          </ion-buttons>
        }
      </ion-toolbar>
    </ion-header>

    <ion-content class="lf-page">
      @if (posterMode()) {
        <section class="generator lf-fade-in" aria-label="Generate a post design">
          <div class="generator__intro">
            <strong>Choose a design</strong>
            <p>Preview your post as a shareable image. The first attached photo is included when available; without one, the design stays text-led.</p>
          </div>
          <div class="generated-stage">
            <canvas #generatedCanvas role="img" [attr.aria-label]="'Preview using the ' + selectedTemplateName() + ' design'"></canvas>
            @if (posterBusy()) { <div class="generated-stage__busy">Updating preview…</div> }
          </div>
          @if (firstImage()) {
            <div class="preview-choice" role="group" aria-label="Preview with or without the attached photo">
              <button type="button" [class.active]="previewWithImage()" (click)="setPreviewPhoto(true)">With photo</button>
              <button type="button" [class.active]="!previewWithImage()" (click)="setPreviewPhoto(false)">Text only</button>
            </div>
          }
          <p class="image-state" role="status">
            {{ firstImage() ? (previewWithImage() ? 'Preview includes your first attached photo.' : 'Preview without the photo; the published design includes your attached photo.') : 'No photo attached — previewing the text-only design.' }}
          </p>
          <div class="template-picker" role="listbox" aria-label="Post design templates">
            @for (template of posterTemplates; track template.id) {
              <button type="button" class="template-choice" role="option" [class.on]="selectedTemplate() === template.id"
                      [attr.aria-selected]="selectedTemplate() === template.id" [disabled]="posterBusy()"
                      (click)="chooseTemplate(template.id)">
                <span class="template-swatch" [style.background]="'linear-gradient(135deg,' + template.swatch[0] + ' 0%,' + template.swatch[2] + ' 55%,' + template.swatch[1] + ' 100%)'"></span>
                <strong>{{ template.name }}</strong><small>{{ template.tagline }}</small>
              </button>
            }
          </div>
          <div class="generator__actions">
            <button type="button" class="use-design" [disabled]="posterBusy()" (click)="useGeneratedDesign()">Use this design</button>
            <button type="button" class="cancel-design" (click)="closeGenerator()">Back to post</button>
          </div>
        </section>
      } @else {
      <main class="composer lf-fade-in">
        <div class="author-row">
          <lf-avatar [src]="userAvatar()" [name]="userName()" [size]="40" />
          <div class="author-meta">
            <strong>{{ userName() }}</strong>
            <!--
              The picker speaks one short word at a time. It used to put the
              whole explanation ("Spotlight (join one first)") inside the
              selected option, which a select box cannot ellipsize: the text was
              painted cut off, so the globe sat several characters away from the
              word it belonged to. The reason, when there is one, is now a line
              under the row.
            -->
            <label class="audience-picker" [attr.title]="audienceTitle()">
              <lf-icon [name]="audienceIcon()" [size]="13" />
              <select [value]="f().audience" (change)="setAudience($any($event.target).value)"
                      aria-label="Who can see this post">
                <option value="public">Public</option>
                <option value="followers">Followers</option>
                <option value="surname" [disabled]="!mySpotlights().length">Spotlight</option>
              </select>
              <lf-icon name="chevronDown" [size]="12" />
            </label>
            @if (f().audience === 'surname' && !mySpotlights().length) {
              <p class="audience-note">Join a Spotlight to share with one surname community.</p>
            }
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
          @if (editing()) { <p class="inline-note">The category can’t change after posting. Saving marks it edited.</p> }
        </section>

        @if (draftKept()) {
          <div class="draft-note" role="status">
            <lf-icon name="info" [size]="16" />
            <span>We kept what you typed. Carry on where you left off.</span>
            <button type="button" (click)="discardDraft()">Start fresh</button>
          </div>
        }

        @if (showFieldErrors() && missing().length) {
          <div class="missing" role="alert">
            <strong><lf-icon name="alert" [size]="15" /> Before you post</strong>
            <ul>
              @for (item of missing(); track item.key) { <li>{{ item.label }}</li> }
            </ul>
          </div>
        }

        @if (mediaFailure(); as failure) {
          <div class="media-failure" role="alert">
            <lf-icon name="image" [size]="16" />
            <p>{{ failure }}</p>
            <div class="media-failure__acts">
              <button type="button" (click)="retryMedia()">Try again</button>
              <button type="button" class="quiet" (click)="postWithoutPhoto()">Post without the photo</button>
            </div>
          </div>
        }

        @if (!type()) {
          <div class="start-hint">
            <span class="hint-icon"><lf-icon name="edit" [size]="18" /></span>
            <p>Choose a category to start your post.</p>
          </div>
        } @else {
          <section class="post-fields" aria-label="Post content">
            @if (editing()) {
              <label class="field full heading-field">
                <span>Short heading <small>(optional)</small></span>
                <input class="heading-input" type="text" maxlength="120" placeholder="Type a short heading"
                       [value]="f().title" (input)="patch({ title: $any($event.target).value })" />
              </label>
            } @else {
              <!--
                Two promises in one line, because both decide whether the form
                feels possible: nothing here has to be perfect, and everything
                left out can be added from the post afterwards.
              -->
              <p class="template-instruction">
                Fill in what you know. Leave any line blank and add it later from the post itself.
                @if (dictation.available) {
                  The small mic in the box types as you speak. Voice, below, records your words for people to hear.
                }
              </p>
            }
            <div class="body-wrap">
              <textarea class="body-input" [class.body-input--template]="!editing()" [rows]="editing() ? 5 : 13"
                        inputmode="text" autocorrect="on" autocomplete="on" autocapitalize="sentences" spellcheck="true"
                        data-field="body" [placeholder]="editing() ? bodyPlaceholder() : ''"
                        [value]="f().body" (input)="patch({ body: $any($event.target).value })"
                        aria-label="Post text template"></textarea>

              <!--
                Speak instead of typing. A parent filling this in on a phone,
                one-handed, in a police station queue should not have to fight a
                keyboard. The button only renders where the browser actually has
                speech recognition - a mic that does nothing is worse than none.
              -->
              @if (dictation.available) {
                <button class="mic" type="button" [class.on]="dictation.listening()"
                        [attr.aria-pressed]="dictation.listening()"
                        [attr.aria-label]="dictation.listening() ? 'Stop speaking' : 'Speak this instead of typing'"
                        (click)="toggleDictation()">
                  <lf-icon [name]="dictation.listening() ? 'stop' : 'mic'" [size]="18" />
                  <span class="sr-only">{{ dictation.listening() ? 'Stop dictation' : 'Start dictation' }}</span>
                </button>
              }
            </div>
            @if (dictation.listening()) {
              <p class="mic-note listening" role="status">
                <span class="pulse" aria-hidden="true"></span>
                Listening. Tap stop when you are done, then read it back.
                @if (dictation.interim()) { <em>{{ dictation.interim() }}</em> }
              </p>
            } @else if (dictation.error()) {
              <p class="mic-note error" role="alert">
                {{ dictation.error() }}
                <button type="button" (click)="dictation.clearError()">Dismiss</button>
              </p>
            }
            @if (fieldError('body')) { <p class="field-error">{{ fieldError('body') }}</p> }

            @if (editing()) {
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
            }

            @if (f().media.length) {
              <div class="media-preview" aria-label="Attached media">
                @for (item of f().media; track item.id) {
                  <div class="media-tile" [class.media-tile--audio]="item.kind === 'audio'">
                    @if (item.kind === 'video') {
                      <video [src]="item.src" controls preload="metadata"></video>
                    } @else if (item.kind === 'audio') {
                      <!-- A voice note, played back before it is posted. -->
                      <div class="voice">
                        <span class="voice__label"><lf-icon name="mic" [size]="15" /> Voice note · {{ voiceLength(item) }}</span>
                        <audio [src]="item.src" controls preload="metadata"></audio>
                        @if (item.transcript) {
                          <p class="voice__text">{{ item.transcript }}</p>
                        }
                      </div>
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

            @if (recorder.recording()) {
              <!--
                The recording bar. It replaces the gestures with words as soon as
                the finger is down, because "slide up to lock" has to be readable
                while the thumb is already moving.
              -->
              <div class="recbar" [class.recbar--locked]="recorder.locked()" role="status" aria-live="polite">
                <span class="pulse" aria-hidden="true"></span>
                <span class="recbar__time">{{ recorder.clock }}</span>
                <svg class="recbar__wave" viewBox="0 0 120 24" aria-hidden="true" preserveAspectRatio="none">
                  @for (h of waveBars; track $index) {
                    <rect [attr.x]="$index * 6" y="0" width="3" [attr.height]="h" rx="1.5"></rect>
                  }
                </svg>
                @if (recorder.locked()) {
                  <span class="recbar__hint">Locked</span>
                  <button type="button" class="recbar__btn recbar__btn--go" (click)="stopVoiceNote()" aria-label="Stop and attach the voice note">
                    <lf-icon name="send" [size]="16" />
                  </button>
                  <button type="button" class="recbar__btn recbar__btn--no" (click)="cancelVoiceNote()" aria-label="Cancel the recording">
                    <lf-icon name="trash" [size]="16" />
                  </button>
                } @else {
                  <span class="recbar__hint"><lf-icon name="chevronLeft" [size]="13" /> Slide to cancel</span>
                  <span class="recbar__hint recbar__hint--up"><lf-icon name="chevronUp" [size]="13" /> up to lock</span>
                }
              </div>
              @if (recorder.transcript()) {
                <!--
                  The words the phone heard so far. They are shown while speaking
                  so the writing-down is never a surprise, and the line under it
                  says plainly who is listening: the phone's speech engine, not
                  LulaFind.
                -->
                <p class="recbar__heard" role="status">
                  <span class="recbar__heard-words">{{ recorder.transcript() }}</span>
                  <small>The phone's speech engine is writing these words down, so the note can be read as well as heard.</small>
                </p>
              }
            } @else if (recorder.error()) {
              <div class="voicerec error" role="alert">
                <span>{{ recorder.error() }}</span>
                <button type="button" class="voicerec__cancel" (click)="recorder.clearError()">Dismiss</button>
              </div>
            }

            <div class="attachment-actions">
              <button type="button" class="attachment-button" (click)="addPhoto()"
                      [disabled]="busy() || hasVideo() || f().media.length >= maxPhotos">
                <lf-icon name="image" [size]="18" /> <span>Photo</span>
              </button>
              <button type="button" class="attachment-button" (click)="addVideo()"
                      [disabled]="busy() || hasVideo() || f().media.length > 0">
                <lf-icon name="video" [size]="18" /> <span>Video</span>
              </button>
              <!--
                Voice note, held the way WhatsApp holds it: press and keep the
                finger down to record, slide left to cancel, slide up to lock it
                and let go. A plain tap still starts a hands-free recording, so
                the gesture is a shortcut rather than the only way in - and every
                one of those is also a button, for a screen reader or a shaky hand.
              -->
              @if (recorder.available) {
                <button type="button" class="attachment-button voice-hold" [class.armed]="recorder.recording()"
                        [disabled]="busy() || hasVideo()"
                        [attr.aria-pressed]="recorder.recording()"
                        [attr.aria-label]="recorder.recording() ? 'Recording. Release to send, slide up to lock, slide left to cancel.' : 'Hold to record a voice note'"
                        (pointerdown)="voiceDown($event)"
                        (pointerup)="voiceUp($event)"
                        (pointercancel)="voiceCancelGesture()"
                        (pointermove)="voiceMove($event)"
                        (keydown.enter)="startVoiceHandsFree()"
                        (keydown.space)="startVoiceHandsFree(); $event.preventDefault()">
                  <lf-icon [name]="recorder.recording() ? 'mic' : 'mic'" [size]="18" />
                  <span>{{ recorder.recording() ? 'Release' : hasVoiceNote() ? 'Re-record' : 'Voice' }}</span>
                </button>
              }
              @if (!editing() && canGenerate()) {
                <button type="button" class="attachment-button generate-button" (click)="openGenerator()" [disabled]="busy()">
                  <lf-icon name="layout" [size]="18" /> <span>Generate</span>
                </button>
              }
              <span class="attachment-hint">
                Up to {{ maxPhotos }} photos ({{ photoMb }} MB each), 1 video ({{ videoMb }} MB) or a voice note up to {{ voiceMb }} MB.
              </span>
            </div>
            @if (posterTemplate()) {
              <p class="generated-selection" role="status"><lf-icon name="check" [size]="15" /> {{ selectedTemplateName() }} design will be published with this post.
                <button type="button" (click)="clearGeneratedDesign()">Remove</button>
              </p>
            }
            @if (posterStale()) {
              <p class="generator-stale" role="status">The text or photos changed, so the old preview was cleared. Generate again to use a design.</p>
            }

            <!--
              Available while creating too, not only when editing. It was
              edit-only, so the composer's copy promised "add it after posting"
              while the panel it pointed at did not exist yet - the promise is
              only honest if the fields are right here, collapsed.
            -->
            @if (canAddDetails()) {
              <button type="button" class="details-toggle" [attr.aria-expanded]="moreOpen()" (click)="moreOpen.set(!moreOpen())">
                <span class="details-icon"><lf-icon name="plus" [size]="17" /></span>
                <span class="details-copy"><strong>{{ detailsLabel() }}</strong><small>Optional - skip it and add it after posting</small></span>
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
                    <label class="field full"><span>Clothing or identifying details</span><textarea rows="2" inputmode="text" autocorrect="on" autocomplete="on" autocapitalize="sentences" spellcheck="true" placeholder="What were they wearing? Any details that could help identify them?" [value]="s().clothing" (input)="patchSubject({ clothing: $any($event.target).value })"></textarea></label>
                    @if (type() === 'missing') {
                      <label class="field full"><span>Private identifying detail <small>(kept off the public poster)</small></span><input placeholder="A mark only the family knows" [value]="s().distinguishing" (input)="patchSubject({ distinguishing: $any($event.target).value })" /></label>
                    }
                  }

                  @if (type() === 'announcement') {
                    <div class="section-heading compact"><strong>What are you announcing?</strong><span>Your words</span></div>
                    <!--
                      An announcement is an open field on purpose. A lost dog, a
                      found wallet, a water cut, a funeral notice - the app does
                      not know which of these the person needs to say, so it asks
                      for what it is and lets them write the rest.
                    -->
                    <label class="field full"><span>What is it? <small>(optional)</small></span>
                      <input placeholder="A lost dog, a found wallet, a notice for the street" [value]="s().name" (input)="patchSubject({ name: $any($event.target).value })" />
                    </label>
                    <label class="field full"><span>Anything that identifies it <small>(optional)</small></span>
                      <input placeholder="Colour, collar, a mark, a reference" [value]="s().distinguishing" (input)="patchSubject({ distinguishing: $any($event.target).value })" />
                    </label>
                  }

                  @if (type() === 'sighting') {
                    <div class="section-heading compact"><strong>Sighting details</strong><span>Optional</span></div>
                    <label class="field full"><span>Where did you see them?</span><input placeholder="Nearest landmark or public place" [value]="f().lastSeenWhere" (input)="patch({ lastSeenWhere: $any($event.target).value })" /></label>
                    <label class="field full"><span>Appearance</span><input placeholder="Describe only what you actually saw" [value]="s().clothing" (input)="patchSubject({ clothing: $any($event.target).value })" /></label>
                  }

                  @if (type() !== 'sighting') {
                    <label class="field full"><span>Last seen near</span><input placeholder="Neighbourhood or public place" [value]="f().lastSeenWhere" (input)="patch({ lastSeenWhere: $any($event.target).value })" /></label>
                  }
                  @if (type() !== 'announcement' && type() !== 'sighting') {
                    <label class="field full"><span>SAPS case number <small>(optional)</small></span><input placeholder="Police case reference" [value]="f().caseNumber" (input)="patch({ caseNumber: $any($event.target).value })" /></label>
                  }

                  @if (type() === 'khumbulekhaya') {
                    <label class="field full"><span>What might the family want them to know?</span><input placeholder="Optional — don't assume they want to come home" [value]="khumbuReason()" (input)="setKhumbu($any($event.target).value)" /></label>
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
                    <label class="switch-row"><input type="checkbox" [checked]="f().chatEnabled" (change)="patch({ chatEnabled: $any($event.target).checked })" /><span><strong>Allow private chat</strong><small>Chat requires an accepted follow in either direction and both people allowing messages.</small></span></label>
                  </div>
                </section>
              }
            } @else {
              <button type="button" class="details-toggle" [attr.aria-expanded]="moreOpen()" (click)="moreOpen.set(!moreOpen())">
                <span class="details-icon"><lf-icon name="plus" [size]="17" /></span>
                <span class="details-copy"><strong>Post settings</strong><small>Privacy and who can respond</small></span>
                <lf-icon [name]="moreOpen() ? 'chevronDown' : 'chevronRight'" [size]="17" />
              </button>
              @if (moreOpen()) {
                <section class="extra-fields lf-fade-in" aria-label="Post settings">
                  <label class="field full"><span>Contact visibility</span><select [value]="f().contactVisibleTo" (change)="patch({ contactVisibleTo: $any($event.target).value })">
                    <option value="everyone">Everyone</option><option value="verified">Verified members</option><option value="owner">Only me</option>
                  </select></label>
                  <div class="privacy-switches">
                    <label class="switch-row"><input type="checkbox" [checked]="f().anonymous" (change)="patch({ anonymous: $any($event.target).checked })" /><span><strong>Post anonymously</strong><small>Your profile stays private on this post.</small></span></label>
                    <label class="switch-row"><input type="checkbox" [checked]="f().allowComments" (change)="patch({ allowComments: $any($event.target).checked })" /><span><strong>Allow comments</strong><small>People can share leads in the thread.</small></span></label>
                    <label class="switch-row"><input type="checkbox" [checked]="f().chatEnabled" (change)="patch({ chatEnabled: $any($event.target).checked })" /><span><strong>Allow private chat</strong><small>Chat requires an accepted follow in either direction and both people allowing messages.</small></span></label>
                    @if (type() === 'khumbulekhaya') {
                      <label class="switch-row"><input type="checkbox" [checked]="f().askWanted" (change)="patch({ askWanted: $any($event.target).checked })" /><span><strong>Ask the community if they are being looked for</strong><small>People can answer yes or no.</small></span></label>
                    }
                  </div>
                </section>
              }
            }
          </section>
        }

        @if (notice()) { <p class="notice-message"><lf-icon name="info" [size]="15" /> {{ notice() }}</p> }
        @if (error()) { <p class="error-message" role="alert"><lf-icon name="alert" [size]="15" /> {{ error() }}</p> }
        @if (childCase()) {
          <label class="consent">
            <input type="checkbox" [checked]="f().guardianConsent" (change)="patch({ guardianConsent: $any($event.target).checked })" />
            <span>I am this child\u2019s parent or guardian, or I have their permission to post this. A case about a child is checked by a moderator before it goes out.</span>
          </label>
        }
        <p class="footnote">Share only information you are allowed to post. In an emergency, call 10111.</p>
      </main>
      }
    </ion-content>
  `,
  styles: [`
    :host { --fb-blue: var(--lf-primary); --fb-text: var(--ion-text-color); --fb-muted: var(--lf-muted); --fb-line: var(--lf-line); --fb-soft: var(--lf-input); }
    .fb-create-header { background: var(--lf-card); border-bottom: 1px solid var(--fb-line); }
    .icon-button { width: 36px; height: 36px; border: 0; border-radius: 50%; display: grid; place-items: center; background: var(--fb-soft); color: var(--fb-text); cursor: pointer; transition: background .16s ease, transform .16s ease; }
    .icon-button:active { transform: scale(.94); }
    .post-button { justify-self: end; min-width: 54px; height: 32px; padding: 0 12px; border: 0; border-radius: 6px; background: var(--lf-primary-fill); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; transition: filter .15s ease, transform .15s ease; }
    .post-button:disabled { opacity: .45; cursor: default; }
    .post-button.ready { box-shadow: 0 0 0 2px color-mix(in srgb, var(--lf-primary) 22%, transparent); }
    .post-button:active:not(:disabled) { transform: scale(.96); }
    .composer { width: min(100%, 600px); margin: 0 auto; padding: 14px 14px calc(26px + var(--lf-safe-bottom)); color: var(--fb-text); }
    .author-row { display: flex; align-items: center; gap: 10px; padding: 0 0 12px; }
    .author-meta { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
    .author-meta > strong { font-size: 14px; }
    .audience-picker { display: inline-flex; align-items: center; gap: 4px; min-height: 34px; padding: 4px 8px; border-radius: 5px; background: var(--fb-soft); color: var(--fb-text); font-size: 13px; font-weight: 600; max-width: 100%; }
    /*
     * The picker labels the glyph: it is always the short word, never a
     * sentence. A native select is as wide as its widest option, so showing
     * "Public" left a gap where "Spotlight" would be, and the chevron sat far
     * to the right of the word. field-sizing makes it hug the word it is
     * actually showing; browsers without it keep a sane maximum.
     */
    .audience-picker select {
      border: 0; outline: 0; background: transparent; color: inherit; font: inherit;
      appearance: none; cursor: pointer; min-height: 26px; max-width: 8rem;
      field-sizing: content;
    }
    .audience-picker lf-icon { flex: none; }
    .audience-note { margin: 6px 0 0 50px; color: var(--fb-muted); font-size: 13px; line-height: 1.35; }
    .spotlight-picker select { border: 0; outline: 0; background: transparent; color: inherit; font: inherit; appearance: none; cursor: pointer; min-height: 26px; }
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
    .template-instruction { margin: 0; color: var(--fb-muted); font-size: 13px; line-height: 1.4; }
    .body-input { width: 100%; box-sizing: border-box; min-height: 112px; padding: 8px 0; border: 0;
      background: transparent; color: var(--fb-text); font: inherit; font-size: 15px; line-height: 1.5; outline: 0; resize: vertical; }
    .body-input--template { min-height: 290px; padding: 12px; border: 1px solid var(--fb-line); border-radius: 9px; background: var(--lf-card); white-space: pre-wrap; }
    .body-input::placeholder { color: var(--lf-muted); }
    /*
     * Dictation. The mic sits inside the writing area, bottom-right, where a
     * thumb already is - not in a toolbar at the top. While it listens it turns
     * solid and pulses, because a muted mic button that looks identical to an
     * idle one is how people talk to a phone that never started listening.
     */
    .body-wrap { position: relative; }
    .mic { position: absolute; right: 6px; bottom: 6px; width: 42px; height: 42px; border-radius: 50%;
      display: grid; place-items: center; border: 1px solid var(--fb-line); background: var(--lf-card);
      color: var(--lf-muted); cursor: pointer; box-shadow: 0 2px 8px rgb(0 0 0 / .10); }
    .mic.on { background: var(--lf-signal-text); border-color: var(--lf-signal-text); color: #fff; }
    .mic:focus-visible { outline: 3px solid var(--lf-primary); outline-offset: 2px; }
    .mic-note { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin: 2px 0 0;
      font-size: 12.5px; line-height: 1.35; color: var(--lf-muted); }
    .mic-note.listening { color: var(--lf-signal-text); font-weight: 600; }
    .mic-note em { font-style: normal; font-weight: 500; color: var(--lf-muted); }
    .mic-note.error { color: var(--lf-signal-text); }
    .mic-note button { border: 0; background: none; padding: 0; font: inherit; font-weight: 700;
      color: var(--lf-link); cursor: pointer; text-decoration: underline; }
    .pulse { width: 9px; height: 9px; border-radius: 50%; background: var(--lf-signal-text);
      animation: mic-pulse 1.2s ease-in-out infinite; }
    @keyframes mic-pulse { 0%, 100% { opacity: .35; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.15); } }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none; opacity: 1; } }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
      clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .location-grid, .fields-two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field.full { width: 100%; }
    .field > span { color: var(--fb-muted); font-size: 13px; font-weight: 600; }
    .field b { color: var(--lf-signal-text); }
    .field small { font-size: 12px; font-weight: 500; }
    .field input, .field select, .field textarea { width: 100%; min-height: 38px; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--fb-line); border-radius: 6px; background: var(--lf-card); color: var(--fb-text); font: inherit; font-size: 15px; outline: none; transition: border-color .16s ease, box-shadow .16s ease; }
    .field textarea { resize: vertical; min-height: 58px; }
    .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--lf-primary); box-shadow: 0 0 0 2px rgba(var(--lf-primary-rgb), .18); }
    .heading-field .heading-input { min-height: 46px; padding: 10px 12px; font-size: 16px; font-weight: 600; }
    .heading-field .heading-input::placeholder { color: var(--lf-muted); font-weight: 500; opacity: 1; }
    .heading-field .heading-input:focus-visible { border-color: var(--lf-primary); box-shadow: 0 0 0 2px rgba(var(--lf-primary-rgb), .18); }
    .media-preview { display: flex; flex-wrap: wrap; gap: 7px; }
    .media-tile { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; background: var(--fb-soft); }
    .media-tile img, .media-tile video { width: 100%; height: 100%; object-fit: cover; }
    /* A voice note is a row, not an 84px square: the player needs the width. */
    .media-tile--audio { width: 100%; height: auto; }
    .media-tile--audio .voice { padding-right: 34px; }
    /* The words the phone heard, so the note is readable before it is posted. */
    .voice__text { margin: 5px 0 0; font-size: 12.5px; line-height: 1.4; color: var(--fb-muted); }
    .remove-media { position: absolute; right: 4px; top: 4px; display: grid; place-items: center; width: 23px; height: 23px; border: 0; border-radius: 50%; background: rgba(0,0,0,.68); color: #fff; cursor: pointer; }
    /* Wrap the buttons, then let the limit text take a line of its own rather
       than being squeezed into a vertical column beside them. */
    .attachment-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 6px 0;
      border-top: 1px solid var(--lf-line-soft); border-bottom: 1px solid var(--lf-line-soft); }
    .attachment-button { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 9px; border: 0; border-radius: 6px; background: transparent; color: var(--fb-muted); font-size: 14px; font-weight: 600; cursor: pointer; }
    .attachment-button:first-child lf-icon { color: #45bd62; }
    .attachment-button:nth-child(2) lf-icon { color: #9360d8; }
    .attachment-button:disabled { opacity: .4; cursor: default; }
    .attachment-hint { flex: 1 1 100%; color: var(--fb-muted); font-size: 12px; line-height: 1.3; }
    /*
     * The recording bar, after WhatsApp: a red dot, the clock, a moving
     * equaliser, and the two things a thumb can do next. It takes the whole
     * width because it is the only thing happening on the screen at that moment.
     */
    .recbar { display: flex; align-items: center; gap: 9px; width: 100%; padding: 10px 12px;
      border-radius: 999px; margin-bottom: 8px; color: #fff;
      background: color-mix(in srgb, var(--lf-signal-text) 92%, #000);
      animation: recbar-in .18s ease-out both; }
    .recbar__time { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .recbar__wave { flex: 1 1 auto; height: 20px; min-width: 40px; }
    .recbar__wave rect { fill: rgb(255 255 255 / .75); animation: wave 1s ease-in-out infinite; }
    .recbar__wave rect:nth-child(3n) { animation-delay: .12s; }
    .recbar__wave rect:nth-child(3n+1) { animation-delay: .24s; }
    .recbar__wave rect:nth-child(4n) { animation-delay: .36s; }
    .recbar__hint { display: inline-flex; align-items: center; gap: 2px; font-size: 11.5px; font-weight: 600;
      white-space: nowrap; opacity: .9; }
    .recbar__hint--up { opacity: .75; }
    .recbar__btn { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%; border: 0; display: grid;
      place-items: center; cursor: pointer; }
    .recbar__btn--go { background: #fff; color: var(--lf-signal-text); }
    .recbar__btn--no { background: rgb(255 255 255 / .18); color: #fff; }
    .recbar--locked { background: color-mix(in srgb, var(--lf-ubuntu) 92%, #000); }
    @keyframes recbar-in { from { transform: translateY(6px); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes wave { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
    /* The hold target: a wide, forgiving area - a thumb on a moving taxi is not precise. */
    .voice-hold { touch-action: none; user-select: none; -webkit-user-select: none; }
    .voice-hold.armed { background: color-mix(in srgb, var(--lf-signal-text) 14%, transparent); color: var(--lf-signal-text); }
    @media (prefers-reduced-motion: reduce) {
      .recbar, .recbar__wave rect { animation: none; }
      .recbar__wave rect { opacity: .8; }
    }
    /* The recording strip: visible, time-stamped, and cancellable. */
    .voicerec { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 9px 11px; border-radius: 9px;
      margin-bottom: 6px; font-size: 13px; line-height: 1.3; }
    .voicerec.on { background: color-mix(in srgb, var(--lf-signal-text) 10%, transparent); color: var(--lf-signal-text); }
    .voicerec.error { background: var(--lf-card-2); color: var(--ion-text-color); }
    .voicerec strong { font-weight: 700; font-variant-numeric: tabular-nums; }
    .voicerec .lf-small { flex: 1 1 160px; color: var(--lf-muted); }
    .voicerec__cancel { border: 0; background: none; padding: 0; font: inherit; font-weight: 700;
      color: var(--lf-link); cursor: pointer; text-decoration: underline; }
    /* The words being heard, under the bar, with the sentence that says who hears them. */
    .recbar__heard { margin: 0 0 8px; padding: 8px 12px; border-radius: 10px; background: var(--fb-soft);
      font-size: 12.5px; line-height: 1.35; color: var(--ion-text-color); }
    .recbar__heard-words { display: block; font-weight: 550; }
    .recbar__heard small { display: block; margin-top: 3px; color: var(--fb-muted); font-size: 11.5px; }
    .voice { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; }
    .voice__label { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 650; color: var(--lf-muted); }
    .voice audio { width: 100%; max-width: 100%; }
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
    .error-message { display: flex; align-items: center; gap: 6px; padding: 9px 10px; margin: 12px 0 0; border-radius: 6px; background: color-mix(in srgb, var(--lf-signal) 12%, transparent); color: var(--lf-signal-text); font-size: 14px; }
    .notice-message { display: flex; align-items: center; gap: 6px; padding: 9px 10px; margin: 12px 0 0; border-radius: 6px; background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); font-size: 14px; }
    .field-error { margin: 1px 0 0; color: var(--lf-signal-text); font-size: 13px; font-weight: 600; }
    .field.invalid input, .field.invalid select, .field.invalid textarea,
    .body-input.field-error { border-color: var(--lf-signal-text); box-shadow: 0 0 0 2px color-mix(in srgb, var(--lf-signal) 18%, transparent); }
    .draft-note { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; padding: 9px 11px; border-radius: 6px; background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); font-size: 13.5px; }
    .draft-note button { margin-left: auto; border: 0; background: transparent; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
    .missing { margin: 12px 0 0; padding: 11px 13px; border-radius: 8px; background: color-mix(in srgb, var(--lf-signal) 9%, transparent); color: var(--fb-text); }
    .missing strong { display: flex; align-items: center; gap: 6px; color: var(--lf-signal-text); font-size: 14px; }
    .missing ul { margin: 7px 0 0; padding-left: 20px; }
    .missing li { font-size: 14px; line-height: 1.45; color: var(--fb-muted); }
    /* A stuck upload is not a refused post: one strip, two ways on, no red wall. */
    .media-failure { display: grid; gap: 8px; margin: 12px 0 0; padding: 11px 13px; border-radius: 8px;
      background: var(--lf-card-2); color: var(--fb-text); font-size: 14px; }
    .media-failure p { margin: 0; display: flex; align-items: flex-start; gap: 8px; line-height: 1.45; }
    .media-failure lf-icon { flex: none; color: var(--lf-muted); margin-top: 2px; }
    .media-failure__acts { display: flex; gap: 8px; flex-wrap: wrap; }
    .media-failure__acts button { border: 1px solid var(--lf-link); background: var(--lf-link); color: #fff; font: inherit;
      font-size: 13px; font-weight: 600; padding: 7px 12px; border-radius: 999px; cursor: pointer; }
    .media-failure__acts button.quiet { background: transparent; color: var(--lf-link); }
    .fb-create-header { background: var(--lf-card); }
    .consent { display: flex; gap: 10px; align-items: flex-start; margin: 14px 0 0; padding: 11px 12px; border-radius: 8px;
      background: var(--lf-card); border: 1px solid var(--fb-line); font-size: 13.5px; line-height: 1.4; }
    .consent input { margin-top: 2px; width: 17px; height: 17px; flex-shrink: 0; }
    .footnote { margin: 14px 0 0; color: var(--fb-muted); font-size: 12px; line-height: 1.4; }
    .generate-button { color: var(--lf-primary); }
    .generated-selection, .generator-stale { display: flex; align-items: center; gap: 8px; margin: 3px 0 0; color: var(--lf-primary-soft-text); font-size: 13px; }
    .generated-selection button { margin-left: auto; border: 0; background: transparent; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
    .generator { width: min(100%, 640px); margin: 0 auto; padding: 16px 14px calc(28px + var(--lf-safe-bottom)); }
    .generator__intro { margin: 0 auto 12px; max-width: 460px; text-align: center; }
    .generator__intro strong { font-size: 17px; }
    .generator__intro p { margin: 5px 0 0; color: var(--fb-muted); font-size: 13px; line-height: 1.4; }
    .generated-stage { position: relative; width: min(88%, 420px); margin: 0 auto; overflow: hidden; border-radius: 14px; aspect-ratio: 1080 / 1350; background: #101116; box-shadow: 0 12px 34px rgba(0,0,0,.28); }
    .generated-stage canvas { display: block; width: 100%; height: 100%; }
    .generated-stage__busy { position: absolute; inset: 0; display: grid; place-items: center; background: #0008; color: #fff; font-weight: 700; }
    .preview-choice { display: flex; width: fit-content; gap: 3px; padding: 3px; margin: 9px auto 0; border: 1px solid var(--fb-line); border-radius: 22px; background: var(--lf-card); }
    .preview-choice button { min-height: 32px; padding: 0 14px; border: 0; border-radius: 18px; background: transparent; color: var(--fb-muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .preview-choice button.active { background: var(--lf-primary-fill); color: #fff; }
    .image-state { margin: 8px 0 0; text-align: center; color: var(--fb-muted); font-size: 12px; }
    .template-picker { display: flex; gap: 9px; overflow-x: auto; padding: 14px 2px 8px; scroll-snap-type: x proximity; scrollbar-width: none; }
    .template-picker::-webkit-scrollbar { display: none; }
    .template-choice { flex: 0 0 126px; scroll-snap-align: start; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 7px; border: 2px solid var(--fb-line); border-radius: 12px; background: var(--lf-card); color: var(--fb-text); text-align: left; cursor: pointer; }
    .template-choice.on { border-color: var(--lf-primary); background: var(--lf-primary-soft); }
    .template-choice:disabled { opacity: .65; cursor: wait; }
    .template-swatch { width: 100%; height: 56px; border-radius: 7px; }
    .template-choice strong { font-size: 13px; }
    .template-choice small { color: var(--fb-muted); font-size: 11px; line-height: 1.2; }
    .generator__actions { display: flex; flex-direction: column; gap: 7px; max-width: 420px; margin: 8px auto 0; }
    .use-design { min-height: 44px; border: 0; border-radius: 22px; background: var(--lf-primary-fill); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
    .use-design:disabled { opacity: .5; cursor: default; }
    .cancel-design { min-height: 38px; border: 0; background: transparent; color: var(--fb-muted); font: inherit; font-weight: 600; cursor: pointer; }
    @media (max-width: 370px) { .composer { padding-inline: 10px; } .category-grid { gap: 5px; } .category { padding-inline: 7px; font-size: 13px; } .location-grid, .fields-two { grid-template-columns: 1fr; } }
  `]
})
export class CreatePostComponent implements OnInit, OnDestroy {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private media = inject(MediaService);
  private router = inject(Router);
  private backStack = inject(BackStackService);
  private route = inject(ActivatedRoute);
  private toaster = inject(ToastController);
  private platform = inject(PlatformService);

  protected readonly provinces = PROVINCES;
  protected readonly categories = CATEGORIES;
  protected readonly posterTemplates = POSTER_TEMPLATES;
  protected readonly moreOpen = signal(false);

  /**
   * Whether the "add details" panel applies to this post.
   *
   * A missing person, a Home Sweet Home case or a pet gets person/pet fields; a
   * sighting gets its own. A plain update has none of them, so the panel is not
   * offered at all rather than opening onto nothing.
   */
  /* ------------------------ voice notes ------------------------ */

  protected readonly recorder = inject(VoiceRecorderService);

  readonly hasVoiceNote = computed(() => this.f().media.some((item) => item.kind === 'audio'));

  /** "0:42" - the length on the tile, so a note is not a mystery box. */
  voiceLength(item: { durationSec?: number }): string {
    const total = Math.max(0, Math.round(item.durationSec ?? 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  /* ------------------- the hold-to-record gesture ------------------- */

  /**
   * Where the thumb first touched down. Everything is measured from here, the
   * way WhatsApp measures: the gesture is relative, not absolute, so it behaves
   * the same wherever the button happens to sit on the screen.
   */
  private gesture: { startX: number; startY: number; pointerId: number } | null = null;
  /** True once the thumb has slid far enough left that letting go would cancel. */
  private willCancel = false;
  /** Set when a recording was thrown away, so a late-arriving note is not attached. */
  private voiceCancelled = false;

  /** Slide further than this to the left and the recording is thrown away. */
  private static readonly CANCEL_PX = 70;
  /** Slide up further than this and the recording locks. */
  private static readonly LOCK_PX = 60;

  /** The little equaliser in the recording bar. Heights in the 0..24 viewBox. */
  protected readonly waveBars = [6, 13, 20, 9, 16, 22, 11, 18, 7, 15, 21, 10, 17, 8, 14, 19, 6, 12, 16, 9];

  /**
   * Finger down: start recording immediately.
   *
   * Recording begins on touch-down rather than on release so the first word is
   * not lost - the commonest complaint about every hold-to-talk button ever
   * built. The permission prompt is the only thing that can delay it, and when
   * that happens the bar shows "starting" instead of a running clock.
   */
  voiceDown(event: PointerEvent): void {
    if (this.busy() || this.hasVideo() || !this.recorder.available) return;
    event.preventDefault();
    /*
     * Capture the pointer for the whole gesture. The recording bar appears
     * under the thumb and pushes the buttons down, so without capture the
     * release would land on the bar and the recording would run forever -
     * a start with no finish. Capture makes every move and the release come
     * back to this button, wherever the layout moves to.
     */
    try {
      (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    } catch {
      // A synthetic or already-released pointer: the gesture still works.
    }
    this.gesture = { startX: event.clientX, startY: event.clientY, pointerId: event.pointerId };
    this.willCancel = false;
    // A fresh gesture clears any leftover cancel flag from the last one, so one
    // thrown-away recording can never poison the next.
    this.voiceCancelled = false;
    // Holding is a deliberate, physical act - the phone should say so.
    void this.platform.haptic('light');
    if (this.recorder.recording()) return;
    /*
     * Deliberately not awaited. `record()` stays pending for the whole
     * recording, so awaiting it here would leave this handler hanging and the
     * gesture list half-bound. It is started, and the note is collected when it
     * arrives - or not at all, if the person slides left.
     */
    this.pendingNote = this.recorder.record();
    void this.pendingNote.then((note) => this.collectVoiceNote(note));
  }

  /** The in-flight recording, so a cancel can throw away what it eventually returns. */
  private pendingNote: Promise<MediaItem | null> | null = null;

  /**
   * Finger moving: decide whether this is a cancel (left) or a lock (up).
   *
   * Only the axis that moved furthest counts, so a diagonal slide cannot both
   * cancel and lock. The threshold is crossed once and remembered, so a thumb
   * that drifts back does not silently revive a cancelled recording - the
   * action is stated in the bar instead.
   */
  voiceMove(event: PointerEvent): void {
    const g = this.gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal: sliding left throws it away, sliding back restores it.
      const wasCancel = this.willCancel;
      this.willCancel = dx < -CreatePostComponent.CANCEL_PX;
      if (this.willCancel !== wasCancel) void this.platform.haptic('light');
      return;
    }

    // Upwards: lock, so the finger can come off and the person can talk.
    if (dy < -CreatePostComponent.LOCK_PX && !this.recorder.locked() && this.recorder.recording()) {
      this.recorder.locked.set(true);
      this.willCancel = false;
      void this.platform.haptic('medium');
    }
  }

  /**
   * Finger up: finish.
   *
   * Three outcomes, in the order the person expects: a cancel if they slid left,
   * nothing if the recording was locked (it keeps running), and otherwise stop
   * and attach.
   */
  voiceUp(event: PointerEvent): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g || event.pointerId !== g.pointerId) return;

    if (this.willCancel) {
      this.willCancel = false;
      this.voiceCancelled = true;
      this.recorder.cancel();
      void this.platform.haptic('heavy');
      return;
    }
    // Locked: the finger leaving is the point. Keep recording.
    if (this.recorder.locked()) return;
    if (this.recorder.recording()) this.recorder.stop();
  }

  /** The browser took the pointer away (a call, a system gesture). Stop cleanly. */
  voiceCancelGesture(): void {
    if (!this.gesture) return;
    this.gesture = null;
    this.willCancel = false;
    if (this.recorder.recording() && !this.recorder.locked()) this.recorder.stop();
  }

  /** A tap, a keyboard press, or a screen reader: record without holding anything. */
  startVoiceHandsFree(): void {
    if (this.recorder.recording() || this.hasVideo()) return;
    this.voiceCancelled = false;
    this.pendingNote = this.recorder.record();
    void this.pendingNote.then((note) => this.collectVoiceNote(note));
  }

  stopVoiceNote(): void {
    this.recorder.stop();
  }

  cancelVoiceNote(): void {
    this.voiceCancelled = true;
    this.recorder.cancel();
  }

  /**
   * Attach the note once it lands.
   *
   * One voice note per post, and it replaces any previous one: a case should not
   * carry a pile of half-recordings. A null result is a cancelled or failed
   * recording, and nothing is attached.
   */
  private async collectVoiceNote(note: Awaited<ReturnType<VoiceRecorderService['record']>>): Promise<void> {
    /*
     * The flag is read and cleared once, whatever arrives: a cancelled
     * recording resolves to null, so clearing it only in the non-null branch
     * would leave the flag set and swallow the person's next note.
     */
    const cancelled = this.voiceCancelled;
    this.voiceCancelled = false;
    if (!note || cancelled) return;
    this.f.update((form) => ({
      ...form,
      media: [...form.media.filter((item) => item.kind !== 'audio'), note]
    }));
    void this.platform.haptic('light');
  }

  protected readonly canAddDetails = computed(() => {
    const t = this.type();
    return t === 'missing' || t === 'khumbulekhaya' || t === 'announcement' || t === 'sighting';
  });

  /* ------------------------- dictation ------------------------- */

  protected readonly dictation = inject(DictationService);

  /**
   * Speak into the prompt box.
   *
   * Dictation writes into the same textarea the person would type in - it is
   * not a separate voice post. That means the text is visible, correctable and
   * published exactly like typed words, and the prompts stay the structure of
   * the post rather than being replaced by free speech.
   */
  toggleDictation(): void {
    this.dictation.toggle({
      existing: this.f().body,
      apply: (text) => this.patch({ body: text })
    });
  }

  /** Leaving the screen must not leave the microphone open. */
  ngOnDestroy(): void {
    if (this.dictation.listening()) this.dictation.stop();
  }
  private generatedCanvas: HTMLCanvasElement | null = null;
  private generatedImage: HTMLImageElement | null = null;

  @ViewChild('generatedCanvas')
  set canvasElement(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.generatedCanvas = ref?.nativeElement ?? null;
    if (this.generatedCanvas) setTimeout(() => void this.renderGenerated(), 0);
  }

  type = signal<PostType | null>(null);
  editing = signal(false);
  busy = signal(false);
  posterMode = signal(false);
  posterBusy = signal(false);
  selectedTemplate = signal<PosterTemplateId>('signal');
  previewWithImage = signal(true);
  posterTemplate = signal<PosterTemplateId | null>(null);
  posterStale = signal(false);
  error = signal('');
  /** Not an error: a plain fact, e.g. this build has no camera module. */
  notice = signal('');
  postId: string | null = null;

  /**
   * The whole composer lives in signals. The app runs zoneless, so a plain
   * field object mutated from an `(input)` handler never re-renders the Post
   * button - the button stayed grey with every field filled in. Signals make
   * every binding, and the validation below, update the moment something is
   * typed.
   */
  readonly f = signal<ComposerForm>(blankForm());
  readonly s = signal(blankSubject());
  readonly khumbuReason = signal('');

  readonly templateValues = computed(() => parseTemplate(this.f().body));
  readonly firstImage = computed(() => this.f().media.find((item) => item.kind === 'image')?.src ?? null);
  readonly canGenerate = computed(() => this.type() !== null && isPosterType(this.type()!));
  readonly userAvatar = computed(() => this.data.avatarFor(this.auth.user()));
  readonly userName = computed(() => this.auth.user()?.displayName ?? 'You');
  readonly mySpotlights = computed(() => this.data.mySpotlights());

  patch(p: Partial<ComposerForm>): void {
    if (p.body !== undefined && p.body !== this.f().body) this.invalidateGenerated();
    this.f.update((f) => ({ ...f, ...p }));
    if (this.error()) this.error.set('');
    if (this.mediaFailure() && p.body !== undefined) this.mediaFailure.set('');
    this.persistDraft();
  }

  private invalidateGenerated(): void {
    if (!this.posterTemplate()) return;
    this.posterTemplate.set(null);
    this.posterStale.set(true);
  }

  selectedTemplateName(): string {
    return this.posterTemplates.find((template) => template.id === this.selectedTemplate())?.name ?? 'selected';
  }

  patchSubject(p: Partial<ReturnType<typeof blankSubject>>): void {
    this.s.update((s) => ({ ...s, ...p }));
    this.persistDraft();
  }

  setKhumbu(value: string): void {
    this.khumbuReason.set(value);
    this.persistDraft();
  }

  /* ------------------------------------------------------------------ *
   * Finish later.
   *
   * A long case takes minutes to write, and a phone call interrupts it. The
   * composer keeps what was typed (text fields - photos are device-local and
   * cannot come back), and says so when the screen is opened again, with one
   * tap to start fresh instead. Nothing is silently kept and nothing is
   * silently lost.
   * ------------------------------------------------------------------ */

  /** Set when the post is published, so a finished composer stops saving. */
  private draftClosed = false;
  /** The composer put back something typed earlier. */
  readonly draftKept = signal(false);
  private static readonly DRAFT_KEY = 'lulafind.composer.draft';

  private persistDraft(): void {
    if (this.editing() || this.draftClosed) return;
    const f = this.f();
    const s = this.s();
    const empty = !this.type() && !f.body.trim() && !f.title.trim() && !f.town.trim()
      && !f.lastSeenWhere.trim() && !s.name.trim() && !this.khumbuReason().trim();
    try {
      if (empty) { localStorage.removeItem(CreatePostComponent.DRAFT_KEY); return; }
      localStorage.setItem(CreatePostComponent.DRAFT_KEY, JSON.stringify({
        type: this.type(), f: { ...f, media: [] }, s, khumbu: this.khumbuReason(), at: Date.now()
      }));
    } catch { /* storage blocked (private mode) - then nothing is kept, and nothing pretends to be */ }
  }

  private restoreDraft(): void {
    let raw: string | null = null;
    try { raw = localStorage.getItem(CreatePostComponent.DRAFT_KEY); } catch { return; }
    if (!raw) return;
    try {
      const d = JSON.parse(raw) as {
        type?: PostType | null; f?: Partial<ComposerForm>;
        s?: Partial<ReturnType<typeof blankSubject>>; khumbu?: string;
      };
      const hasStory = !!d.f?.body?.trim() || !!d.f?.title?.trim();
      if (!hasStory) { localStorage.removeItem(CreatePostComponent.DRAFT_KEY); return; }
      if (d.type) this.type.set(d.type);
      if (d.f) this.f.update((f) => ({ ...f, ...d.f, media: [] }));
      if (d.s) this.s.update((s) => ({ ...s, ...d.s }));
      if (d.khumbu) this.khumbuReason.set(d.khumbu);
      this.showFieldErrors.set(false);
      this.draftKept.set(true);
    } catch {
      try { localStorage.removeItem(CreatePostComponent.DRAFT_KEY); } catch { /* ignore */ }
    }
  }

  /** Throw the kept draft away and start with a blank composer. */
  discardDraft(): void {
    try { localStorage.removeItem(CreatePostComponent.DRAFT_KEY); } catch { /* ignore */ }
    this.draftKept.set(false);
    this.type.set(null);
    this.f.set(blankForm());
    this.s.set(blankSubject());
    this.khumbuReason.set('');
    this.error.set('');
    this.posterTemplate.set(null);
    this.posterStale.set(false);
    this.showFieldErrors.set(false);
  }

  private clearDraft(): void {
    this.draftClosed = true;
    try { localStorage.removeItem(CreatePostComponent.DRAFT_KEY); } catch { /* ignore */ }
  }

  /**
   * Everything still missing before this post can be shared, in the order the
   * person will meet it. Empty means the Post button is live.
   *
   * A photo is a post. LinkedIn asks for nothing, and here a picture of the
   * person or the street is often the whole message, so text and location become
   * optional the moment something is attached - the province then comes from the
   * profile, which is what the case alerts need. What stays required is only what
   * the law needs (guardian permission for a child) and what the audience needs
   * (which community a surname-only post belongs to).
   */
  readonly missing = computed<MissingField[]>(() => {
    const f = this.f();
    const out: MissingField[] = [];
    const type = this.type();
    if (!type) out.push({ key: 'type', label: 'Choose what you are posting' });
    const attached = f.media.length > 0;
    if (this.editing()) {
      if (!f.body.trim() && !attached) out.push({ key: 'body', label: 'Write what happened, or attach a photo' });
      if (!f.province && !this.profileProvince()) out.push({ key: 'province', label: 'Choose the province' });
    } else if (type) {
      const values = this.templateValues();
      if (!attached && values.happened.trim().length < 30) {
        out.push({ key: 'body', label: 'Add a photo, or at least 30 characters about what happened' });
      }
      if (!attached && (!values.town || !values.province) && !this.profileProvince()) {
        out.push({ key: 'location', label: 'Complete the location line with a town and province' });
      }
      if (this.childCase() && !f.guardianConsent) out.push({ key: 'consent', label: 'Confirm guardian permission for this child’s case' });
    }
    if (f.audience === 'surname' && !f.spotlightId) out.push({ key: 'spotlightId', label: 'Choose a Spotlight community' });
    return out;
  });

  /** The province on the account, used when a photo-only post names no place. */
  protected profileProvince(): ProvinceCode | null {
    return this.auth.user()?.province ?? null;
  }

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
    /*
     * The address bar reads `home-sweet-home`, the name people know. The stored
     * post type keeps its original key, so old links (`/create/khumbulekhaya`)
     * and saved drafts still open the same composer.
     */
    const routeType = this.route.snapshot.paramMap.get('type');
    const wanted = routeType === 'home-sweet-home' ? 'khumbulekhaya' : routeType;
    if (wanted && CATEGORIES.some((category) => category.key === wanted)) this.setType(wanted as PostType);

    const editId = this.route.snapshot.paramMap.get('id');
    const historyState = typeof window !== 'undefined' && window.history.state && typeof window.history.state === 'object'
      ? window.history.state as Record<string, unknown>
      : {};
    const photoAttachment = historyState['photoAttachment'] as MediaItem | undefined;
    const mediaNotice = historyState['mediaNotice'];
    if (typeof mediaNotice === 'string') this.notice.set(mediaNotice);
    if ('photoAttachment' in historyState || 'mediaNotice' in historyState) {
      const consumedState = { ...historyState };
      delete consumedState['photoAttachment'];
      delete consumedState['mediaNotice'];
      window.history.replaceState(consumedState, document.title, window.location.href);
    }

    if (!editId) {
      this.restoreDraft();
      // "Start a post" on a Spotlight page arrives with the community already chosen,
      // so the writer never has to find the audience picker afterwards.
      const fromSpotlight = this.route.snapshot.queryParamMap.get('spotlight');
      if (fromSpotlight && this.data.isMember(fromSpotlight)) {
        this.f.update((form) => ({ ...form, audience: 'surname', spotlightId: fromSpotlight }));
      } else if (fromSpotlight) {
        this.error.set('Join that community before you can post to it.');
      }
      if (photoAttachment?.kind === 'image' && photoAttachment.src) {
        const existingMedia = this.f().media;
        if (!existingMedia.some((item) => item.id === photoAttachment.id)) {
          if (existingMedia.length >= POST_MAX_PHOTOS || existingMedia.some((item) => item.kind === 'video')) {
            this.error.set(`This draft already has a video or its ${POST_MAX_PHOTOS} photos. Remove one before adding this photo.`);
          } else {
            this.invalidateGenerated();
            this.f.update((form) => ({ ...form, media: [...form.media, photoAttachment] }));
          }
        }
      }
    }
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
      if (post.khumbu) this.khumbuReason.set(post.khumbu.reasonGuess);
      this.moreOpen.set(true);
    }
  }

  setType(type: PostType): void {
    if (this.editing()) return;
    const previousType = this.type();
    const previousTemplate = previousType ? templateForType(previousType) : '';
    const currentBody = this.f().body;
    const body = !currentBody.trim() || currentBody === previousTemplate ? templateForType(type) : currentBody;
    this.invalidateGenerated();
    this.type.set(type);
    this.posterStale.set(false);
    this.moreOpen.set(false);
    this.s.set(blankSubject());
    this.f.update((f) => ({
      ...f, body, caseNumber: '', lastSeenAt: '', lastSeenWhere: '',
      askWanted: type === 'khumbulekhaya'
    }));
    this.khumbuReason.set('');
    this.error.set('');
    this.showFieldErrors.set(false);
    this.persistDraft();
  }

  private publicBody(): string {
    const values = this.templateValues();
    return [
      values.happened,
      values.clothing ? `Clothing / identifying details: ${values.clothing}` : '',
      values.familyNote ? `What the family wants them to know: ${values.familyNote}` : ''
    ].filter((part) => part.trim()).join('\n\n').trim();
  }

  /**
   * The subject, from the prompts *and* the optional panel.
   *
   * The panel is open while a case is being created, so what it collects has to
   * reach the post. It used to be ignored on a new post - whatever a person
   * typed into "clothing" there was silently dropped, and only the line inside
   * the prompt text survived. The panel wins where it has a value (it is the
   * more explicit input), and the prompt fills the gaps.
   */
  private subjectFromTemplate(): Post['subject'] {
    const type = this.type();
    const values = this.templateValues();
    const fields = this.s();
    const orTemplate = (panel: string, template: string): string => (panel ?? '').trim() || (template ?? '').trim();
    if (!type || !isPosterType(type)) {
      const sightingName = orTemplate(fields.name, values.name);
      const sightingClothing = orTemplate(fields.clothing, values.clothing);
      return type === 'sighting' && (sightingName || sightingClothing) ? {
        name: sightingName, age: null, gender: 'unknown', height: '', build: '', skinTone: '', hair: '', eyes: '',
        clothing: sightingClothing, distinguishing: '', medical: '', vehicle: '', languages: '', surname: '', relationship: ''
      } : null;
    }
    const name = orTemplate(fields.name, values.name);
    const age = fields.age ? Number(fields.age) : values.age;
    const gender = (fields.gender && fields.gender !== 'unknown' ? fields.gender : values.gender);
    return {
      name, age, gender, height: '', build: '', skinTone: '', hair: fields.hair?.trim() || '', eyes: '',
      clothing: orTemplate(fields.clothing, values.clothing),
      distinguishing: orTemplate(fields.distinguishing, values.privateMark),
      medical: '', vehicle: '', languages: '',
      surname: name.split(/\s+/).at(-1) ?? '', relationship: ''
    };
  }

  private previewPost(): Post | null {
    const type = this.type();
    if (!type || !isPosterType(type)) return null;
    const values = this.templateValues();
    const subject = this.subjectFromTemplate();
    return {
      id: 'post-preview', type, status: 'active', danger: null,
      authorId: this.auth.viewerId ?? 'preview', anonymous: this.f().anonymous, askWanted: this.f().askWanted,
      title: this.generatedTitle(type, values.name), body: this.publicBody(), media: this.f().media, poster: null,
      province: (values.province ?? '') as ProvinceCode, town: values.town,
      lastSeenAt: values.when, lastSeenWhere: '', geo: null,
      contactLabel: 'Family contact', contactValue: values.contact, contactVisibleTo: this.f().contactVisibleTo,
      caseNumber: values.caseNumber || null, reward: null, subject,
      vehicleDetails: null, audience: this.f().audience, spotlightId: this.f().spotlightId,
      chatEnabled: this.f().chatEnabled, allowComments: this.f().allowComments, allowShare: true,
      upvotes: 0, commentCount: 0, shares: 0, views: 0, savedBy: 0, voterIds: {}, lastLike: null, lastComment: null,
      escalation: { requested: false, consentGranted: false, consentAt: null, partners: [] }, consent: [],
      sightingVerified: null, searchParty: null, locationCheck: {
        subjectRegisteredInApp: false, requestedBy: null, requestedAt: null, consentFromSubject: 'none', consentAt: null,
        points: [], deviceReachable: false, lastKnownAt: null, note: ''
      }, khumbu: null, outcome: { found: false, foundAt: null, whereaboutsFound: '', closedBy: null, note: '' },
      events: [], flags: [], outcomeNudgeAt: null, createdAt: Date.now(), updatedAt: Date.now()
    } as unknown as Post;
  }

  async openGenerator(): Promise<void> {
    if (!this.canGenerate()) return;
    this.error.set('');
    this.posterMode.set(true);
    this.selectedTemplate.set(this.posterTemplate() ?? this.selectedTemplate());
    this.previewWithImage.set(true);
    this.posterBusy.set(true);
    this.generatedImage = await loadPosterImage(this.firstImage());
    this.posterBusy.set(false);
    await this.renderGenerated();
  }

  private async renderGenerated(): Promise<void> {
    const canvas = this.generatedCanvas;
    const post = this.previewPost();
    if (!canvas || !post || !this.posterMode() || this.posterBusy()) return;
    this.posterBusy.set(true);
    try {
      const imageSrc = this.previewWithImage() ? this.firstImage() : null;
      const content = posterContent(post, this.platform.baseUrl, imageSrc);
      drawPoster(canvas, this.selectedTemplate(), content, this.previewWithImage() ? this.generatedImage : null);
    } finally {
      this.posterBusy.set(false);
    }
  }

  async setPreviewPhoto(include: boolean): Promise<void> {
    if (this.posterBusy()) return;
    this.previewWithImage.set(include);
    await this.renderGenerated();
  }

  async chooseTemplate(id: PosterTemplateId): Promise<void> {
    if (this.posterBusy()) return;
    this.selectedTemplate.set(id);
    await this.renderGenerated();
  }

  useGeneratedDesign(): void {
    if (this.posterBusy() || !this.generatedCanvas) return;
    this.posterTemplate.set(this.selectedTemplate());
    this.posterStale.set(false);
    this.posterMode.set(false);
  }

  closeGenerator(): void { this.posterMode.set(false); }

  clearGeneratedDesign(): void {
    this.posterTemplate.set(null);
    this.posterStale.set(false);
  }

  private async attachGeneratedPoster(post: Post, templateId: PosterTemplateId, photoSrc: string | null): Promise<void> {
    const canvas = document.createElement('canvas');
    const src = photoSrc;
    const image = await loadPosterImage(src);
    if (src && !image) throw new Error('The photo could not be opened for the generated image');
    const content = posterContent(post, this.platform.link(`/post/${post.id}`), src);
    drawPoster(canvas, templateId, content, image);
    // Exported within the photo rule: a 1080x1350 PNG with a photo in it is
    // routinely larger than 2 MB, and would be refused at upload.
    const blob = await this.media.exportCanvas(canvas);
    if (!blob) throw new Error('The generated image could not be exported');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Could not read the generated image'));
      reader.readAsDataURL(blob);
    });
    const poster: PostPoster = {
      templateId, createdAt: Date.now(),
      media: { id: uid('poster'), kind: 'image', src: dataUrl }
    };
    await this.data.updatePost(post.id, { poster });
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

  /** The same words the feed card uses for the same three choices. */
  audienceTitle(): string {
    const audience = this.f().audience;
    return audience === 'public' ? 'Visible to anyone' : audience === 'followers' ? 'Visible to followers' : 'Visible in a Spotlight community';
  }

  categoryLabel(): string {
    return this.categories.find((category) => category.key === this.type())?.label ?? 'Post';
  }

  bodyPlaceholder(): string {
    switch (this.type()) {
      case 'missing': return 'Share the important details. Where were they last seen? What might help someone recognise them?';
      case 'khumbulekhaya': return 'Tell the family what they need to know. Keep in mind they may not want to return home.';
      case 'announcement': return 'Say what you lost or found, where, and how people can help. Your own words are the whole point.';
      case 'sighting': return 'Share only what you personally saw, when and where. Avoid guesses or naming suspects.';
      default: return 'Write a short update for your community…';
    }
  }

  detailsLabel(): string {
    switch (this.type()) {
      case 'missing': return 'Add person and case details';
      case 'khumbulekhaya': return 'Add family context';
      case 'announcement': return 'Add the details';
      case 'sighting': return 'Add sighting details';
      default: return 'Add more details';
    }
  }

  hasVideo(): boolean { return this.f().media.some((item) => item.kind === 'video'); }

  /** The attachment rules, so the hint cannot drift from what is enforced. */
  readonly maxPhotos = POST_MAX_PHOTOS;
  readonly photoMb = mb(PHOTO_MAX_BYTES);
  readonly videoMb = mb(VIDEO_MAX_BYTES);
  readonly voiceMb = mb(AUDIO_MAX_BYTES);

  /** A case about someone under 18: the poster must confirm they may publish it. */
  childCase(): boolean {
    const type = this.type();
    if (type !== 'missing' && type !== 'khumbulekhaya') return false;
    const age = this.editing() ? (this.s().age === '' ? null : Number(this.s().age)) : this.templateValues().age;
    return age !== null && Number.isFinite(age) && age >= 0 && age < 18;
  }

  async addPhoto(): Promise<void> {
    const f = this.f();
    if (f.media.length >= POST_MAX_PHOTOS || this.hasVideo()) return;
    const item = await this.media.pickImage({ quality: 76 });
    if (this.media.notice()) this.notice.set(this.media.notice()!);
    if (!item) {
      if (this.media.lastError()) this.error.set(this.media.lastError()!);
      return;
    }
    const src = await this.media.compress(item.src, 1200);
    this.mediaFailure.set('');
    this.invalidateGenerated();
    this.f.update((current) => ({ ...current, media: [...current.media, { ...item, src }] }));
  }

  async addVideo(): Promise<void> {
    if (this.f().media.length) return;
    const item = await this.media.pickVideo();
    if (this.media.notice()) this.notice.set(this.media.notice()!);
    if (!item) {
      if (this.media.lastError()) this.error.set(this.media.lastError()!);
      return;
    }
    this.invalidateGenerated();
    this.f.update((current) => ({ ...current, media: [item] }));
  }

  removeMedia(id: string): void {
    this.mediaFailure.set('');
    this.invalidateGenerated();
    this.f.update((current) => ({ ...current, media: current.media.filter((item) => item.id !== id) }));
  }

  async submit(): Promise<void> {
    this.error.set('');
    const f = this.f();
    const s = this.s();
    const type = this.type();

    // The Post button always answers a tap, so an unfinished form explains
    // itself instead of sitting there looking broken.
    this.showFieldErrors.set(true);
    if (this.missing().length) {
      this.error.set(this.missing()[0].label + '.');
      this.scrollToError();
      return;
    }

    const values = this.templateValues();
    const timestamp = this.editing()
      ? (f.lastSeenAt ? new Date(f.lastSeenAt).getTime() : null)
      : values.when;
    const subject = this.editing() ? (() => {
      const personType = type === 'missing' || type === 'khumbulekhaya' || type === 'announcement';
      return personType ? {
        name: s.name.trim(), age: s.age ? Number(s.age) : null, gender: s.gender,
        height: s.height.trim(), build: '', skinTone: '', hair: s.hair.trim(), eyes: '',
        clothing: s.clothing.trim(), distinguishing: s.distinguishing.trim(), medical: '',
        vehicle: '', languages: '', surname: s.name.trim().split(/\s+/).at(-1) ?? '', relationship: ''
      } : (type === 'sighting' && (s.name || s.clothing) ? {
        name: s.name.trim(), age: null, gender: 'unknown' as const, height: '', build: '', skinTone: '', hair: '', eyes: '',
        clothing: s.clothing.trim(), distinguishing: '', medical: '', vehicle: '', languages: '', surname: '', relationship: ''
      } : null);
    })() : this.subjectFromTemplate();
    const body = this.editing() ? f.body : this.publicBody();
    // A post that names no place still needs a province for the case alerts, and
    // the account already knows it. Only when neither has one does the service
    // refuse - and it says so in the same words as the checklist above.
    const locationProvince = ((this.editing() ? f.province : values.province) ?? this.profileProvince()) as ProvinceCode;
    const town = (this.editing() ? f.town : values.town).trim();
    const lastSeenWhere = this.editing() ? (f.lastSeenWhere || f.town).trim() : '';
    const caseNumber = this.editing() ? (f.caseNumber || null) : (values.caseNumber.trim() || null);
    const contactValue = this.editing() ? f.contactValue : values.contact.trim();
    const title = this.editing()
      ? (f.title.trim() || this.generatedTitle(type!, subject?.name ?? ''))
      : this.generatedTitle(type!, values.name.trim());
    const khumbu = type === 'khumbulekhaya' ? {
      daysOut: timestamp ? Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000)) : null,
      leftHomeAt: timestamp,
      reasonGuess: this.khumbuReason().trim(), claimedByUserId: null, claimedAt: null,
      subjectResponse: 'none' as const, subjectNote: '', wantedAnswers: { yes: 0, no: 0, myVote: null }
    } : null;
    const generatedTemplate = !this.editing() ? this.posterTemplate() : null;

    let created: Post | null = null;
    let posterFailure = false;
    this.busy.set(true);
    try {
      if (this.editing() && this.postId) {
        await this.data.updatePost(this.postId, {
          title, body: f.body, media: f.media, province: locationProvince, town,
          lastSeenAt: timestamp, lastSeenWhere, caseNumber,
          subject, vehicleDetails: null, audience: f.audience, spotlightId: f.spotlightId,
          chatEnabled: f.chatEnabled, allowComments: f.allowComments, anonymous: f.anonymous,
          askWanted: f.askWanted, contactLabel: f.contactLabel, contactValue: f.contactValue,
          contactVisibleTo: f.contactVisibleTo, khumbu
        });
      } else {
        created = await this.data.createPost({
          type: type!, title, body, media: f.media, province: locationProvince, town,
          lastSeenAt: timestamp, lastSeenWhere, geo: null,
          contactLabel: f.contactLabel || 'Family contact', contactValue,
          contactVisibleTo: f.contactVisibleTo, caseNumber, reward: null,
          guardianConsent: f.guardianConsent,
          subject, vehicleDetails: null, audience: f.audience, spotlightId: f.spotlightId,
          chatEnabled: f.chatEnabled, allowComments: f.allowComments, anonymous: f.anonymous,
          askWanted: f.askWanted, khumbu,
          danger: null
        });
      }
      this.showFieldErrors.set(false);
      this.clearDraft();
      if (this.editing()) {
        await this.toastMsg('Post updated. It now shows as edited.');
        await this.router.navigate(['/post', this.postId]);
      } else if (created) {
        if (generatedTemplate) {
          try {
            await this.attachGeneratedPoster(created, generatedTemplate, this.firstImage());
          } catch (e) {
            posterFailure = true;
            console.error('Post was shared, but the generated design could not be attached.', e);
          }
        }
        if (posterFailure) {
          await this.toastMsg('Post shared, but its design could not be attached.');
          await this.router.navigate(['/post', created.id]);
        } else {
          await this.toastMsg(generatedTemplate ? 'Post shared with generated design.' : 'Post shared.');
          /*
           * The next step after publishing a case is not "back to the feed" -
           * it is the thing that actually puts it in front of people: the
           * printable poster, or an area alert if it is a sighting. LulaFind
           * only offers this when the case can carry a poster (a missing,
           * left-home or pet post), so a status update still goes home.
           */
          if (created && isPosterType(created.type)) {
            await this.router.navigate(['/post', created.id, 'poster'], { queryParams: { new: '1' } });
          } else {
            await this.router.navigate(['/home']);
          }
        }
      }
    } catch (e: any) {
      const message = e?.message ?? 'Could not share this post';
      if (e?.mediaFailed) {
        // The words are fine - only the attachment is stuck. Say which, and give
        // the way to post now without losing the photo from the composer.
        this.mediaFailure.set(message);
      } else {
        this.error.set(message);
      }
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * A photo that would not store. The photo stays in the composer, so the person
   * can pick another one or send the post without it - the case does not wait on
   * a upload.
   */
  readonly mediaFailure = signal('');

  /** Post without the attachment that would not upload. */
  async postWithoutPhoto(): Promise<void> {
    const dropped = this.f().media.length;
    this.f.update((f) => ({ ...f, media: [] }));
    this.mediaFailure.set('');
    this.notice.set(dropped === 1 ? 'The photo was left out of this post.' : 'The photos were left out of this post.');
    await this.submit();
  }

  /** Try the same upload again - usually after a connection came back. */
  async retryMedia(): Promise<void> {
    this.mediaFailure.set('');
    await this.submit();
  }

  /** Brings the first empty required field into view. */
  private scrollToError(): void {
    if (typeof document === 'undefined') return;
    const target = document.querySelector('[data-field="body"]')
      ?? document.querySelector('.post-fields');
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }

  private generatedTitle(type: PostType, name: string): string {
    const category = this.categories.find((item) => item.key === type)?.label ?? 'Post';
    if (name) return `${category}: ${name}`;
    const source = this.editing() ? this.f().body : this.templateValues().happened;
    const opening = source.trim().split(/[.!?\n]/)[0]?.trim() ?? '';
    return `${category}: ${opening.slice(0, 64) || 'Community update'}`;
  }

  private toLocalDateTime(timestamp: number | null): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }

  private async toastMsg(message: string): Promise<void> {
    const t = await this.toaster.create({ message, duration: 2400, position: 'bottom' });
    await t.present();
  }

  close(): void {
    // Editing a post and landing here cold: back to the post itself.
    const editId = this.route.snapshot.paramMap.get('id');
    this.backStack.go(editId ? `/post/${editId}` : '/home');
  }
}
