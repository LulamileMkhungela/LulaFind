import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { IonApp } from '@ionic/angular/ion-app';
import { IonRouterOutlet } from '@ionic/angular/ion-router-outlet';
import { Router } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { PlatformService } from './core/services/platform.service';
import { PushService } from './core/services/push.service';
import { PrefetchService } from './core/services/prefetch.service';
import { BACKGROUNDS, SettingsService } from './core/services/settings.service';
import { RepostSheetComponent } from './shared/components/repost-sheet.component';
import { LogoComponent } from './shared/components/logo.component';
import { supabaseNotice } from './core/data/supabase-client';
import { demoMode, localMode } from './core/data/demo';

@Component({
  selector: 'lf-root',
  standalone: true,
  imports: [IonApp, IonRouterOutlet, RepostSheetComponent, LogoComponent],
  template: `
    <ion-app>
      @if (demoMode()) {
        <p class="lf-notice lf-notice--demo" role="status">
          Demo data - sample cases, not real people. Turn it off in the URL with ?demo=0
        </p>
      }

      @if (localMode()) {
        <p class="lf-notice lf-notice--demo" role="status">
          Local data mode - this device is the database. Nothing here is shared.
        </p>
      }

      @if (notice()) {
        <p class="lf-notice" role="alert">{{ notice() }}</p>
      }

      <!-- ── Animated splash overlay ── shown until auth is ready, then fades out -->
      @if (splashVisible()) {
        <div class="lf-splash" [class.lf-splash--out]="splashFading()" aria-hidden="true">
          <div class="lf-splash__logo">
            <lf-logo [size]="76" />
          </div>
          <p class="lf-splash__tagline">Spot me, help me and bring me home.</p>
          <div class="lf-splash__dots" role="status" aria-label="Loading">
            <span></span><span></span><span></span>
          </div>
        </div>
      }

      <ion-router-outlet></ion-router-outlet>
      <lf-repost-sheet />
    </ion-app>
  `,
  styles: [`
    .lf-splash {
      position: fixed; inset: 0; z-index: 9999;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 12px;
      background: var(--lf-card);
      transition: opacity .55s cubic-bezier(.4,0,.2,1), transform .55s cubic-bezier(.4,0,.2,1);
    }
    .lf-splash--out {
      opacity: 0;
      transform: scale(1.04);
      pointer-events: none;
    }
    .lf-splash__logo {
      animation: splash-pop .7s cubic-bezier(.2,.8,.2,1) both;
    }
    .lf-splash__logo lf-logo { display: flex; width: 76px; height: 76px; }
    .lf-splash__tagline {
      margin: 0;
      font-size: 15px;
      font-weight: 500;
      color: var(--lf-muted);
      letter-spacing: .4px;
      animation: splash-up .6s .2s cubic-bezier(.2,.8,.2,1) both;
    }
    .lf-splash__dots {
      display: flex; gap: 7px; margin-top: 28px;
      animation: splash-up .6s .3s cubic-bezier(.2,.8,.2,1) both;
    }
    .lf-splash__dots span {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--lf-primary);
      animation: splash-dot 1.2s ease-in-out infinite;
    }
    .lf-splash__dots span:nth-child(2) { animation-delay: .2s; }
    .lf-splash__dots span:nth-child(3) { animation-delay: .4s; }
    @keyframes splash-pop {
      from { transform: scale(.5); opacity: 0; }
      to   { transform: scale(1); opacity: 1; }
    }
    @keyframes splash-up {
      from { transform: translateY(14px); opacity: 0; }
      to   { transform: none; opacity: 1; }
    }
    @keyframes splash-dot {
      0%, 80%, 100% { transform: scale(.6); opacity: .4; }
      40%           { transform: scale(1); opacity: 1; }
    }
    .lf-notice { margin: 0; padding: 10px 14px; padding-top: max(10px, var(--lf-safe-top));
      background: var(--lf-signal); color: #fff; font: 600 13px/1.35 var(--ion-font-family); }
    /* Informational, not an alarm: a card surface reads better than a blue bar. */
    .lf-notice--demo { background: var(--lf-card-2); color: var(--ion-text-color); }
    @media (prefers-reduced-motion: reduce) {
      .lf-splash, .lf-splash__logo,
      .lf-splash__tagline, .lf-splash__dots,
      .lf-splash__dots span { animation: none; transition: none; }
    }
  `]
})
export class AppComponent implements OnInit {
  private auth = inject(AuthService);
  private platform = inject(PlatformService);
  private push = inject(PushService);
  private router = inject(Router);
  private prefetch = inject(PrefetchService);
  private settings = inject(SettingsService);
  readonly notice = supabaseNotice;
  readonly demoMode = demoMode;
  readonly localMode = localMode;

  /** Splash overlay state — visible until auth.ready(), then fades for .55s and removes. */
  readonly splashVisible = signal(true);
  readonly splashFading = signal(false);

  constructor() {
    this.prefetch.start(0);

    // Once auth is restored, fade the splash out.
    //
    // The splash is what covers the first moment of a cold start, when nobody
    // knows yet whether there is a session. Nothing navigates from here: the
    // route guard on the app shell waits for the same signal and makes the
    // decision before the first page paints, so a visitor who is not signed in
    // goes to the login screen without Home ever appearing behind it.
    effect(() => {
      if (!this.auth.ready()) return;
      this.splashFading.set(true);
      // Remove from DOM after the CSS transition finishes (580ms).
      setTimeout(() => this.splashVisible.set(false), 580);
    });

    // Signed in but not onboarded -> straight into the Snapchat-style walkthrough.
    effect(() => {
      const u = this.auth.user();
      if (this.auth.passwordRecovery()) {
        if (!this.router.url.startsWith('/auth')) void this.router.navigate(['/auth']);
        return;
      }
      if (u && !u.onboarded && this.auth.ready()) void this.router.navigate(['/onboarding']);
    });

    effect(() => {
      this.settings.settings();
      if (this.platform.isNative) void this.syncStatusBar();
    });
  }

  private isLight(): boolean {
    const mode = this.settings.settings().theme;
    return mode === 'light' || (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches);
  }

  /** The colour behind the status bar follows the chosen background. */
  private barColor(): string {
    if (this.isLight()) return '#FFFFFF';
    const key = this.settings.settings().background;
    return BACKGROUNDS.find((b) => b.key === key)?.card ?? '#000000';
  }

  private async syncStatusBar(): Promise<void> {
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: this.isLight() ? Style.Light : Style.Dark });
      await StatusBar.setBackgroundColor({ color: this.barColor() }).catch(() => undefined);
    } catch {
      /* plugin unavailable in this build target */
    }
  }

  async ngOnInit(): Promise<void> {
    this.platform.watchKeyboard();
    this.listenForPress();
    await this.configureNative();
  }

  /** A light tap on every button, so the app answers the finger. */
  private listenForPress(): void {
    document.addEventListener('pointerdown', (ev) => {
      const el = ev.target as HTMLElement | null;
      if (!this.settings.settings().haptics) return;
      if (!el?.closest('button, ion-tab-button, a, .lf-action, .chip, .quickbtn')) return;
      void this.platform.haptic('light');
    }, { passive: true });
  }

  private async configureNative(): Promise<void> {
    if (!this.platform.isNative) return;
    // Already-permitted devices register for pushes now; first-time asks
    // happen in Settings -> Phone permissions (PushService.requestAndRegister).
    void this.push.init();
    try {
      const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([
        import('@capacitor/status-bar'),
        import('@capacitor/splash-screen')
      ]);
      const light = this.isLight();
      await StatusBar.setOverlaysWebView({ overlay: true });
      await StatusBar.setStyle({ style: light ? Style.Light : Style.Dark });
      await StatusBar.setBackgroundColor({ color: this.barColor() }).catch(() => undefined);
      // The native splash screen is hidden after the in-app splash begins fading.
      await SplashScreen.hide({ fadeOutDuration: 300 });
    } catch {
      /* plugins unavailable in this build target */
    }
  }
}
