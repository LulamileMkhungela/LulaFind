import { LULA_TOPICS } from './ask-lula';

/**
 * The FAQ page's content.
 *
 * Every answer Lula can give is listed here as a question, so the two can never
 * drift apart: `LULA_TOPICS` is the single source, and this file only adds the
 * categories and the handful of app-housekeeping questions Lula does not need
 * to answer in a chat (editing a post, notifications, permissions).
 *
 * Answers are kept to two or three sentences on purpose. Anything longer
 * belongs on the page that does the job, and every answer links there.
 */
export type FaqCategory =
  | 'Start here'
  | 'Reporting & helping'
  | 'Chat & follows'
  | 'Stories & posting'
  | 'Safety & privacy'
  | 'Communities'
  | 'Your account';

export const FAQ_CATEGORIES: FaqCategory[] = [
  'Start here',
  'Reporting & helping',
  'Chat & follows',
  'Stories & posting',
  'Safety & privacy',
  'Communities',
  'Your account'
];

export interface Faq {
  id: string;
  category: FaqCategory;
  q: string;
  a: string;
  links?: { label: string; route: string }[];
}

/** Which FAQ category each of Lula's topics belongs to. */
const TOPIC_CATEGORY: Record<string, FaqCategory> = {
  emergency: 'Safety & privacy',
  report: 'Reporting & helping',
  '72': 'Reporting & helping',
  poster: 'Reporting & helping',
  sighting: 'Reporting & helping',
  khumbu: 'Reporting & helping',
  child: 'Safety & privacy',
  chat: 'Chat & follows',
  reactions: 'Chat & follows',
  found: 'Reporting & helping',
  privacy: 'Safety & privacy',
  community: 'Communities',
  money: 'Safety & privacy',
  story: 'Stories & posting'
};

const fromLula: Faq[] = LULA_TOPICS
  .filter((t) => TOPIC_CATEGORY[t.id])
  .map((t) => ({
    id: `lula-${t.id}`,
    category: TOPIC_CATEGORY[t.id],
    q: t.question,
    a: t.answer.text,
    links: t.answer.links
  }));

const housekeeping: Faq[] = [
  {
    id: 'create',
    category: 'Start here',
    q: 'How do I post something?',
    a: 'Tap Create at the bottom of the screen and pick what you are posting - a missing person, a KhumbulEkhaya post, a sighting, a lost pet, or a story. Add a photo, then share.',
    links: [{ label: 'Create a post', route: '/new' }]
  },
  {
    id: 'feed',
    category: 'Start here',
    q: 'Why do I not see every post?',
    a: 'Your feed shows the cases around you and the people you follow. Use the filters at the top to choose a province or a category, or set the feed to All.',
    links: [{ label: 'Open the feed', route: '/home' }]
  },
  {
    id: 'edit-delete',
    category: 'Stories & posting',
    q: 'Can I edit or delete my post?',
    a: 'Yes. Open your post, tap the "..." at the top and choose Edit post or Delete post. Editing marks the post as Edited. Deleting asks first and tells you when it is done.',
  },
  {
    id: 'story-who',
    category: 'Stories & posting',
    q: 'Who sees my story?',
    a: 'Only the audience you choose: everyone, your followers, or one Spotlight community you belong to. Stories disappear 24 hours after you share them.',
    links: [{ label: 'Create a story', route: '/create-story' }]
  },
  {
    id: 'community-post',
    category: 'Communities',
    q: 'Why can I not post in a community?',
    a: 'You can post to a Spotlight community you have joined, and to no other. Open the community and tap Join first - joining is instant.',
    links: [{ label: 'Open Spotlight', route: '/spotlight' }]
  },
  {
    id: 'specialist',
    category: 'Reporting & helping',
    q: 'Is there a waiting period before SAPS will take a case?',
    a: 'No. In South Africa you can report a missing person immediately - there is no 24-hour rule. Ask for the case number and add it to your post.',
    links: [{ label: 'Report a missing person', route: '/create/missing' }]
  },
  {
    id: 'notifications',
    category: 'Your account',
    q: 'How do I stop or start notifications?',
    a: 'Menu, then Settings. Switch notifications on or off, or choose to hear only about missing children and critical cases.',
    links: [{ label: 'Open settings', route: '/settings' }]
  },
  {
    id: 'permissions',
    category: 'Your account',
    q: 'Why does LulaFind ask for permissions?',
    a: 'Only when a feature needs them: camera and photos for a picture, location for a sighting pin, notifications for alerts. Each one is listed with a switch in Settings, and none of them is used in the background.',
    links: [{ label: 'Review permissions', route: '/settings' }]
  },
  {
    id: 'account',
    category: 'Your account',
    q: 'How do I change my details or delete my account?',
    a: 'Menu, then Edit profile for your photo, town and privacy choices. Deleting your account is at the bottom of Settings and removes your profile, posts and messages.',
    links: [{ label: 'Open your profile', route: '/me' }]
  },
  {
    id: 'cost',
    category: 'Your account',
    q: 'Does LulaFind cost anything?',
    a: 'No. It is free, and there is no advertising. LulaFind never asks you for money and will never ask you to pay for information.',
  },
  {
    id: 'review',
    category: 'Reporting & helping',
    q: 'Why was my child\u2019s case not published straight away?',
    a: 'Every case about a child is read by a moderator before it goes out, because a false child alert makes people stop opening real ones. It is published the moment it is checked, and only then are alerts sent to the area.',
    links: [{ label: 'Report a missing person', route: '/create/missing' }]
  },
  {
    id: 'alerts',
    category: 'Safety & privacy',
    q: 'Who gets an alert when I post a case?',
    a: 'Members in the province the case happened in, and within the distance they chose in Settings. A member who asked for missing children only is alerted only for under-18 cases. Nobody is ever alerted about their own post.',
    links: [{ label: 'Change your alert area', route: '/settings' }]
  },
  {
    id: 'case-number',
    category: 'Reporting & helping',
    q: 'What is a case number and do I need one?',
    a: 'When you open a missing person case, SAPS gives you a case number on the SAPS 55 form. Add it to your post so people can see the police are involved. You can post on LulaFind first and add the number later when you have it.',
    links: [{ label: 'Read the safety tips', route: '/tips' }]
  },
  {
    id: 'not-to-share',
    category: 'Safety & privacy',
    q: 'What should I never put in a case post?',
    a: 'Never the person\u2019s home address, and never a detail only they would know - that is how a false claim gets made. Do not name a suspect. Share a photo, what they wore, and where they were last seen.',
    links: [{ label: 'Read the safety tips', route: '/tips' }]
  },
  {
    id: 'real-lead',
    category: 'Reporting & helping',
    q: 'How do I know a case or a sighting is real?',
    a: 'Check for a case number, a clear place and time, and who posted it. A lead marked "checked" has been compared with CCTV, police information or records. Posts that ask you for money or a payment to "release" someone are a scam - report them.',
    links: [{ label: 'Read the safety tips', route: '/tips' }]
  },
  {
    id: 'checklist',
    category: 'Reporting & helping',
    q: 'What are the steps after someone goes missing?',
    a: 'Open a case at any station and ask for the SAPS 55(A) form, write the case number down, save the investigating officer\u2019s details, add a recent photo, choose one family spokesperson, and put the poster where the person usually goes. A case on LulaFind tracks these steps for you.',
    links: [{ label: 'Report a missing person', route: '/create/missing' }]
  },
  {
    id: 'guardian',
    category: 'Safety & privacy',
    q: 'Can I post a case about a child?',
    a: 'Yes, if you are the child\u2019s parent or guardian, or you have their permission - a case about a child is checked by a moderator before it goes out. If a child is in danger right now, call 10111 first.',
    links: [{ label: 'A child is missing', route: '/create/missing' }]
  },
  {
    id: 'station-refuses',
    category: 'Reporting & helping',
    q: 'The police station says I must wait 24 hours. Is that true?',
    a: 'No. There is no waiting period for a missing person in South Africa. Ask for the senior officer, and if you are still turned away, escalate to the Bureau for Missing Persons on 021 918 3512 or missing@saps.gov.za.',
    links: [{ label: 'See the numbers', route: '/help' }]
  },
  {
    id: 'help-out',
    category: 'Reporting & helping',
    q: 'I am not family or police. What can I actually do?',
    a: 'Share the case, keep the poster on your phone, and watch for the person instead of guessing online. If you see something, reply on the case and tick "This is a lead": the time, the exact place, and what they wore. Never approach or confront anyone.',
    links: [{ label: 'Open the feed', route: '/home' }]
  }
];

export const FAQS: Faq[] = [...fromLula, ...housekeeping];

/** Case-insensitive search over the question and the answer. */
export function searchFaqs(query: string, list: Faq[] = FAQS): Faq[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(q));
}
