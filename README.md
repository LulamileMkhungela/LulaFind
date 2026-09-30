# LulaFind

LulaFind is a community search network: missing-person posters, sightings,
danger alerts, surname (Spotlight) communities, 24-hour stories and private
chat - as one installable app. The app itself lives in `lulafind/` (Angular +
Ionic, Capacitor for Android/iOS).

## Prerequisites

- **Node.js 22 LTS or newer** (`node -v`) and npm
- For Android: **Android Studio** with a JDK 17+ and an emulator or device
- For iOS (macOS only): **Xcode** + **CocoaPods** (`sudo gem install cocoapods`)

## Run in VS Code (web)

```bash
cd lulafind
npm install
npm start
```

Then open http://localhost:4200. `npm start` is `ng serve` with live reload.

Other useful commands (all run from `lulafind/`):

| Command               | What it does                                    |
| --------------------- | ----------------------------------------------- |
| `npm test`            | Unit + render tests, single run                 |
| `npm run build:dev`   | Development build into `lulafind/www/`          |
| `npm run build`       | Production build into `lulafind/www/`           |
| `npm run preview`     | Serves `lulafind/www/` on :4200 (no live reload)|
| `npm run lint`        | ESLint over `src/`                              |

## Run in Android Studio

```bash
cd lulafind
npm install
npm run build        # web assets -> lulafind/www/
npx cap sync         # copies www/ + plugins into android/
npx cap open android # opens Android Studio
```

Then press **Run** (emulator or USB device). The Firebase config
(`android/app/google-services.json`) is already in the repo.

After changing web code, repeat `npm run build && npx cap sync` (or
`npm run cap:sync`), then re-run from Android Studio.

> **Good to know:** since the `capSync` Gradle task landed, pressing **Run**
> in Android Studio also syncs for you — a build never packages stale web
> assets or drops the Capacitor plugin registry (the cause of "old UI on the
> phone" and "… plugin is not implemented on android"). Details, the Google
> sign-in (SHA-1) checklist and the full permission matrix live in
> [docs/ANDROID.md](docs/ANDROID.md).

## Run in Xcode (macOS)

```bash
cd lulafind
npm install
npm run build        # web assets -> lulafind/www/
npx cap sync         # copies www/ + plugins into ios/
cd ios/App && pod install && cd ../..   # first time only
npx cap open ios     # opens Xcode
```

Select a simulator or your device and press **Run**. After changing web code,
repeat `npm run build && npx cap sync`, then re-run from Xcode.

## Layout

```
lulafind/
  src/app/
    pages/        # screens: tabs (home, spotlight, chats, me), post, story,
                  # search, auth, admin, safety, settings, ...
    shared/components/  # feed card, top nav, poster, rails, sheets, ...
    core/
      services/   # data, auth, chat, media, safety, ... (mock API today)
      models/     # Post, Comment, UserProfile, Story, ...
      data/       # seed data, generated art helpers (covers, story bgs)
      utils/      # poster text parser, formatting, ...
  android/        # committed Capacitor Android shell (open in Android Studio)
  ios/            # committed Capacitor iOS shell (open in Xcode)
  www/            # build output - generated, never commit
```

`server.mjs` is a tiny static server for previews; `capacitor.config.ts`
holds the app id (`com.lulafind.app`) and native settings.
