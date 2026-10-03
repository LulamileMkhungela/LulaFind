import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/toast-controller';
import { ActionSheetController } from '@ionic/angular/action-sheet-controller';
import { AlertController } from '@ionic/angular/alert-controller';
import { Post } from '../models/types';
import { DataService } from './data.service';
import { AuthService } from './auth.service';
import { PlatformService } from './platform.service';
import { ModerationService } from './moderation.service';
import { ChatService } from './chat.service';
import { UserProfile } from '../models/types';

/**
 * Everything you can do to a post from a menu: repost, send, save, edit,
 * delete, report. It lives in one place so a post behaves the same on Home, a
 * profile, Search, a Spotlight and its own page - and so every one of them
 * tells you what happened ("Post deleted", "Reposted").
 */
/** One row in the Send sheet. */
export interface SendPerson {
  profile: UserProfile;
  /** True when you follow each other, so it also lands in your chat. */
  connection: boolean;
}

@Injectable({ providedIn: 'root' })
export class PostActionsService {
  private data = inject(DataService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private platform = inject(PlatformService);
  private mod = inject(ModerationService);
  private chat = inject(ChatService);
  private toastCtl = inject(ToastController);
  private sheetCtl = inject(ActionSheetController);
  private alertCtl = inject(AlertController);

  /** The post whose repost sheet is open (rendered once, by `lf-repost-sheet`). */
  readonly repostTarget = signal<Post | null>(null);
  /** True when the viewer has already reposted `repostTarget`, so the sheet offers Undo. */
  readonly repostUndo = signal<Post | null>(null);
  readonly busy = signal(false);

  /* ------------------------------- send ------------------------------- */

  /** The post whose Send sheet is open (rendered once, by `lf-send-sheet`). */
  readonly sendTarget = signal<Post | null>(null);
  /** What the person has typed in the sheet's search box. */
  readonly sendQuery = signal('');
  /** Everyone this post can be sent to in the app, best matches first. */
  readonly sendPeople = signal<SendPerson[]>([]);
  readonly sendBusy = signal(false);
  readonly sendLoading = signal(false);

  async toast(message: string, action?: { text: string; handler: () => void }): Promise<void> {
    const t = await this.toastCtl.create({
      message, duration: action ? 4200 : 2400, position: 'bottom',
      buttons: action ? [{ text: action.text, role: 'cancel', handler: action.handler }] : []
    });
    await t.present();
  }

  async needAuth(): Promise<boolean> {
    if (this.auth.signedIn()) return true;
    await this.toast('Sign in to do that', { text: 'Sign in', handler: () => void this.router.navigate(['/auth']) });
    return false;
  }

  /* ----------------------------- repost ----------------------------- */
  async openRepost(p: Post): Promise<void> {
    if (!(await this.needAuth())) return;
    const original = p.repostOf ? (await this.data.loadPost(p.repostOf)) ?? p : p;
    if (original.authorId === this.auth.viewerId) {
      await this.toast('You can\u2019t repost your own post. Use Send to share it.');
      return;
    }
    if (original.audience !== 'public' || original.anonymous || !original.allowShare) {
      await this.toast('This post can\u2019t be reposted. Use Send to share the link.');
      return;
    }
    this.repostUndo.set(await this.data.myRepostOf(original.id));
    this.repostTarget.set(original);
  }

  closeRepost(): void {
    this.repostTarget.set(null);
    this.repostUndo.set(null);
  }

  /** "Repost" on LinkedIn: straight to your followers, no text. */
  async repostNow(): Promise<void> {
    const p = this.repostTarget();
    if (!p || this.busy()) return;
    this.busy.set(true);
    try {
      const copy = await this.data.repost(p.id);
      this.closeRepost();
      await this.toast('Repost successful', { text: 'View post', handler: () => void this.router.navigate(['/post', copy.id]) });
    } catch (e: unknown) {
      this.closeRepost();
      await this.toast(e instanceof Error ? e.message : 'Could not repost. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  /** "Repost with your thoughts": opens the composer with the original attached. */
  repostWithThoughts(): void {
    const p = this.repostTarget();
    if (!p) return;
    this.closeRepost();
    void this.router.navigate(['/repost', p.id]);
  }

  async undoRepost(): Promise<void> {
    const mine = this.repostUndo();
    if (!mine || this.busy()) return;
    this.busy.set(true);
    try {
      const gone = await this.data.deletePost(mine.id);
      this.closeRepost();
      await this.toast(gone ? 'Repost removed' : 'Could not remove your repost. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  /* ------------------------------ send ------------------------------ */
  /**
   * Send on LinkedIn opens a picker, not the phone's share sheet: you choose
   * the person, or you choose another app. This is that picker.
   */
  async send(p: Post): Promise<void> {
    if (!(await this.needAuth())) return;
    const target = p.repostOf ? (await this.data.loadPost(p.repostOf)) ?? p : p;
    this.sendQuery.set('');
    this.sendTarget.set(target);
    void this.loadSendPeople();
  }

  closeSend(): void {
    this.sendTarget.set(null);
    this.sendQuery.set('');
  }

  /**
   * Who can be sent this post, in the app.
   *
   * Connections (you follow each other) come first, then your followers: they
   * chose to see your posts, so handing them one is welcome rather than a cold
   * message. People you merely follow are left out - they have not asked for
   * anything from you, and the app's rule is that messaging needs a mutual
   * follow.
   */
  private async loadSendPeople(): Promise<void> {
    this.sendLoading.set(true);
    try {
      const mutual = new Set(this.data.followingIds().filter((id) => this.data.followerIds().includes(id)));
      const ids = [...mutual, ...this.data.followerIds().filter((id) => !mutual.has(id))];
      const people = await Promise.all(ids.map((id) => this.data.profile(id)));
      this.sendPeople.set(
        people
          .filter((u): u is UserProfile => !!u && u.id !== this.auth.viewerId)
          .map((u) => ({ profile: u, connection: mutual.has(u.id) }))
      );
    } finally {
      this.sendLoading.set(false);
    }
  }

  /** The people matching what has been typed. */
  matches(query: string): SendPerson[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.sendPeople();
    return this.sendPeople().filter((p) =>
      p.profile.displayName.toLowerCase().includes(q)
      || p.profile.handle.toLowerCase().includes(q)
      || (p.profile.bio ?? '').toLowerCase().includes(q)
    );
  }

  /**
   * Send this post to one person, inside LulaFind.
   *
   * It always reaches them as a notification, so it works whoever they are.
   * When you follow each other it also lands in your chat thread about the post,
   * which is where a conversation can carry on.
   */
  async sendToUser(person: SendPerson): Promise<void> {
    const p = this.sendTarget();
    const me = this.auth.user();
    if (!p || !me || this.sendBusy()) return;
    this.sendBusy.set(true);
    try {
      await this.data.notifyPerson(person.profile.id, {
        kind: 'share',
        title: `${me.displayName} sent you a case`,
        body: p.title,
        route: `/post/${p.id}`,
        postId: p.id
      });

      let inChat = false;
      if (person.connection) {
        const thread = await this.chat.ensureThread(p, person.profile.id);
        if (thread) {
          await this.chat.send(`I sent you this case: ${p.title}\n${this.platform.link(`/post/${p.id}`)}`);
          inChat = true;
        }
      }
      await this.data.recordShare(p.id).catch(() => undefined);
      this.closeSend();
      await this.toast(
        inChat ? `Sent to ${person.profile.displayName} - it is in your chat and their notifications` : `Sent to ${person.profile.displayName}`,
        inChat ? { text: 'Open chat', handler: () => void this.router.navigate(['/chats']) } : undefined
      );
    } catch (e: unknown) {
      await this.toast((e as Error)?.message ?? 'Could not send this post');
    } finally {
      this.sendBusy.set(false);
    }
  }

  /** "Share to other apps" - the phone's own share sheet: WhatsApp, SMS, mail. */
  async shareExternally(): Promise<void> {
    const target = this.sendTarget();
    if (!target) return;
    const text = `${target.title}\n\n${target.body.slice(0, 220)}\n\nShared from LulaFind`;
    const mode = await this.platform.share(target.title, text, this.platform.link(`/post/${target.id}`));
    await this.data.recordShare(target.id).catch(() => undefined);
    this.closeSend();
    await this.toast(mode === 'clipboard' ? 'Link copied to clipboard' : 'Shared');
  }

  /* ------------------------------ menu ------------------------------ */
  /**
   * The "..." menu. `onGone` runs after a delete that was confirmed by the
   * server, so a detail page can leave the post it just removed.
   */
  async openMenu(p: Post, onGone?: () => void): Promise<void> {
    const mine = this.data.canEdit(p);
    const saved = this.data.savedIds().includes(p.id);
    const isRepost = !!p.repostOf;
    const buttons: { text: string; role?: string; icon?: string; handler?: () => void }[] = [
      { text: saved ? 'Unsave' : 'Save', icon: 'bookmark', handler: () => void this.toggleSave(p) },
      { text: 'Copy link to post', icon: 'link', handler: () => void this.copyLink(p) }
    ];
    if (mine) {
      if (!isRepost) buttons.push({ text: 'Edit post', icon: 'pencil', handler: () => void this.router.navigate(['/post', p.id, 'edit']) });
      buttons.push({
        text: isRepost ? 'Delete repost' : 'Delete post', role: 'destructive', icon: 'trash',
        handler: () => void this.confirmDelete(p, onGone)
      });
    } else {
      buttons.push({ text: 'Report post', role: 'destructive', icon: 'flag', handler: () => void this.report(p) });
    }
    buttons.push({ text: 'Cancel', role: 'cancel' });
    const sheet = await this.sheetCtl.create({ header: p.title.slice(0, 48), buttons: buttons as never });
    await sheet.present();
  }

  async toggleSave(p: Post): Promise<void> {
    if (!(await this.needAuth())) return;
    const saved = await this.data.toggleSaved(p.id);
    await this.toast(saved ? 'Post saved. Find it in Menu \u2192 Saved.' : 'Removed from Saved');
  }

  async copyLink(p: Post): Promise<void> {
    const ok = await this.platform.copy(this.platform.link(`/post/${p.repostOf ?? p.id}`));
    await this.toast(ok ? 'Link copied to clipboard' : 'Could not copy the link');
  }

  /** Asks first, deletes, then says whether it worked. */
  async confirmDelete(p: Post, onGone?: () => void): Promise<void> {
    const alert = await this.alertCtl.create({
      header: p.repostOf ? 'Delete this repost?' : 'Delete this post?',
      message: p.repostOf ? 'The original post stays where it is.' : 'This removes the post and its comments for everyone. It can\u2019t be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete', role: 'destructive',
          /*
           * Deliberately not `async`.
           *
           * Ionic keeps a dialog on screen until its button handler settles, so
           * an async handler meant "Delete" left the popup sitting there for the
           * whole write. This returns nothing, so the dialog is gone on the tap;
           * the removal itself runs in the background.
           */
          handler: () => { void this.runDelete(p, onGone); }
        }
      ]
    });
    await alert.present();
  }

  /**
   * Delete a post the person has already confirmed.
   *
   * Order matters: the caller (a list, or the post's own page) drops the post
   * first so it disappears the instant Delete is tapped, and the toast is fired
   * without being awaited - nothing here blocks the screen.
   */
  private async runDelete(p: Post, onGone?: () => void): Promise<void> {
    onGone?.();
    try {
      const gone = await this.data.deletePost(p.id);
      void this.toast(gone
        ? (p.repostOf ? 'Repost deleted' : 'Post deleted')
        : 'The post was not deleted. Check your connection and try again.');
    } catch (e: unknown) {
      void this.toast(e instanceof Error ? `Post not deleted: ${e.message}` : 'The post was not deleted. Try again.');
    }
  }

  async report(p: Post): Promise<void> {
    if (!(await this.needAuth())) return;
    const pick = await this.alertCtl.create({
      header: 'Report this post',
      inputs: this.mod.reasons.map((r, i) => ({ name: 'reason', type: 'radio' as const, label: r.label, value: r.id, checked: i === 0 })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Send report',
          handler: async (v: string) => {
            try {
              await this.mod.report({ target: 'post', targetId: p.id, summary: p.title, reason: v ?? 'other' });
              await this.toast('Report sent. Thank you \u2014 an admin will look at it.');
            } catch (e: unknown) {
              await this.toast(e instanceof Error ? e.message : 'Could not send the report');
            }
          }
        }
      ]
    });
    await pick.present();
  }
}
