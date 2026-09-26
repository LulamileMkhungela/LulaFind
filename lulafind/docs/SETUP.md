# What is actually connected

Checked against the live project on 26 September 2026. A button in the app is not the same as a working backend. This file is the check. Do not treat an older paragraph in `README.md` as newer than this.

## Live check

| Piece | What was checked | Result |
| --- | --- | --- |
| Supabase project | `GET /auth/v1/health` | Answers. GoTrue v2.197.0. |
| `records` table | `GET /rest/v1/records?select=collection&limit=1` with the publishable key | The table exists. It returned an empty list. |
| Anonymous write | Insert into `records` with no signed-in user | Rejected. Row-level security blocked it. That is correct. A post, follow, chat, or Spotlight needs a signed-in Supabase session. |
| Email sign-in | Auth settings | On. |
| Confirm email | User turned it off on 26 September 2026 | Off. Leave it off. Firebase still sends the verification email. This was not re-checked from here after the switch was turned off. |
| Google | Auth settings | On. |
| Apple | Auth settings | Off. The app does not offer Apple. |
| Phone | Auth settings | Off. Signup has no phone field. |
| Photos bucket | `GET /storage/v1/bucket/photos` | Bucket not found. The app does not upload to that bucket. Photos are stored inside the post, story, or profile record. A missing bucket does not block a photo today. A very large photo can still fail because the row is too big. |
| Firebase email page | `https://lulafinds-app.firebaseapp.com/__/auth/action` | Returns 200. That is the page in the three email templates. |
| Inbox delivery | Not checked | An email was not opened. Do not treat the page existing as proof that a message arrived. |
| Android or iOS app | Not run | No Android SDK and no Xcode in the check environment. |
| Production web build | `ng build --configuration=production` with Node 22.22.3 | Succeeded. Output `www/`. |

The publishable key is already in `src/environments/environment.ts` and `environment.prod.ts`. Do not put the service-role secret, the database password, or the Firebase Admin private key in the app.

## How the two backends are split

- Firebase sends the three account emails: verify, reset password, and email-change undo. Those templates are already in the Firebase console. The links open Firebase's page. The person finishes there, then signs in inside LulaFind.
- Google sign-in uses Supabase, because that provider is on there. It is not a second Firebase Google login.
- Posts, chat, follows, Spotlights, stories, and profiles are rows in Supabase `records`.
- A password reset changes the Firebase password. The database session is tied to the Firebase account, so the next sign-in still opens the same posts. This was not watched in a real inbox.

## What you still have to do

| Step | Why |
| --- | --- |
| Leave **Enable email provider** on | That switch stays on. It is how an email and password can sign in. Do not turn it off. |
| Confirm email is off | Leave it off. If Save is still showing on that page, click it. Leave Enable email provider on, and leave Allow new users to sign up on. |
| Add the redirect URLs in `docs/RUN.md` | Google returns to the address the app was opened from. A missing URL fails the return. |
| Keep the Firebase template links as they are | The app calls `sendEmailVerification`, `sendPasswordResetEmail`, and `verifyBeforeUpdateEmail`. It does not invent a 6-digit code. |

Do not add a card or turn on the Blaze plan. This app does not use Firestore, Realtime Database, or Cloud Storage.

## Feature check, from the source, not from a phone

| Feature | In the source | Proven on a live account |
| --- | --- | --- |
| Create a post | `DataService.createPost` writes a `posts` row | Not watched on a signed-in account. Confirm email is now off, which was the block. |
| Create, edit, join, and delete a Spotlight | Create, edit, and delete are in the Spotlight page. The creator can edit the short line and the about text, and can delete the community. | Not watched on a signed-in phone. `editor.sql` already allows create. Do not run it again. |
| 24-hour story | `expiresAt` is set to 24 hours. The rail hides a story after that. | The filter is in the source. It was not watched for 24 hours. |
| See followers and unfollow | Me shows both lists from the `follows` rows, not from people who happen to have posted. Unfollow deletes your own follow. | The list code is in the source. Not watched on a second phone. |
| Report a post | Saved on the phone, and copied to `records` when a session exists | Not watched on a second phone. |
| Contact us | Get help and Settings open a mail to `mkhungela.l@gmail.com` | The link is in the source. Delivery depends on the mail app. |
| Comment, follow, chat | Wired to `records` | Not exercised with a live account in this check. Private chat still needs the poster to allow chat, an upvote, and a mutual follow. |
| Logout | Signs out of Firebase and Supabase, then opens the auth screen | Not watched on a phone. |
| Live updates | Listens to `records` and also refreshes every 45 seconds | The listener is in the source. A second phone was not used to prove a row appeared. |

## Competitors, from their own pages

This is not a claim that LulaFind is more advanced.

- Namola dispatches private armed or medical response to a GPS point, tracks family, and sells paid plans. LulaFind does not dispatch anyone. Official page: https://www.namola.com/
- Bright Sky SA, from Vodacom, is an information app for domestic abuse: a directory, a questionnaire, and a journal that is not stored in the app. It says it is not a safety app. https://now.vodacom.co.za/article/vodacom-s-bright-sky-sa-app-is-here-to-combat-gbv
- Missing Children South Africa requires a SAPS case number before they circulate a flyer. They are not an app that files the case. https://missingchildren.org.za/report.html
- The Pink Ladies organisation distributes posters and helps families open a police case. They are volunteers, not a dispatch app.
- Kwanele stores GBV evidence, has a panic button, and connects people to trained staff. LulaFind does not store an evidence vault and does not send armed response.

What LulaFind actually has, in code, is a community case file, a Khumbul'ekhaya claim that does not publish the person's location, surname Spotlights, a 24-hour story, and a follow list. Those screens exist. They are not a substitute for SAPS, Namola, or Kwanele, and they were not proven on a phone in this check.
