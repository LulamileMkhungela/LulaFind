import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { LULA_API } from '../data/api';
import { Lookout, UserProfile } from '../models/types';
import { uid } from '../utils/format';
import { answerBlocker, clearedByOwner, clearedBySelf, hasAnswered, isDue, newLookout, waitingOn, withAsked } from '../utils/lookout';
import { AuthService } from './auth.service';
import { DataService } from './data.service';
import { LocationService } from './location.service';

/**
 * "Be on the lookout" - what happens when someone tells their followers they
 * may not be safe.
 *
 * The person starts it themselves: where they are going, or the area that
 * worries them. Their followers are told, and while it runs they can see where
 * the person last checked in. Twenty-four hours later the app asks each of
 * those followers, one at a time, whether the person is okay:
 *
 *   - every follower says yes -> the lookout closes on its own;
 *   - one follower says no    -> LulaFind flags the person as a possible
 *                               missing person, but only if the person allowed
 *                               the app to publish a case about them.
 *
 * The person it is about can end it at any moment by saying "I'm here", and the
 * case the app published is deleted with it. Nothing here is automatic in the
 * other direction: the app never calls someone missing without a person saying
 * something is wrong.
 */
@Injectable({ providedIn: 'root' })
export class LookoutService {
  private api = inject(LULA_API);
  private auth = inject(AuthService);
  private data = inject(DataService);
  private location = inject(LocationService);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** Lookouts currently being asked about, so one is never asked twice at once. */
  private readonly asking = new Set<string>();

  constructor() {
    /*
     * The 24-hour clock. The check runs whenever lookouts land, and again on
     * every sync (the store re-reads them every 45 seconds) - so whoever opens
     * the app runs the check, and it always runs against a list that has
     * actually loaded. In production the same rule is also run by pg_cron (see
     * supabase/schema.sql), because a follower should not have to open the app
     * for the question to be asked.
     */
    this.data.onLookoutsLoaded(async () => {
      if (this.auth.signedIn()) await this.runDue();
    });
    effect(() => {
      this.data.syncTick();
      if (!this.auth.signedIn()) return;
      untracked(() => void this.data.loadLookouts());
    });
  }

  /**
   * My open lookout, if any. "Open" includes one that has been flagged: the
   * person it is about must always be able to say "I'm here", especially once a
   * case has been published about them.
   */
  readonly mine = computed<Lookout | null>(() => {
    const me = this.auth.user();
    if (!me) return null;
    const all = this.data.lookouts();
    return all.find(
      (l) => l.userId === me.id && (l.status === 'active' || l.status === 'checking' || l.status === 'escalated')
    ) ?? null;
  });

  /** Everything about me that is still open, for the banner on my profile. */
  readonly openForMe = computed<Lookout | null>(() => this.mine());

  /** Someone else's open lookout - what the profile page shows about them. */
  openLookoutFor(userId: string): Lookout | null {
    return this.data.lookouts().find(
      (l) => l.userId === userId && (l.status === 'active' || l.status === 'checking' || l.status === 'escalated')
    ) ?? null;
  }

  hasAnswered(lookout: Lookout, userId: string): boolean {
    return hasAnswered(lookout, userId);
  }

  /** The questions waiting on me, as a follower. */
  readonly waitingOnMe = computed<Lookout[]>(() => {
    const me = this.auth.user();
    if (!me) return [];
    return this.data.lookouts().filter(
      (l) => l.status === 'checking' && l.userId !== me.id
        && l.askedIds.includes(me.id) && !hasAnswered(l, me.id)
    );
  });

  /* ------------------------------ start ------------------------------ */

  async start(input: { area: string; note?: string; shareLocation?: boolean }): Promise<Lookout> {
    const me = this.auth.user();
    if (!me) throw new Error('Sign in to start a lookout');
    if (me.suspended) throw new Error('Your account is suspended');
    if (!input.area.trim()) throw new Error('Say where you are going, or the area that worries you');

    this.busy.set(true);
    this.error.set(null);
    try {
      let point = null;
      if (input.shareLocation !== false) {
        if (this.location.permission() === 'granted') point = await this.location.readDevicePosition();
      }

      const lookout = newLookout(me.id, { ...input, location: point });
      await this.api.saveLookout(lookout);
      this.data.mergeLookout(lookout);
      await this.tellFollowers(me, lookout);
      // A lookout is a safety status: it also shows on the profile ring.
      await this.setCheckInStatus(me, 'unfamiliar', `On the lookout: ${lookout.area}`);
      return lookout;
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not start the lookout');
      throw e;
    } finally {
      this.busy.set(false);
    }
  }

  /* ------------------------------ answers ------------------------------ */

  /** Ask every follower whether the person is okay. Called when the 24 hours are up. */
  async askFollowers(lookout: Lookout): Promise<Lookout> {
    const fresh = this.data.lookouts().find((l) => l.id === lookout.id) ?? lookout;
    if (!isDue(fresh) || this.asking.has(fresh.id)) return fresh;

    this.asking.add(fresh.id);
    try {
      const asked = await this.followerIdsOf(fresh.userId);
      const next = withAsked(fresh, asked);
      /*
       * Show it as asked before the write finishes. Every write makes the store
       * re-read itself, and without this the next read would still look due and
       * ask again - the whole thing would stampede.
       */
      this.data.mergeLookout(next);
      await this.api.patchLookout(fresh.id, {
        status: next.status, askedIds: next.askedIds, askedAt: next.askedAt, checkAt: next.checkAt
      });
      const saved = (await this.api.patchLookout(fresh.id, {})) ?? next;
      this.data.mergeLookout(saved);

      const owner = await this.api.user(fresh.userId);
      const name = owner?.displayName ?? 'Someone you follow';
      for (const followerId of asked) {
        await this.api.pushNotification({
          id: uid('n'),
          userId: followerId,
          kind: 'lookout',
          title: `Is ${name} okay?`,
          body: asked.length === 1
            ? `${name} set a lookout 24 hours ago and has not said they are safe. You are the only follower asked - please answer.`
            : `${name} set a lookout 24 hours ago and has not said they are safe. Please say whether you have seen or heard from them.`,
          at: Date.now(),
          read: false,
          route: `/lookout/${fresh.id}`,
          postId: null
        });
      }
      return saved;
    } finally {
      this.asking.delete(fresh.id);
    }
  }

  /** Anything that has reached its 24 hours gets asked. Run on start-up and on a timer. */
  async runDue(now = Date.now()): Promise<number> {
    let asked = 0;
    for (const lookout of this.data.lookouts()) {
      if (!isDue(lookout, now) || this.asking.has(lookout.id)) continue;
      await this.askFollowers(lookout);
      asked++;
    }
    return asked;
  }

  /**
   * A follower answers.
   *
   * One "no" flags the person - and the case the app publishes is built from
   * the person's own last check-in and the area they named. If they never
   * allowed the app to publish, nothing is posted anywhere: the answer is still
   * recorded, their followers are told, and the page says out loud why there is
   * no case.
   */
  async answer(lookoutId: string, ok: boolean): Promise<Lookout | undefined> {
    const me = this.auth.user();
    if (!me) throw new Error('Sign in to answer');
    const lookout = this.data.lookouts().find((l) => l.id === lookoutId);
    if (!lookout) throw new Error('That lookout is not here any more');
    const blocked = answerBlocker(lookout, me.id);
    if (blocked) throw new Error(blocked);
    if (hasAnswered(lookout, me.id)) return lookout;

    this.busy.set(true);
    try {
      const next = await this.api.answerLookout(lookoutId, me.id, ok);
      if (next) this.data.mergeLookout(next);

      const owner = await this.api.user(lookout.userId);

      if (!ok) {
        await this.onEscalated(next ?? lookout, owner);
      } else if (next?.status === 'cleared') {
        await this.tellEveryoneClear(next, owner);
      } else {
        // Let the person know a follower has confirmed they are okay so far.
        await this.notify(lookout.userId, lookout.id, `${me.displayName} says you are okay`,
          `${me.displayName} answered the safety check. ${waitingOn(next ?? lookout).length} still to answer.`);
      }
      return next;
    } finally {
      this.busy.set(false);
    }
  }

  private async onEscalated(lookout: Lookout, owner: UserProfile | undefined): Promise<void> {
    const name = owner?.displayName ?? 'This member';
    const published = !!lookout.escalatedPostId;
    const allowed = owner?.privacy?.allowSafetyAlertPosts === true;

    await this.notify(lookout.userId, lookout.id,
      published ? `${name} was flagged as a possible missing person` : 'Someone said something is wrong',
      published
        ? 'A follower said something is wrong after 24 hours. LulaFind published a case about you. If you are safe, open it and tap "I\'m here" - the post is deleted.'
        : allowed
          ? 'A follower said something is wrong after 24 hours.'
          : 'A follower said something is wrong, but you have not allowed LulaFind to post a case about you, so no case was published. You can turn that on in the Safety centre.');

    // Everyone who follows this person should know something is wrong with them.
    for (const followerId of lookout.askedIds) {
      if (await this.api.isFollowing(followerId, lookout.userId)) {
        await this.notify(followerId, lookout.id, `${name} may be missing`,
          published
            ? 'Someone said something is wrong after the 24-hour lookout. A case has been opened - please look at it.'
            : 'Someone said something is wrong after the 24-hour lookout.');
      }
    }

    if (owner) await this.setCheckInStatus(owner, 'need_help', `Possible missing person: ${lookout.area}`);
  }

  private async tellEveryoneClear(lookout: Lookout, owner: UserProfile | undefined): Promise<void> {
    const name = owner?.displayName ?? 'This member';
    for (const followerId of lookout.askedIds) {
      await this.notify(followerId, lookout.id, `${name} is safe`,
        'Every follower confirmed they are okay. The lookout is closed.');
    }
    await this.notify(lookout.userId, lookout.id, 'Your followers confirmed you are safe',
      'The lookout is closed. Your status is back to safe.');
    if (owner) await this.setCheckInStatus(owner, 'safe', 'Followers confirmed I am okay');
  }

  private async tellFollowers(me: UserProfile, lookout: Lookout): Promise<void> {
    const followers = await this.followerIdsOf(me.id);
    for (const followerId of followers) {
      await this.notify(followerId, lookout.id, `Be on the lookout: ${me.displayName}`,
        `${me.displayName} may not feel safe around ${lookout.area}. You will be asked in 24 hours to confirm they are okay.`);
    }
  }

  /* ------------------------------ ending it ------------------------------ */

  /** The person says they are here. Any case the app published is deleted. */
  async imHere(lookoutId?: string): Promise<Lookout | null> {
    const me = this.auth.user();
    if (!me) throw new Error('Sign in first');
    const lookout = lookoutId
      ? this.data.lookouts().find((l) => l.id === lookoutId)
      : this.mine();
    if (!lookout) return null;
    if (lookout.userId !== me.id && me.isAdmin !== true) throw new Error('Only the person this is about can say that');

    this.busy.set(true);
    try {
      const closed = clearedBySelf(lookout);
      const saved = await this.api.patchLookout(lookout.id, {
        status: closed.status, closedAt: closed.closedAt, closedReason: closed.closedReason
      }) ?? closed;
      await this.api.deleteLookoutCase(lookout.id);
      this.data.mergeLookout(saved);

      for (const followerId of saved.askedIds.length ? saved.askedIds : await this.followerIdsOf(me.id)) {
        await this.notify(followerId, saved.id, `${me.displayName} is safe`,
          'They said "I\'m here". The lookout is closed and anything the app posted has been removed.');
      }
      await this.setCheckInStatus(me, 'safe', 'I am here');
      return saved;
    } finally {
      this.busy.set(false);
    }
  }

  /** The person takes it back without a full check-out. */
  async cancel(lookoutId?: string): Promise<Lookout | null> {
    const me = this.auth.user();
    const lookout = lookoutId ? this.data.lookouts().find((l) => l.id === lookoutId) : this.mine();
    if (!me || !lookout) return null;
    if (lookout.userId !== me.id && me.isAdmin !== true) throw new Error('That is not yours to cancel');
    this.busy.set(true);
    try {
      const closed = clearedByOwner(lookout);
      const saved = await this.api.patchLookout(lookout.id, {
        status: closed.status, closedAt: closed.closedAt, closedReason: closed.closedReason
      }) ?? closed;
      // A lookout-generated case is not allowed to survive the owner's cancel.
      // This keeps a stale public alert from outliving the person's decision.
      if (saved.escalatedPostId) await this.api.deleteLookoutCase(saved.id);
      this.data.mergeLookout(saved);
      for (const followerId of saved.askedIds) {
        await this.notify(followerId, saved.id, `${me.displayName} ended the lookout`,
          'They cancelled the lookout. No further check-in is needed.');
      }
      return saved;
    } finally {
      this.busy.set(false);
    }
  }

  /* ------------------------------ helpers ------------------------------ */

  /** People who follow `userId`, as ids. */
  async followerIdsOf(userId: string): Promise<string[]> {
    const all = await this.api.users();
    const out: string[] = [];
    for (const u of all) {
      if (u.id === userId) continue;
      if (await this.api.isFollowing(u.id, userId)) out.push(u.id);
    }
    return out;
  }

  private async notify(userId: string, lookoutId: string, title: string, body: string): Promise<void> {
    await this.api.pushNotification({
      id: uid('n'), userId, kind: 'lookout', title, body,
      at: Date.now(), read: false, route: `/lookout/${lookoutId}`, postId: null
    });
  }

  /** A lookout is a safety status, so the profile ring follows it. */
  private async setCheckInStatus(u: UserProfile, status: 'safe' | 'unfamiliar' | 'need_help', note: string): Promise<void> {
    const fresh = (await this.api.user(u.id)) ?? u;
    const next: UserProfile = {
      ...fresh,
      lastBeaconAt: Date.now(),
      checkIn: {
        status,
        note,
        at: Date.now(),
        location: fresh.checkIn?.location ?? null,
        liveShareOn: false,
        liveUntil: null
      }
    };
    await this.api.saveUser(next);
    if (this.auth.user()?.id === next.id) await this.auth.updateProfile(next);
    this.data.touchAuthor(next);
  }
}
