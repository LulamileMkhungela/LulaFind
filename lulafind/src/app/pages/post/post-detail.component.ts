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
import { ReactionButtonComponent } from '../../shared/components/reaction-button.component';
import { ReactionIconComponent } from '../../shared/components/reaction-icon.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatService, ChatGate } from '../../core/services/chat.service';
import { ModerationService } from '../../core/services/moderation.service';
import { PostActionsService } from '../../core/services/post-actions.service';
import { KvStore } from '../../core/data/local-db';
import {
  Comment, Post, REACTIONS, ReactionKind, UserProfile, isReaction, provinceName
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
 *   4. The comments, laid out the way LinkedIn lays them out: a comment box,
 *      "Most relevant", then bordered comment cards with Like / Reply rows.
 *
 * Everything else that used to be stacked here (case facts, contact details,
 * poster, escalation and location links) has been taken off this page so it
 * reads as a post, not a file. Poster and safety tools stay one tap away in the
 * "..." menu and on the pages built for them.
 */
@Component({
  selector: 'lf-post-detail',
  standalone: true,
  imports: [
    IonContent, IonTextarea, IonSkeletonText, RouterLink, IconComponent, AvatarComponent,
    TopNavComponent, ReactionButtonComponent, ReactionIconComponent, ReactionsSheetComponent
  ],
  template: `
    <lf-top-nav title="Post" backTo="/home" />

    <ion-content class="lf-page">
      @if (!p()) {
        <div class="lf-card"><ion-skeleton-text style="height:220px"></ion-skeleton-text></div>
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
                @if (o.media.length) { <img [src]="o.media[0].src" [alt]="o.title" /> }
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
                    <video [src]="m.src" controls preload="metadata"></video>
                  } @else {
                    <img [src]="m.src" [alt]="m.caption ?? p()!.title" />
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
            <button class="act" type="button" (click)="focusComment()"><lf-icon name="comment" [size]="20" /><span>Comment</span></button>
            <button class="act" type="button" (click)="repost()"><lf-icon name="repost" [size]="20" /><span>Repost</span></button>
            <button class="act" type="button" (click)="send()"><lf-icon name="send" [size]="19" /><span>Send</span></button>
          </div>

          @if (!isMine() && p()!.chatEnabled && !p()!.repostOf) {
            <button class="chatline" type="button" [class.open]="gate().allowed" (click)="openChat()">
              <lf-icon [name]="gate().allowed ? 'unlock' : 'lock'" [size]="16" />
              <span>{{ gate().allowed ? 'Private chat with the poster' : nextChatAction() }}</span>
            </button>
          }
        </article>

        <!-- the two questions this page asks -->
        @if (isMine() && (p()!.status === 'active' || p()!.status === 'under_review') && !p()!.repostOf) {
          <section class="ask" aria-label="Case status">
            <button class="big big--go" type="button" (click)="markFound()"><lf-icon name="check" [size]="18" /> Mark as found</button>
            <button class="big" type="button" (click)="stillSearching()"><lf-icon name="search" [size]="18" /> Still searching</button>
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
              <ion-textarea rows="2" placeholder="Add a message (optional)" [value]="khumbuNote" (ionInput)="khumbuNote = $any($event.target).value"></ion-textarea>
            </section>
          }
          @if (openAnswer()) {
            <p class="note"><strong>{{ responseLabel() }}</strong>@if (p()!.khumbu?.subjectNote) { \u201C{{ p()!.khumbu!.subjectNote }}\u201D }</p>
          }
        }

        <!-- comments, LinkedIn style: box, "Most relevant", bordered cards -->
        <section class="comments" id="comments">
          @if (!p()!.allowComments) {
            <p class="note">The poster turned comments off for this post.</p>
          } @else {
            @if (!auth.signedIn()) {
              <button class="signin" type="button" (click)="needAuth()">Sign in to comment</button>
            } @else {
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
                <div class="field">
                  <textarea #box rows="1" [placeholder]="replyTo() ? 'Add a reply…' : 'Add a comment…'" [value]="draft()"
                            (input)="onType($event)" (keydown.enter)="onEnter($event)" aria-label="Write a comment"></textarea>
                  @if (draft().trim()) {
                    <button type="button" class="post" [disabled]="posting()" (click)="submitComment()">{{ replyTo() ? 'Reply' : 'Post' }}</button>
                  }
                </div>
              </div>
            }

            @if (comments().length) {
              <div class="sort">
                <button type="button" (click)="toggleSort()">{{ sort() === 'relevant' ? 'Most relevant' : 'Most recent' }} <lf-icon name="chevronDown" [size]="14" /></button>
              </div>
            } @else {
              <p class="empty">No comments yet. Start the conversation.</p>
            }

            @for (c of sorted(); track c.id) {
              <div class="cmsg">
                <lf-avatar [src]="avatarOf(c.authorId)" [name]="nameOf(c.authorId)" [size]="40" />
                <div class="cmsg__body">
                  @if (editingId() === c.id) {
                    <div class="edit">
                      <textarea rows="2" [value]="editDraft()" (input)="editDraft.set($any($event.target).value)" aria-label="Edit your comment"></textarea>
                      <div class="edit__row">
                        <button type="button" class="pill" (click)="editingId.set(null)">Cancel</button>
                        <button type="button" class="pill pill--go" [disabled]="!editDraft().trim()" (click)="saveEdit(c)">Save</button>
                      </div>
                    </div>
                  } @else {
                    <div class="ccard">
                      <div class="ccard__top">
                        <a [routerLink]="'/user/' + c.authorId" class="ccard__name">{{ nameOf(c.authorId) }}</a>
                        @if (c.authorId === p()!.authorId) { <span class="tag">Author</span> }
                      </div>
                      @if (headlineOf(c.authorId)) { <span class="ccard__headline">{{ headlineOf(c.authorId) }}</span> }
                      <p class="ccard__text">{{ c.body }}</p>
                      @if (c.isLead) { <span class="lead">Lead</span> }
                      @if (c.sighting) {
                        <div class="sighting"><lf-icon name="pin" [size]="13" /> {{ c.sighting.place }} · {{ provinceName(c.sighting.province) }}@if (c.sighting.note) { · {{ c.sighting.note }} }</div>
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
                        <span class="ctime">{{ timeAgo(c.createdAt) }}@if (c.editedAt) { · Edited }</span>
                        <button type="button" class="dots" (click)="commentMenu(c)" aria-label="Comment options"><lf-icon name="more" [size]="16" /></button>
                      </div>
                    </div>
                  }

                  @if (repliesOf(c.id).length) {
                    @if (!expanded().has(c.id)) {
                      <button type="button" class="viewrep" (click)="expand(c.id)">
                        <lf-icon name="repost" [size]="14" /> {{ repliesOf(c.id).length }} {{ repliesOf(c.id).length === 1 ? 'reply' : 'replies' }}
                      </button>
                    } @else {
                      <div class="replies">
                        @for (r of repliesOf(c.id); track r.id) {
                          <div class="cmsg cmsg--reply">
                            <lf-avatar [src]="avatarOf(r.authorId)" [name]="nameOf(r.authorId)" [size]="32" />
                            <div class="cmsg__body">
                              @if (editingId() === r.id) {
                                <div class="edit">
                                  <textarea rows="2" [value]="editDraft()" (input)="editDraft.set($any($event.target).value)" aria-label="Edit your reply"></textarea>
                                  <div class="edit__row">
                                    <button type="button" class="pill" (click)="editingId.set(null)">Cancel</button>
                                    <button type="button" class="pill pill--go" [disabled]="!editDraft().trim()" (click)="saveEdit(r)">Save</button>
                                  </div>
                                </div>
                              } @else {
                                <div class="ccard">
                                  <div class="ccard__top">
                                    <a [routerLink]="'/user/' + r.authorId" class="ccard__name">{{ nameOf(r.authorId) }}</a>
                                    @if (r.authorId === p()!.authorId) { <span class="tag">Author</span> }
                                  </div>
                                  @if (headlineOf(r.authorId)) { <span class="ccard__headline">{{ headlineOf(r.authorId) }}</span> }
                                  <p class="ccard__text">{{ r.body }}</p>
                                  <div class="ccard__acts">
                                    <button type="button" [class.on]="liked(r)" (click)="likeComment(r)">
                                      <lf-icon name="thumbup" [size]="15" [filled]="liked(r)" /> {{ liked(r) ? 'Liked' : 'Like' }}
                                    </button>
                                    <button type="button" (click)="startReply(c, r)"><lf-icon name="comment" [size]="15" /> Reply</button>
                                    @if (r.upvotes > 0) { <span class="clikes"><lf-reaction-icon kind="like" [size]="15" /> {{ r.upvotes }}</span> }
                                    <span class="ctime">{{ timeAgo(r.createdAt) }}@if (r.editedAt) { · Edited }</span>
                                    <button type="button" class="dots" (click)="commentMenu(r)" aria-label="Reply options"><lf-icon name="more" [size]="16" /></button>
                                  </div>
                                </div>
                              }
                            </div>
                          </div>
                        }
                      </div>
                    }
                  }
                </div>
              </div>
            }
          }
        </section>

        <p class="fine">LulaFind is a community tool. It does not replace SAPS. In an emergency call <strong>10111</strong>.</p>
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
    .media { margin: 4px 0 0; }
    .media img, .media video { display: block; width: 100%; max-height: 640px; object-fit: contain; background: #000; }
    .media.multi { display: flex; gap: 2px; overflow-x: auto; scroll-snap-type: x mandatory; }
    .media.multi img, .media.multi video { flex: 0 0 88%; scroll-snap-align: start; }
    .embed { display: block; margin: 0 var(--edge) 12px; padding: 12px; border: 1px solid var(--lf-line); border-radius: 8px; color: inherit; text-decoration: none; }
    .embed__head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .embed__who { display: flex; flex-direction: column; min-width: 0; }
    .embed__who strong { font-size: 14px; font-weight: 600; }
    .embed__who small { font-size: 12px; color: var(--lf-muted); }
    .embed h2 { margin: 4px 0; font-size: 17px; }
    .embed p { margin: 0; font-size: 15px; line-height: 1.4; white-space: pre-line; }
    .embed img { display: block; width: calc(100% + 24px); margin: 10px -12px -12px; max-height: 300px; object-fit: cover; }
    .embed.gone { display: flex; gap: 8px; align-items: center; color: var(--lf-muted); }

    /* LinkedIn's stats line + action bar */
    .stats { display: flex; align-items: center; justify-content: space-between; padding: 8px var(--edge) 6px; font-size: 13px; color: var(--lf-muted); }
    .stats button { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 0; }
    .stats__likes { display: inline-flex; align-items: center; gap: 6px; }
    .stats__react { display: inline-flex; align-items: center; gap: 6px; }
    .stack { display: inline-flex; }
    .stack lf-reaction-icon + lf-reaction-icon { margin-left: -6px; }
    .stats__right { display: inline-flex; align-items: center; gap: 12px; }
    .actions { display: flex; align-items: center; margin: 0 12px; padding: 4px 0; border-top: 1px solid var(--lf-line-soft); }
    .act { flex: 1; min-width: 0; height: 40px; border: 0; background: transparent; color: var(--lf-muted); font-family: inherit;
      font-size: 14px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 5px; cursor: pointer; border-radius: 4px; }
    .act:hover, .act:active { background: var(--lf-hover); }
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
    .big--go { background: var(--lf-primary); border-color: var(--lf-primary); color: #fff; }
    .note { margin: 8px var(--edge); padding: 10px 12px; border-radius: 8px; background: var(--lf-card); color: var(--ion-text-color); font-size: 14px; line-height: 1.45; }

    /* comments - LinkedIn's comment card: avatar, bordered box, Like/Reply row inside */
    .comments { background: var(--lf-card); box-shadow: var(--lf-shadow); padding: 12px var(--edge) 18px; }
    .cbox { display: flex; align-items: flex-start; gap: 8px; }
    .field { flex: 1; min-width: 0; display: flex; align-items: flex-end; gap: 6px; padding: 6px 6px 6px 14px; border: 1px solid var(--lf-line); border-radius: 20px; background: var(--lf-card); }
    .field textarea { flex: 1; min-width: 0; max-height: 120px; padding: 6px 0; border: 0; outline: 0; resize: none; background: transparent; color: var(--ion-text-color); font: inherit; font-size: 15px; line-height: 1.35; }
    .field .post { height: 30px; padding: 0 14px; margin-bottom: 1px; border: 0; border-radius: 15px; background: var(--lf-primary); color: #fff; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
    .signin { width: 100%; height: 42px; border: 0; border-radius: 21px; background: var(--lf-primary); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
    .replying { display: flex; align-items: center; justify-content: space-between; margin: 0 0 6px 48px; font-size: 13px; color: var(--lf-muted); }
    .replying button { border: 0; background: transparent; color: inherit; cursor: pointer; }
    .leadrow { margin: 0 0 8px 48px; font-size: 13px; color: var(--lf-muted); display: flex; flex-direction: column; gap: 6px; }
    .markin { padding: 8px 10px; border: 1px solid var(--lf-line); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
    .sort { display: flex; justify-content: flex-end; margin: 12px 0 2px; }
    .sort button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: var(--lf-muted); font: inherit; font-size: 13px; cursor: pointer; }
    .empty { margin: 12px 0 0; color: var(--lf-muted); font-size: 14px; }
    .cmsg { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; }
    .cmsg__body { flex: 1; min-width: 0; }
    .cmsg--reply { margin-top: 10px; }
    .replies { margin-top: 4px; padding-left: 8px; border-left: 1px solid var(--lf-line-soft); }
    .ccard { border: 1px solid var(--lf-line); border-radius: 10px; background: var(--lf-card); padding: 10px 12px 6px; }
    .ccard__top { display: flex; align-items: center; gap: 6px; }
    .ccard__name { font-size: 14px; font-weight: 600; color: var(--ion-text-color); text-decoration: none; }
    .ccard__headline { display: block; margin-top: 1px; font-size: 12px; color: var(--lf-muted); }
    .tag { padding: 1px 6px; border-radius: 10px; background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); font-size: 11px; font-weight: 700; }
    .ccard__text { margin: 5px 0 6px; font-size: 14.5px; line-height: 1.42; white-space: pre-line; word-break: break-word; }
    .lead { display: inline-block; margin-bottom: 6px; padding: 1px 8px; border-radius: 10px; background: color-mix(in srgb, var(--lf-ubuntu) 18%, transparent); color: var(--lf-ubuntu); font-size: 11.5px; font-weight: 700; }
    .sighting { display: flex; align-items: center; gap: 5px; margin-bottom: 6px; font-size: 13px; color: var(--lf-muted); }
    .mark { margin: 0 0 6px; font-size: 13px; color: var(--lf-muted); }
    .ccard__acts { display: flex; align-items: center; gap: 12px; padding: 6px 0 2px; border-top: 1px solid var(--lf-line-soft); }
    .ccard__acts button { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: var(--lf-muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; padding: 0; }
    .ccard__acts button.on { color: var(--lf-primary); }
    .clikes { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--lf-muted); }
    .ctime { font-size: 12px; color: var(--lf-muted); }
    .dots { margin-left: auto; border: 0; background: transparent; color: var(--lf-muted); cursor: pointer; padding: 0; }
    .viewrep { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; border: 0; background: transparent; color: var(--lf-muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .edit { display: flex; flex-direction: column; gap: 6px; }
    .edit textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--lf-line); border-radius: 8px; background: var(--lf-card-2); color: inherit; font: inherit; font-size: 14px; resize: vertical; }
    .edit__row { display: flex; gap: 8px; margin: 4px 0 0; }
    .pill { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 1px solid var(--lf-line); border-radius: 15px;
      background: transparent; color: var(--ion-text-color); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .pill--go { background: var(--lf-primary); border-color: var(--lf-primary); color: #fff; }
    .fine { margin: 12px var(--edge) 28px; font-size: 12px; text-align: center; color: var(--lf-muted); }

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
  private route = inject(ActivatedRoute);
  private toast = inject(ToastController);
  private alert = inject(AlertController);
  private sheets = inject(ActionSheetController);
  private mod = inject(ModerationService);
  private actions = inject(PostActionsService);
  private prefs = new KvStore('lulafind.post-detail');

  @ViewChild('box') box?: ElementRef<HTMLTextAreaElement>;

  protected readonly compact = compact;
  protected readonly timeAgo = timeAgo;
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
  asLead = signal(false);
  markGuess = signal('');
  posting = signal(false);
  khumbuNote = '';

  readonly me = computed(() => this.auth.viewerId);
  readonly isMine = computed(() => this.p()?.authorId === this.auth.viewerId);
  readonly author = computed(() => (this.p() ? this.data.authorOf(this.p()!.authorId) ?? null : null));
  readonly authorName = computed(() =>
    this.p()?.anonymous && !this.isMine() ? 'Anonymous' : this.author()?.displayName ?? 'LulaFind member');
  readonly authorHeadline = computed(() =>
    this.p()?.anonymous && !this.isMine() ? '' : this.author()?.bio ?? '');
  readonly authorAvatar = computed(() => this.data.avatarFor(this.p()?.anonymous && !this.isMine() ? null : this.author()));
  readonly authorLink = computed(() => (this.p()?.anonymous && !this.isMine() ? ['/post', this.p()!.id] : ['/user', this.p()?.authorId ?? '']));
  readonly myAvatar = computed(() => this.data.avatarFor(this.auth.user()));
  readonly myName = computed(() => this.auth.user()?.displayName ?? 'Me');
  readonly myVote = computed(() => (this.p() ? this.data.myVote(this.p()!) : null));
  readonly originalName = computed(() => {
    const o = this.original();
    return o ? (o.anonymous ? 'Anonymous' : this.data.authorOf(o.authorId)?.displayName ?? 'LulaFind member') : '';
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
  private dismissed = signal<string[]>(this.prefs.get<string[]>('notMe', []));

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
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
    try {
      await this.data.vote(p.id, kind);
      this.p.set(this.data.post(p.id) ?? null);
      await this.refreshGate();
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not save your reaction');
    }
  }

  repost(): void { const p = this.p(); if (p) void this.actions.openRepost(p); }
  send(): void { const p = this.p(); if (p) void this.actions.send(p).then(() => this.reload()); }

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

  more(): void {
    const p = this.p();
    if (p) void this.actions.openMenu(p, () => void this.router.navigate(['/home'], { replaceUrl: true }));
  }

  /* --------------------------- comments --------------------------- */
  repliesOf(parentId: string): Comment[] {
    return this.comments().filter((c) => c.parentId === parentId).sort((a, b) => a.createdAt - b.createdAt);
  }
  nameOf(id: string): string { return this.data.authorOf(id)?.displayName ?? 'LulaFind member'; }
  /** LinkedIn shows the commenter's headline under their name. */
  headlineOf(id: string): string { return this.data.authorOf(id)?.bio ?? ''; }
  avatarOf(id: string): string { return this.data.avatarFor(this.data.authorOf(id)); }
  liked(c: Comment): boolean { const me = this.me(); return !!me && (c.likedIds ?? []).includes(me); }
  canLead(): boolean { const t = this.p()?.type; return !!t && !this.isMine() && (t === 'missing' || t === 'sighting' || t === 'pet' || t === 'khumbulekhaya'); }

  toggleSort(): void { this.sort.set(this.sort() === 'relevant' ? 'recent' : 'relevant'); }
  expand(id: string): void { this.expanded.update((s) => new Set(s).add(id)); }

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

  onType(ev: Event): void {
    const el = ev.target as HTMLTextAreaElement;
    this.draft.set(el.value);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  /** Enter sends on a keyboard; on a phone it starts a new line. */
  onEnter(ev: Event): void {
    const e = ev as KeyboardEvent;
    if (e.shiftKey || (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)) return;
    e.preventDefault();
    void this.submitComment();
  }

  async submitComment(): Promise<void> {
    if (!this.auth.signedIn()) return this.needAuth();
    const body = this.draft().trim();
    const p = this.p();
    if (!body || !p || this.posting()) return;
    const reply = this.replyTo();
    const lead = this.asLead() && !reply;
    this.posting.set(true);
    try {
      await this.data.addComment({
        postId: p.id, body, parentId: reply?.rootId ?? null, isLead: lead,
        markGuess: lead && this.markGuess().trim() ? this.markGuess().trim() : undefined
      });
      this.comments.set(await this.data.comments(p.id));
      this.p.set(this.data.post(p.id) ?? null);
      if (reply) this.expand(reply.rootId);
      this.draft.set('');
      const el = this.box?.nativeElement;
      if (el) { el.value = ''; el.style.height = 'auto'; }
      this.replyTo.set(null);
      this.asLead.set(false);
      this.markGuess.set('');
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
              await this.say('Report sent. Thank you.');
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
      const thread = await this.chat.ensureThread(p, p.authorId, 'vote');
      if (thread) await this.router.navigate(['/chat', thread.id]);
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
      await this.say(skipName ? 'Case closed as found.' : 'Thank you. They have a contributor badge.');
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not close the case');
    } finally {
      this.foundBusy.set(false);
    }
  }

  async stillSearching(): Promise<void> {
    const p = this.p();
    if (!p) return;
    await this.data.dismissOutcomeNudge(p.id);
    this.p.set(this.data.post(p.id) ?? null);
    await this.say('Marked as still searching. The post stays open.');
  }

  /* ---------------------------- chat ---------------------------- */
  nextChatAction(): string {
    const g = this.gate();
    if (!g || g.allowed) return 'Private chat';
    if (g.step === 'sign_in') return 'Sign in to chat';
    if (g.step === 'vote') return 'Have an idea to unlock chat';
    if (g.step === 'follow') return 'Follow to unlock chat';
    return 'Chat unavailable';
  }

  async openChat(): Promise<void> {
    if (!this.auth.signedIn()) return this.needAuth();
    const p = this.p();
    if (!p) return;
    const g = await this.chat.gate(p, p.khumbu?.claimedByUserId === this.auth.viewerId);
    if (g.allowed) {
      const thread = await this.chat.ensureThread(p, p.authorId, 'vote');
      if (thread) await this.router.navigate(['/chat', thread.id]);
      return;
    }
    if (g.step === 'vote') {
      await this.data.vote(p.id, 'up');
      this.p.set(this.data.post(p.id) ?? null);
      await this.refreshGate();
      await this.say('You have an idea on this post. Now follow them to open chat.');
      return;
    }
    if (g.step === 'follow') {
      await this.data.toggleFollow(p.authorId);
      const state = await this.data.followStatus(p.authorId);
      this.following.set(state === 'accepted');
      this.followRequested.set(state === 'pending');
      await this.refreshGate();
      await this.say(state === 'pending'
        ? 'Follow request sent. Chat opens after they accept and follow you back.'
        : 'Following. Chat opens when they follow you back.');
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
