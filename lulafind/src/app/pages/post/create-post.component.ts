import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonInput } from '@ionic/angular/ion-input';
import { IonTextarea } from '@ionic/angular/ion-textarea';
import { IonItem } from '@ionic/angular/ion-item';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonSelect } from '@ionic/angular/ion-select';
import { IonSelectOption } from '@ionic/angular/ion-select-option';
import { IonToggle } from '@ionic/angular/ion-toggle';
import { IonDatetimeButton } from '@ionic/angular/ion-datetime-button';
import { IonDatetime } from '@ionic/angular/ion-datetime';
import { ToastController } from '@ionic/angular/toast-controller';
import { AlertController } from '@ionic/angular/alert-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { LocationService } from '../../core/services/location.service';
import { MediaService } from '../../core/services/media.service';
import { DANGER_KINDS, DangerAlert, DangerKind, PROVINCES, PostType, ProvinceCode, MediaItem, POST_TYPE_META, Post, dangerLabel } from '../../core/models/types';

const CATEGORIES: { key: PostType; label: string; hint: string }[] = [
  { key: 'missing', label: 'Missing person', hint: 'Someone is missing and you are looking for them.' },
  { key: 'khumbulekhaya', label: 'KhumbulEkhaya (left home)', hint: 'They left and have not come back. They can answer here.' },
  { key: 'sighting', label: 'Sighting', hint: 'You think you saw someone from a case.' },
  { key: 'vehicle', label: 'Hijacked or stolen vehicle', hint: 'Add the colour, make, and plate for the case. LulaFind cannot track it. Report it at a police station, and open Tracker, Netstar, or Cartrack if the car has one.' },
  { key: 'pet', label: 'Lost pet', hint: 'A dog, cat or other animal is missing.' },
  { key: 'danger', label: 'Danger nearby', hint: 'Warn people about violence or a dangerous place you just saw.' }
];

/**
 * The composer.
 *
 * Three screens, not five: pick a category and its fields appear, describe what
 * happened and where, then choose who can see it. Editing an existing post uses
 * the same screen.
 */
@Component({
  selector: 'lf-create-post',
  standalone: true,
  imports: [
    IonContent, IonHeader, IonToolbar, IonButtons, IonTitle, IonInput, IonTextarea, IonItem,
    IonLabel, IonSelect, IonSelectOption, IonToggle, IonDatetimeButton, IonDatetime, IconComponent
  ],
  template: `
    <ion-header translucent="true">
      <ion-toolbar>
        <ion-title>{{ editing() ? 'Edit post' : 'New post' }}</ion-title>
        <ion-buttons slot="end">
          <button class="lf-icon-btn" (click)="close()" aria-label="Close"><lf-icon name="x" [size]="22" /></button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="lf-page">
      <div class="wrap lf-fade-in">
        <!-- ---------- 1. what are you posting ---------- -->
        <section>
          <h1 class="lf-h1">{{ editing() ? 'What are you changing?' : 'What are you posting?' }}</h1>

          <ion-item [class.bad]="touched.type && !type()">
            <ion-label position="stacked">Category</ion-label>
            <ion-select [value]="type()" placeholder="Choose a category" (ionChange)="setType($any($event.detail).value)">
              @for (c of categories; track c.key) { <ion-select-option [value]="c.key">{{ c.label }}</ion-select-option> }
            </ion-select>
          </ion-item>
          @if (type()) { <p class="hint">{{ categoryHint() }}</p> }
        </section>

        @if (type() === 'danger') {
          <section>
            <p class="hint">If someone is hurting you, do not post it. They may see it. <button type="button" class="linkish" (click)="goHelp()">Get help</button></p>
            <h2 class="lf-h2">What did you see?</h2>
            <div class="kinds" role="group" aria-label="Kind of danger">
              @for (k of dangerKinds; track k.key) {
                <button type="button" class="kind" [class.on]="dangerKind() === k.key" (click)="pickDanger(k.key)">{{ k.label }}</button>
              }
            </div>
            @if (touched.type && !dangerKind()) { <p class="field-err">Choose what you saw</p> }

            <ion-item [class.bad]="touched.subject && !f.lastSeenWhere.trim()">
              <ion-label position="stacked">Place</ion-label>
              <ion-input [value]="f.lastSeenWhere" placeholder="e.g. Bree taxi rank, north entrance"
                         (ionInput)="f.lastSeenWhere = $any($event.target).value" (ionBlur)="touched.subject = true"></ion-input>
            </ion-item>
            @if (touched.subject && !f.lastSeenWhere.trim()) { <p class="field-err">Say the exact place</p> }

            <ion-item [class.bad]="touched.province && !f.province">
              <ion-label position="stacked">Province</ion-label>
              <ion-select placeholder="Choose a province" [value]="f.province"
                          (ionChange)="f.province = $any($event.detail).value">
                <ion-select-option [value]="null">Choose a province</ion-select-option>
                @for (p of provinces; track p.code) { <ion-select-option [value]="p.code">{{ p.name }}</ion-select-option> }
              </ion-select>
            </ion-item>
            @if (touched.province && !f.province) { <p class="field-err">Choose the province</p> }

            <ion-item [class.bad]="touched.town && !f.town.trim()">
              <ion-label position="stacked">Town or suburb</ion-label>
              <ion-input placeholder="e.g. Johannesburg CBD" [value]="f.town"
                         (ionInput)="f.town = $any($event.target).value" (ionBlur)="touched.town = true"></ion-input>
            </ion-item>
            @if (touched.town && !f.town.trim()) { <p class="field-err">Choose the town or suburb</p> }

            <ion-item>
              <ion-label position="stacked">When</ion-label>
              <ion-datetime-button datetime="lastSeen"></ion-datetime-button>
            </ion-item>

            <button type="button" class="lf-btn lf-btn--ghost lf-btn--block" (click)="useMyLocation()">
              <lf-icon name="target" [size]="16" /> {{ geoLabel() }}
            </button>

            <ion-item [class.bad]="touched.body && bodyError()">
              <ion-label position="stacked">What did you see?</ion-label>
              <ion-textarea rows="4" [value]="f.body"
                placeholder="What happened, and whether it is still going on. Do not name anyone."
                (ionInput)="f.body = $any($event.target).value" (ionBlur)="touched.body = true"></ion-textarea>
            </ion-item>
            @if (touched.body && bodyError()) { <p class="field-err">{{ bodyError() }}</p> }
            <p class="hint">{{ f.body.trim().length }} / 30 characters minimum</p>

            <div class="media">
              @for (m of f.media; track m.id) {
                <figure>
                  <img [src]="m.kind === 'video' ? mediaPoster : m.src" alt="" />
                  <button type="button" class="rm" (click)="removeMedia(m.id)" aria-label="Remove photo"><lf-icon name="x" [size]="14" /></button>
                </figure>
              }
              @if (f.media.length < 4) {
                <button type="button" class="add" (click)="addPhoto()"><lf-icon name="camera" [size]="22" /><span>Add photo</span></button>
              }
            </div>
          </section>
        }

        @if (type() && type() !== 'danger') {
          <section>
            <h2 class="lf-h2">{{ detailsHeading() }}</h2>

            <ion-item [class.bad]="touched.title && titleError()">
              <ion-label position="stacked">Title</ion-label>
              <ion-input [value]="f.title" [placeholder]="titlePlaceholder()"
                         (ionInput)="f.title = $any($event.target).value" (ionBlur)="touched.title = true"></ion-input>
            </ion-item>
            @if (touched.title && titleError()) { <p class="field-err">{{ titleError() }}</p> }

            <ion-item [class.bad]="touched.body && bodyError()">
              <ion-label position="stacked">What happened?</ion-label>
              <ion-textarea rows="6" [value]="f.body"
                placeholder="Say what happened, when, where, who was with them and what you have already done. The more specific you are, the faster someone recognises them."
                (ionInput)="f.body = $any($event.target).value" (ionBlur)="touched.body = true"></ion-textarea>
            </ion-item>
            @if (touched.body && bodyError()) { <p class="field-err">{{ bodyError() }}</p> }
            <p class="hint">{{ f.body.trim().length }} / 30 characters minimum</p>

            @if (type() !== 'story') {
              <ion-item [class.bad]="touched.subject && !s.name.trim()">
                <ion-label position="stacked">Full name of the person</ion-label>
                <ion-input [value]="s.name" placeholder="e.g. Thato Mokoena"
                           (ionInput)="s.name = $any($event.target).value" (ionBlur)="touched.subject = true"></ion-input>
              </ion-item>
              @if (touched.subject && !s.name.trim()) { <p class="field-err">We need the person's name</p> }


              @if (type() === 'khumbulekhaya') {
                <div class="lf-banner lf-banner--warn">
                  <lf-icon name="home" [size]="18" />
                  <div class="lf-col">
                    <strong>How long have they been out?</strong>
                    <ion-input type="number" placeholder="days" [value]="daysOut"
                               (ionInput)="daysOut = $any($event.target).value"></ion-input>
                    <ion-input placeholder="Why do you think they left?" [value]="reasonGuess"
                               (ionInput)="reasonGuess = $any($event.target).value"></ion-input>
                  </div>
                </div>
              }

              <h2 class="lf-h2" style="margin-top:20px">Where and when</h2>

              <ion-item [class.bad]="touched.province && !f.province">
                <ion-label position="stacked">Province</ion-label>
                <ion-select placeholder="Choose a province" [value]="f.province"
                            (ionChange)="f.province = $any($event.detail).value">
                  <ion-select-option [value]="null">Choose a province</ion-select-option>
                  @for (p of provinces; track p.code) { <ion-select-option [value]="p.code">{{ p.name }}</ion-select-option> }
                </ion-select>
              </ion-item>
              @if (touched.province && !f.province) { <p class="field-err">Choose the province where this happened</p> }

              <ion-item [class.bad]="touched.town && !f.town.trim()">
                <ion-label position="stacked">Town or suburb</ion-label>
                <ion-input placeholder="e.g. Orlando West, Soweto" [value]="f.town"
                           (ionInput)="f.town = $any($event.target).value" (ionBlur)="touched.town = true"></ion-input>
              </ion-item>
              @if (touched.town && !f.town.trim()) { <p class="field-err">Choose the town or suburb</p> }

              <ion-item><ion-label position="stacked">Last seen where</ion-label>
                <ion-input [value]="f.lastSeenWhere" placeholder="Taxi rank outside Orlando Mall"
                           (ionInput)="f.lastSeenWhere = $any($event.target).value"></ion-input></ion-item>
              <ion-item><ion-label position="stacked">Last seen when</ion-label>
                <ion-datetime-button datetime="lastSeen"></ion-datetime-button></ion-item>

              <button class="lf-btn lf-btn--ghost lf-btn--block" (click)="useMyLocation()">
                <lf-icon name="target" [size]="16" /> {{ geoLabel() }}
              </button>


              <h2 class="lf-h2" style="margin-top:20px">Photos and contact</h2>
            } @else {
              <h2 class="lf-h2" style="margin-top:20px">Photos</h2>
            }

            <div class="media">
              @for (m of f.media; track m.id) {
                <figure>
                  <img [src]="m.kind === 'video' ? mediaPoster : m.src" alt="" />
                  @if (m.kind === 'video') { <span class="vtag"><lf-icon name="video" [size]="13" /> video</span> }
                  <button class="rm" (click)="removeMedia(m.id)"><lf-icon name="x" [size]="14" /></button>
                </figure>
              }
              @if (f.media.length < 4) {
                <button class="add" (click)="addPhoto()"><lf-icon name="camera" [size]="22" /><span>Add photo</span></button>
              }
              @if (!f.media.length) {
                <button class="add" (click)="addVideo()"><lf-icon name="video" [size]="22" /><span>Add video</span></button>
              }
            </div>
            <p class="hint">
              {{ f.media.some((m) => m.kind === 'video')
                 ? 'You chose a video, so photos are off. Remove the video to add photos instead.'
                 : 'Up to 4 photos. Choose photos or one video - not both.' }}
            </p>

            @if (type() !== 'story') {
              <ion-item><ion-label position="stacked">Contact label</ion-label>
                <ion-input [value]="f.contactLabel" (ionInput)="f.contactLabel = $any($event.target).value"></ion-input></ion-item>
              <ion-item><ion-label position="stacked">Contact number or handle</ion-label>
                <ion-input [value]="f.contactValue" placeholder="071 555 0142" (ionInput)="f.contactValue = $any($event.target).value"></ion-input></ion-item>
              <ion-item><ion-label position="stacked">Who can see the contact details?</ion-label>
                <ion-select [value]="f.contactVisibleTo" (ionChange)="f.contactVisibleTo = $any($event.detail).value">
                  <ion-select-option value="everyone">Everyone</ion-select-option>
                  <ion-select-option value="verified">Verified members only</ion-select-option>
                  <ion-select-option value="owner">Only me (people must chat)</ion-select-option>
                </ion-select></ion-item>
              <div class="lf-banner">
                <lf-icon name="shield" [size]="18" />
                <div>Scammers call families within hours. "Verified only" or "only me" cuts that down a lot.</div>
              </div>

              <button type="button" class="disclose" (click)="moreOpen.set(!moreOpen())"
                      [attr.aria-expanded]="moreOpen()">
                <lf-icon [name]="moreOpen() ? 'chevronDown' : 'chevronRight'" [size]="16" />
                <span>{{ moreOpen() ? 'Hide extra details' : 'Add extra details' }}</span>
                <em>{{ extraCount() }} filled</em>
              </button>
              @if (moreOpen()) {
                <div class="more lf-fade-in">
              <div class="two">
                <ion-item><ion-label position="stacked">Age</ion-label>
                  <ion-input type="number" [value]="s.age" (ionInput)="s.age = $any($event.target).value"></ion-input></ion-item>
                <ion-item><ion-label position="stacked">Gender</ion-label>
                  <ion-select [value]="s.gender" (ionChange)="s.gender = $any($event.detail).value">
                    <ion-select-option value="female">Female</ion-select-option>
                    <ion-select-option value="male">Male</ion-select-option>
                    <ion-select-option value="other">Other</ion-select-option>
                    <ion-select-option value="unknown">Unknown</ion-select-option>
                  </ion-select></ion-item>
              </div>
              <ion-item><ion-label position="stacked">Your relationship to them</ion-label>
                <ion-input [value]="s.relationship" placeholder="Mother, brother, neighbour…"
                           (ionInput)="s.relationship = $any($event.target).value"></ion-input></ion-item>
              <div class="two">
                <ion-item><ion-label position="stacked">Height</ion-label>
                  <ion-input [value]="s.height" placeholder="1.65 m" (ionInput)="s.height = $any($event.target).value"></ion-input></ion-item>
                <ion-item><ion-label position="stacked">Build</ion-label>
                  <ion-input [value]="s.build" placeholder="Slim" (ionInput)="s.build = $any($event.target).value"></ion-input></ion-item>
              </div>
              <ion-item><ion-label position="stacked">What were they wearing?</ion-label>
                <ion-textarea rows="2" [value]="s.clothing" (ionInput)="s.clothing = $any($event.target).value"></ion-textarea></ion-item>
              <ion-item><ion-label position="stacked">Anything that makes them easy to spot</ion-label>
                <ion-textarea rows="2" placeholder="Tattoos, scars, glasses, a limp…" [value]="s.distinguishing"
                              (ionInput)="s.distinguishing = $any($event.target).value"></ion-textarea></ion-item>
              <ion-item><ion-label position="stacked">SAPS case number (if you have one)</ion-label>
                <ion-input [value]="f.caseNumber" placeholder="e.g. ORL/441/09/2026" (ionInput)="f.caseNumber = $any($event.target).value"></ion-input></ion-item>
              <ion-item><ion-label position="stacked">Reward (optional)</ion-label>
                <ion-input [value]="f.reward" placeholder="R5 000 for information" (ionInput)="f.reward = $any($event.target).value"></ion-input></ion-item>

              <div class="lf-banner">
                <lf-icon name="info" [size]="18" />
                <div>No case number yet? That is fine. Open the case at any SAPS station today - there is no 24-hour waiting period.</div>
              </div>
                </div>
              }
            }
          </section>
        }

        @if (type()) {
          <!-- ---------- 3. who sees it ---------- -->
          <section>
            <h2 class="lf-h2">Who sees this?</h2>
            <div class="opts">
              @for (a of audiences; track a.key) {
                <button class="opt" [class.on]="f.audience === a.key" (click)="f.audience = a.key">
                  <lf-icon [name]="a.icon" [size]="20" />
                  <span><strong>{{ a.label }}</strong><small>{{ a.sub }}</small></span>
                </button>
              }
            </div>

            @if (f.audience === 'surname') {
              <ion-item [class.bad]="touched.spotlight && !f.spotlightId">
                <ion-label position="stacked">Which of your Spotlights?</ion-label>
                <ion-select [value]="f.spotlightId" placeholder="Choose a community"
                            (ionChange)="f.spotlightId = $any($event.detail).value">
                  @for (sp of mySpotlights(); track sp.id) { <ion-select-option [value]="sp.id">{{ sp.surname }} · {{ sp.province ? provinceLabel(sp.province) : 'South Africa' }}</ion-select-option> }
                </ion-select>
              </ion-item>
              @if (!mySpotlights().length) {
                <p class="field-err">
                  You have not joined a Spotlight yet.
                  <button class="linklike" type="button" (click)="goSpotlights()">Join or create one</button> first.
                </p>
              }
            }

            <div class="toggles">
              @if (type() !== 'story') {
                <ion-item>
                  <ion-label><strong>Allow private chat</strong><br />
                    <span class="lf-muted lf-small">People who upvote and follow each other can message you.</span></ion-label>
                  <ion-toggle [checked]="f.chatEnabled" (ionChange)="f.chatEnabled = $any($event.detail).checked"></ion-toggle>
                </ion-item>
                <ion-item>
                  <ion-label><strong>Allow comments</strong></ion-label>
                  <ion-toggle [checked]="f.allowComments" (ionChange)="f.allowComments = $any($event.detail).checked"></ion-toggle>
                </ion-item>
                <ion-item>
                  <ion-label><strong>Post anonymously</strong><br />
                    <span class="lf-muted lf-small">Your name is hidden. LulaFind and SAPS still know who you are.</span></ion-label>
                  <ion-toggle [checked]="f.anonymous" (ionChange)="f.anonymous = $any($event.detail).checked"></ion-toggle>
                </ion-item>
                @if (type() === 'khumbulekhaya') {
                  <ion-item>
                    <ion-label><strong>Ask "Are they being wanted?"</strong><br />
                      <span class="lf-muted lf-small">The community answers yes/no, and the person can claim the post and reply.</span></ion-label>
                    <ion-toggle [checked]="f.askWanted" (ionChange)="f.askWanted = $any($event.detail).checked"></ion-toggle>
                  </ion-item>
                }
              } @else {
                <ion-item>
                  <ion-label><strong>Allow comments</strong></ion-label>
                  <ion-toggle [checked]="f.allowComments" (ionChange)="f.allowComments = $any($event.detail).checked"></ion-toggle>
                </ion-item>
              }
            </div>

            @if (type() === 'danger' && f.audience === 'public') {
              <p class="hint">Everyone can read it. People in this province get an alert.</p>
            }

            @if (type() === 'danger') {
              <div class="lf-banner lf-banner--warn">
                <lf-icon name="shield" [size]="18" />
                <div>Only post what you saw. Do not name a person. Do not tell anyone to go there. If you are in danger, call 10111.</div>
              </div>
            } @else {
              <div class="lf-banner lf-banner--warn">
                <lf-icon name="alert" [size]="18" />
                <div>
                  By posting you confirm this is true and that you are allowed to post about this person.
                  Sharing false information about a missing person is a crime and can lead to arrest.
                  For anyone under 18, a parent, guardian or SAPS officer must confirm - those posts are reviewed before going live.
                </div>
              </div>
            }

            @if (error()) { <p class="err"><lf-icon name="alert" [size]="15" /> {{ error() }}</p> }

            <button class="lf-btn lf-btn--primary lf-btn--block big" [disabled]="busy()" (click)="submit()">
              {{ busy() ? 'Saving…' : (editing() ? 'Save changes' : (type() === 'danger' ? 'Warn people' : 'Post it')) }}
            </button>
          </section>
        }
      </div>
      <div style="height:40px"></div>
    </ion-content>

    <ion-datetime id="lastSeen" class="picker" presentation="date-time" [value]="isoLastSeen" (ionChange)="onDateChange($event)"></ion-datetime>
  `,
  styles: [`
    .wrap { padding: 16px var(--lf-gap) calc(28px + var(--lf-safe-bottom, 0px)); max-width: 560px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
    section { display: flex; flex-direction: column; gap: 10px; }
    .linkish { border: 0; background: none; padding: 0; color: var(--lf-signal); font: inherit; font-weight: 800; cursor: pointer; }
    .hint { font-size: 12px; color: var(--lf-muted); margin: -4px 2px 0; line-height: 1.45; }
    ion-item { --background: var(--lf-card); border-radius: 16px; --border-radius: 16px; }
    ion-item.bad { --border-color: var(--lf-signal); box-shadow: inset 0 0 0 1.5px var(--lf-signal); }
    .field-err { color: var(--lf-signal); font-size: 12px; font-weight: 600; margin: -6px 0 0 4px; }
    .err { display: flex; align-items: center; gap: 8px; color: var(--lf-signal); font-size: 13px; margin: 6px 0 0; }
    .linklike { background: none; border: 0; color: var(--lf-beacon); font-weight: 700; font-size: inherit;
      padding: 0; cursor: pointer; text-decoration: underline; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .lf-col { display: flex; flex-direction: column; gap: 6px; }
    .media { display: flex; gap: 10px; flex-wrap: wrap; margin: 2px 0 0; }
    .media figure { position: relative; margin: 0; width: 104px; height: 104px; border-radius: 12px; overflow: hidden; }
    .media img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .vtag { position: absolute; left: 6px; bottom: 6px; display: inline-flex; align-items: center; gap: 4px;
      background: rgba(0,0,0,.65); color: #fff; border-radius: 999px; padding: 2px 8px; font-size: 10px; font-weight: 700; }
    .rm { position: absolute; top: 4px; right: 4px; width: 26px; height: 26px; border-radius: 50%;
      background: rgba(0,0,0,.6); color: #fff; border: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .add { width: 104px; height: 104px; border-radius: 12px; border: 1.5px dashed var(--lf-line);
      background: transparent; color: var(--lf-muted); display: flex; flex-direction: column; gap: 6px;
      align-items: center; justify-content: center; font-size: 12px; font-weight: 600; cursor: pointer; }
    .opts { display: flex; flex-direction: column; gap: 8px; }
    .disclose { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 6px;
      padding: 13px; border: 1px dashed var(--lf-line); border-radius: 12px; background: none;
      color: var(--lf-ink); font-size: 14px; font-weight: 600; cursor: pointer; }
    .disclose em { margin-left: auto; font-style: normal; font-size: 11.5px; color: var(--lf-muted); }
    .more { margin-top: 10px; padding-left: 12px; border-left: 2px solid var(--lf-line); }
    .opt { display: flex; align-items: center; gap: 12px; padding: 13px; border-radius: 12px;
      border: 1px solid var(--lf-line); background: var(--lf-card); color: inherit; text-align: left; cursor: pointer; }
    .opt.on { border-color: var(--lf-beacon); background: color-mix(in srgb, var(--lf-beacon) 12%, transparent); }
    .opt span { display: flex; flex-direction: column; gap: 2px; }
    .opt small { color: var(--lf-muted); font-size: 12px; line-height: 1.35; }
    .big { margin-top: 6px; min-height: 52px; font-size: 16px; }
    .kinds { display: flex; flex-wrap: wrap; gap: 8px; }
    .kind { min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--lf-line);
      background: color-mix(in srgb, var(--lf-card) 72%, transparent); color: inherit; font-weight: 700; font-size: 14px; cursor: pointer; }
    .kind.on { border-color: var(--lf-signal); color: var(--lf-signal);
      background: color-mix(in srgb, var(--lf-signal) 14%, transparent); }
    ion-datetime.picker { display: none; }
  `]
})
export class CreatePostComponent implements OnInit {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private location = inject(LocationService);
  private media = inject(MediaService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private nav = inject(Location);
  private toast = inject(ToastController);
  private alert = inject(AlertController);

  protected readonly provinces = PROVINCES;
  /** Extra descriptive fields stay collapsed - the form opens short, not 21 fields deep. */
  protected readonly moreOpen = signal(false);

  /** How many of the collapsed fields the poster has actually filled in. */
  protected extraCount(): number {
    return [this.s.age, this.s.gender, this.s.relationship, this.s.height, this.s.build,
            this.s.clothing, this.s.distinguishing, this.f.caseNumber, this.f.reward]
      .filter((v) => String(v ?? '').trim() !== '' && v !== 'unknown').length;
  }

  protected readonly categories = CATEGORIES;
  protected readonly dangerKinds = DANGER_KINDS;
  dangerKind = signal<DangerKind | null>(null);
  private existingDanger: DangerAlert | null = null;
  /** offline poster used as the video thumbnail */
  readonly mediaPoster = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#12203f"/><polygon points="80,65 80,135 140,100" fill="#f2b233"/></svg>'
  );

  type = signal<PostType | null>(null);
  editing = signal(false);
  busy = signal(false);
  picker = signal(false);
  error = signal('');
  postId: string | null = null;

  daysOut: number | string = '';
  reasonGuess = '';
  isoLastSeen = new Date(Date.now() - 3600_000).toISOString();

  touched = { type: false, title: false, body: false, subject: false, province: false, town: false, spotlight: false };

  f = {
    title: '', body: '', media: [] as MediaItem[], province: null as ProvinceCode | null, town: '',
    lastSeenAt: null as number | null, lastSeenWhere: '', geo: null as any,
    contactLabel: 'Call / WhatsApp', contactValue: '', contactVisibleTo: 'everyone' as any,
    caseNumber: '', reward: '', audience: 'public' as any, spotlightId: null as string | null,
    chatEnabled: true, allowComments: true, anonymous: false, askWanted: true
  };

  s = {
    name: '', age: '' as number | string, gender: 'unknown' as any, height: '', build: '', skinTone: '',
    hair: '', eyes: '', clothing: '', distinguishing: '', medical: '', vehicle: '', languages: '',
    surname: '', relationship: ''
  };

  readonly audiences = [
    { key: 'public', icon: 'globe', label: 'Everyone', sub: 'The whole of South Africa sees it. Fastest reach.' },
    { key: 'followers', icon: 'users', label: 'My followers only', sub: 'For sensitive cases - your network still shares it out.' },
    { key: 'surname', icon: 'award', label: 'A Spotlight community', sub: 'Only inside a surname community you have joined.' }
  ];

  readonly mySpotlights = computed(() => this.data.mySpotlights());

  async ngOnInit(): Promise<void> {
    await this.data.loadStatic();

    // editing an existing post
    const editId = this.route.snapshot.paramMap.get('id');
    if (editId) {
      const p = await this.data.loadPost(editId);
      if (!p) {
        await this.say('That post is not here any more.');
        await this.router.navigate(['/home']);
        return;
      }
      if (!this.data.canEdit(p)) {
        await this.say('Only the person who posted this can edit it.');
        await this.router.navigate(['/post', p.id]);
        return;
      }
      this.postId = p.id;
      this.editing.set(true);
      this.type.set(p.type);
      if (p.danger) { this.dangerKind.set(p.danger.kind); this.existingDanger = p.danger; }
      this.f.title = p.title;
      this.f.body = p.body;
      this.f.media = [...p.media];
      this.f.province = p.province;
      this.f.town = p.town;
      this.f.lastSeenAt = p.lastSeenAt;
      this.f.lastSeenWhere = p.lastSeenWhere;
      this.f.geo = p.geo;
      this.f.contactLabel = p.contactLabel;
      this.f.contactValue = p.contactValue;
      this.f.contactVisibleTo = p.contactVisibleTo;
      this.f.caseNumber = p.caseNumber ?? '';
      this.f.reward = p.reward ?? '';
      this.f.audience = p.audience;
      this.f.spotlightId = p.spotlightId;
      this.f.chatEnabled = p.chatEnabled;
      this.f.allowComments = p.allowComments;
      this.f.anonymous = p.anonymous;
      this.f.askWanted = p.askWanted;
      if (p.subject) this.s = { ...p.subject, age: p.subject.age ?? '' };
      if (p.khumbu) {
        this.daysOut = p.khumbu.daysOut ?? '';
        this.reasonGuess = p.khumbu.reasonGuess;
      }
      if (p.lastSeenAt) this.isoLastSeen = new Date(p.lastSeenAt).toISOString();
      return;
    }

    // new post: the category still has to be chosen, and nothing is pre-filled
    const t = this.route.snapshot.paramMap.get('type') as PostType | null;
    if (t && ['missing', 'khumbulekhaya', 'story', 'sighting', 'vehicle', 'pet', 'danger'].includes(t)) this.type.set(t);
    this.f.lastSeenAt = Date.now() - 3600_000;
    const spId = this.data.filter().spotlightId;
    if (spId && this.data.isMember(spId)) {
      this.f.spotlightId = spId;
      this.f.audience = 'surname';
    }
  }

  setType(t: PostType): void {
    this.type.set(t);
    this.touched.type = true;
    if (t === 'danger') {
      this.f.chatEnabled = false;
      this.f.lastSeenAt = Date.now();
      this.isoLastSeen = new Date().toISOString();
    }
  }

  goHelp(): void {
    void this.router.navigate(['/help']);
  }

  pickDanger(k: DangerKind): void {
    this.dangerKind.set(k);
    this.touched.type = true;
  }

  categoryHint(): string {
    return CATEGORIES.find((c) => c.key === this.type())?.hint ?? '';
  }

  detailsHeading(): string {
    const map: Record<PostType, string> = {
      missing: 'Who are we looking for?',
      khumbulekhaya: 'Who has not come home?',
      sighting: 'What did you see?',
      vehicle: 'Which vehicle is missing?',
      pet: 'Which pet is missing?',
      story: 'What is your story?',
      danger: 'What did you see?'
    };
    return map[this.type() ?? 'missing'];
  }

  titlePlaceholder(): string {
    switch (this.type()) {
      case 'story': return 'e.g. We found her - here is what worked';
      case 'vehicle': return 'e.g. White Toyota Quantum, BB 45 XX GP - taken in Roodepoort';
      case 'pet': return 'e.g. Brown Labrador "Bongani" - last seen Brixton';
      case 'danger': return 'e.g. Violence near Bree taxi rank';
      default: return 'e.g. Help find Thato Mokoena, 14 - last seen Orlando West';
    }
  }

  titleError(): string {
    const len = this.f.title.trim().length;
    if (!len) return 'Give your post a title';
    if (len < 8) return 'A title needs at least 8 characters';
    return '';
  }

  bodyError(): string {
    const len = this.f.body.trim().length;
    if (!len) return 'Tell us what happened';
    if (len < 30) return 'Please write at least 30 characters - details save lives';
    return '';
  }

  provinceLabel(code: string): string {
    return PROVINCES.find((p) => p.code === code)?.name ?? 'South Africa';
  }

  geoLabel(): string {
    return this.f.geo ? 'Location attached · tap to update' : 'Use my current location';
  }

  async useMyLocation(): Promise<void> {
    if (this.location.permission() !== 'granted') {
      const ok = await this.location.askWithExplanation();
      if (!ok) { await this.say('Location is off. Type the town instead.'); return; }
    }
    const point = await this.location.readDevicePosition();
    if (point) {
      this.f.geo = point;
      await this.say('Location attached. Still choose the province and town.');
    } else {
      await this.say('This phone did not share a location. Type the town instead.');
    }
  }

  onDateChange(e: any): void {
    const iso = e?.detail?.value ?? e?.target?.value;
    if (!iso) return;
    this.isoLastSeen = iso;
    this.f.lastSeenAt = new Date(iso).getTime();
    this.picker.set(false);
  }

  async addPhoto(): Promise<void> {
    if (this.f.media.some((m) => m.kind === 'video')) {
      await this.say('Remove the video first - a post is photos or one video, not both.');
      return;
    }
    const item = await this.media.pickImage({ quality: 76 });
    if (!item) {
      if (this.media.lastError()) await this.say(this.media.lastError()!);
      return;
    }
    item.src = await this.media.compress(item.src);
    this.f.media = [...this.f.media, item];
  }

  async addVideo(): Promise<void> {
    if (this.f.media.length) {
      await this.say('Remove the photos first - a post is photos or one video, not both.');
      return;
    }
    const item = await this.media.pickVideo();
    if (item) this.f.media = [item];
  }

  removeMedia(id: string): void {
    this.f.media = this.f.media.filter((m) => m.id !== id);
  }

  goSpotlights(): void {
    void this.router.navigate(['/spotlight']);
  }

  private validate(): boolean {
    this.touched = { type: true, title: true, body: true, subject: true, province: true, town: true, spotlight: true };
    if (!this.type()) { this.error.set('Choose a category first.'); return false; }
    if (this.type() === 'danger') {
      if (!this.dangerKind()) { this.error.set('Choose what you saw.'); return false; }
      if (!this.f.lastSeenWhere.trim()) { this.error.set('Say the place where you saw this.'); return false; }
      if (!this.f.province) { this.error.set('Choose the province where this happened.'); return false; }
      if (!this.f.town.trim()) { this.error.set('Choose the town or suburb where this happened.'); return false; }
      if (this.bodyError()) { this.error.set(this.bodyError()); return false; }
      if (this.f.title.trim().length < 8) {
        this.f.title = `${dangerLabel(this.dangerKind())} near ${this.f.lastSeenWhere.trim()}`;
      }
    } else {
      if (this.titleError()) { this.error.set(this.titleError()); return false; }
      if (this.bodyError()) { this.error.set(this.bodyError()); return false; }
      if (this.type() !== 'story') {
        if (!this.s.name.trim()) { this.error.set('We need the person\'s name.'); return false; }
        if (!this.f.province) { this.error.set('Choose the province where this happened.'); return false; }
        if (!this.f.town.trim()) { this.error.set('Choose the town or suburb where this happened.'); return false; }
      }
    }
    if (this.f.audience === 'surname' && !this.f.spotlightId) {
      this.error.set(this.mySpotlights().length ? 'Choose which Spotlight should see this.' : 'Join a Spotlight community first.');
      return false;
    }
    return true;
  }

  private subjectPayload() {
    if (this.type() === 'story' || this.type() === 'danger') return null;
    return {
      name: this.s.name.trim(),
      age: this.s.age === '' || this.s.age === null ? null : Number(this.s.age),
      gender: this.s.gender,
      height: this.s.height.trim(),
      build: this.s.build.trim(),
      skinTone: this.s.skinTone.trim(),
      hair: this.s.hair.trim(),
      eyes: this.s.eyes.trim(),
      clothing: this.s.clothing.trim(),
      distinguishing: this.s.distinguishing.trim(),
      medical: this.s.medical.trim(),
      vehicle: this.s.vehicle.trim(),
      languages: this.s.languages.trim(),
      surname: this.s.surname.trim() || this.s.name.trim().split(/\s+/).slice(-1)[0] || '',
      relationship: this.s.relationship.trim()
    };
  }

  private dangerPayload(): DangerAlert | null {
    if (this.type() !== 'danger' || !this.dangerKind()) return null;
    return {
      kind: this.dangerKind()!,
      stillIds: this.existingDanger?.stillIds ?? [],
      clearIds: this.existingDanger?.clearIds ?? [],
      clearedAt: this.existingDanger?.clearedAt ?? null
    };
  }

  async submit(): Promise<void> {
    this.error.set('');
    if (!this.validate()) return;
    this.busy.set(true);
    try {
      const khumbu = this.type() === 'khumbulekhaya'
        ? {
            daysOut: this.daysOut === '' ? null : Number(this.daysOut),
            leftHomeAt: this.f.lastSeenAt,
            reasonGuess: this.reasonGuess.trim(),
            claimedByUserId: null as string | null,
            claimedAt: null as number | null,
            subjectResponse: 'none' as const,
            subjectNote: '',
            wantedAnswers: { yes: 0, no: 0, myVote: null as boolean | null }
          }
        : null;

      if (this.editing() && this.postId) {
        const updated = await this.data.updatePost(this.postId, {
          title: this.f.title, body: this.f.body, media: this.f.media,
          province: this.f.province as any, town: this.f.town, lastSeenAt: this.f.lastSeenAt,
          lastSeenWhere: this.f.lastSeenWhere, geo: this.f.geo,
          contactLabel: this.f.contactLabel, contactValue: this.f.contactValue,
          contactVisibleTo: this.f.contactVisibleTo,
          caseNumber: this.f.caseNumber || null, reward: this.f.reward || null,
          subject: this.subjectPayload(), audience: this.f.audience,
          spotlightId: this.f.spotlightId, chatEnabled: this.f.chatEnabled,
          allowComments: this.f.allowComments, anonymous: this.f.anonymous,
          askWanted: this.f.askWanted, khumbu,
          danger: this.dangerPayload()
        });
        await this.say('Saved.');
        await this.router.navigate(['/post', updated?.id ?? this.postId]);
        return;
      }

      const post = await this.data.createPost({
        type: this.type()!,
        title: this.f.title, body: this.f.body, media: this.f.media,
        province: this.f.province as any, town: this.f.town, lastSeenAt: this.f.lastSeenAt,
        lastSeenWhere: this.f.lastSeenWhere, geo: this.f.geo,
        contactLabel: this.f.contactLabel, contactValue: this.f.contactValue,
        contactVisibleTo: this.f.contactVisibleTo,
        caseNumber: this.f.caseNumber || null, reward: this.f.reward || null,
        subject: this.subjectPayload(), audience: this.f.audience,
        spotlightId: this.f.audience === 'surname' ? this.f.spotlightId : null,
        chatEnabled: this.f.chatEnabled, allowComments: this.f.allowComments,
        anonymous: this.f.anonymous, askWanted: this.f.askWanted, khumbu,
        danger: this.dangerPayload()
      });
      await this.say('Posted. Here is your post.');
      await this.router.navigate(['/post', post.id]);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not save the post');
    } finally {
      this.busy.set(false);
    }
  }

  /** Close / cancel - goes back to wherever the person came from. */
  async close(): Promise<void> {
    const dirty = this.f.title.trim() || this.f.body.trim() || this.f.media.length;
    if (dirty) {
      const a = await this.alert.create({
        header: 'Discard this post?',
        message: 'What you have typed will be lost.',
        buttons: [
          { text: 'Keep editing', role: 'cancel' },
          { text: 'Discard', role: 'destructive', handler: () => this.goBack() }
        ]
      });
      await a.present();
      return;
    }
    this.goBack();
  }

  private goBack(): void {
    if (this.editing() && this.postId) {
      void this.router.navigate(['/post', this.postId]);
      return;
    }
    // Never return to the empty plus tab.
    void this.router.navigate(['/home']);
  }

  private async say(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2600, position: 'bottom' });
    await t.present();
  }
}
