import { AfterViewChecked, Component, EventEmitter, Input, OnChanges, OnInit, Output, ViewChild, computed, inject, signal } from '@angular/core';
import type { ElementRef } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DEFAULT_REACTION, DEFAULT_REACTION_LABEL, Comment, MediaItem, Post, POST_TYPE_META, REACTIONS, ReactionKind, UserProfile, isReaction, provinceName } from '../../core/models/types';
import { compact, headingIsNew, timeAgo } from '../../core/utils/format';
import { AvatarComponent } from './avatar.component';
import { IconComponent } from './icon.component';
import { CaseFactsComponent } from './case-facts.component';
import { MediaAudioComponent } from './media-audio.component';
import { ReactionsSheetComponent } from './reactions-sheet.component';
import { UserHoverDirective } from './user-hover-card.component';
import { ReactionIconComponent } from './reaction-icon.component';
import { ReactionButtonComponent } from './reaction-button.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { CHECK_IN_COPY } from '../../core/services/safety.service';
import { PostActionsService } from '../../core/services/post-actions.service';

export type ChatState = 'off' | 'locked-follow' | 'open';

/**
 * The LinkedIn feed card, adapted to LulaFind's rules:
 *
 *   optional "X reposted this" line
 *   avatar · name + Follow · headline · time · province · globe · "…"
 *   three lines of text with a muted "…see more"
 *   media, or the original post in a frame when this is a reshare
 *   stats: reaction icons + count .......... comments / reposts
 *   action bar: react (hold for the tray) · Comment · Repost · Send
 *
 * Two things are deliberately not LinkedIn's: the category chip above the text
 * (this app is about missing people, and the chip is how a case is labelled)
 * and the private-chat icon in the action bar (subject to connection and message settings).
 */
@Component({
  selector: 'lf-post-card',
  standalone: true,
  imports: [RouterLink, IconComponent, AvatarComponent, ReactionIconComponent, ReactionButtonComponent, ReactionsSheetComponent, UserHoverDirective, MediaAudioComponent, CaseFactsComponent],
  template: `
    @if (!gone()) {
    <article class="fb-card lf-fade-in"
             [class.fb-card--found]="post.status === 'found'">
      @if (activity(); as act) {
        <a class="fb-activity" [routerLink]="['/user', act.userId]"><strong>{{ act.name }}</strong> {{ act.verb }}</a>
      }
      @if (post.repostOf) {
        <!-- LinkedIn puts the reposter's line above everything else on a reshare. -->
        <div class="fb-reposted">
          <lf-icon name="repost" [size]="14" [weight]="2.4" />
          <span><strong>{{ reposterLine() }}</strong></span>
        </div>
      }

      <header class="fb-card-header" [routerLink]="authorRoute()">
        <lf-avatar [src]="authorAvatar()" [name]="authorName()" [size]="48"
                   [status]="authorStatus()" />
        <div class="fb-author-meta">
          <div class="fb-author-row">
            <span class="fb-author-name" [lfUserHover]="post.authorId">{{ authorName() }}</span>
          </div>
          @if (authorHeadline()) { <span class="fb-headline">{{ authorHeadline() }}</span> }
          <!-- Where and when, then who can see it: one quiet line, the way a
               timeline reads it. -->
          <div class="fb-sub-meta">
            <span class="fb-sub-meta__text">{{ whereWhen() }}</span>
            <lf-icon [name]="audienceIcon()" [size]="12" [attr.title]="audienceTitle()" [attr.aria-label]="audienceTitle()" />
          </div>
        </div>
        <!-- Follow and the … sit in one right-hand column so they share a line
             with the name instead of the Follow floating mid-card. -->
        <div class="fb-head-actions">
          @if (showFollow()) {
            <button class="fb-follow-link" [class.on]="followingAuthor()" [class.requested]="followRequested()"
                    [attr.aria-pressed]="followingAuthor() || followRequested()" (click)="onFollow($event)">
              {{ followingAuthor() ? 'Following' : followRequested() ? 'Requested' : '+ Follow' }}
            </button>
          }
          <button class="fb-more-btn" (click)="onMore($event)" aria-label="More options">
            <lf-icon name="more" [size]="20" />
          </button>
        </div>
      </header>

      @if (post.repostOf) {
        <!-- A repost: the reposter's own words, then the original inside a frame. -->
        @if (post.body.trim()) {
          <div class="fb-card-body fb-card-body--thoughts" [routerLink]="'/post/' + post.id">
            <p class="fb-post-text" #bodyEl [class.fb-clamp]="!expanded()">{{ post.body }}</p>
            @if (!expanded() && textOverflows()) {
              <button class="fb-readmore" (click)="toggleExpand($event)">…see more</button>
            } @else if (expanded() && textOverflows()) {
              <button class="fb-readmore" (click)="toggleExpand($event)">see less</button>
            }
          </div>
        }
        @if (original(); as o) {
          <a class="fb-embed" [routerLink]="'/post/' + o.id">
            <div class="fb-embed__head">
              <lf-avatar [src]="originalAvatar()" [name]="originalName()" [size]="40" />
              <div>
                <strong [lfUserHover]="post.repostOf ? original()?.authorId ?? '' : ''">{{ originalName() }}</strong>
                @if (originalHeadline(o)) { <span>{{ originalHeadline(o) }}</span> }
                <span class="fb-embed__when">{{ timeAgo(o.createdAt) }}@if (o.editedAt) { · Edited } · <lf-icon name="globe" [size]="11" /></span>
              </div>
            </div>
            <h3 class="fb-post-title">{{ o.title }}</h3>
            <p class="fb-embed__text">{{ o.body }}</p>
            @if (o.poster?.media?.src) {
              <img class="fb-embed__img fb-embed__poster" [src]="o.poster!.media.src" [alt]="'LulaFind poster: ' + o.title" loading="lazy" />
            } @else if (o.media.length && o.media[0].kind === 'video') {
              <video class="fb-embed__img" [src]="o.media[0].src" muted playsinline preload="metadata"></video>
            } @else if (o.media.length) { <img class="fb-embed__img" [src]="o.media[0].src" [alt]="o.title" loading="lazy" /> }
          </a>
        } @else {
          <div class="fb-embed fb-embed--gone">
            <lf-icon name="info" [size]="16" />
            {{ originalMissing() ? 'This post is no longer available.' : 'Loading the original post…' }}
          </div>
        }
      } @else {
      <div class="fb-card-body" [routerLink]="'/post/' + post.id">
        <!--
          The kind of post is the one fact that changes how everything below is
          read ("sighting" and "missing" are not the same request), so it tags
          the post itself rather than the author: a tinted chip on its own line
          above the title. It never competes with a long name, a Follow button
          or the place-and-time line for the same 390px.
        -->
        <span class="fb-kind-chip" [attr.data-tone]="kindTone()" [class.is-found]="post.status === 'found'">
          <lf-icon [name]="meta().icon" [size]="11" [weight]="2.4" />{{ kindLabel() }}
        </span>
        @if (showHeading()) { <h3 class="fb-post-title">{{ post.title }}</h3> }
        <p class="fb-post-text" #bodyEl [class.fb-clamp]="!expanded()">{{ post.body }}</p>
        @if (!expanded() && textOverflows()) {
          <button class="fb-readmore" (click)="toggleExpand($event)">…see more</button>
        } @else if (expanded() && textOverflows()) {
          <button class="fb-readmore" (click)="toggleExpand($event)">see less</button>
        }
        <!-- The facts sit under the words, not above them: a person reads the
             appeal first, then the details they can act on. -->
        <lf-case-facts [post]="post" />
      </div>

      @if (post.poster?.media?.src) {
        <div class="fb-media fb-media--poster" [routerLink]="'/post/' + post.id">
          <img class="fb-media-img" [src]="post.poster!.media.src" [alt]="'LulaFind poster: ' + post.title" loading="lazy" />
        </div>
      } @else if (post.media.length === 1 && post.media[0].kind === 'video') {
        <!-- One video: its own controls are the point, so it is not wrapped in
             the card's link - tapping play must play, not navigate. -->
        <div class="fb-media">
          <video class="fb-media-video" [src]="post.media[0].src" controls playsinline preload="metadata"
                 [attr.aria-label]="'Video attached to: ' + post.title"></video>
        </div>
      } @else if (voiceNote(); as note) {
        <!--
          A voice note plays on the card. It is deliberately not wrapped in the
          card's link: pressing play must play, and the words stay here rather
          than sending someone to another screen to hear a parent speak.
        -->
        <div class="fb-media fb-media--voice">
          <lf-media-audio [src]="note.src" [durationSec]="note.durationSec ?? 0"
                          [label]="note.caption?.trim() || 'Voice note'" [transcript]="transcriptOf(note)" />
        </div>
      } @else if (post.media.length) {
        <div class="fb-media" [routerLink]="'/post/' + post.id">
          @if (post.media.length === 1) {
            <img class="fb-media-img" [src]="post.media[0].src" [alt]="post.title" loading="lazy" />
          } @else {
            <div class="fb-grid" [attr.data-count]="visibleMedia().length">
              @for (m of visibleMedia(); track m.id; let i = $index) {
                <div class="fb-grid__tile">
                  @if (m.kind === 'video') {
                    <video [src]="m.src" muted playsinline preload="metadata" [attr.aria-label]="'Video: ' + post.title"></video>
                  } @else if (m.kind === 'audio') {
                    <span class="fb-grid__audio"><lf-icon name="mic" [size]="18" /> Voice</span>
                  } @else {
                    <img [src]="m.src" [alt]="m.caption ?? ''" loading="lazy" />
                  }
                  @if (i === visibleMedia().length - 1 && extraMedia() > 0) {
                    <span class="fb-grid__more">+{{ extraMedia() }}</span>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
      }

      <!-- Reaction summary, like LinkedIn: the top reactions, then the count. Real counts only. -->
      @if (post.upvotes > 0 || post.commentCount > 0 || post.shares > 0) {
        <div class="fb-stats-bar" [routerLink]="'/post/' + post.id">
          <div class="fb-stats-likes">
            @if (post.upvotes > 0) {
              <span class="fb-stack" role="button" tabindex="0" aria-label="See who reacted" (click)="openReactions($event)" (keydown.enter)="openReactions($event)">
                @for (k of topKinds(); track k) { <lf-reaction-icon [kind]="k" [size]="18" [ring]="true" /> }
              </span>
              <span role="button" tabindex="0" (click)="openReactions($event)" (keydown.enter)="openReactions($event)">{{ compact(post.upvotes) }}</span>
            }
          </div>
          <div class="fb-stats-right">
            @if (post.commentCount > 0) { <span>{{ compact(post.commentCount) }} {{ post.commentCount === 1 ? 'comment' : 'comments' }}</span> }
            @if (post.commentCount > 0 && post.shares > 0) { <span class="fb-dot">·</span> }
            @if (post.shares > 0) { <span>{{ compact(post.shares) }} {{ post.shares === 1 ? 'repost' : 'reposts' }}</span> }
          </div>
        </div>
      }

      <!--
        The action bar: react (hold for the tray) - Comment - Repost - Send.
        Every one of them carries its word, not just its icon: an outline glyph
        alone is a guessing game on a phone, and the words are what make the
        row read as a social post rather than a toolbar.
      -->
      <div class="fb-actions" (click)="$event.stopPropagation()">
        <lf-reaction-button class="fb-act" [value]="myReaction()" (react)="onReact($event)" />
        <button class="fb-act" type="button" (click)="comment.emit()" aria-label="Comment" title="Comment">
          <lf-icon name="comment" [size]="20" /><span class="fb-act__label">Comment</span>
        </button>
        <button class="fb-act" type="button" (click)="onRepost()" aria-label="Repost" title="Repost">
          <lf-icon name="repost" [size]="20" /><span class="fb-act__label">Repost</span>
        </button>
        <button class="fb-act" type="button" (click)="onSend()" aria-label="Send" title="Send">
          <lf-icon name="send" [size]="19" /><span class="fb-act__label">Send</span>
        </button>
        @if (post.chatEnabled && !isMine() && !post.repostOf && !post.anonymous) {
          <button class="fb-act fb-act--chat" type="button" (click)="chat.emit()" [attr.aria-label]="chatLabel()" [attr.title]="chatLabel()">
            <lf-icon name="chat" [size]="20" /><span class="fb-act__label">Message</span>
          </button>
        }
      </div>

      <!-- The comment box, the way a timeline draws it: your face, a pill that
           says what tapping does, and the shortcut icons. Tapping anywhere in
           the pill opens the post, focused on its comment field. -->
      <button class="fb-comment-cta" type="button" [routerLink]="'/post/' + post.id" [queryParams]="{ comment: 1 }">
        <lf-avatar [src]="myAvatar()" [name]="myName()" [size]="32" />
        <span class="fb-comment-cta__pill">Write a comment…</span>
        <span class="fb-comment-cta__ic" aria-hidden="true"><lf-icon name="smile" [size]="19" /></span>
      </button>

      <!-- LinkedIn's comment preview: the most-relevant comment sits under the
           action bar, so the conversation is visible without opening the post. -->
      @if (topComment(); as c) {
        <a class="fb-comment" [routerLink]="'/post/' + post.id">
          <lf-avatar [src]="commenterAvatar(c)" [name]="commenterName(c)" [size]="32" />
          <div class="fb-comment__body">
            <span class="fb-comment__who">{{ commenterName(c) }}</span>
            <p class="fb-comment__text">{{ c.body }}</p>
            <span class="fb-comment__meta">
              {{ timeAgo(c.createdAt) }}
              @if (c.upvotes > 0) { <span class="fb-dot">·</span> {{ compact(c.upvotes) }} {{ c.upvotes === 1 ? 'like' : 'likes' }} }
            </span>
          </div>
        </a>
      }

    </article>
    <lf-reactions-sheet [post]="post" [open]="reactionsOpen()" (close)="reactionsOpen.set(false)" />
    }
  `,
  styles: [`
    /* Mobile Facebook: edge-to-edge cards separated by the grey page. */
    .fb-card {
      background: var(--lf-card);
      margin: 0 0 8px;
      box-shadow: var(--lf-shadow);
      position: relative;
      /* visible, so the reaction tray can open above the action bar */
    }
    /* No coloured bar across the top of a case card. A missing-person post is
       identifiable by its chip, not by a red rule that reads as an error state.
       "Found" keeps its green rule, which is an outcome, not a hazard. */
    .fb-card--found { box-shadow: var(--lf-shadow), inset 0 3px 0 var(--lf-ubuntu); }
    @media (min-width: 700px) {
      .fb-card { border-radius: var(--lf-radius); max-width: var(--lf-maxw); margin: 0 auto 12px; }
    }

    .fb-activity {
      display: block; padding: 8px 16px 0; font-size: 12px; line-height: 1.3;
      color: var(--lf-muted); text-decoration: none;
    }
    .fb-card { border-radius: 10px; border: 1px solid var(--lf-line-soft); overflow: hidden; }
    @media (min-width: 700px) { .fb-card { border-radius: 12px; } }
    .fb-activity strong { font-weight: 600; color: inherit; }
    .fb-card-header {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 12px 8px 0 16px;
      cursor: pointer;
    }
    .fb-author-meta { flex: 1; min-width: 0; }
    .fb-author-row { display: flex; align-items: center; gap: 4px; min-width: 0; min-height: 24px; }
    .fb-author-name { font-weight: 600; font-size: 14px; color: var(--ion-text-color);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* LinkedIn's second header line: who the person is, one line, muted. */
    .fb-headline {
      display: block; font-size: 12px; color: var(--lf-muted); line-height: 1.3;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    /* LinkedIn clamps feed text to three lines and ends it in a muted ellipsis. */
    .fb-clamp {
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
      overflow: hidden; white-space: normal;
    }
    .fb-dot { color: var(--lf-muted); font-size: 13px; }
    .fb-follow-link {
      background: none;
      border: 0;
      color: var(--lf-link);
      font-family: inherit;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      padding: 0;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .fb-follow-link.on,
    .fb-follow-link.requested { color: var(--lf-muted); }
    /*
     * One line, never broken mid-word. The row itself clips instead: the first
     * item (province on line 1, time on line 2) ellipsizes and the rest hold
     * their width, so "KwaZulu-Natal · Missing person" reads as
     * "KwaZulu-Nata… · Missing person" rather than "Missing / person".
     */
    .fb-sub-meta {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12.5px;
      color: var(--lf-muted);
      margin-top: 4px;
      white-space: nowrap;
      overflow: hidden;
    }
    .fb-sub-meta__text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .fb-sub-meta .fb-dot, .fb-sub-meta > lf-icon { flex: 0 0 auto; }
    /*
     * Follow and … share this column, centred on the name's line. The column is
     * the height of one line of text; the … keeps a 32px tap target by bleeding
     * 4px above and below it, so the glyph lines up with the name without
     * shrinking the thing fingers have to hit.
     */
    .fb-head-actions {
      display: flex; align-items: center; gap: 6px;
      height: 24px; flex-shrink: 0;
    }
    .fb-more-btn {
      width: 32px; height: 32px; margin: -4px 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: none;
      border: 0;
      color: var(--lf-muted);
      cursor: pointer;
      border-radius: 50%;
      align-self: flex-start;
    }
    .fb-more-btn:hover { background: var(--lf-hover); }
    /* The post kind now rides in the meta line, not in a chip under the avatar. */
    .fb-kind { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 3px; font-weight: 600; }
    .fb-kind--success { color: var(--lf-ubuntu); }
    /*
     * The kind chip. It sits on the name's line and answers the one question
     * that changes how the rest of the card is read. The tint comes from the
     * post's own tone, so a danger warning and a lost pet never look alike,
     * and it shrinks to an icon-only disc before it would clip the name.
     */
    .fb-kind-chip {
      display: inline-flex;
      margin: 0 0 8px;
      align-items: center;
      gap: 4px;
      min-width: 0;
      padding: 2px 8px 2px 6px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 700;
      line-height: 1.5;
      letter-spacing: .1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      --tone: var(--lf-primary);
      color: color-mix(in srgb, var(--tone) 78%, var(--ion-text-color));
      background: color-mix(in srgb, var(--tone) 13%, transparent);
    }
    .fb-kind-chip lf-icon { flex: none; }
    .fb-kind-chip[data-tone="danger"] { --tone: var(--lf-signal); }
    .fb-kind-chip[data-tone="warm"] { --tone: var(--lf-marigold); }
    .fb-kind-chip[data-tone="warn"] { --tone: var(--lf-marigold); }
    .fb-kind-chip[data-tone="info"] { --tone: var(--lf-primary); }
    .fb-kind-chip[data-tone="success"],
    .fb-kind-chip.is-found { --tone: var(--lf-ubuntu); }
    .fb-kind-chip[data-tone="neutral"] { --tone: var(--lf-muted); }
    /* The chip keeps its own words; the place-and-time after it is what
       ellipsizes. A chip that clips to "Missing perso" is worse than a place
       that ends in "…" - the kind is the part nobody can infer. */


    .fb-card-body { padding: 8px 16px 12px; cursor: pointer; }
    /*
     * The case line. It went in without a size of its own and inherited the
     * 17px weight-700 heading rule below, which turned a sentence of small
     * facts into a second headline. It now carries its own type, and the
     * clock alone changes colour, and only while time is doing damage.
     */
    .fb-post-title { font-size: 17px; font-weight: 700; color: var(--ion-text-color); margin: 0 0 6px; line-height: 1.3; }
    .fb-kind-chip + .fb-post-title { margin-top: 0; }
    .fb-post-text { font-size: 14.5px; color: var(--ion-text-color); line-height: 1.4; margin: 6px 0 0; white-space: pre-line; }
    .fb-readmore { background: none; border: 0; color: var(--lf-muted); font-family: inherit; font-weight: 400; font-size: 14.5px; cursor: pointer; padding: 0; margin-top: 2px; }
    .fb-readmore:hover { text-decoration: underline; }

    .fb-media { width: 100%; overflow: hidden; background: var(--lf-card-2); cursor: pointer; }
    .fb-media-img { width: 100%; object-fit: cover; max-height: 520px; display: block; }
    .fb-media-video { width: 100%; max-height: 520px; display: block; background: #000; }
    .fb-media--poster { background: #101116; }
    .fb-media--poster .fb-media-img { object-fit: contain; max-height: 720px; }
    .fb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
    .fb-grid[data-count="3"] .fb-grid__tile:first-child { grid-column: 1 / -1; aspect-ratio: 2 / 1; }
    .fb-grid__tile { position: relative; aspect-ratio: 1 / 1; overflow: hidden; }
    .fb-grid__tile img, .fb-grid__tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
    .fb-grid__more {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, .45); color: #fff;
      font-size: 30px; font-weight: 700;
    }

    .fb-stats-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 0 16px;
      padding: 8px 0;
      border-top: 0;
      font-size: 13px;
      color: var(--lf-muted);
      cursor: pointer;
    }
    .fb-stats-likes { display: flex; align-items: center; gap: 6px; }
    .fb-stack { display: inline-flex; }
    .fb-stack lf-reaction-icon + lf-reaction-icon { margin-left: -5px; }
    .fb-edited { font-style: normal; }
    .fb-card-body--thoughts { padding-bottom: 8px; }
    /* LinkedIn's line above a reshared post. */
    .fb-reposted {
      display: flex; align-items: center; gap: 7px;
      padding: 12px 16px 0;
      color: var(--lf-muted);
      font-size: 13.5px;
      line-height: 1.2;
    }
    .fb-reposted strong { font-weight: 600; color: var(--ion-text-color); }

    .fb-embed { display: block; margin: 4px 16px 12px; padding: 12px; border: 1px solid var(--lf-line); border-radius: 8px;
      color: inherit; text-decoration: none; background: transparent; }
    .fb-embed:hover { background: var(--lf-hover); }
    .fb-embed__head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .fb-embed__head div { display: flex; flex-direction: column; min-width: 0; }
    .fb-embed__head strong { font-size: 14px; font-weight: 600; }
    .fb-embed__head span { font-size: 12px; color: var(--lf-muted); }
    .fb-embed__head .fb-embed__when { display: inline-flex; align-items: center; gap: 4px; }
    .fb-embed__text { margin: 0; font-size: 14px; line-height: 1.35; color: var(--ion-text-color);
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
    .fb-embed__img { display: block; width: calc(100% + 24px); margin: 10px -12px -12px; max-height: 260px; object-fit: cover; border-radius: 0 0 8px 8px; }
    .fb-embed__poster { object-fit: contain; background: #111; }
    .fb-embed--gone { display: flex; align-items: center; gap: 8px; color: var(--lf-muted); font-size: 14px; }
    .fb-media { border-radius: 0; }
    .fb-like-icon {
      width: 18px; height: 18px; border-radius: 50%;
      background: linear-gradient(180deg, #18afff, #0062df); color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      box-shadow: 0 0 0 2px var(--lf-card);
    }
    .fb-stats-right { display: flex; align-items: center; gap: 6px; }
    /* The comment preview under the action bar, LinkedIn's most-relevant comment. */
    .fb-comment {
      display: flex; gap: 8px; align-items: flex-start;
      margin: 0 16px; padding: 10px 0 12px;
      border-top: 1px solid var(--lf-line);
      color: inherit; text-decoration: none;
    }
    .fb-comment__body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .fb-comment__who { font-size: 13.5px; font-weight: 600; }
    .fb-comment__text {
      margin: 0; font-size: 13.5px; line-height: 1.4;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .fb-comment__meta { font-size: 12.5px; color: var(--lf-muted); display: flex; align-items: center; gap: 5px; }

    /* React - Comment - Repost - Send, the bar LinkedIn puts under every post. */
    .fb-actions {
      display: flex; align-items: center; margin: 6px 8px 2px; padding-top: 2px;
      border-top: 1px solid var(--lf-line-soft);
    }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .fb-actions lf-reaction-button { flex: 1 1 0; min-width: 0; }
    .fb-act {
      flex: 1 1 0; min-width: 0; height: 40px; border: 0; background: transparent; color: var(--lf-muted);
      font-family: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; border-radius: 6px;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    }
    .fb-act:hover, .fb-act:active { background: var(--lf-hover); }
    .fb-act.on { color: var(--lf-primary); }
    .fb-act__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /*
     * A fifth action (Message) only appears on a live case. The four words
     * that carry the interaction keep their labels; Message, which is also on
     * the post page, keeps its icon and its accessible name, so no cell has to
     * clip a word to fit.
     */
    @media (max-width: 430px) {
      .fb-act { font-size: 12.5px; gap: 4px; font-weight: 600; }
      /* 18px glyphs, so "Comment" fits with its icon in a quarter of 390px. */
      .fb-act lf-icon svg { width: 18px; height: 18px; }
      .fb-act--chat .fb-act__label { display: none; }
      .fb-act--chat { flex: 0 0 40px; }
    }
    @media (max-width: 360px) {
      /* At 320px the row still says all four words: the type steps down and
         lightens rather than the words disappearing. */
      .fb-act { font-size: 11.5px; font-weight: 500; gap: 3px; letter-spacing: -.1px; }
      .fb-act--chat { flex: 0 0 36px; }
    }

    /* Your face, a pill that says what tapping does, then the shortcut icon. */
    .fb-comment-cta {
      width: calc(100% - 24px); margin: 0 12px 10px; padding: 0;
      display: flex; align-items: center; gap: 8px;
      border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer;
      text-align: left;
    }
    .fb-comment-cta__pill {
      flex: 1; min-width: 0;
      height: 34px; padding: 0 14px;
      display: flex; align-items: center;
      border-radius: 999px;
      background: var(--lf-input);
      color: var(--lf-muted);
      font-size: 14px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .fb-comment-cta:hover .fb-comment-cta__pill,
    .fb-comment-cta:active .fb-comment-cta__pill { background: var(--lf-hover); }
    .fb-comment-cta__ic {
      flex: none; width: 32px; height: 32px; border-radius: 50%;
      display: grid; place-items: center; color: var(--lf-muted);
    }
    .fb-comment-cta:hover .fb-comment-cta__ic { background: var(--lf-hover); }
    @media (max-width: 380px) { .fb-act { font-size: 12px; gap: 4px; } }

    .fb-chat-cta {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      width: calc(100% - 24px); margin: 0 12px 10px;
      height: 36px; border: 0; border-radius: 6px;
      background: var(--lf-card-2);
      color: var(--ion-text-color); font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
    }
    .fb-chat-cta.open { background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }

  `]
})
export class PostCardComponent implements OnInit, OnChanges, AfterViewChecked {
  /** The post text, measured to decide whether "…see more" is honest. */
  @ViewChild('bodyEl') private bodyRef?: ElementRef<HTMLElement>;

  private router = inject(Router);
  private lookOn = signal<boolean | null>(null);
  @Input({ required: true }) post!: Post;
  @Input() author: UserProfile | null = null;
  @Input() chatState: ChatState = 'off';

  @Output() vote = new EventEmitter<ReactionKind>();
  @Output() comment = new EventEmitter<void>();
  @Output() chat = new EventEmitter<void>();
  @Output() savedChange = new EventEmitter<void>();
  @Output() follow = new EventEmitter<Post>();

  private data = inject(DataService);
  private auth = inject(AuthService);
  private actions = inject(PostActionsService);

  /** Template-visible copy of DEFAULT_REACTION: module constants are not. */
  readonly defaultReaction = DEFAULT_REACTION;

  /** Set once this card's post was deleted, so it disappears at once. */
  readonly gone = signal(false);
  readonly original = signal<Post | null>(null);
  readonly originalMissing = signal(false);

  saved = signal(false);
  followingAuthor = signal(false);
  followRequested = signal(false);
  expanded = signal(false);

  protected readonly compact = compact;
  protected readonly timeAgo = timeAgo;
  protected readonly provinceName = provinceName;

  readonly meta = computed(() => POST_TYPE_META[this.post?.type ?? 'missing']);
  readonly isMine = computed(() => this.post?.authorId === this.auth.viewerId);
  readonly myVote = computed(() => (this.post ? this.data.myVote(this.post) : null));
  readonly authorName = computed(() =>
    this.post?.anonymous && !this.isMine() ? 'Anonymous' : this.author?.displayName ?? 'Member'
  );
  readonly originalName = computed(() => {
    const o = this.original();
    if (!o) return '';
    return o.anonymous ? 'Anonymous' : this.data.authorOf(o.authorId)?.displayName ?? 'Member';
  });
  readonly originalAvatar = computed(() => {
    const o = this.original();
    return this.data.avatarFor(o && !o.anonymous ? this.data.authorOf(o.authorId) : null);
  });
  /** Up to three reaction kinds, most given first, for the little stack next to the count. */
  readonly topKinds = computed<ReactionKind[]>(() => {
    const counts = new Map<ReactionKind, number>();
    for (const v of Object.values(this.post?.voterIds ?? {})) {
      if (isReaction(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const order = REACTIONS.map((r) => r.key);
    const kinds = [...counts.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0])).map(([k]) => k);
    /*
     * A card with reactions shows the kinds people actually chose. A card with
     * none shows the site default (Like), not a stray "Have an idea" bulb - the
     * fallback must not invent a reaction nobody gave.
     */
    return (kinds.length ? kinds : [DEFAULT_REACTION]).slice(0, 3);
  });
  readonly authorAvatar = computed(() => this.data.avatarFor(this.post?.anonymous && !this.isMine() ? null : this.author));

  /** The reader's own face, for the "Write a comment…" box. */
  readonly myAvatar = computed(() => this.auth.userAvatar());
  readonly myName = computed(() => this.auth.user()?.displayName ?? 'You');

  /**
   * The chip's colour follows the post's own tone, including the tones the
   * PostType table does not carry (`found` is an outcome, not a kind).
   */
  readonly kindTone = computed(() => {
    const p = this.post;
    if (!p) return 'neutral';
    if (p.status === 'found') return 'success';
    return POST_TYPE_META[p.type]?.tone ?? 'neutral';
  });

  /** The chip's word: the kind, or the outcome when the case is closed. */
  kindLabel(): string {
    if (!this.post) return '';
    if (this.post.status === 'found') return 'Found - home safe';
    return POST_TYPE_META[this.post.type]?.label ?? 'Post';
  }

  /**
   * "Orlando West, Soweto, Gauteng · 3d" - where, then when.
   *
   * The province is never dropped, even when a town is known: "Soweto" alone
   * is not an answer to "how far is this from me?", and the line ellipsizes
   * rather than losing the part that matters.
   */
  whereWhen(): string {
    const p = this.post;
    if (!p) return '';
    const town = (p.town ?? '').trim();
    const province = provinceName(p.province);
    const place = town && province ? `${town}, ${province}` : town || province;
    const when = timeAgo(p.createdAt);
    const edited = p.editedAt ? ` · edited ${timeAgo(p.editedAt)}` : '';
    return `${place} · ${when}${edited}`;
  }
  readonly authorStatus = computed(() =>
    this.post?.anonymous && !this.isMine() ? null : this.data.statusOf(this.author));
  readonly statusWord = computed(() => {
    const s = this.authorStatus();
    return s ? CHECK_IN_COPY[s].short : '';
  });
  readonly authorRoute = computed(() =>
    this.post?.anonymous && !this.isMine() ? ['/post/' + this.post.id] : ['/user/' + (this.author?.id ?? '')]
  );
  /**
   * True when the text is actually cut off at three lines.
   *
   * This used to be `body.length > 120`, which is a guess: on a wide screen a
   * 200-character post can fit, and "…see more" would be offered for a tap that
   * changes nothing. Ask the element instead.
   */
  readonly textOverflows = signal(false);

  /** LinkedIn's second header line: the poster's own line about themselves. */
  readonly authorHeadline = computed(() =>
    this.post?.anonymous && !this.isMine() ? '' : (this.author?.bio ?? '').trim());

  /** "You reposted this" / "Thabo Nkosi reposted this" - LinkedIn's reshare line. */
  reposterLine(): string {
    return this.isMine() ? 'You reposted this' : `${this.authorName()} reposted this`;
  }

  /** The original author's sub-line inside the embed box: their headline, as LinkedIn shows. */
  originalHeadline(o: Post): string {
    const bio = (this.data.authorOf(o.authorId)?.bio ?? '').trim();
    return bio || provinceName(o.province);
  }

  readonly visibleMedia = computed(() => this.post?.media.slice(0, 4) ?? []);
  readonly extraMedia = computed(() => Math.max(0, (this.post?.media.length ?? 0) - 4));

  readonly showFollow = computed(() => {
    if (this.isMine()) return false;
    if (this.post?.anonymous) return false;
    return !!this.author?.id;
  });

  async ngOnInit(): Promise<void> {
    this.syncFollow();
    this.loadOriginal();
    this.loadComment();
    this.saved.set(this.data.savedIds().includes(this.post?.id ?? ''));
  }

  ngOnChanges(): void {
    this.syncFollow();
    this.loadOriginal();
    this.loadComment();
  }

  /**
   * Ask for this post's comments once, for the preview under the card - but
   * only when the post claims to have any. A card with no comments does no work.
   */
  private loadComment(): void {
    if (this.post?.commentCount > 0) this.data.primeComments([this.post.id]);
  }

  /**
   * The comment LinkedIn would show: the one the most people stood behind, and
   * the oldest of those if there is a tie. Replies hang off a parent, so only
   * top-level comments are candidates - a reply shown on its own reads as a
   * sentence with its beginning cut off.
   */
  readonly topComment = computed<Comment | null>(() => {
    const list = this.data.commentsFor(this.post?.id ?? '');
    const top = list
      .filter((c) => !c.parentId && c.body.trim())
      .sort((a, b) => b.upvotes - a.upvotes || a.createdAt - b.createdAt);
    return top[0] ?? null;
  });

  commenterName(c: Comment): string {
    return this.data.authorOf(c.authorId)?.displayName ?? 'Member';
  }

  commenterAvatar(c: Comment): string {
    return this.data.avatarFor(this.data.authorOf(c.authorId));
  }

  /** LinkedIn's line above a post: who commented on it or reacted to it last. Not shown on your own activity or on reposts. */
  activity(): { userId: string; name: string; verb: string } | null {
    const p = this.post;
    if (!p || p.repostOf) return null;
    const me = this.auth.viewerId;
    const c = p.lastComment, l = p.lastLike;
    const useComment = !!c && (!l || c.at >= l.at);
    const who = useComment ? c : l;
    if (!who || who.userId === me || who.userId === p.authorId) return null;
    return { userId: who.userId, name: who.displayName, verb: useComment ? 'commented on this' : 'reacted to this' };
  }

  readonly reactionsOpen = signal(false);
  openReactions(e: Event): void { e.preventDefault(); e.stopPropagation(); this.reactionsOpen.set(true); }

  private loadOriginal(): void {
    const id = this.post?.repostOf;
    if (!id) return;
    const known = this.data.post(id);
    if (known) this.original.set(known);
    void this.data.loadPost(id).then((fresh) => {
      if (fresh) { this.original.set(fresh); this.originalMissing.set(false); }
      else if (!known) this.originalMissing.set(true);
    }).catch(() => { if (!known) this.originalMissing.set(true); });
  }

  private syncFollow(): void {
    const id = this.post?.authorId;
    if (!id) return;
    void this.data.followStatus(id).then((status) => {
      this.followingAuthor.set(status === 'accepted');
      this.followRequested.set(status === 'pending');
    });
  }

  async onFollow(e: Event): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (!this.post) return;
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { mode: 'signin', next: this.router.url } });
      return;
    }
    try {
      await this.data.toggleFollow(this.post.authorId);
      const status = await this.data.followStatus(this.post.authorId);
      this.followingAuthor.set(status === 'accepted');
      this.followRequested.set(status === 'pending');
      this.follow.emit(this.post);
    } catch { /* the profile has a full follow control with feedback */ }
  }

  /**
   * Who can see this post, drawn with the same three glyphs the composer uses
   * for the same choice: globe for public, people for followers, ribbon for a
   * Spotlight (surname) audience.
   */
  audienceIcon(): string {
    const a = this.post?.audience;
    return a === 'followers' ? 'users' : a === 'surname' ? 'award' : 'globe';
  }

  audienceTitle(): string {
    const a = this.post?.audience;
    return a === 'followers' ? 'Visible to followers' : a === 'surname' ? 'Visible in a Spotlight community' : 'Visible to anyone';
  }

  statusLabel(): string {
    if (!this.post) return '';
    if (this.post.status === 'found') return 'Found - home safe';
    return POST_TYPE_META[this.post.type].label;
  }

  /** Heading, name and last-seen lines are shown only when the post has not already said them. */
  showHeading(): boolean { return headingIsNew(this.post.title, this.post.body); }

  /* ---------------------- the case line ---------------------- */

  /**
   * Only a case that is still open gets the line. A found case has its own
   * green banner; a story or a repost is not a search.
   */
  /**
   * The voice note attached to this post, if there is exactly one and it is the
   * only thing attached. With photos as well, the note becomes a tile - the
   * pictures are what people scan for.
   */
  voiceNote(): MediaItem | undefined {
    const notes = (this.post.media ?? []).filter((m) => m.kind === 'audio');
    if (notes.length !== 1) return undefined;
    return (this.post.media ?? []).length === 1 ? notes[0] : undefined;
  }

  /**
   * The spoken words as text, for anyone who cannot hear the note.
   *
   * Only the note's own transcript counts. Earlier this fell back to the post
   * body, which put "Read it instead" under a player and then repeated the
   * case's text a second time - a promise the audio did not keep. No transcript
   * means no control: a voice note without words stays a player, not a dead end.
   */
  transcriptOf(note: MediaItem): string {
    return (note.transcript ?? '').trim();
  }

  chatLabel(): string {
    switch (this.chatState) {
      case 'open': return 'Message them';
      case 'locked-follow': return 'Follow or be followed to message';
      default: return 'Message the poster';
    }
  }

  /**
   * Runs after every render: while the text is clamped, does it overflow?
   * Only written when the answer changes, so a render cannot chase itself.
   */
  ngAfterViewChecked(): void {
    const el = this.bodyRef?.nativeElement;
    if (!el || this.expanded()) return;
    // Where there is no layout to measure (tests, a hidden tab), fall back to
    // the length rule this used to use rather than claiming the text fits.
    const over = el.clientHeight > 0
      ? el.scrollHeight > el.clientHeight + 2
      : (this.post?.body?.trim().length ?? 0) > 120;
    if (over !== this.textOverflows()) this.textOverflows.set(over);
  }

  toggleExpand(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.expanded.update((v) => !v);
  }

  onReact(kind: ReactionKind): void {
    this.vote.emit(kind);
  }

  /** The reaction this viewer already gave, or null. */
  myReaction(): ReactionKind | null {
    return this.post ? this.data.myVote(this.post) : null;
  }

  /** "Like" until you have reacted, the reaction's own name after that. */
  reactionWord(): string {
    const mine = this.myReaction();
    return mine ? REACTIONS.find((r) => r.key === mine)?.label ?? DEFAULT_REACTION_LABEL : DEFAULT_REACTION_LABEL;
  }


  onRepost(): void { void this.actions.openRepost(this.post); }
  onSend(): void { void this.actions.send(this.post); }

  onSave(): void {
    this.saved.update((s) => !s);
    this.savedChange.emit();
  }

  onMore(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    void this.actions.openMenu(this.post, () => this.gone.set(true));
  }
}
