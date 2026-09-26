import { InjectionToken } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import {
  ChatMessage, ChatThread, Comment, FeedFilter, FollowEdge, Notification, Post, Spotlight, Story, Tip, UserProfile
} from '../models/types';
import { LocalDb } from './local-db';

/**
 * Data-source contract. Two implementations ship with the app:
 *  - MockApi  : bundled seed data + localStorage (default, works fully offline)
 *  - FirebaseApi : Cloud Firestore + Firebase Auth (set environment.dataMode = 'firebase')
 *
 * Everything above this line is UI code and never knows which one is active.
 */
export abstract class LulaApi {
  abstract init(): Promise<void>;
  abstract reset(): Promise<void>;

  /* users */
  abstract user(id: string): Promise<UserProfile | undefined>;
  abstract users(): Promise<UserProfile[]>;
  abstract saveUser(u: UserProfile): Promise<void>;
  abstract deleteUser(id: string): Promise<void>;

  /* posts */
  abstract post(id: string): Promise<Post | undefined>;
  abstract posts(): Promise<Post[]>;
  abstract queryFeed(f: FeedFilter, viewerId: string | null): Promise<Post[]>;
  abstract savePost(p: Post): Promise<void>;
  abstract deletePost(id: string): Promise<void>;

  /* comments */
  abstract commentsFor(postId: string): Promise<Comment[]>;
  abstract saveComment(c: Comment): Promise<void>;
  abstract deleteComment(id: string): Promise<void>;

  /* spotlights */
  abstract spotlights(): Promise<Spotlight[]>;
  abstract spotlight(id: string): Promise<Spotlight | undefined>;
  abstract saveSpotlight(s: Spotlight): Promise<void>;

  /* stories */
  abstract stories(): Promise<Story[]>;
  abstract saveStory(s: Story): Promise<void>;

  /* chat */
  abstract threadsFor(userId: string): Promise<ChatThread[]>;
  abstract thread(id: string): Promise<ChatThread | undefined>;
  abstract saveThread(t: ChatThread): Promise<void>;
  abstract messages(threadId: string): Promise<ChatMessage[]>;
  abstract saveMessage(m: ChatMessage): Promise<void>;
  abstract markThreadRead(threadId: string, userId: string): Promise<void>;

  /* follows */
  abstract isFollowing(a: string, b: string): Promise<boolean>;
  abstract follow(a: string, b: string): Promise<'accepted' | 'pending'>;
  abstract unfollow(a: string, b: string): Promise<void>;
  /** Requests waiting on this person's accept / decline. */
  abstract followRequests(userId: string): Promise<FollowEdge[]>;
  abstract respondFollowRequest(followerId: string, userId: string, accept: boolean): Promise<void>;
  abstract followerCount(userId: string): Promise<number>;
  abstract followingCount(userId: string): Promise<number>;

  /* notifications */
  abstract notifications(userId: string): Promise<Notification[]>;
  abstract pushNotification(n: Notification): Promise<void>;
  abstract markNotificationsRead(userId: string): Promise<void>;

  /* tips */
  abstract tips(): Promise<Tip[]>;

  /** Live change feed. Emits whenever any document changes. */
  abstract changes(): Observable<number>;
}

export const LULA_API = new InjectionToken<LulaApi>('LULA_API');

/** Thin adapter so the mock engine satisfies the async contract. */
export class MockApi implements LulaApi {
  constructor(public readonly db: LocalDb) {}
  private readonly rx = new Subject<number>();

  async init(): Promise<void> {
    this.db.subscribe(() => this.rx.next(this.db.revision()));
  }
  async reset(): Promise<void> { this.db.reset(); }

  async user(id: string) { return this.db.user(id); }
  async users() { return this.db.users(); }
  async saveUser(u: UserProfile) { this.db.upsertUser(u); }
  async deleteUser(id: string) { this.db.removeUser(id); }

  async post(id: string) { return this.db.post(id); }
  async posts() { return this.db.posts(); }
  async queryFeed(f: FeedFilter, viewerId: string | null) {
    return this.db.filtered(f, viewerId, viewerId ? this.db.user(viewerId) : undefined);
  }
  async savePost(p: Post) { this.db.upsertPost(p); }
  async deletePost(id: string) { this.db.deletePost(id); }

  async commentsFor(postId: string) { return this.db.commentsFor(postId); }
  async saveComment(c: Comment) { this.db.upsertComment(c); }
  async deleteComment(id: string) { this.db.deleteComment(id); }

  async spotlights() { return this.db.spotlights(); }
  async spotlight(id: string) { return this.db.spotlight(id); }
  async saveSpotlight(s: Spotlight) { this.db.upsertSpotlight(s); }

  async stories() { return this.db.stories(); }
  async saveStory(s: Story) { this.db.upsertStory(s); }

  async threadsFor(userId: string) { return this.db.threadsFor(userId); }
  async thread(id: string) { return this.db.thread(id); }
  async saveThread(t: ChatThread) { this.db.upsertThread(t); }
  async messages(threadId: string) { return this.db.messages(threadId); }
  async saveMessage(m: ChatMessage) { this.db.upsertMessage(m); }
  async markThreadRead(threadId: string, userId: string) { this.db.markThreadRead(threadId, userId); }

  async isFollowing(a: string, b: string) { return this.db.isFollowing(a, b); }
  /**
   * Follow someone. Returns 'pending' when they have asked to approve requests,
   * 'accepted' when it goes straight through.
   */
  async follow(a: string, b: string): Promise<'accepted' | 'pending'> {
    const target = this.db.user(b);
    const needsApproval = target?.privacy?.requireFollowApproval === true;
    const status: FollowEdge['status'] = needsApproval ? 'pending' : 'accepted';
    this.db.upsertFollow({ id: `f_${a}_${b}`, followerId: a, followingId: b, at: Date.now(), status });
    return status;
  }
  async unfollow(a: string, b: string) { this.db.removeFollow(a, b); }
  async followRequests(userId: string) { return this.db.followRequestsFor(userId); }
  async respondFollowRequest(followerId: string, userId: string, accept: boolean) {
    if (accept) this.db.setFollowStatus(followerId, userId, 'accepted');
    else this.db.removeFollow(followerId, userId);
  }
  async followerCount(userId: string) { return this.db.followersOf(userId).length; }
  async followingCount(userId: string) { return this.db.followingOf(userId).length; }

  async notifications(userId: string) { return this.db.notifications(userId); }
  async pushNotification(n: Notification) { this.db.pushNotification(n); }
  async markNotificationsRead(userId: string) { this.db.markNotificationsRead(userId); }

  async tips() { return this.db.tips(); }

  changes() { return this.rx.asObservable(); }
}
