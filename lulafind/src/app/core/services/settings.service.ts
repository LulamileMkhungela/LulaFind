import { Injectable, signal } from '@angular/core';
import { KvStore } from '../data/local-db';

export type ThemeMode = 'dark' | 'light' | 'system';

/** Background colours offered in Settings -> Appearance. Black is the default. */
export type BackgroundKey = 'black' | 'charcoal' | 'navy' | 'forest' | 'plum' | 'wine';

export interface BackgroundPalette {
  key: BackgroundKey;
  label: string;
  /** page, surface, raised surface / input, divider */
  bg: string;
  card: string;
  card2: string;
  line: string;
}

export const BACKGROUNDS: BackgroundPalette[] = [
  { key: 'black', label: 'Black', bg: '#000000', card: '#0f0f10', card2: '#262728', line: '#2b2c2e' },
  { key: 'charcoal', label: 'Charcoal', bg: '#18191a', card: '#242526', card2: '#3a3b3c', line: '#3e4042' },
  { key: 'navy', label: 'Midnight blue', bg: '#060d1b', card: '#0e1a30', card2: '#1b2b4a', line: '#22355a' },
  { key: 'forest', label: 'Forest', bg: '#04120b', card: '#0b1f14', card2: '#163224', line: '#1f4030' },
  { key: 'plum', label: 'Plum', bg: '#12061a', card: '#1d0c2a', card2: '#301846', line: '#3d2258' },
  { key: 'wine', label: 'Wine', bg: '#1a0508', card: '#290b10', card2: '#431820', line: '#55222b' }
];

export interface Settings {
  theme: ThemeMode;
  /** Colour behind the app when the theme is dark. */
  background: BackgroundKey;
  haptics: boolean;
  pushEnabled: boolean;
  pushMissingOnly: boolean;
  pushProvince: string | 'all';
  pushRadiusKm: number;
  showAnonymousAs: string;
  reduceMotion: boolean;
  /** Legacy stored value; Story viewing is now manual regardless of this flag. */
  autoplayMedia: boolean;
  dataSaving: boolean;
}

const DEFAULTS: Settings = {
  // Follow the device appearance until the person explicitly chooses Light or Dark.
  theme: 'system',
  background: 'black',
  haptics: true,
  pushEnabled: true,
  pushMissingOnly: true,
  pushProvince: 'all',
  pushRadiusKm: 50,
  showAnonymousAs: 'Anonymous',
  reduceMotion: false,
  autoplayMedia: false,
  dataSaving: false
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private store = new KvStore('lulafind.settings');
  private systemMedia?: MediaQueryList;
  readonly settings = signal<Settings>(this.load());

  /**
   * Black is the default. Settings saved before backgrounds existed have no
   * `background` key; those were on the old light default, so they move to the
   * new black default once. Anyone who then picks a theme keeps their choice.
   */
  private load(): Settings {
    const saved = this.store.get<Partial<Settings>>('current', {});
    if (saved.background === undefined) {
      const migrated = { ...DEFAULTS, ...saved, theme: (saved.theme ?? DEFAULTS.theme) as ThemeMode, background: 'black' as BackgroundKey };
      this.store.set('current', migrated);
      return migrated;
    }
    return { ...DEFAULTS, ...saved };
  }

  update(patch: Partial<Settings>): void {
    const next = { ...this.settings(), ...patch };
    this.settings.set(next);
    this.store.set('current', next);
    this.applyTheme(next.theme, next.background);
  }

  applyTheme(mode: ThemeMode, background: BackgroundKey = this.settings().background): void {
    const root = document.documentElement;
    const dark = mode === 'dark' || (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    root.classList.toggle('lf-dark', !!dark);
    root.classList.toggle('lf-light', !dark);
    const palette = BACKGROUNDS.find((b) => b.key === background) ?? BACKGROUNDS[0];
    const vars: Record<string, string> = dark ? {
      '--lf-bg': palette.bg, '--ion-background-color': palette.bg,
      '--lf-card': palette.card, '--lf-toolbar': palette.card, '--lf-tabbar': palette.card,
      '--lf-card-2': palette.card2, '--lf-hover': palette.card2, '--lf-input': palette.card2,
      '--lf-line': palette.line, '--lf-line-soft': palette.line
    } : {};
    for (const name of ['--lf-bg', '--ion-background-color', '--lf-card', '--lf-toolbar', '--lf-tabbar', '--lf-card-2', '--lf-hover', '--lf-input', '--lf-line', '--lf-line-soft']) {
      if (vars[name]) root.style.setProperty(name, vars[name]);
      else root.style.removeProperty(name);
    }
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.removeAttribute('media');
      m.setAttribute('content', dark ? palette.card : '#ffffff');
    });
    document.body?.style.setProperty('background', dark ? palette.bg : '#f0f2f5');
    root.style.setProperty('background', dark ? palette.bg : '#f0f2f5');
  }

  init(): void {
    this.applyTheme(this.settings().theme, this.settings().background);
    // `system` is a live preference, not a one-time copy of the current mode.
    // This also covers a device switching appearance while LulaFind is open.
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.systemMedia = window.matchMedia('(prefers-color-scheme: dark)');
      const refresh = () => {
        if (this.settings().theme === 'system') this.applyTheme('system', this.settings().background);
      };
      this.systemMedia.addEventListener?.('change', refresh);
      // Safari versions without addEventListener still expose addListener.
      this.systemMedia.addListener?.(refresh);
    }
  }
}
