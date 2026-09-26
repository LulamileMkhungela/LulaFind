import { Component, OnInit, effect, inject } from '@angular/core';
import { IonApp } from '@ionic/angular/ion-app';
import { IonRouterOutlet } from '@ionic/angular/ion-router-outlet';
import { Router } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { PlatformService } from './core/services/platform.service';
import { PrefetchService } from './core/services/prefetch.service';
import { SettingsService } from './core/services/settings.service';
import { supabaseNotice } from './core/data/supabase-client';

@Component({
  selector: 'lf-root',
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
  template: `
    <ion-app>
      @if (notice()) {
        <p style="margin:0;padding:10px 14px;background:#7a2e24;color:#fff;font:600 13px/1.35 system-ui">{{ notice() }}</p>
      }
      <ion-router-outlet></ion-router-outlet>
    </ion-app>
  `
})
export class AppComponent implements OnInit {
  private auth = inject(AuthService);
  private platform = inject(PlatformService);
  private router = inject(Router);
  private prefetch = inject(PrefetchService);
  private settings = inject(SettingsService);
  readonly notice = supabaseNotice;

  constructor() {
    this.prefetch.start(0);
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

  private async syncStatusBar(): Promise<void> {
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: this.isLight() ? Style.Light : Style.Dark });
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
    try {
      const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([
        import('@capacitor/status-bar'),
        import('@capacitor/splash-screen')
      ]);
      const light = this.isLight();
      await StatusBar.setOverlaysWebView({ overlay: true });
      await StatusBar.setStyle({ style: light ? Style.Light : Style.Dark });
      await SplashScreen.hide();
    } catch {
      /* plugins unavailable in this build target */
    }
  }
}
