import { Injectable, inject } from '@angular/core';
import { LULA_API } from '../data/api';
import { AuthService } from './auth.service';
import {
  POST_TYPE_META, Post, Spotlight, UserProfile, provinceName
} from '../models/types';
import { timeAgo } from '../utils/format';

/** One answer from Lula, the floating assistant. */
export interface AssistantAnswer {
  /** Plain-language summary of what was found. */
  text: string;
  users: UserProfile[];
  posts: Post[];
  spotlights: Spotlight[];
  /** Follow-up chips shown under the answer. */
  suggestions: string[];
}

const HELP_TOPICS: { keys: string[]; text: string }[] = [
  {
    keys: ['how do i post', 'how to post', 'create a post', 'create post', 'new post', 'report missing', 'report a'],
    text: 'To post: tap the blue + Create button at the bottom, then Create post. Pick what it is (missing person, left home, sighting, vehicle, pet, story or danger), add a clear title, what happened, photos, and the town. Cases with a photo and a last-seen place get far more help.'
  },
  {
    keys: ['story', 'stories'],
    text: 'Stories last 24 hours. Tap + Create, then Create story, add up to 3 photos and some words. You can share to everyone, your followers, or one Spotlight community. Replies to your story are private — only you see them.'
  },
  {
    keys: ['found', 'mark as found', 'close', 'home safe'],
    text: 'When someone is home: open their case, tap “Mark as found”, say where they were found, and name the LulaFind member who found them so they earn a contributor badge. Found cases move to the Found filter.'
  },
  {
    keys: ['chat', 'message', 'talk to', 'contact the poster'],
    text: 'Private chat opens in 3 steps: 1) tap Idea (“I have an idea”) on the post, 2) follow each other, 3) chat opens. This keeps families safe from strangers.'
  },
  {
    keys: ['follow'],
    text: 'Tap Follow on any post or profile. If they approve requests first, yours waits until they accept. Private chat opens once you follow each other.'
  },
  {
    keys: ['safety', 'safe', 'emergency', 'police', 'saps', 'danger'],
    text: 'In an emergency call 10111, or Childline on 116 for a child. LulaFind is a community tool and never replaces SAPS. On a danger alert, do not approach — tap “Still happening” or “It’s clear” so people nearby know.'
  },
  {
    keys: ['report', 'scam', 'false', 'spam', 'abuse'],
    text: 'To report a post: open it, tap •••, then Report, and pick a reason. An admin reviews every report. Reporting is private — the poster is never told who reported.'
  },
  {
    keys: ['spotlight'],
    text: 'A Spotlight is a surname community (for example the Dlamini families). Open Spotlight, search the surname, join, and posts about that surname gather there automatically.'
  },
  {
    keys: ['save', 'saved'],
    text: 'Tap ••• on any post, then Save post. Saved posts live in Menu → Saved, and you get told when they get new Ideas or are marked found.'
  },
  {
    keys: ['search party', 'ground search', 'volunteer', 'looking'],
    text: 'The poster can start a ground search from the case page: a meeting point plus areas to cover. Volunteers claim one area each. You can also tap “I’m looking” so the family knows someone is near the last-seen place.'
  },
  {
    keys: ['who are you', 'your name', 'what can you do', 'help', 'hello', 'hi', 'hey'],
    text: 'I’m Lula, your LulaFind helper. Type a person’s name, a surname, a town, or a case number and I’ll pull every matching post and profile. Try “missing in Soweto”, a surname, or “how do I post?”.'
  }
];

/**
 * Lula — the floating assistant.
 *
 * Runs fully on-device against the same data layer as the feed: no network
 * call, no API key, works offline. It searches people, posts and Spotlight
 * communities for whatever was typed and explains what it found.
 */
@Injectable({ providedIn: 'root' })
export class AssistantService {
  private api = inject(LULA_API);
  private auth = inject(AuthService);

  async ask(raw: string): Promise<AssistantAnswer> {
    const q = raw.trim().replace(/\s+/g, ' ');
    if (!q) return this.greeting();
    const needle = q.toLowerCase();

    const help = HELP_TOPICS.find((h) => h.keys.some((k) => needle.includes(k)));
    if (help && needle.length < 60) {
      // Still attach matching posts so a “found” question also shows found cases.
      const posts = await this.matchPosts(q);
      return {
        text: help.text,
        users: [],
        posts: posts.slice(0, 3),
        spotlights: [],
        suggestions: ['Show missing people', 'Show found cases', 'How do I post a story?']
      };
    }

    const [users, posts, spotlights] = await Promise.all([
      this.matchUsers(q),
      this.matchPosts(q),
      this.matchSpotlights(q)
    ]);

    if (!users.length && !posts.length && !spotlights.length) {
      return {
        text: `I couldn’t find anything for “${q}”. Try a surname only (for example “Dlamini”), the town (“Soweto”), a case number, or one word from the title. If it’s a new case, tap + Create to post it.`,
        users: [],
        posts: [],
        spotlights: [],
        suggestions: ['Show missing people', 'How do I post?', 'Get help numbers']
      };
    }

    const bits: string[] = [];
    if (posts.length) bits.push(`${posts.length} post${posts.length === 1 ? '' : 's'}`);
    if (users.length) bits.push(`${users.length} ${users.length === 1 ? 'person' : 'people'}`);
    if (spotlights.length) bits.push(`${spotlights.length} Spotlight${spotlights.length === 1 ? '' : 's'}`);
    let text = `I found ${bits.join(', ')} for “${q}”.`;

    const top = posts[0];
    if (top) {
      const subject = top.subject?.name?.trim() || top.title;
      const status = top.status === 'found'
        ? `FOUND — ${top.outcome?.whereaboutsFound || 'safe'}.`
        : top.status === 'not_going_home'
          ? 'They answered: safe but not coming home.'
          : `Still ${top.type === 'danger' ? 'happening' : 'open'} — last seen ${top.lastSeenWhere || top.town || provinceName(top.province)}${top.upvotes ? `, ${top.upvotes} ${top.upvotes === 1 ? 'person has' : 'people have'} an idea` : ''}.`;
      const type = POST_TYPE_META[top.type]?.label ?? 'Post';
      text += ` Top match: ${type} “${subject}” (${timeAgo(top.updatedAt)}). ${status}`;
      if (top.status === 'active' && top.type !== 'story') {
        text += ' Open it to read the leads, comment, or unlock private chat with the poster.';
      }
    } else if (users.length) {
      const u = users[0];
      text += ` Top match: ${u.displayName} (@${u.handle}). Open their profile to see their posts and follow them.`;
    } else if (spotlights.length) {
      text += ` Top match: the ${spotlights[0].surname} Spotlight community. Join it to see every case filed there.`;
    }

    return {
      text,
      users: users.slice(0, 4),
      posts: posts.slice(0, 5),
      spotlights: spotlights.slice(0, 3),
      suggestions: this.followUps(q, posts)
    };
  }

  greeting(): AssistantAnswer {
    return {
      text: 'Hi, I’m Lula. Type a name, surname, town or case number and I’ll pull every matching post and profile — or ask me how anything on LulaFind works.',
      users: [],
      posts: [],
      spotlights: [],
      suggestions: ['Missing people', 'How do I post?', 'Show found cases', 'Get help numbers']
    };
  }

  private followUps(q: string, posts: Post[]): string[] {
    const out: string[] = [];
    const first = posts[0];
    if (first?.subject?.surname) out.push(first.subject.surname);
    if (first?.town) out.push(first.town);
    if (/missing/i.test(q)) out.push('Show found cases');
    else out.push('Show missing people');
    out.push('How do I post?');
    return [...new Set(out)].slice(0, 3);
  }

  private words(q: string): string[] {
    return q.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  }

  private async matchUsers(q: string): Promise<UserProfile[]> {
    const all = await this.api.users().catch(() => [] as UserProfile[]);
    const me = this.auth.viewerId;
    const needle = q.toLowerCase();
    const words = this.words(q);
    const scored: { u: UserProfile; score: number }[] = [];
    for (const u of all) {
      if (u.suspended) continue;
      const hay = `${u.displayName} ${u.handle} ${u.surname} ${u.town}`.toLowerCase();
      let score = 0;
      if (u.displayName.toLowerCase() === needle) score += 100;
      if (u.handle.toLowerCase() === needle.replace(/^@/, '')) score += 90;
      if (u.surname.toLowerCase() === needle) score += 70;
      for (const w of words) {
        if (u.displayName.toLowerCase().includes(w)) score += 12;
        if (u.handle.toLowerCase().includes(w)) score += 8;
        if (u.surname.toLowerCase().includes(w)) score += 10;
        if (hay.includes(w)) score += 2;
      }
      if (u.id === me) score -= 5;
      if (score > 0) scored.push({ u, score });
    }
    return scored.sort((a, b) => b.score - a.score).map((s) => s.u);
  }

  private async matchPosts(q: string): Promise<Post[]> {
    const needle = q.toLowerCase();
    const words = this.words(q);
    // “show missing people” / “show found cases” are shortcuts, not keyword searches.
    if (/show\s+(all\s+)?missing/.test(needle) || needle === 'missing people' || needle === 'missing') {
      const all = await this.api.posts().catch(() => [] as Post[]);
      return all.filter((p) => p.type === 'missing' && p.status === 'active')
        .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
    }
    if (/show\s+found|found cases/.test(needle)) {
      const all = await this.api.posts().catch(() => [] as Post[]);
      return all.filter((p) => p.status === 'found')
        .sort((a, b) => (b.outcome?.foundAt ?? b.updatedAt) - (a.outcome?.foundAt ?? a.updatedAt)).slice(0, 12);
    }
    if (/get help|help numbers|emergency numbers/.test(needle)) return [];
    const all = await this.api.posts().catch(() => [] as Post[]);
    const me = this.auth.viewerId;
    const scored: { p: Post; score: number }[] = [];
    for (const p of all) {
      if (p.status === 'removed') continue;
      const subject = `${p.subject?.name ?? ''} ${p.subject?.surname ?? ''}`.toLowerCase();
      const hay = `${p.title} ${p.body} ${p.town} ${provinceName(p.province)} ${p.caseNumber ?? ''} ${subject}`.toLowerCase();
      let score = 0;
      if (subject && needle.length >= 3 && subject.includes(needle)) score += 80;
      if (p.caseNumber && needle.replace(/\s+/g, '').length >= 3 &&
        p.caseNumber.toLowerCase().replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''))) score += 80;
      for (const w of words) {
        if (subject.includes(w)) score += 25;
        if (p.title.toLowerCase().includes(w)) score += 10;
        if (p.town.toLowerCase() === w) score += 18;
        else if (p.town.toLowerCase().includes(w)) score += 6;
        if ((p.caseNumber ?? '').toLowerCase().includes(w)) score += 20;
        if (hay.includes(w)) score += 2;
      }
      if (p.authorId === me) score += 1;
      if (p.status === 'active') score += 1;
      if (score > 0) scored.push({ p, score });
    }
    return scored.sort((a, b) => b.score - a.score || b.p.updatedAt - a.p.updatedAt).map((s) => s.p);
  }

  private async matchSpotlights(q: string): Promise<Spotlight[]> {
    const all = await this.api.spotlights().catch(() => [] as Spotlight[]);
    const needle = q.toLowerCase();
    const words = this.words(q);
    return all
      .filter((s) => {
        const hay = `${s.surname} ${s.tagline}`.toLowerCase();
        return hay.includes(needle) || words.some((w) => w.length >= 3 && hay.includes(w));
      })
      .sort((a, b) => {
        const ae = a.surname.toLowerCase() === needle ? 0 : 1;
        const be = b.surname.toLowerCase() === needle ? 0 : 1;
        return ae - be || b.followers - a.followers;
      });
  }
}
