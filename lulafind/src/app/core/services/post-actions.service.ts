import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/toast-controller';
import { ActionSheetController } from '@ionic/angular/action-sheet-controller';
import { AlertController } from '@ionic/angular/alert-controller';
import { Post, UserProfile, provinceName } from '../models/types';
import { DataService } from './data.service';
import { AuthService } from './auth.service';
import { PlatformService } from './platform.service';
import { ModerationService } from './moderation.service';
import { ChatService } from './chat.service';

/** One row of the Send sheet. */
export interface SendRecipient {
  id: string;
  name: string;
  headline: string;
  avatar: string;
}

const provinceNameOf = (code: UserProfile['province']): string => provinceName(code ?? undefined);

/**
 * Everything you can do to a post from a menu: repost, send, save, edit,
 * delete, report. It lives in one place so a post behaves the same on Home, a
 * profile, Search, a Spotlight and its own page - and so every one of them
 * tells you what happened ("Post deleted", "Reposted").
 */
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
   * LinkedIn's Send. The post goes to a person, into a thread you can both
   * answer - not to the app's share sheet, which is what "Share" is for.
   */
  async send(p: Post): Promise<void> {
    const target = p.repostOf ? (await this.data.loadPost(p.repostOf)) ?? p : p;
    const mode = await this.platform.share(target.title, `${target.title}\n\nShared from LulaFind`, this.platform.link(`/post/${target.id}`));
    await this.data.recordShare(target.id).catch(() => undefined);
    await this.toast(mode === 'clipboard' ? 'Link copied to clipboard' : 'Sent');
  }

  /** Who a post may be sent to: the members who follow you and you follow back. */
  async sendRecipients(query = ''): Promise<SendRecipient[]> {
    const me = this.auth.viewerId;
    if (!me) return [];
    const mutual = this.data.followingIds().filter((id) => this.data.followerIds().includes(id) && id !== me);
    const people = await this.data.people(mutual).catch(() => [] as UserProfile[]);
    const byId = new Map(people.map((u) => [u.id, u]));
    const needle = query.trim().toLowerCase();
    return mutual
      .map((id) => byId.get(id) ?? this.data.authorOf(id) ?? null)
      .filter((u): u is UserProfile => !!u && !u.suspended)
      .map((u) => ({
        id: u.id,
        name: u.displayName,
        headline: (u.bio || provinceNameOf(u.province)).slice(0, 70),
        avatar: this.data.avatarFor(u)
      }))
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.headline.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Send the post to the chosen people. Returns how many it reached, and tells
   * each one in their own bell - the same message the thread carries.
   */
  async sendTo(post: Post, ids: string[], note = ''): Promise<number> {
    const me = this.auth.user();
    if (!me) throw new Error('Sign in to send a post');
    const original = post.repostOf ? (await this.data.loadPost(post.repostOf)) ?? post : post;
    let sent = 0;
    for (const id of ids) {
      const ok = await this.chat.sendPost(original, id, note.trim()).catch(() => false);
      if (!ok) continue;
      sent += 1;
      await this.data.notify({
        userId: id, kind: 'chat',
        title: `${me.displayName} sent you a post`,
        body: note.trim() || original.title,
        route: `/post/${original.id}`, postId: original.id
      }).catch(() => undefined);
    }
    if (sent) await this.data.recordShare(original.id).catch(() => undefined);
    return sent;
  }

  /** Whether a post can be sent to a given member at all (used by the sheet's empty state). */
  async canSendTo(peerId: string): Promise<boolean> {
    const me = this.auth.viewerId;
    if (!me || me === peerId) return false;
    return this.data.mutualFollow(peerId);
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
      // LinkedIn's order: the two share paths first, then the private ones.
      { text: 'Send this to a connection', icon: 'send', handler: () => this.openSend(p) },
      { text: 'Share this post', icon: 'share', handler: () => void this.send(p) },
      { text: saved ? 'Unsave post' : 'Save post', icon: 'bookmark', handler: () => void this.toggleSave(p) },
      { text: 'Copy link to post', icon: 'link', handler: () => void this.copyLink(p) }
    ];
    if (mine) {
      if (!isRepost) buttons.push({ text: 'Edit post', icon: 'pencil', handler: () => void this.router.navigate(['/post', p.id, 'edit']) });
      buttons.push({
        text: isRepost ? 'Delete repost' : 'Delete post', role: 'destructive', icon: 'trash',
        handler: () => void this.confirmDelete(p, onGone)
      });
    } else {
      const author = this.data.authorOf(p.authorId);
      if (!p.anonymous && author && author.id !== this.auth.viewerId) {
        const following = await this.data.isFollowing(author.id);
        buttons.push({
          text: following ? `Unfollow ${author.displayName.split(' ')[0]}` : `Follow ${author.displayName.split(' ')[0]}`,
          icon: 'user',
          handler: () => void this.toggleFollow(author!.id)
        });
      }
      buttons.push({ text: 'Report post', role: 'destructive', icon: 'flag', handler: () => void this.report(p) });
    }
    buttons.push({ text: 'Cancel', role: 'cancel' });
    const sheet = await this.sheetCtl.create({ header: p.title.slice(0, 48), buttons: buttons as never });
    await sheet.present();
  }

  /** The post the Send sheet is open for. Rendered once by the shell (lf-send-sheet). */
  readonly sendTarget = signal<Post | null>(null);

  openSend(p: Post): void {
    if (!this.auth.signedIn()) {
      void this.needAuth();
      return;
    }
    this.sendTarget.set(p);
  }

  closeSend(): void { this.sendTarget.set(null); }

  private async toggleFollow(id: string): Promise<void> {
    try {
      const following = await this.data.toggleFollow(id);
      await this.toast(following ? 'You will see their posts in your feed' : 'Unfollowed');
    } catch (e: unknown) {
      await this.toast(e instanceof Error ? e.message : 'Could not change that follow');
    }
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
          handler: async () => {
            try {
              const gone = await this.data.deletePost(p.id);
              if (gone) {
                await this.toast(p.repostOf ? 'Repost deleted' : 'Post deleted');
                onGone?.();
              } else {
                await this.toast('The post was not deleted. Check your connection and try again.');
              }
            } catch (e: unknown) {
              await this.toast(e instanceof Error ? `Post not deleted: ${e.message}` : 'The post was not deleted. Try again.');
            }
          }
        }
      ]
    });
    await alert.present();
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
