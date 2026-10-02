import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    // The app itself needs an account: Home, Spotlight, Chats, Discover and the
    // menu all live under this shell, so a visitor who is not signed in lands on
    // the auth screen instead of a page that will be taken away from them.
    // Shared links to a case or a Spotlight stay readable - see below.
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/tabs/tabs.component').then((m) => m.TabsComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', loadComponent: () => import('./pages/tabs/home.component').then((m) => m.HomeComponent) },
      { path: 'spotlight', loadComponent: () => import('./pages/tabs/spotlight.component').then((m) => m.SpotlightComponent) },
      {
        path: 'chats',
        children: [
          { path: '', pathMatch: 'full', loadComponent: () => import('./pages/tabs/chats.component').then((m) => m.ChatsComponent) },
          { path: 'thread/:threadId', canActivate: [authGuard], loadComponent: () => import('./pages/chat/chat-room.component').then((m) => m.ChatRoomComponent) }
        ]
      },
      { path: 'create', redirectTo: '/new', pathMatch: 'full' },
      { path: 'discover', loadComponent: () => import('./pages/tabs/discover.component').then((m) => m.DiscoverComponent) },
      { path: 'me', loadComponent: () => import('./pages/tabs/me.component').then((m) => m.MeComponent) }
    ]
  },
  // Notifications is the bell in the top navigation. Chats is a bottom tab (above).
  { path: 'notifications', canActivate: [authGuard], loadComponent: () => import('./pages/notifications/notifications.component').then((m) => m.NotificationsComponent) },
  { path: 'auth', loadComponent: () => import('./pages/auth/auth.component').then((m) => m.AuthComponent) },
  { path: 'auth/confirm', loadComponent: () => import('./pages/auth/auth.component').then((m) => m.AuthComponent) },
  {
    path: 'new',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/post/create-post.component').then((m) => m.CreatePostComponent)
  },
  {
    path: 'onboarding',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/onboarding/onboarding.component').then((m) => m.OnboardingComponent)
  },
  { path: 'chat/:threadId', pathMatch: 'full', redirectTo: '/chats/thread/:threadId' },
  { path: 'repost/:id', canActivate: [authGuard], loadComponent: () => import('./pages/post/repost.component').then((m) => m.RepostComponent) },
  { path: 'post/:id/poster', loadComponent: () => import('./pages/post/poster.component').then((m) => m.PosterComponent) },
  { path: 'post/:id', loadComponent: () => import('./pages/post/post-detail.component').then((m) => m.PostDetailComponent) },
  {
    path: 'post/:id/edit',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/post/create-post.component').then((m) => m.CreatePostComponent)
  },
  { path: 'user/:id', loadComponent: () => import('./pages/user/profile.component').then((m) => m.ProfileComponent) },
  { path: 'spotlight/:id', loadComponent: () => import('./pages/spotlight/spotlight-detail.component').then((m) => m.SpotlightDetailComponent) },
  { path: 'story/:id', loadComponent: () => import('./pages/story/story-viewer.component').then((m) => m.StoryViewerComponent) },
  { path: 'saved', canActivate: [authGuard], loadComponent: () => import('./pages/saved/saved.component').then((m) => m.SavedComponent) },
  { path: 'connections', canActivate: [authGuard], loadComponent: () => import('./pages/connections/connections.component').then((m) => m.ConnectionsComponent) },
  { path: 'search', loadComponent: () => import('./pages/search/search.component').then((m) => m.SearchComponent) },
  { path: 'tips', loadComponent: () => import('./pages/tips/tips.component').then((m) => m.TipsComponent) },
  { path: 'help', loadComponent: () => import('./pages/help/help.component').then((m) => m.HelpComponent) },
  { path: 'faqs', loadComponent: () => import('./pages/help/faqs.component').then((m) => m.FaqsComponent) },
  { path: 'found', loadComponent: () => import('./pages/found/found.component').then((m) => m.FoundComponent) },
  {
    path: 'create/:type',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/post/create-post.component').then((m) => m.CreatePostComponent)
  },
  {
    path: 'create-story',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/story/create-story.component').then((m) => m.CreateStoryComponent)
  },
  { path: 'safety', loadComponent: () => import('./pages/safety/safety-center.component').then((m) => m.SafetyCenterComponent) },
  {
    path: 'lookout/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/safety/lookout.component').then((m) => m.LookoutComponent)
  },
  {
    path: 'escalate/:postId',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/safety/escalate.component').then((m) => m.EscalateComponent)
  },
  {
    path: 'location-check/:postId',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/safety/location-check.component').then((m) => m.LocationCheckComponent)
  },
  { path: 'settings', loadComponent: () => import('./pages/settings/settings.component').then((m) => m.SettingsComponent) },
  {
    /* Sign-in is required; admins alone get the tools. A signed-in member who
       is not an admin lands on the screen and reads why, instead of being
       bounced home with no explanation - the component loads nothing for them. */
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent)
  },
  { path: 'terms', loadComponent: () => import('./pages/terms/terms.component').then((m) => m.TermsComponent) },
  { path: '**', redirectTo: '' }
];
