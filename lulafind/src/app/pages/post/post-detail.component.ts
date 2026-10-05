import { Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonTextarea } from '@ionic/angular/ion-textarea';
import { IonSkeletonText } from '@ionic/angular/ion-skeleton-text';
import { ToastController } from '@ionic/angular/toast-controller';
import { AlertController } from '@ionic/angular/alert-controller';
import { ActionSheetController } from '@ionic/angular/action-sheet-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { ReactionsSheetComponent } from '../../shared/components/reactions-sheet.component';
import { MediaImageComponent, MediaVideoComponent } from '../../shared/components/media-image.component';
import { UserHoverDirective } from '../../shared/components/user-hover-card.component';
import { ReactionButtonComponent } from '../../shared/components/reaction-button.component';
import { ReactionIconComponent } from '../../shared/components/reaction-icon.component';
import { PHOTO_MAX_BYTES, POST_MAX_PHOTOS, VIDEO_MAX_BYTES, mb } from '../../core/models/media-rules';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatService, ChatGate } from '../../core/services/chat.service';
import { ModerationService } from '../../core/services/moderation.service';
import { PostActionsService } from '../../core/services/post-actions.service';
import { LookoutService } from '../../core/services/lookout.service';
import { MediaService } from '../../core/services/media.service';
import { KvStore } from '../../core/data/local-db';
import {
  Comment, MediaItem, Post, PROVINCES, ProvinceCode, REACTIONS, ReactionKind, Sighting, UserProfile,
  isReaction, provinceName
} from '../../core/models/types';
import { compact, dayMonth, headingIsNew as headingIsNewFn, timeAgo } from '../../core/utils/format';
import { leadMarkView } from '../../core/utils/mark-check';

/**
 * One post, and nothing else.
 *
 *   1. Read the post (title, words, photos).
 *   2. React, comment, repost, send - the LinkedIn action bar.
 *   3. The two questions this app asks: "Mark as found / Still searching" for
 *      the family, "This is me / Not me" for the person in the post.
 *   4. The comments, laid out as a conversation: a composer, a LinkedIn sort
 *      control, named message bubbles and replies visibly nested under them.
 *
 * Everything else that used to be stacked here (case facts, contact details,
 * poster, escalation and location links) has been taken off this page so it
 * reads as a post, not a file. Poster and safety tools stay one tap away in the
 * "..." menu and on the pages built for them.
 */
import { KeyboardDirective } from '../../shared/keyboard.directive';

@Component({
  selector: 'lf-post-detail',
  standalone: true,
  imports: [
    IonContent, IonTextarea, IonSkeletonText, RouterLink, IconComponent, AvatarComponent,
    TopNavComponent, ReactionButtonComponent, ReactionIconComponent, ReactionsSheetComponent, KeyboardDirective,
    MediaImageComponent, MediaVideoComponent, UserHoverDirective],
  template: `
    <lf-top-nav title="Post" backTo="/home" />

    <ion-content class="lf-page">
      @if (!p() && !loaded()) {
        <div class="lf-card"><ion-skeleton-text style="height:220px"></ion-skeleton-text></div>
      } @else if (!p()) {
        <!--
          The store answered and there is no such post: either the person it was
          about said "I'm here" (the case is deleted), or a moderator removed it.
          Say so, and give the way out - never leave the screen loading forever.
        -->
        <section class="lf-card gone" aria-label="Post not available">
          <lf-icon name="info" [size]="20" />
          <p>This post is no longer available. It may have been deleted by the person it was about, or removed.</p>
          <button class="big big--go" type="button" (click)="goHome()">Back to home</button>
        </section>
      } @else {
        <article class="post">
          @if (p()!.repostOf) {
            <div class="reposted">
              <lf-icon name="repost" [size]="14" [weight]="2.4" />
              <strong>{{ reposterLine() }}</strong>
            </div>
          }

          <header class="head">
            <a class="who" [routerLink]="authorLink()">
              <lf-avatar [src]="authorAvatar()" [name]="authorName()" [size]="48" />
              <span class="who__text">
                <strong>{{ authorName() }}</strong>
                <span class="headline">{{ authorHeadline() }}</span>
                <span class="meta">
                  {{ timeAgo(p()!.createdAt) }}
                  @if (p()!.editedAt) { · <span class="edited" [attr.title]="'Edited ' + timeAgo(p()!.editedAt)">Edited</span> }
                  · {{ provinceName(p()!.province) }} · <lf-icon name="globe" [size]="11" />
                </span>
              </span>
            </a>
            @if (!isMine() && !p()!.anonymous) {
              <button class="follow" type="button" [class.on]="following() || followRequested()" (click)="toggleFollow()">
                {{ following() ? 'Following' : followRequested() ? 'Requested' : '+ Follow' }}
              </button>
            }
            <button class="more" type="button" (click)="more()" aria-label="More options"><lf-icon name="more" [size]="22" /></button>
          </header>

          @if (p()!.status === 'found') {
            <div class="found"><lf-icon name="award" [size]="18" />
              <span><strong>Found</strong> · {{ p()!.outcome.whereaboutsFound || 'Safe' }}
                @if (p()!.outcome.foundAt) { · {{ dayMonth(p()!.outcome.foundAt) }} }</span>
            </div>
          }

          @if (p()!.repostOf) {
            @if (p()!.body.trim()) { <p class="text">{{ p()!.body }}</p> }
            @if (original(); as o) {
              <a class="embed" [routerLink]="'/post/' + o.id">
                <div class="embed__head">
                  <lf-avatar [src]="originalAvatar()" [name]="originalName()" [size]="40" />
                  <span class="embed__who">
                    <strong>{{ originalName() }}</strong>
                    <small>{{ timeAgo(o.createdAt) }} · {{ provinceName(o.province) }}</small>
                  </span>
                </div>
                <h2>{{ o.title }}</h2>
                <p>{{ o.body }}</p>
                @if (o.media.length) { <lf-media-img [src]="o.media[0].src" [alt]="o.title" /> }
              </a>
            } @else {
              <p class="embed gone"><lf-icon name="info" [size]="16" /> This post is no longer available.</p>
            }
          } @else {
            @if (headingIsNew(p()!.title, p()!.body)) { <h1 class="title">{{ p()!.title }}</h1> }
            <p class="text">{{ p()!.body }}</p>

            @if (p()!.media.length) {
              <div class="media" [class.multi]="p()!.media.length > 1">
                @for (m of p()!.media; track m.id) {
                  @if (m.kind === 'video') {
                    <lf-media-video [src]="m.src" label="Video in this post" />
                  } @else {
                    <lf-media-img [src]="m.src" [alt]="m.caption ?? p()!.title" />
                  }
                }
              </div>
            }
          }

          <!-- reactions + counts -->
          @if (p()!.upvotes > 0 || comments().length > 0 || p()!.shares > 0) {
            <div class="stats">
              <span class="stats__likes">
                @if (p()!.upvotes > 0) {
                  <button type="button" class="stats__react" aria-label="See who reacted" (click)="reactionsOpen.set(true)">
                    <span class="stack">@for (k of topKinds(); track k) { <lf-reaction-icon [kind]="k" [size]="18" [ring]="true" /> }</span>
                    {{ compact(p()!.upvotes) }}
                  </button>
                }
              </span>
              <span class="stats__right">
                @if (comments().length > 0) { <button type="button" (click)="focusComment()">{{ compact(comments().length) }} {{ comments().length === 1 ? 'comment' : 'comments' }}</button> }
                @if (p()!.shares > 0) { <span>{{ compact(p()!.shares) }} {{ p()!.shares === 1 ? 'repost' : 'reposts' }}</span> }
              </span>
            </div>
          }

          <div class="actions">
            <lf-reaction-button [value]="myVote()" (react)="react($event)" />
            <button class="act" type="button" (click)="focusComment()" aria-label="Comment" title="Comment"><lf-icon name="comment" [size]="20" /><span class="sr-only">Comment</span></button>
            <button class="act" type="button" (click)="repost()" aria-label="Repost" title="Repost"><lf-icon name="repost" [size]="20" /><span class="sr-only">Repost</span></button>
            <button class="act" type="button" (click)="send()" aria-label="Send" title="Send"><lf-icon name="send" [size]="19" /><span class="sr-only">Send</span></button>
          </div>

          @if (!isMine() || p()!.status === 'active') {
            <!-- Following a case is the reason to come back to the app: it is
                 what makes the updates arrive, and what the catch-up counts. -->
            <button class="followline" type="button" [class.on]="followingCase()" (click)="toggleFollowCase()">
              <lf-icon name="bell" [size]="16" [filled]="followingCase()" />
              <span>
                @if (followingCase()) { Following this case - we will tell you when something changes }
                @else { Follow this case and be told when something changes }
              </span>
              <strong>{{ followingCase() ? 'Following' : 'Follow' }}</strong>
            </button>
          }

          @if (isCase() && !isMine() && p()!.status === 'active') {
            <button class="lookingline" type="button" [class.on]="looking()" [disabled]="lookingBusy()" (click)="toggleLooking()">
              <lf-icon name="search" [size]="16" />
              <span>
                @if (looking()) { You are looking near this case }
                @else { I’m looking near this case }
              </span>
              <strong>{{ lookingCount() }} {{ lookingCount() === 1 ? 'person' : 'people' }}</strong>
            </button>
          }

          @if (leads().length) {
            <button class="leads" type="button" (click)="openLeads()">
              <lf-icon name="search" [size]="16" />
              <span class="leads__text">
                <strong>{{ leads().length }} {{ leads().length === 1 ? 'lead' : 'leads' }}</strong>
                · newest: {{ leads()[0].sighting ? leads()[0].sighting!.place : shortBody(leads()[0]) }}
              </span>
              @if (verified()) { <span class="leads__tick"><lf-icon name="check" [size]="12" [weight]="3" /> checked</span> }
              <lf-icon name="chevronRight" [size]="15" />
            </button>
          }

          @if (!isMine() && p()!.chatEnabled && !p()!.repostOf) {
            <button class="chatline" type="button" [class.open]="gate().allowed" (click)="openChat()">
              <lf-icon [name]="gate().allowed ? 'unlock' : 'lock'" [size]="16" />
              <span>{{ nextChatAction() }}</span>
            </button>
          }
        </article>

        @if (p()!.outcome.found) {
          <p class="closed">
            <lf-icon name="check" [size]="15" [weight]="3" />
            <span>Found. The family confirmed it. To take the case off the police circulation list, complete a <strong>SAPS 92</strong> with the investigating officer.</span>
          </p>
        }

        @if (isCase() && (p()!.status === 'active' || p()!.status === 'under_review') && latestStillSearching(); as update) {
          <p class="still-status" role="status">
            <lf-icon name="search" [size]="16" />
            <span><strong>Still searching.</strong> Confirmed {{ timeAgo(update.at) }}. This case remains open.</span>
          </p>
        }

        <!-- the two questions this page asks -->
        @if (isMine() && !p()!.appPosted && (p()!.status === 'active' || p()!.status === 'under_review') && !p()!.repostOf) {
          <section class="ask" aria-label="Case status">
            <button class="big big--go" type="button" (click)="markFound()"><lf-icon name="check" [size]="18" /> Mark as found</button>
            <button class="big" type="button" [disabled]="searchingBusy()" (click)="stillSearching()"><lf-icon name="search" [size]="18" /> {{ searchingBusy() ? 'Saving update…' : 'Still searching' }}</button>
          </section>
        } @else if (appPostedCase()) {
          <!--
            LulaFind published this case itself after a failed safety check. The
            person it is about does not claim it and answer questions - they say
            they are here, and the case is deleted with the lookout.
          -->
          <section class="ask ask--col" aria-label="This case is about you">
            <p class="ask__q">This case is about you</p>
            <p class="note">If you are safe, say so. The case is deleted and your followers are told.</p>
            <button class="big big--go" type="button" [disabled]="clearing()" (click)="imHere()">
              <lf-icon name="hand" [size]="18" /> I'm here
            </button>
          </section>
        } @else if (showSubjectAsk()) {
          @if (childCase()) {
            <p class="note">If this child is safe, call Childline on 116. A child\u2019s post can\u2019t be claimed.</p>
          } @else if (canClaim() && !notMe()) {
            <section class="ask" aria-label="Is this you?">
              <p class="ask__q">Is this you?</p>
              <button class="big big--go" type="button" (click)="claim()"><lf-icon name="user" [size]="18" /> This is me</button>
              <button class="big" type="button" (click)="dismissNotMe()">Not me</button>
            </section>
          }
          @if (waitingAnswer()) {
            <section class="ask ask--col" aria-label="Your answer">
              <p class="ask__q">What do you want your family to know?</p>
              <button class="big big--go" type="button" (click)="respond('going_home')">I am coming home</button>
              <button class="big" type="button" (click)="respond('not_going_home')">I am safe, not coming home</button>
              <button class="big" type="button" (click)="respond('contact_me')">Let us chat first</button>
              <ion-textarea lfKeyboard rows="2" placeholder="Add a message (optional)" [value]="khumbuNote" (ionInput)="khumbuNote = $any($event.target).value"></ion-textarea>
            </section>
          }
          @if (openAnswer()) {
            <p class="note"><strong>{{ responseLabel() }}</strong>@if (p()!.khumbu?.subjectNote) { \u201C{{ p()!.khumbu!.subjectNote }}\u201D }</p>
          }
        }

        <!-- Post conversation: composer, relevance sort, messages and nested replies. -->
        <section class="comments" id="comments">
          @if (!p()!.allowComments) {
            <p class="note">The poster turned comments off for this post.</p>
          } @else {
            @if (!auth.signedIn()) {
              <button class="signin" type="button" (click)="needAuth()">Sign in to comment</button>
            } @else {
              @if (canLead() && !replyTo()) {
                <button type="button" class="sighting-trigger" [class.on]="sightingOpen()" (click)="openSightingForm()">
                  <lf-icon name="pin" [size]="16" />
                  <span><strong>Report a sighting</strong><small>Share when and where you saw someone</small></span>
                  <lf-icon [name]="sightingOpen() ? 'chevronDown' : 'chevronRight'" [size]="16" />
                </button>
                @if (sightingOpen()) {
                  <section class="sighting-form" aria-label="Report a structured sighting">
                    <p class="sighting-form__hint">Only report what you personally saw. Do not approach or confront anyone.</p>
                    <label><span>Where did you see them?</span><input [value]="sightingPlace" placeholder="Public place or nearest landmark" (input)="sightingPlace = $any($event.target).value" /></label>
                    <div class="sighting-form__two">
                      <label><span>Province</span><select [value]="sightingProvince" (change)="sightingProvince = $any($event.target).value">
                        @for (province of provinces; track province.code) { <option [value]="province.code">{{ province.name }}</option> }
                      </select></label>
                      <label><span>When?</span><input type="datetime-local" [value]="sightingWhen" (input)="sightingWhen = $any($event.target).value" /></label>
                    </div>
                    <label><span>What did you see?</span><textarea rows="3" [value]="sightingNote" placeholder="Direction of travel, clothing, vehicle or other facts" (input)="sightingNote = $any($event.target).value"></textarea></label>
                    <div class="sighting-form__actions">
                      <button type="button" class="textbtn" (click)="closeSightingForm()" [disabled]="posting()">Cancel</button>
                      <button type="button" class="big big--go" (click)="reportSighting()" [disabled]="posting() || !sightingPlace.trim()">
                        <lf-icon name="send" [size]="16" /> {{ posting() ? 'Sending…' : 'Submit sighting' }}
                      </button>
                    </div>
                  </section>
                }
              }
              @if (replyTo(); as r) {
                <div class="replying">Replying to <strong>{{ r.name }}</strong>
                  <button type="button" (click)="cancelReply()" aria-label="Cancel reply"><lf-icon name="x" [size]="14" /></button>
                </div>
              }
              @if (draft().trim() && !replyTo() && canLead()) {
                <div class="leadrow">
                  <label><input type="checkbox" [checked]="asLead()" (change)="asLead.set($any($event.target).checked)" /> This is a <strong>lead</strong> (something I saw or know)</label>
                  @if (asLead() && p()!.subject?.distinguishing) {
                    <input class="markin" [value]="markGuess()" (input)="markGuess.set($any($event.target).value)" placeholder="A mark you noticed. Only the family sees the words." />
                  }
                </div>
              }
              <div class="cbox">
                <lf-avatar [src]="myAvatar()" [name]="myName()" [size]="40" />
                <div class="compose">
                  <div class="field">
                    <!-- autocorrect + suggestions + the keyboard's own emoji key -->
                    <textarea #box rows="1" [placeholder]="replyTo() ? 'Add a reply…' : 'Add a comment…'" [value]="draft()"
                              inputmode="text" enterkeyhint="send"
                              autocorrect="on" autocomplete="on" autocapitalize="sentences" spellcheck="true"
                              (input)="onType($event)" (keydown.enter)="onEnter($event)" (keydown)="onMentionKeys($event)"
                              [attr.aria-expanded]="mentionOpen()" aria-autocomplete="list" aria-label="Write a comment"></textarea>
                    @if (draft().trim() || commentMedia().length) {
                      <button type="button" class="post" [disabled]="posting()" (click)="submitComment()">{{ replyTo() ? 'Reply' : 'Post' }}</button>
                    }
                    @if (mentionOpen()) {
                      <div class="who-list" role="listbox" aria-label="People you can mention">
                        @for (u of mentionPeople(); track u.id; let i = $index) {
                          <button type="button" role="option" [attr.aria-selected]="i === mentionAt()"
                                  (mousedown)="$event.preventDefault(); pickMention(u)" (click)="pickMention(u)">
                            <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="28" />
                            <span class="who-list__name">{{ u.displayName }}</span>
                            <small>{{ '@' + u.handle }}</small>
                          </button>
                        }
                        @if (!mentionPeople().length) {
                          <p class="who-list__none">No one here matches “{{ mentionQuery() }}”. Mentions only reach people already in this conversation.</p>
                        }
                      </div>
                    }
                  </div>
                  @if (commentMedia().length) {
                    <div class="attach-preview">
                      @for (item of commentMedia(); track item.id) {
                        <div class="attach-preview__item">
                          @if (item.kind === 'image') {
                            <img [src]="item.src" alt="Comment attachment preview" />
                          } @else {
                            <video [src]="item.src" controls playsinline aria-label="Comment video preview"></video>
                          }
                          <button type="button" (click)="removeCommentMedia(item.id)" [disabled]="posting()" [attr.aria-label]="'Remove ' + item.kind + ' attachment'"><lf-icon name="x" [size]="15" /></button>
                        </div>
                      }
                    </div>
                  }
                  <div class="attach-actions">
                    <button type="button" (click)="addCommentPhoto()" [disabled]="posting() || media.busy() || commentMedia().length >= maxPhotos || hasCommentVideo()">
                      <lf-icon name="image" [size]="17" /> Photo
                    </button>
                    <button type="button" (click)="addCommentVideo()" [disabled]="posting() || media.busy() || commentMedia().length > 0">
                      <lf-icon name="video" [size]="17" /> Video
                    </button>
                    <span>Attachments stay with this {{ replyTo() ? 'reply' : 'comment' }}</span>
                  </div>
                </div>
              </div>
            }

            @if (comments().length) {
              <div class="sort">
                <button type="button" (click)="toggleSort()">{{ sort() === 'relevant' ? 'Most relevant' : 'Most recent' }} <lf-icon name="chevronDown" [size]="14" /></button>
              </div>
            }

            @for (c of sorted(); track c.id) {
              <div class="cmsg">
                <lf-avatar [src]="avatarOf(c.authorId)" [name]="nameOf(c.authorId)" [size]="40" />
                <div class="cmsg__body">
                  @if (editingId() === c.id) {
                    <div class="edit">
                      <textarea rows="2" inputmode="text" autocorrect="on" autocomplete="on"
                                autocapitalize="sentences" spellcheck="true"
                                [value]="editDraft()" (input)="editDraft.set($any($event.target).value)" aria-label="Edit your comment"></textarea>
                      <div class="edit__row">
                        <button type="button" class="pill" (click)="editingId.set(null)">Cancel</button>
                        <button type="button" class="pill pill--go" [disabled]="!editDraft().trim()" (click)="saveEdit(c)">Save</button>
                      </div>
                    </div>
                  } @else {
                    <div class="ccard">
                      <div class="ccard__top">
                        <a [routerLink]="'/user/' + c.authorId" class="ccard__name" [lfUserHover]="c.authorId">{{ nameOf(c.authorId) }}</a>
                        @if (c.authorId === p()!.authorId) { <span class="tag">Author</span> }
                        @if (c.authorId !== me()) {
                          <button type="button" class="cfollow" [class.on]="isFollowing(c.authorId)" (click)="followPerson(c.authorId)">
                            {{ isFollowing(c.authorId) ? 'Following' : '+ Follow' }}
                          </button>
                        }
                        
                      </div>
                      @if (headlineOf(c.authorId)) { <span class="ccard__headline">{{ headlineOf(c.authorId) }}</span> }
                      @if (c.body) {
                        <p class="ccard__text">@for (part of parts(c.body); track $index) {
                          @if (part.userId) {
                            <a [routerLink]="'/user/' + part.userId" class="mention">{{ part.text }}</a>
                          } @else { {{ part.text }} }
                        }</p>
                      }
                      @if (c.media?.length) {
                        <div class="comment-media">
                          @for (item of c.media; track item.id) {
                            @if (item.kind === 'image') {
                              <lf-media-img [src]="item.src" alt="Photo attached to comment" />
                            } @else {
                              <lf-media-video [src]="item.src" label="Video attached to comment" />
                            }
                          }
                        </div>
                      }
                      @if (c.isLead) { <span class="lead">Lead</span> }
                      @if (c.sighting) {
                        <div class="sighting"><lf-icon name="pin" [size]="13" /> {{ c.sighting.place }} · {{ provinceName(c.sighting.province) }}@if (c.sighting.note) { · {{ c.sighting.note }} }</div>
                      }
                      @if (c.sighting && p()!.sightingVerified; as v) {
                        <div class="checked"><lf-icon name="check" [size]="13" [weight]="3" /> Checked against {{ v.source }}@if (v.note) { · {{ v.note }} }</div>
                      }
                      @if (mod.isAdmin() && (c.sighting || c.isLead)) {
                        <div class="edit__row">
                          @if (p()!.sightingVerified) {
                            <button class="pill" type="button" (click)="unverifyLead()">Remove check</button>
                          } @else {
                            <button class="pill" type="button" (click)="verifyLead()">Mark as checked</button>
                          }
                        </div>
                      }
                      @if (leadMark(c, isMine()); as mark) {
                        @if (mark.status) {
                          <p class="mark">{{ mark.status }}@if (mark.guess) { · They said \u201C{{ mark.guess }}\u201D }</p>
                          @if (isMine() && c.markGuess && !c.markCheck) {
                            <div class="edit__row">
                              <button class="pill" type="button" (click)="checkMark(c, 'match')">It matches</button>
                              <button class="pill" type="button" (click)="checkMark(c, 'no')">It does not</button>
                            </div>
                          }
                        }
                      }
                      <div class="ccard__acts">
                        <button type="button" [class.on]="liked(c)" (click)="likeComment(c)">
                          <lf-icon name="thumbup" [size]="15" [filled]="liked(c)" /> {{ liked(c) ? 'Liked' : 'Like' }}
                        </button>
                        <button type="button" (click)="startReply(c, c)"><lf-icon name="comment" [size]="15" /> Reply</button>
                        @if (c.upvotes > 0) { <span class="clikes"><lf-reaction-icon kind="like" [size]="15" /> {{ c.upvotes }}</span> }
                        <time class="ctime2">{{ timeAgo(c.createdAt) }}@if (c.editedAt) { · Edited }</time>
                        <button type="button" class="dots" (click)="commentMenu(c)" aria-label="Comment options"><lf-icon name="more" [size]="16" /></button>
                      </div>
                    </div>
                  }

                  @if (repliesOf(c.id).length) {
                    @if (!expanded().has(c.id) && repliesOf(c.id).length > 2) {
                      <button type="button" class="viewrep" (click)="expand(c.id)">
                        <lf-icon name="repost" [size]="14" /> View all {{ repliesOf(c.id).length }} replies
                      </button>
                    } @else {
                      <div class="replies" [attr.aria-label]="'Replies to ' + nameOf(c.authorId)">
                        @for (r of repliesOf(c.id); track r.id) {
                          <div class="cmsg cmsg--reply">
                            <lf-avatar [src]="avatarOf(r.authorId)" [name]="nameOf(r.authorId)" [size]="32" />
                            <div class="cmsg__body">
                              @if (editingId() === r.id) {
                                <div class="edit">
                                  <textarea rows="2" inputmode="text" autocorrect="on" autocomplete="on"
                                            autocapitalize="sentences" spellcheck="true"
                                            [value]="editDraft()" (input)="editDraft.set($any($event.target).value)" aria-label="Edit your reply"></textarea>
                                  <div class="edit__row">
                                    <button type="button" class="pill" (click)="editingId.set(null)">Cancel</button>
                                    <button type="button" class="pill pill--go" [disabled]="!editDraft().trim()" (click)="saveEdit(r)">Save</button>
                                  </div>
                                </div>
                              } @else {
                                <div class="ccard">
                                  <div class="ccard__top">
                                    <a [routerLink]="'/user/' + r.authorId" class="ccard__name" [lfUserHover]="r.authorId">{{ nameOf(r.authorId) }}</a>
                                    @if (r.authorId === p()!.authorId) { <span class="tag">Author</span> }
                                    @if (r.authorId !== me()) {
                                      <button type="button" class="cfollow" [class.on]="isFollowing(r.authorId)" (click)="followPerson(r.authorId)">
                                        {{ isFollowing(r.authorId) ? 'Following' : '+ Follow' }}
                                      </button>
                                    }
                                    
                                  </div>
                                  @if (headlineOf(r.authorId)) { <span class="ccard__headline">{{ headlineOf(r.authorId) }}</span> }
                                  @if (r.body) {
                                    <p class="ccard__text">@for (part of parts(r.body); track $index) {
                                      @if (part.userId) {
                                        <a [routerLink]="'/user/' + part.userId" class="mention">{{ part.text }}</a>
                                      } @else { {{ part.text }} }
                                    }</p>
                                  }
                                  @if (r.media?.length) {
                                    <div class="comment-media">
                                      @for (item of r.media; track item.id) {
                                        @if (item.kind === 'image') {
                                          <lf-media-img [src]="item.src" alt="Photo attached to reply" />
                                        } @else {
                                          <lf-media-video [src]="item.src" label="Video attached to reply" />
                                        }
                                      }
                                    </div>
                                  }
                                  <div class="ccard__acts">
                                    <button type="button" [class.on]="liked(r)" (click)="likeComment(r)">
                                      <lf-icon name="thumbup" [size]="15" [filled]="liked(r)" /> {{ liked(r) ? 'Liked' : 'Like' }}
                                    </button>
                                    <button type="button" (click)="startReply(c, r)"><lf-icon name="comment" [size]="15" /> Reply</button>
                                    @if (r.upvotes > 0) { <span class="clikes"><lf-reaction-icon kind="like" [size]="15" /> {{ r.upvotes }}</span> }
                                    <time class="ctime2">{{ timeAgo(r.createdAt) }}@if (r.editedAt) { · Edited }</time>
                                    <button type="button" class="dots" (click)="commentMenu(r)" aria-label="Reply options"><lf-icon name="more" [size]="16" /></button>
                                  </div>
                                </div>
                              }
                            </div>
                          </div>
                        }
                        @if (repliesOf(c.id).length > 2) {
                          <button type="button" class="viewrep" (click)="collapse(c.id)">Hide replies</button>
                        }
                      </div>
                    }
                  }
                </div>
              </div>
            }
          }
        </section>

      }
    </ion-content>

    @if (p()) { <lf-reactions-sheet [post]="p()!" [open]="reactionsOpen()" (close)="reactionsOpen.set(false)" /> }

    @if (foundOpen()) {
      <div class="sheetwrap" (click)="closeFound()">
        <div class="sheet" (click)="$event.stopPropagation()">
          <div class="sheet__top">
            <h3>Mark as found</h3>
            <button class="dots" (click)="closeFound()" aria-label="Close"><lf-icon name="x" [size]="20" /></button>
          </div>
          <p class="sheet__p">This closes the case. Name the person who found them so they get a contributor badge.</p>
          <label class="k">Where were they found?</label>
          <input class="fld" [value]="foundWhere" placeholder="e.g. Safe at home in Soweto" (input)="foundWhere = $any($event.target).value" />
          <label class="k">Who found them?</label>
          <input class="fld" [value]="finderQuery()" placeholder="Type their name" (input)="onFinder($any($event.target).value)" />
          @if (finderQuery().trim().length >= 2 && !finderHits().length && !finderBusy()) {
            <p class="sheet__p muted">No member with that name. Try the other spelling, or close without a name.</p>
          }
          <div class="hits">
            @for (u of finderHits(); track u.id) {
              <button type="button" class="hit" [class.on]="finderId() === u.id" (click)="pickFinder(u)">
                <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="36" />
                <span><strong>{{ u.displayName }}</strong><small>&#64;{{ u.handle }}</small></span>
              </button>
            }
          </div>
          <button class="big big--go" [disabled]="foundBusy() || !finderId()" (click)="confirmFound()">{{ foundBusy() ? 'Saving…' : 'They are found' }}</button>
          <button class="textbtn" type="button" [disabled]="foundBusy()" (click)="confirmFound(true)">Close without naming a member</button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { --edge: 16px; }
    .post { background: var(--lf-card); box-shadow: var(--lf-shadow); margin-bottom: 8px; padding-bottom: 2px; position: relative; }
    .reposted { display: flex; align-items: center; gap: 7px; padding: 12px var(--edge) 0; color: var(--lf-muted); font-size: 13.5px; }
    .reposted strong { font-weight: 600; color: var(--ion-text-color); }
    .head { display: flex; align-items: flex-start; gap: 8px; padding: 12px 8px 8px var(--edge); }
    .who { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
    .who__text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .who__text strong { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .headline { font-size: 13px; color: var(--lf-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--lf-muted); }
    .edited { font-style: normal; }
    .follow { align-self: center; height: 32px; padding: 0 12px; border: 0; background: transparent; color: var(--lf-primary);
      font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
    .follow.on { color: var(--lf-muted); }
    .more { width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: var(--lf-muted); cursor: pointer; display: grid; place-items: center; }
    .found { display: flex; align-items: center; gap: 8px; margin: 0 var(--edge) 8px; padding: 8px 12px; border-radius: 8px;
      background: color-mix(in srgb, var(--lf-ubuntu) 16%, transparent); color: var(--lf-ubuntu); font-size: 14px; }
    .title { margin: 4px var(--edge) 6px; font-size: 20px; line-height: 1.25; font-weight: 700; letter-spacing: -.2px; }
    .text { margin: 0 var(--edge) 12px; font-size: 16px; line-height: 1.45; white-space: pre-line; word-break: break-word; }
    .followline { display: flex; align-items: center; gap: 8px; width: 100%; margin: 6px 0 0; padding: 10px 12px;
      border: 0; border-radius: var(--lf-radius); background: var(--lf-card-2); color: var(--ion-text-color);
      font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; }
    .followline span { flex: 1; color: var(--lf-muted); }
    .followline strong { color: var(--lf-link); font-weight: 700; white-space: nowrap; }
    .followline.on { background: var(--lf-primary-soft); }
    .followline.on strong { color: var(--lf-link); }
    .lookingline { display: flex; align-items: center; gap: 8px; width: calc(100% - 24px); margin: 4px 12px 8px; padding: 10px 12px;
      border: 1px solid var(--lf-line); border-radius: 8px; background: var(--lf-card-2); color: inherit;
      font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
    .lookingline span { flex: 1; color: var(--lf-muted); }
    .lookingline strong { color: var(--lf-link); font-size: 12px; font-weight: 700; white-space: nowrap; }
    .lookingline.on { border-color: transparent; background: color-mix(in srgb, var(--lf-ubuntu) 12%, var(--lf-card)); }
    .lookingline.on lf-icon, .lookingline.on strong { color: var(--lf-ubuntu); }
    .lookingline:disabled { opacity: .65; cursor: wait; }
    .media { margin: 4px 0 0; }
    .media lf-media-img, .media lf-media-video { display: block; width: 100%; max-height: 640px; overflow: hidden; background: #000; }
    .media.multi { display: flex; gap: 2px; overflow-x: auto; scroll-snap-type: x mandatory; }
    .media.multi lf-media-img, .media.multi lf-media-video { flex: 0 0 88%; scroll-snap-align: start; }
    .embed { display: block; margin: 0 var(--edge) 12px; padding: 12px; border: 1px solid var(--lf-line); border-radius: 8px; color: inherit; text-decoration: none; }
    .embed__head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .embed__who { display: flex; flex-direction: column; min-width: 0; }
    .embed__who strong { font-size: 14px; font-weight: 600; }
    .embed__who small { font-size: 12px; color: var(--lf-muted); }
    .embed h2 { margin: 4px 0; font-size: 17px; }
    .embed p { margin: 0; font-size: 15px; line-height: 1.4; white-space: pre-line; }
    .embed img { display: block; width: calc(100% + 24px); margin: 10px -12px -12px; max-height: 300px; object-fit: cover; }
    .embed.gone { display: flex; gap: 8px; align-items: center; color: var(--lf-muted); }
    section.gone { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; color: var(--lf-text); }
    section.gone p { margin: 0; color: var(--lf-muted); line-height: 1.5; }

    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    /* LinkedIn's stats line + action bar */
    .stats { display: flex; align-items: center; justify-content: space-between; padding: 8px var(--edge) 6px; font-size: 13px; color: var(--lf-muted); }
    .stats button { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 0; }
    .stats__likes { display: inline-flex; align-items: center; gap: 6px; }
    .stats__react { display: inline-flex; align-items: center; gap: 6px; }
    .stack { display: inline-flex; }
    .stack lf-reaction-icon + lf-reaction-icon { margin-left: -6px; }
    .stats__right { display: inline-flex; align-items: center; gap: 12px; }
    /* React - Comment - Repost - Send, the four actions spread the full width
       the way LinkedIn draws them, instead of bunched at the start. */
    .actions { display: flex; align-items: center; margin: 0 8px; padding: 4px 0; border-top: 1px solid var(--lf-line-soft); }
    .act { flex: 1 1 0; min-width: 0; height: 44px; border: 0; background: transparent; color: var(--lf-muted); font-family: inherit;
      font-size: 14px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; border-radius: 6px; }
    .act:hover, .act:active { background: var(--lf-hover); }
    .act.on { color: var(--lf-primary); }
    @media (max-width: 430px) { .actions { margin: 0 4px; } .act { font-size: 12.5px; gap: 4px; } }
    @media (max-width: 360px) { .act { font-size: 11.5px; gap: 3px; } }
    .chatline { display: flex; align-items: center; justify-content: center; gap: 8px; width: calc(100% - 24px); margin: 4px 12px 12px;
      height: 38px; border: 1px solid var(--lf-line); border-radius: 6px; background: transparent; color: var(--ion-text-color);
      font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
    .chatline.open { background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); border-color: transparent; }

    /* the two questions */
    .ask { display: flex; flex-direction: column; gap: 8px; margin: 8px 0; padding: 14px var(--edge); background: var(--lf-card); box-shadow: var(--lf-shadow); }
    .ask--col { gap: 8px; }
    .ask__q { margin: 0 0 2px; font-size: 15px; font-weight: 700; }
    .big { display: flex; align-items: center; justify-content: center; gap: 8px; height: 44px; border: 1px solid var(--lf-line); border-radius: 8px;
      background: transparent; color: var(--ion-text-color); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
    .big--go { background: var(--lf-primary-fill); border-color: var(--lf-primary-fill); color: #fff; }
    .note { margin: 8px var(--edge); padding: 10px 12px; border-radius: 8px; background: var(--lf-card); color: var(--ion-text-color); font-size: 14px; line-height: 1.45; }

    /* Conversation thread - sender row, message bubble and compact Like/Reply actions. */
    /* The comment composer belongs to the viewport, not the conversation. Keep
       enough room in the thread for its fixed bottom bar so the last comment
       can still be read above it. */
    .comments { background: var(--lf-card); box-shadow: var(--lf-shadow); padding: 12px var(--edge) calc(116px + var(--lf-safe-bottom)); }
    .sighting-trigger { display: flex; align-items: center; gap: 8px; width: 100%; margin: 0 0 10px; padding: 10px 12px; border: 1px solid var(--lf-line);
      border-radius: 8px; background: var(--lf-card-2); color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .sighting-trigger span { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .sighting-trigger small { color: var(--lf-muted); font-size: 12px; }
    .sighting-trigger.on { border-color: transparent; background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
    .sighting-form { display: flex; flex-direction: column; gap: 10px; margin: -2px 0 12px; padding: 12px; border: 1px solid var(--lf-line); border-radius: 9px; background: var(--lf-bg); }
    .sighting-form label { display: flex; flex-direction: column; gap: 4px; color: var(--ion-text-color); font-size: 12px; font-weight: 700; }
    .sighting-form input, .sighting-form select, .sighting-form textarea { width: 100%; box-sizing: border-box; min-height: 38px; padding: 8px 10px; border: 1px solid var(--lf-line); border-radius: 7px; background: var(--lf-card); color: inherit; font: inherit; font-size: 14px; font-weight: 400; }
    .sighting-form textarea { min-height: 76px; resize: vertical; }
    .sighting-form__two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .sighting-form__hint { margin: 0; color: var(--lf-muted); font-size: 12px; line-height: 1.4; }
    .sighting-form__actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
    .sighting-form__actions .big { min-width: 148px; height: 38px; font-size: 13px; }
    .cbox { position: fixed; inset-inline: 0; bottom: 0; z-index: 30; display: flex; align-items: flex-start; gap: 8px;
      box-sizing: border-box; padding: 8px var(--edge) max(8px, var(--lf-safe-bottom));
      background: color-mix(in srgb, var(--lf-card) 96%, transparent); box-shadow: 0 -4px 18px rgba(0,0,0,.12);
      overscroll-behavior: contain; }
    .cbox > .compose { width: min(100%, var(--lf-maxw)); margin: 0 auto; }
    @media (min-width: 700px) {
      .cbox { padding-inline: max(var(--edge), calc((100vw - var(--lf-maxw)) / 2 + var(--edge))); }
    }
    .compose { flex: 1; min-width: 0; }
    .field { width: 100%; min-width: 0; box-sizing: border-box; display: flex; align-items: flex-end; gap: 6px; padding: 6px 6px 6px 14px; border: 1px solid var(--lf-line); border-radius: 20px; background: var(--lf-card); overscroll-behavior-y: contain; touch-action: pan-y; }
    .field textarea { flex: 1; min-width: 0; max-height: 120px; padding: 6px 0; border: 0; outline: 0; resize: none; overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y; background: transparent; color: var(--ion-text-color); font: inherit; font-size: 15px; line-height: 1.35; }
    .field .post { height: 30px; padding: 0 14px; margin-bottom: 1px; border: 0; border-radius: 15px; background: var(--lf-primary-fill); color: #fff; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
    .field .post:disabled { opacity: .6; }
    .attach-actions { display: flex; align-items: center; gap: 4px; min-height: 34px; padding: 3px 0; }
    .attach-actions button { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--lf-muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .attach-actions button:hover:not(:disabled) { background: var(--lf-hover); }
    .attach-actions button:disabled { opacity: .4; cursor: default; }
    .attach-actions span { margin-left: auto; color: var(--lf-muted); font-size: 11px; text-align: right; }
    .attach-preview { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 2px; }
    .attach-preview__item { position: relative; width: min(150px, 44vw); height: 112px; overflow: hidden; border-radius: 8px; background: #000; }
    .attach-preview__item img, .attach-preview__item video { display: block; width: 100%; height: 100%; object-fit: cover; }
    .attach-preview__item > button { position: absolute; top: 5px; right: 5px; display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 50%; background: #000b; color: #fff; cursor: pointer; }
    .attach-preview__item > button:disabled { opacity: .55; cursor: wait; }
    .signin { width: 100%; height: 42px; border: 0; border-radius: 21px; background: var(--lf-primary-fill); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
    .replying { display: flex; align-items: center; justify-content: space-between; margin: 0 0 6px 48px; font-size: 13px; color: var(--lf-muted); }
    .replying button { border: 0; background: transparent; color: inherit; cursor: pointer; }
    .leadrow { margin: 0 0 8px 48px; font-size: 13px; color: var(--lf-muted); display: flex; flex-direction: column; gap: 6px; }
    .markin { padding: 8px 10px; border: 1px solid var(--lf-line); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
    /* LinkedIn's comment box is a rounded pill that grows with the text. */
    .composer textarea, .composer .fld { border-radius: 999px !important; }
    .sort { display: flex; justify-content: flex-end; margin: 12px 0 2px; }
    .sort button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: var(--lf-muted); font: inherit; font-size: 13px; cursor: pointer; }
    .cmsg { display: flex; align-items: flex-start; gap: 8px; margin-top: 14px; }
    .cmsg__body { flex: 1; min-width: 0; }
    .cmsg--reply { margin-top: 9px; }
    .replies { position: relative; margin: 7px 0 0 15px; padding-left: 15px; border-left: 2px solid var(--lf-line-soft); }
    /* Each horizontal branch makes the reply's parent relationship visible on
       a phone, rather than relying on indentation alone. */
    .cmsg--reply { position: relative; }
    .replies .cmsg--reply::before { content: ''; position: absolute; left: -15px; top: 17px; width: 13px; border-top: 2px solid var(--lf-line-soft); }
    /* LinkedIn does not put a comment in a speech bubble - the text sits on the
       card, under the name, and the time lives in the action row with the
       buttons. A bubble read as a private message, which this is not. */
    .ccard { border: 0; border-radius: 0; background: transparent; padding: 0; }
    .who-list { position: absolute; z-index: 12; left: 0; right: 0; bottom: calc(100% + 4px); display: flex; flex-direction: column;
      padding: 6px; border: 1px solid var(--lf-line-soft); border-radius: 10px; background: var(--lf-card); box-shadow: var(--lf-shadow); }
    .who-list button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 8px; border: none; border-radius: 8px;
      background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .who-list button:hover, .who-list button[aria-selected="true"] { background: var(--lf-hover); }
    .who-list__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; font-weight: 600; }
    .who-list small { color: var(--lf-muted); font-size: 11.5px; }
    .who-list__none { margin: 2px 4px; font-size: 12px; color: var(--lf-muted); }
    .field { position: relative; }
    .mention { color: var(--lf-link); font-weight: 600; text-decoration: none; }
    .mention:hover { text-decoration: underline; }
    .cfollow { flex: none; border: 1px solid var(--lf-primary-text); border-radius: 999px; background: none; color: var(--lf-primary-text);
      font: inherit; font-size: 11.5px; font-weight: 600; line-height: 1; padding: 4px 9px; cursor: pointer; opacity: .55; }
    .ccard__top:hover .cfollow, .cfollow:focus-visible, .cfollow.on { opacity: 1; }
    .cfollow.on { color: var(--lf-muted); border-color: var(--lf-line); }
    .ccard__top { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .ccard__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; color: var(--ion-text-color); text-decoration: none; }
    .ccard__time { margin-left: auto; flex: none; color: var(--lf-muted); font-size: 11px; }
    .ccard__headline { display: block; margin-top: 1px; font-size: 12px; color: var(--lf-muted); }
    .tag { padding: 1px 6px; border-radius: 10px; background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); font-size: 11px; font-weight: 700; }
    .ccard__text { margin: 5px 0 6px; font-size: 14.5px; line-height: 1.42; white-space: pre-line; word-break: break-word; }
    .comment-media { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: 6px; margin: 8px 0; }
    .comment-media lf-media-img, .comment-media lf-media-video { display: block; width: 100%; max-height: 360px; border-radius: 8px; overflow: hidden; background: #000; }
    .lead { display: inline-block; margin-bottom: 6px; padding: 1px 8px; border-radius: 10px; background: color-mix(in srgb, var(--lf-ubuntu) 18%, transparent); color: var(--lf-ubuntu); font-size: 11.5px; font-weight: 700; }
    .sighting { display: flex; align-items: center; gap: 5px; margin-bottom: 6px; font-size: 13px; color: var(--lf-muted); }
    .checked { display: flex; align-items: center; gap: 5px; margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--lf-ubuntu); }
    .closed, .still-status { display: flex; gap: 8px; align-items: flex-start; margin: 4px 0 10px; padding: 10px 12px; border-radius: 8px;
      background: color-mix(in srgb, var(--lf-ubuntu) 12%, transparent); color: inherit; font-size: 13.5px; line-height: 1.35; }
    .still-status strong { color: var(--lf-ubuntu); font-weight: 700; }
    .big:disabled { opacity: .65; cursor: wait; }
    /* A lead is useful information, not an error: this used to be drawn in the
       red "signal" colour, which read as a warning banner on a case page. */
    .leads { display: flex; align-items: center; gap: 8px; width: 100%; margin: 2px 0 8px; padding: 10px 12px;
      border: 1px solid var(--lf-line); border-radius: 8px;
      background: var(--lf-card-2); color: inherit; cursor: pointer;
      font-family: inherit; font-size: 14px; text-align: left; }
    .leads__text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .leads__tick { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 999px;
      background: var(--lf-ubuntu); color: #fff; font-size: 12px; font-weight: 700; }
    .mark { margin: 0 0 6px; font-size: 13px; color: var(--lf-muted); }
    .ccard__acts { display: flex; align-items: center; gap: 14px; padding: 4px 0 2px 0; border-top: 0; }
    .ccard__acts button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: var(--lf-muted); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; padding: 0; }
    .ccard__acts .ctime2 { color: var(--lf-muted); font-size: 12px; }
    .ccard__acts button.on { color: var(--lf-primary); }
    .clikes { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--lf-muted); }
    .ctime { font-size: 12px; color: var(--lf-muted); }
    .dots { margin-left: auto; border: 0; background: transparent; color: var(--lf-muted); cursor: pointer; padding: 0; }
    .viewrep { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; border: 0; background: transparent; color: var(--lf-muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .edit { display: flex; flex-direction: column; gap: 6px; }
    .edit textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--lf-line); border-radius: 8px; background: var(--lf-card-2); color: inherit; font: inherit; font-size: 14px; resize: vertical; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
    .edit__row { display: flex; gap: 8px; margin: 4px 0 0; }
    .pill { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 1px solid var(--lf-line); border-radius: 15px;
      background: transparent; color: var(--ion-text-color); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .pill--go { background: var(--lf-primary-fill); border-color: var(--lf-primary-fill); color: #fff; }

    .sheetwrap { position: fixed; inset: 0; z-index: 40; background: var(--lf-scrim); display: flex; align-items: flex-end; justify-content: center; }
    .sheet { width: 100%; max-width: 520px; max-height: 88vh; overflow-y: auto; background: var(--lf-card); border-radius: 18px 18px 0 0; padding: 18px 18px 28px; display: flex; flex-direction: column; gap: 8px; }
    .sheet__top { display: flex; justify-content: space-between; align-items: center; } .sheet__top h3 { margin: 0; font-size: 18px; }
    .sheet__p { margin: 0; font-size: 14px; line-height: 1.45; } .muted { color: var(--lf-muted); }
    .k { font-size: 12px; font-weight: 700; color: var(--lf-muted); }
    .fld { width: 100%; box-sizing: border-box; border-radius: 12px; border: 1px solid var(--lf-line); background: var(--lf-card-2); color: inherit; font: inherit; padding: 12px; }
    .hits { display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow-y: auto; }
    .hit { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 12px; border: 1px solid var(--lf-line); background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .hit.on { border-color: var(--lf-primary); background: color-mix(in srgb, var(--lf-primary) 14%, transparent); }
    .hit span { display: flex; flex-direction: column; gap: 1px; } .hit small { color: var(--lf-muted); font-size: 12px; }
    .textbtn { background: none; border: 0; color: var(--lf-muted); font-size: 13px; font-weight: 700; text-decoration: underline; cursor: pointer; padding: 6px; }
    .textbtn:disabled { opacity: .5; }
    @media (min-width: 700px) { .post, .ask, .note, .comments { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; } }
  `]
})
export class PostDetailComponent implements OnInit {
  protected data = inject(DataService);
  protected auth = inject(AuthService);
  private chat = inject(ChatService);
  private router = inject(Router);
  private lookouts = inject(LookoutService);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastController);
  private alert = inject(AlertController);
  private sheets = inject(ActionSheetController);
  private mod = inject(ModerationService);
  protected media = inject(MediaService);
  protected isAdmin = (): boolean => this.mod.isAdmin();
  private actions = inject(PostActionsService);
  private prefs = new KvStore('lulafind.post-detail');

  @ViewChild('box') box?: ElementRef<HTMLTextAreaElement>;

  protected readonly compact = compact;
  protected readonly timeAgo = timeAgo;
  protected readonly provinces = PROVINCES;
  /** Whether this account asked to hear about changes to this case. */
  readonly followingCase = computed(() => !!this.p() && this.data.isFollowingCase(this.p()!.id));
  /** Whether this account has volunteered to look near the last-seen area. */
  readonly looking = computed(() => {
    const me = this.auth.viewerId;
    return !!me && !!this.p()?.lookingIds?.includes(me);
  });
  readonly lookingCount = computed(() => this.p()?.lookingIds?.length ?? 0);
  protected readonly headingIsNew = headingIsNewFn;
  protected readonly dayMonth = dayMonth;
  protected readonly provinceName = provinceName;
  protected readonly leadMark = leadMarkView;

  p = signal<Post | null>(null);
  original = signal<Post | null>(null);
  comments = signal<Comment[]>([]);
  gate = signal<ChatGate>({ allowed: true, reason: 'open' });
  following = signal(false);
  followRequested = signal(false);
  sort = signal<'relevant' | 'recent'>('relevant');
  expanded = signal<Set<string>>(new Set());
  editingId = signal<string | null>(null);
  editDraft = signal('');
  replyTo = signal<{ rootId: string; name: string } | null>(null);
  draft = signal('');
  readonly commentMedia = signal<MediaItem[]>([]);
  asLead = signal(false);
  markGuess = signal('');
  posting = signal(false);
  readonly lookingBusy = signal(false);
  readonly sightingOpen = signal(false);
  sightingPlace = '';
  sightingProvince: ProvinceCode = 'GP';
  sightingWhen = '';
  sightingNote = '';
  khumbuNote = '';

  readonly me = computed(() => this.auth.viewerId);
  readonly isMine = computed(() => this.p()?.authorId === this.auth.viewerId);
  readonly author = computed(() => (this.p() ? this.data.authorOf(this.p()!.authorId) ?? null : null));
  readonly authorName = computed(() =>
    this.p()?.anonymous && !this.isMine() ? 'Anonymous' : this.author()?.displayName ?? 'Member');
  readonly authorHeadline = computed(() =>
    this.p()?.anonymous && !this.isMine() ? '' : this.author()?.bio ?? '');
  readonly authorAvatar = computed(() => this.data.avatarFor(this.p()?.anonymous && !this.isMine() ? null : this.author()));
  readonly authorLink = computed(() => (this.p()?.anonymous && !this.isMine() ? ['/post', this.p()!.id] : ['/user', this.p()?.authorId ?? '']));
  readonly myAvatar = computed(() => this.data.avatarFor(this.auth.user()));

  /** The attachment rule, shared with the composer: three photos, one video. */
  readonly maxPhotos = POST_MAX_PHOTOS;
  readonly photoMb = mb(PHOTO_MAX_BYTES);
  readonly videoMb = mb(VIDEO_MAX_BYTES);
  readonly myName = computed(() => this.auth.user()?.displayName ?? 'Me');
  readonly latestStillSearching = computed(() => (this.p()?.events ?? [])
    .filter((event) => event.kind === 'still_searching')
    .sort((a, b) => b.at - a.at)[0] ?? null);
  readonly searchingBusy = signal(false);
  readonly myVote = computed(() => (this.p() ? this.data.myVote(this.p()!) : null));
  readonly originalName = computed(() => {
    const o = this.original();
    return o ? (o.anonymous ? 'Anonymous' : this.data.authorOf(o.authorId)?.displayName ?? 'Member') : '';
  });
  readonly originalAvatar = computed(() => {
    const o = this.original();
    return this.data.avatarFor(o && !o.anonymous ? this.data.authorOf(o.authorId) : null);
  });
  readonly reactionsOpen = signal(false);
  readonly topKinds = computed<ReactionKind[]>(() => {
    const counts = new Map<ReactionKind, number>();
    for (const v of Object.values(this.p()?.voterIds ?? {})) if (isReaction(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
    const order = REACTIONS.map((r) => r.key);
    const kinds = [...counts.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0])).map(([k]) => k);
    return (kinds.length ? kinds : ['up' as ReactionKind]).slice(0, 3);
  });
  readonly sorted = computed(() => {
    const top = this.comments().filter((c) => !c.parentId);
    return this.sort() === 'recent'
      ? [...top].sort((a, b) => b.createdAt - a.createdAt)
      : [...top].sort((a, b) => b.upvotes - a.upvotes || a.createdAt - b.createdAt);
  });
  readonly notMe = computed(() => this.dismissed().includes(this.p()?.id ?? ''));

  isCase(): boolean {
    const t = this.p()?.type;
    return t === 'missing' || t === 'khumbulekhaya';
  }

  /**
   * Leads on this case: what people saw or know, newest first. The family reads
   * these before anything else, so they are counted at the top of the case.
   */
  readonly leads = computed(() =>
    this.comments()
      .filter((c) => !c.parentId && (c.isLead || !!c.sighting))
      .sort((a, b) => b.createdAt - a.createdAt)
  );
  readonly verified = computed(() => this.p()?.sightingVerified ?? null);
  private dismissed = signal<string[]>(this.prefs.get<string[]>('notMe', []));

  /** False until the store has answered for this id - keeps "gone" honest. */
  readonly loaded = signal(false);

  goHome(): void { void this.router.navigate(['/home']); }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.loaded.set(true); return; }
    const cached = this.data.post(id);
    if (cached) this.p.set(cached);
    const fresh = await this.data.loadPost(id);
    if (fresh) {
      this.p.set(fresh);
      await this.data.registerView(id);
      if (fresh.repostOf) {
        this.original.set((await this.data.loadPost(fresh.repostOf)) ?? null);
      }
    }
    this.loaded.set(true);
    this.comments.set(await this.data.comments(id));
    await this.refreshGate();
    const followState = this.p() ? await this.data.followStatus(this.p()!.authorId) : null;
    this.following.set(followState === 'accepted');
    this.followRequested.set(followState === 'pending');

    const fragment = this.route.snapshot.fragment;
    if (fragment === 'found' && this.isMine()) this.markFound();
    if (fragment === 'comments') setTimeout(() => this.focusComment(), 250);
  }

  private async refreshGate(): Promise<void> {
    const p = this.p();
    if (!p) return;
    this.gate.set(await this.chat.gate(p, p.khumbu?.claimedByUserId === this.auth.viewerId));
  }

  private async reload(): Promise<void> {
    const id = this.p()?.id;
    if (!id) return;
    this.p.set((await this.data.loadPost(id)) ?? null);
  }

  /* ---------------------- header + actions ---------------------- */
  /** "You reposted this" / "Thabo Nkosi reposted this" - LinkedIn's reshare line. */
  reposterLine(): string {
    return this.isMine() ? 'You reposted this' : `${this.authorName()} reposted this`;
  }

  async react(kind: ReactionKind): Promise<void> {
    if (!this.auth.signedIn()) return this.needAuth();
    const p = this.p();
    if (!p) return;
    const saving = this.data.vote(p.id, kind);
    // DataService updates its feed/cache signals synchronously before the write;
    // mirror that immediately so the detail button changes without a round trip.
    this.p.set(this.data.post(p.id) ?? p);
    try {
      await saving;
      this.p.set(this.data.post(p.id) ?? null);
    } catch (e: unknown) {
      this.p.set(this.data.post(p.id) ?? p);
      await this.say(e instanceof Error ? e.message : 'Could not save your reaction');
    }
  }

  repost(): void { const p = this.p(); if (p) void this.actions.openRepost(p); }
  send(): void { const p = this.p(); if (p) void this.actions.send(p); }

  async toggleFollow(): Promise<void> {
    if (!this.auth.signedIn()) return this.needAuth();
    const p = this.p();
    if (!p) return;
    await this.data.toggleFollow(p.authorId);
    const state = await this.data.followStatus(p.authorId);
    this.following.set(state === 'accepted');
    this.followRequested.set(state === 'pending');
    await this.refreshGate();
  }

  /** Tell the family you are checking the last-seen area, without exposing your live location. */
  async toggleLooking(): Promise<void> {
    if (!this.auth.signedIn()) return this.needAuth();
    const p = this.p();
    if (!p || this.lookingBusy()) return;
    this.lookingBusy.set(true);
    try {
      const on = await this.data.markLooking(p.id);
      await this.reload();
      await this.say(on ? 'The family knows you are looking near the case.' : 'You are no longer marked as looking.');
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not update the search team');
    } finally {
      this.lookingBusy.set(false);
    }
  }

  /** Open the structured sighting sheet instead of forcing a family to parse free text. */
  openSightingForm(): void {
    if (this.sightingOpen()) {
      this.closeSightingForm();
      return;
    }
    const p = this.p();
    if (!p) return;
    this.sightingProvince = p.province;
    this.sightingPlace = '';
    this.sightingWhen = this.localDateTime(Date.now());
    this.sightingNote = '';
    this.sightingOpen.set(true);
  }

  closeSightingForm(): void {
    this.sightingOpen.set(false);
    this.sightingPlace = '';
    this.sightingNote = '';
  }

  private localDateTime(at: number): string {
    const d = new Date(at);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** Save a sighting as a lead with a time and place the family can act on. */
  async reportSighting(): Promise<void> {
    if (!this.auth.signedIn()) return this.needAuth();
    const p = this.p();
    const place = this.sightingPlace.trim();
    const when = Date.parse(this.sightingWhen);
    if (!p || !place) return;
    if (!Number.isFinite(when)) return this.say('Choose when you saw them so the family can place the lead in time.');
    if (when > Date.now() + 5 * 60_000) return this.say('A sighting time cannot be in the future.');
    this.posting.set(true);
    try {
      const note = this.sightingNote.trim();
      const sighting: Sighting = { place, province: this.sightingProvince, when, note: note || undefined };
      await this.data.addComment({
        postId: p.id,
        body: note || `I saw someone matching this case near ${place}.`,
        isLead: true,
        sighting
      });
      this.comments.set(await this.data.comments(p.id));
      this.p.set(this.data.post(p.id) ?? p);
      this.closeSightingForm();
      await this.say('Sighting submitted as a lead for the family.');
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not submit the sighting');
    } finally {
      this.posting.set(false);
    }
  }

  more(): void {
    const p = this.p();
    if (p) void this.actions.openMenu(p, () => void this.router.navigate(['/home'], { replaceUrl: true }));
  }

  /* --------------------------- comments --------------------------- */

  /** What the `@` in the box can still become, and which row is highlighted. */
  protected mentionOpen = signal(false);
  protected mentionQuery = signal('');
  protected mentionAt = signal(0);
  private mentionStart = -1;

  /**
   * LinkedIn's mention list is not the whole address book - it offers the people in
   * front of you. On a missing-person post that limit matters more than usual: a
   * stranger you have never followed cannot be dragged into a case by an @, and
   * the person named is the one already reading the thread.
   */
  readonly mentionPool = computed<UserProfile[]>(() => {
    const p = this.p();
    const ids = new Set<string>();
    if (p) ids.add(p.authorId);
    for (const c of this.comments()) {
      ids.add(c.authorId);
      for (const r of this.repliesOf(c.id)) ids.add(r.authorId);
    }
    const me = this.me();
    if (me) ids.delete(me);
    return [...ids].map((id) => this.data.authorOf(id)).filter((u): u is UserProfile => !!u);
  });

  readonly mentionPeople = computed<UserProfile[]>(() => {
    const q = this.mentionQuery().trim().toLowerCase();
    const pool = this.mentionPool();
    const hits = q
      ? pool.filter((u) => u.displayName.toLowerCase().includes(q) || u.handle.toLowerCase().includes(q))
      : pool;
    return hits.slice(0, 6);
  });

  /** Typing in the box: grow it, and open or close the @ list off the tail. */
  private scanMentions(value: string): void {
    const at = value.lastIndexOf('@');
    if (at < 0) return this.closeMentions();
    const tail = value.slice(at + 1);
    // A name follows the @ with no space, and an email address is not a mention.
    const before = at === 0 ? '' : value[at - 1];
    if (/\s/.test(tail) || tail.length > 24 || (before && !/[\s(:,]/.test(before))) return this.closeMentions();
    this.mentionStart = at;
    this.mentionQuery.set(tail);
    this.mentionAt.set(0);
    this.mentionOpen.set(true);
  }

  private closeMentions(): void {
    if (!this.mentionOpen() && this.mentionStart < 0) return;
    this.mentionOpen.set(false);
    this.mentionQuery.set('');
    this.mentionStart = -1;
  }

  /** Up and down walk the list; Escape shuts it; Enter picks instead of posting. */
  onMentionKeys(ev: Event): void {
    const e = ev as KeyboardEvent;
    if (!this.mentionOpen()) return;
    const n = this.mentionPeople().length;
    if (e.key === 'Escape') { e.stopPropagation(); this.closeMentions(); return; }
    if (!n) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      this.mentionAt.set((this.mentionAt() + step + n) % n);
    }
  }

  protected pickMention(u: UserProfile): void {
    const el = this.box?.nativeElement;
    const value = el ? el.value : this.draft();
    if (this.mentionStart < 0) return;
    const end = this.mentionStart + 1 + this.mentionQuery().length;
    const next = `${value.slice(0, this.mentionStart)}@${u.displayName} ${value.slice(end)}`;
    if (el) {
      el.value = next;
      el.focus();
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
    this.draft.set(next);
    this.closeMentions();
  }

  /**
   * Who the finished text really names, resolved against the same pool the list
   * offered - so typing the words by hand counts the same as picking from the list.
   */
  mentionedIds(body: string): string[] {
    const found: string[] = [];
    for (const m of body.matchAll(/(?:^|[\s(:,])@([^\s@]{1,24})/g)) {
      const name = m[1].toLowerCase().replace(/[.,;:]+$/, '');
      if (!name) continue;
      const hit = this.mentionPool().find((u) => u.handle.toLowerCase() === name
        || u.displayName.toLowerCase() === name
        || u.displayName.toLowerCase().split(/\s+/)[0] === name);
      if (hit && !found.includes(hit.id)) found.push(hit.id);
    }
    return found;
  }

  /** One `@name` becomes a link to the profile; anything else stays plain text. */
  parts(body: string): { text: string; userId?: string }[] {
    const out: { text: string; userId?: string }[] = [];
    const re = /(?:^|[\s(:,])@([^\s@]{1,24})/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const at = m.index + m[0].indexOf('@');
      const name = m[1].replace(/[.,;:]+$/, '');
      const hit = this.mentionPool().find((u) => u.handle.toLowerCase() === name.toLowerCase()
        || u.displayName.toLowerCase() === name.toLowerCase()
        || u.displayName.toLowerCase().split(/\s+/)[0] === name.toLowerCase());
      const before = body.slice(last, at);
      if (before) out.push({ text: before });
      out.push(hit ? { text: `@${name}`, userId: hit.id } : { text: `@${name}` });
      last = at + 1 + name.length;
    }
    const rest = body.slice(last);
    if (rest) out.push({ text: rest });
    return out;
  }

  /** A commenter you do not follow is one tap from being someone you do. */
  isFollowing(id: string): boolean {
    return this.data.followingIds().includes(id);
  }

  async followPerson(id: string): Promise<void> {
    if (!this.auth.signedIn()) return this.needAuth();
    try {
      const now = await this.data.toggleFollow(id);
      await this.data.loadUserScoped();
      await this.say(now ? 'Following them - their posts will show up in your feed.' : 'Unfollowed');
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not change that follow');
    }
  }

  repliesOf(parentId: string): Comment[] {
    return this.comments().filter((c) => c.parentId === parentId).sort((a, b) => a.createdAt - b.createdAt);
  }
  nameOf(id: string): string { return this.data.authorOf(id)?.displayName ?? 'Member'; }
  /** LinkedIn shows the commenter's headline under their name. */
  headlineOf(id: string): string { return this.data.authorOf(id)?.bio ?? ''; }
  avatarOf(id: string): string { return this.data.avatarFor(this.data.authorOf(id)); }
  liked(c: Comment): boolean { const me = this.me(); return !!me && (c.likedIds ?? []).includes(me); }
  canLead(): boolean { const t = this.p()?.type; return !!t && !this.isMine() && (t === 'missing' || t === 'sighting' || t === 'pet' || t === 'khumbulekhaya'); }

  toggleSort(): void { this.sort.set(this.sort() === 'relevant' ? 'recent' : 'relevant'); }

  /** One line of a lead, for the strip. */
  shortBody(c: Comment): string {
    const text = c.body.replace(/\s+/g, ' ').trim();
    return text.length > 40 ? `${text.slice(0, 40)}\u2026` : text;
  }

  /** Jump to what people saw - the leads first. */
  openLeads(): void {
    this.sort.set('recent');
    const el = typeof document !== 'undefined' ? document.getElementById('comments') : null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Admin checks a lead against something official (CCTV, police, records).
   * The badge is what separates a rumour from a lead the family can act on.
   */
  async verifyLead(): Promise<void> {
    await this.mod.verifySighting(this.p()!.id, 'police');
    await this.reload();
    await this.say('Lead marked as checked');
  }

  async unverifyLead(): Promise<void> {
    await this.mod.unverifySighting(this.p()!.id);
    await this.reload();
    await this.say('Check removed');
  }
  expand(id: string): void { this.expanded.update((s) => new Set(s).add(id)); }
  collapse(id: string): void {
    this.expanded.update((current) => { const next = new Set(current); next.delete(id); return next; });
  }

  focusComment(): void {
    if (!this.auth.signedIn()) return this.needAuth();
    const el = this.box?.nativeElement;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus();
  }

  startReply(root: Comment, target: Comment): void {
    if (!this.auth.signedIn()) return this.needAuth();
    this.replyTo.set({ rootId: root.id, name: this.nameOf(target.authorId) });
    this.expand(root.id);
    setTimeout(() => this.box?.nativeElement.focus(), 30);
  }
  cancelReply(): void { this.replyTo.set(null); }

  hasCommentVideo(): boolean { return this.commentMedia().some((item) => item.kind === 'video'); }

  async addCommentPhoto(): Promise<void> {
    if (this.posting() || this.media.busy() || this.commentMedia().length >= this.maxPhotos || this.hasCommentVideo()) return;
    const item = await this.media.pickImage({ quality: 76 });
    const notice = this.media.notice();
    if (notice) await this.say(notice);
    if (!item) {
      const message = this.media.lastError();
      if (message) await this.say(message);
      return;
    }
    const src = await this.media.compress(item.src, 1200);
    this.commentMedia.update((items) => [...items, { ...item, src }]);
  }

  async addCommentVideo(): Promise<void> {
    if (this.posting() || this.media.busy() || this.commentMedia().length) return;
    const item = await this.media.pickVideo();
    if (!item) {
      const message = this.media.lastError();
      if (message) await this.say(message);
      return;
    }
    this.commentMedia.set([item]);
  }

  removeCommentMedia(id: string): void {
    if (!this.posting()) this.commentMedia.update((items) => items.filter((item) => item.id !== id));
  }

  onType(ev: Event): void {
    const el = ev.target as HTMLTextAreaElement;
    this.draft.set(el.value);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    this.scanMentions(el.value);
  }

  /**
   * Kept as a small compatibility hook for existing unit tests and assistive
   * integrations. There is deliberately no app emoji picker or emoji button;
   * normal users use the phone keyboard's native emoji key.
   */
  addEmoji(e: string): void {
    const el = this.box?.nativeElement;
    const next = `${this.draft()}${e}`;
    if (el) {
      el.value = next;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
    this.draft.set(next);
    this.scanMentions(next);
  }

  /** Enter sends on a keyboard; on a phone it starts a new line. */
  onEnter(ev: Event): void {
    const e = ev as KeyboardEvent;
    if (this.mentionOpen() && this.mentionPeople().length) {
      e.preventDefault();
      this.pickMention(this.mentionPeople()[Math.min(this.mentionAt(), this.mentionPeople().length - 1)]);
      return;
    }
    if (e.shiftKey || (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)) return;
    e.preventDefault();
    void this.submitComment();
  }

  async submitComment(): Promise<void> {
    if (!this.auth.signedIn()) return this.needAuth();
    const body = this.draft().trim();
    const media = this.commentMedia();
    const p = this.p();
    if ((!body && !media.length) || !p || this.posting()) return;
    const reply = this.replyTo();
    const lead = this.asLead() && !reply && !!body;
    this.posting.set(true);
    try {
      const mentions = this.mentionedIds(body);
      await this.data.addComment({
        postId: p.id, body, parentId: reply?.rootId ?? null, isLead: lead, media, mentions,
        markGuess: lead && this.markGuess().trim() ? this.markGuess().trim() : undefined
      });
      this.comments.set(await this.data.comments(p.id));
      this.p.set(this.data.post(p.id) ?? null);
      // The comment is out and only an attachment is missing: say so once, in the
      // words the uploader used, rather than leaving the writer to notice.
      const stuck = this.data.commentMediaNotice();
      if (stuck) {
        this.data.commentMediaNotice.set('');
        await this.say(stuck);
      }
      if (reply) this.expand(reply.rootId);
      this.draft.set('');
      this.commentMedia.set([]);
      const el = this.box?.nativeElement;
      if (el) { el.value = ''; el.style.height = 'auto'; }
      this.replyTo.set(null);
      this.asLead.set(false);
      this.markGuess.set('');
      this.closeMentions();
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not post your comment');
    } finally {
      this.posting.set(false);
    }
  }

  async likeComment(c: Comment): Promise<void> {
    if (!this.auth.signedIn()) return this.needAuth();
    try {
      await this.data.voteComment(c);
      const p = this.p();
      if (p) this.comments.set(await this.data.comments(p.id));
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not like that');
    }
  }

  async commentMenu(c: Comment): Promise<void> {
    const mine = c.authorId === this.me();
    const canRemove = mine || this.isMine();
    const buttons: { text: string; role?: string; handler?: () => void }[] = [];
    if (mine) buttons.push({ text: 'Edit', handler: () => { this.editDraft.set(c.body); this.editingId.set(c.id); } });
    if (canRemove) buttons.push({ text: 'Delete', role: 'destructive', handler: () => void this.removeComment(c) });
    if (!mine) buttons.push({ text: 'Report comment', role: 'destructive', handler: () => void this.reportComment(c) });
    buttons.push({ text: 'Cancel', role: 'cancel' });
    const sheet = await this.sheets.create({
      header: 'Comment',
      buttons: buttons.map((b) => ({
        text: b.text,
        role: b.role,
        handler: b.handler ? () => { b.handler!(); } : undefined
      }))
    });
    await sheet.present();
  }

  async saveEdit(c: Comment): Promise<void> {
    try {
      await this.data.editComment(c, this.editDraft());
      this.editingId.set(null);
      const p = this.p();
      if (p) this.comments.set(await this.data.comments(p.id));
      await this.say('Comment updated');
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not update your comment');
    }
  }

  async removeComment(c: Comment): Promise<void> {
    const p = this.p();
    if (!p) return;
    try {
      await this.data.deleteComment(c);
      this.comments.set(await this.data.comments(p.id));
      this.p.set(this.data.post(p.id) ?? null);
      // The comment is out and only an attachment is missing: say so once, in the
      // words the uploader used, rather than leaving the writer to notice.
      const stuck = this.data.commentMediaNotice();
      if (stuck) {
        this.data.commentMediaNotice.set('');
        await this.say(stuck);
      }
      await this.say(c.parentId ? 'Reply deleted' : 'Comment deleted');
    } catch (e: unknown) {
      await this.say(e instanceof Error ? `Not deleted: ${e.message}` : 'The comment was not deleted');
    }
  }

  private async reportComment(c: Comment): Promise<void> {
    if (!this.auth.signedIn()) return this.needAuth();
    const pick = await this.alert.create({
      header: 'Report this comment',
      inputs: this.mod.reasons.map((r, i) => ({ name: 'reason', type: 'radio' as const, label: r.label, value: r.id, checked: i === 0 })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Send report',
          handler: async (v: string) => {
            try {
              await this.mod.report({ target: 'comment', targetId: c.id, summary: c.body.slice(0, 80), reason: v ?? 'other' });
              await this.say('Report saved for moderation. Email alerts depend on the server configuration.');
            } catch (e: unknown) {
              await this.say(e instanceof Error ? e.message : 'Could not send the report');
            }
          }
        }
      ]
    });
    await pick.present();
  }

  async checkMark(c: Comment, result: 'match' | 'no'): Promise<void> {
    try {
      await this.data.checkLeadMark(c, result);
      const p = this.p();
      if (p) this.comments.set(await this.data.comments(p.id));
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not check the mark');
    }
  }

  /* ------------------ "This is me" / "Not me" ------------------ */
  canClaim(): boolean {
    const p = this.p();
    const me = this.me();
    if (!p || !me || p.authorId === me || p.repostOf) return false;
    if (p.khumbu?.claimedByUserId) return false;
    if (this.openAnswer()) return false;
    if (p.type === 'khumbulekhaya') return true;
    if (p.type === 'missing') return p.subject?.age == null || p.subject.age >= 18;
    return false;
  }

  childCase(): boolean {
    const p = this.p();
    const age = p?.subject?.age;
    return p?.type === 'missing' && age != null && age < 18 && !p.repostOf;
  }

  /** A case LulaFind published on someone's behalf, seen by that person. */
  appPostedCase(): boolean {
    const p = this.p();
    return !!p?.appPosted && !!p.lookoutId && (this.isMine() || this.auth.user()?.isAdmin === true);
  }

  readonly clearing = signal(false);

  async imHere(): Promise<void> {
    const p = this.p();
    if (!p?.lookoutId) return;
    this.clearing.set(true);
    try {
      await this.lookouts.imHere(p.lookoutId);
      await this.say('You are marked safe. This case was deleted.');
      await this.router.navigate(['/me']);
    } catch (e) {
      await this.say(e instanceof Error ? e.message : 'Could not close the lookout');
    } finally {
      this.clearing.set(false);
    }
  }

  showSubjectAsk(): boolean {
    const p = this.p();
    if (!p || p.repostOf || (p.type !== 'missing' && p.type !== 'khumbulekhaya')) return false;
    if (this.childCase()) return !this.isMine();
    return this.canClaim() || this.waitingAnswer() || this.openAnswer();
  }

  waitingAnswer(): boolean {
    const k = this.p()?.khumbu;
    return !!k && k.claimedByUserId === this.me() && (!k.subjectResponse || k.subjectResponse === 'none');
  }

  openAnswer(): boolean {
    const r = this.p()?.khumbu?.subjectResponse;
    return !!r && r !== 'none';
  }

  /** "Not me" is remembered on this device only; nothing is sent to the family. */
  dismissNotMe(): void {
    const id = this.p()?.id;
    if (!id) return;
    const next = [...new Set([...this.dismissed(), id])];
    this.dismissed.set(next);
    this.prefs.set('notMe', next);
    void this.say('Thanks. We won\u2019t ask again on this post. The family isn\u2019t told.');
  }

  async claim(): Promise<void> {
    if (!this.auth.signedIn()) return this.needAuth();
    const p = this.p();
    if (!p) return;
    const a = await this.alert.create({
      header: 'Is this you?',
      message: 'Only the person who posted this will see that you claimed it. You can still choose not to go home. Nobody will be forced.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Yes, this is me',
          handler: async () => {
            const next = await this.data.claimKhumbuPost(p.id);
            if (next) this.p.set(next);
            await this.refreshGate();
          }
        }
      ]
    });
    await a.present();
  }

  async respond(response: 'going_home' | 'not_going_home' | 'contact_me'): Promise<void> {
    const p = this.p();
    if (!p) return;
    const next = await this.data.subjectRespond(p.id, response, this.khumbuNote);
    if (next) this.p.set(next);
    await this.say(response === 'not_going_home' ? 'Your family has been told you are safe.' : 'Your family has been notified.');
    if (response === 'contact_me' && p.authorId) {
      const thread = await this.chat.ensureThread(p, p.authorId);
      if (thread) await this.router.navigate(['/chats/thread', thread.id]);
    }
  }

  responseLabel(): string {
    switch (this.p()?.khumbu?.subjectResponse) {
      case 'going_home': return 'They are coming home. ';
      case 'not_going_home': return 'They are safe but not coming home. Please respect this. ';
      case 'contact_me': return 'They want to chat first. ';
      default: return '';
    }
  }

  /* -------------------- "Mark as found" / "Still searching" -------------------- */
  foundOpen = signal(false);
  foundBusy = signal(false);
  finderBusy = signal(false);
  finderQuery = signal('');
  finderHits = signal<UserProfile[]>([]);
  finderId = signal<string | null>(null);
  foundWhere = '';
  private finderSeq = 0;

  markFound(): void {
    if (!this.p()) return;
    this.foundWhere = '';
    this.finderQuery.set('');
    this.finderHits.set([]);
    this.finderId.set(null);
    this.foundOpen.set(true);
  }

  closeFound(): void {
    if (this.foundBusy()) return;
    this.foundOpen.set(false);
  }

  async onFinder(value: string): Promise<void> {
    const selected = this.finderHits().find((u) => u.id === this.finderId());
    if (selected && value === selected.displayName) return;
    this.finderQuery.set(value);
    this.finderId.set(null);
    const q = value.trim();
    if (q.length < 2) { this.finderHits.set([]); return; }
    const seq = ++this.finderSeq;
    this.finderBusy.set(true);
    try {
      const hits = await this.data.usersWithName(q);
      if (seq === this.finderSeq) this.finderHits.set(hits);
    } finally {
      if (seq === this.finderSeq) this.finderBusy.set(false);
    }
  }

  pickFinder(u: UserProfile): void {
    this.finderId.set(u.id);
    this.finderQuery.set(u.displayName);
  }

  async confirmFound(skipName = false): Promise<void> {
    const p = this.p();
    if (!p || this.foundBusy()) return;
    if (!skipName && !this.finderId()) return;
    this.foundBusy.set(true);
    try {
      const next = await this.data.markFound(p.id, {
        whereabouts: this.foundWhere.trim() || 'Safe',
        finderUserId: skipName ? null : this.finderId()
      });
      if (next) this.p.set(next);
      this.foundOpen.set(false);
      // The case is not officially closed until the police are told - SAPS 92.
      await this.say('Case closed here. Tell the investigating officer and complete a SAPS 92.');
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not close the case');
    } finally {
      this.foundBusy.set(false);
    }
  }

  async stillSearching(): Promise<void> {
    const p = this.p();
    if (!p || this.searchingBusy()) return;
    this.searchingBusy.set(true);
    try {
      const updated = await this.data.confirmStillSearching(p.id);
      this.p.set(updated);
      await this.say('Update posted: Still searching. The case remains open.');
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not save your case update');
    } finally {
      this.searchingBusy.set(false);
    }
  }

  /* ---------------------------- chat ---------------------------- */
  nextChatAction(): string {
    const g = this.gate();
    if (!g || g.allowed) return 'Message them';
    if (g.step === 'sign_in') return 'Sign in to message';
    if (g.step === 'follow') return 'Follow each other to message';
    return 'Messaging unavailable';
  }

  /**
   * Follow / unfollow this case.
   *
   * Following is what earns an alert when the case moves: a new lead, a
   * reaction, a sighting, or the person being found. It is stored per account on
   * this device and read by the catch-up card on Home.
   */
  async toggleFollowCase(): Promise<void> {
    const post = this.p();
    if (!post) return;
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { next: `/post/${post.id}` } });
      return;
    }
    try {
      const now = await this.data.toggleFollowCase(post.id);
      const t = await this.toast.create({
        message: now ? 'Following this case. You will be told when something changes.' : 'You stopped following this case.',
        duration: 2200,
        position: 'bottom'
      });
      await t.present();
    } catch (e: unknown) {
      const t = await this.toast.create({ message: e instanceof Error ? e.message : 'Could not change that', duration: 2400, position: 'bottom' });
      await t.present();
    }
  }

  async openChat(): Promise<void> {
    if (!this.auth.signedIn()) return this.needAuth();
    const p = this.p();
    if (!p) return;
    const g = await this.chat.gate(p, p.khumbu?.claimedByUserId === this.auth.viewerId);
    if (g.allowed) {
      const thread = await this.chat.ensureThread(p, p.authorId);
      if (thread) await this.router.navigate(['/chats/thread', thread.id]);
      return;
    }
    if (g.step === 'follow') {
      await this.data.toggleFollow(p.authorId);
      const state = await this.data.followStatus(p.authorId);
      this.following.set(state === 'accepted');
      this.followRequested.set(state === 'pending');
      await this.refreshGate();
      await this.say(state === 'pending'
        ? 'Follow request sent. You can message each other once they follow you back.'
        : 'Following. You can message each other once they follow you back.');
      return;
    }
    await this.say((g as { reason?: string }).reason ?? 'Chat unavailable');
  }

  needAuth(): void {
    void this.router.navigate(['/auth'], { queryParams: { next: this.router.url } });
  }

  private async say(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2400, position: 'bottom' });
    await t.present();
  }
}
