# Run LulaFind

Checked on 26 September 2026. This is the run guide. `docs/SETUP.md` is the live-backend check. If those two files disagree with `README.md`, follow these two files.

## Do this now

1. Leave **Enable email provider** on in Supabase. Do not turn it off.
2. **Confirm email** is off. Leave it off. If Save is still showing on that page, click it. Leave the other email switches off.
3. Do not run `supabase/editor.sql` again. It already succeeded.
4. On this computer, with Node 22:

```bash
cd lulafind
node -v
npm install
npm start
```

5. Open http://localhost:4200 and create an account with email. Firebase sends the verification link. Supabase does not.

This is not an end-to-end pass. The production web build compiles. A signed-in write, an inbox, and a phone launch were not watched from here, so this was not merged as finished.

A phone build is later, in sections 3 and 4. Those steps were not run here.

This environment did not launch Android Studio, an Android emulator, Xcode, or an iPhone simulator. The steps below are the exact project files and commands. A production web build did succeed here with Node 22.22.3. That is not a phone test.

## What you need

| Tool | Version this project expects | Where |
| --- | --- | --- |
| Node.js | 22.22.3 or newer. Node 20 will refuse `ng`. | https://nodejs.org |
| npm | Comes with Node 22 | terminal |
| VS Code | Current | the `lulafind` folder, not a parent folder |
| Android Studio | Current, with JDK 21 and Android SDK 36 | Windows, Mac, or Linux |
| Xcode | Current, Mac only | `ios/App/App.xcodeproj` |

Check Node before anything else:

```bash
node -v
```

If that prints v20 or lower, install Node 22 and open a new terminal. `package.json` requires `>=22.14.0`. Angular 22 refuses to start below `22.22.3`.

## 1. VS Code, browser

1. Open the `lulafind` folder in VS Code. File → Open Folder.
2. Open a terminal in that folder. The prompt should end in `lulafind`.
3. Install and start:

```bash
npm install
npm start
```

4. Wait until the terminal says the server is listening.
5. Open http://localhost:4200

`npm start` is `ng serve --host 0.0.0.0 --port 4200 --disable-host-check`. Leave that terminal open. Stop it with Ctrl+C.

There is no demo account and no sample missing person. Sign-up is email and password, or Google. There is no phone field and no Apple button.

What the browser can prove:

- The screens open.
- A production build of this source completed into `www/`.
- It cannot prove an email arrived, a phone permission prompt, or a Play/App Store install.

If `npm start` says the Angular CLI wants Node 22, you are still on the old Node. Fix that before you open Android Studio. A failed web build will put an old `www/` folder into the phone app.

## 2. One-time backend switches

The app will open without these. Saving a new account, a post, a follow, or a Spotlight will not fully work until they are done. Details and the live check are in `docs/SETUP.md`.

1. Supabase → Authentication → Providers → Email. **Enable email provider** stays on. **Confirm email** is off. Leave it off. If Save is still showing, click it. Leave secure email change, secure password change, and require current password off. Phone stays off. Google stays on. **Allow new users to sign up** stays on.
2. `supabase/editor.sql` already succeeded in the SQL editor. Do not run it again. Do not run `wire-fix.sql` or `fix-rls.sql`.
3. Supabase → Authentication → URL configuration → Redirect URLs. Add every line below:

```text
http://localhost:4200/auth
http://localhost:4200/**
https://localhost/auth
https://localhost/**
capacitor://localhost/auth
https://lulafind.co.za/auth
```

Google sign-in returns to the address the app was opened from. Without that address in the list, Google comes back as an error.

## 3. Android Studio

You need Android Studio with JDK 21 and Android SDK 36. The repo already targets SDK 36 in `android/variables.gradle`. The application id is `com.lulafind.app`. A debug run does not need a release keystore.

From the `lulafind` folder, in a terminal that has Node 22:

```bash
node -v
npm install
npm run build
npm run setup:native
npx cap sync android
```

`npm run build` must finish with no errors before `cap sync`. Sync copies `www/` into the Android project. If you skip the build, the phone runs an old copy.

Then:

1. Android Studio → File → Open.
2. Choose the `android` folder inside `lulafind`. Do not open the repo root.
3. Wait for Gradle sync. If it offers to install SDK 36, accept it.
4. If it asks for a JDK, use Android Studio's embedded JDK 21. File → Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK.
5. Create a phone emulator: Device Manager → Create Device → a current Pixel → a system image that includes API 36. Download it if it is missing.
6. Select that emulator in the device dropdown.
7. Press Run.

The first Gradle sync can take several minutes. It downloads Android libraries. You need an internet connection.

If Gradle says the SDK is missing, open SDK Manager and install:

- Android SDK Platform 36
- Android SDK Build-Tools
- Android SDK Platform-Tools

`google-services.json` is already in `android/app/`. The package name in that file is `com.lulafind.app`. Do not rename the application id.

Permissions already declared: internet, location, camera, photos, and notifications. The first time you attach a place, take a photo, or turn alerts on, the phone will ask. Denying a permission does not crash the app. That feature stays off until you allow it in the phone's Settings → Apps → LulaFind.

To run on a real Android phone: enable Developer options and USB debugging, plug it in, accept the computer prompt, pick the phone in the device dropdown, and press Run.

This guide was not executed in Android Studio here. There is no Android SDK in the environment that prepared this file.

## 4. Xcode

Xcode only runs on a Mac. The project is already in the repo. Capacitor 8 uses Swift Package Manager. Do not look for an `.xcworkspace` and do not run `pod install`.

On the Mac, from the `lulafind` folder, with Node 22:

```bash
node -v
npm install
npm run build
npm run setup:native
npx cap sync ios
```

Then:

1. Open `ios/App/App.xcodeproj`. Double-click that file, or in Xcode choose File → Open and select it.
2. Wait until the Swift packages finish resolving. The first open downloads Capacitor. If it stalls, File → Packages → Resolve Package Versions.
3. In the project navigator, select the **App** target.
4. Signing & Capabilities → Team. A simulator does not need a paid Apple Developer account. A real iPhone does need a free or paid team, and the phone must trust the developer certificate.
5. Bundle identifier must stay `com.lulafind.app`.
6. Pick an iPhone simulator from the scheme menu, for example iPhone 16.
7. Press Run.

`ios/App/App/Info.plist` already explains why the app asks for location, camera, and photos. `PrivacyInfo.xcprivacy` is already in the app target. `npm run setup:native` copies it again if it is missing. It says the app does not track you.

If the simulator is not in the list, Xcode → Settings → Platforms, and download an iOS simulator runtime.

To run on a real iPhone: connect it, select it as the run destination, set a Team, and on the phone open Settings → General → VPN & Device Management and trust the certificate if iOS asks.

This guide was not executed in Xcode here. There is no Mac and no `xcodebuild` in the environment that prepared this file.

## 5. After you change the app

Any TypeScript change is invisible to Android and iOS until you build and sync again:

```bash
npm run build
npx cap sync
```

Then press Run again in Android Studio or Xcode. You do not need to recreate the `android/` or `ios/` folders.

`npm test` runs the unit tests. It needs Node 22. A passing test is not a phone test.

## 6. What you should see

- Sign-up asks for email, password, and full name. The second word becomes the username. The name cannot be edited later. You can add a profile photo.
- The feed is empty until someone posts. There is no sample case.
- A story disappears 24 hours after it is posted. The rail does not keep an expired story.
- Me → the followers number and the following number open the lists. Unfollow is on the people you follow.
- A green ring means Safe. An orange ring means Unfamiliar place. A red ring means Check on me. The words are on the screen as well. Colour is not the only clue.
- Get help lists phone numbers you tap yourself. LulaFind does not call them.
- Contact LulaFind opens a mail to `mkhungela.l@gmail.com`.

## 7. Not a store build

Opening the projects is not a signed Play Store or App Store upload. A store build still needs your own signing keys, a real privacy-policy URL, and a pass on a real device. Share links still use `https://lulafind.co.za` until that domain is yours.
