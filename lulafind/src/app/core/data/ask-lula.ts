/**
 * "Ask Lula" - the help assistant that lives on the Chats page.
 *
 * It is a rule-based helper, not a live AI model: it matches what someone asks
 * against a fixed set of answers written from LulaFind's own guidance and the
 * South African help lines in `sa-help.ts`. It never invents a phone number and
 * it never claims to have contacted anyone. When nothing matches it says so and
 * points at the Help page.
 */

export interface LulaAnswer {
  text: string;
  /** Optional shortcuts shown under the reply. */
  links?: { label: string; route: string }[];
}

export interface Topic {
  id: string;
  /** Any of these words or phrases (lower case) in the question selects the topic. */
  match: string[];
  /** The same answer, written as a question - this is what the FAQ page lists. */
  question: string;
  answer: LulaAnswer;
}

export const LULA_GREETING: LulaAnswer = {
  text: 'Hi, I\'m Lula. I can help with reporting someone missing, what to do in the first 72 hours, posters, lookouts, privacy and how LulaFind works. What do you need?'
};

export const LULA_SUGGESTIONS = [
  'How do I report a missing person?',
  'What should I do in the first 72 hours?',
  'How do I make a poster?',
  'I think I saw someone',
  'What is KhumbulEkhaya?',
  'How does private chat work?',
  'What is "be on the lookout"?'
];

export const LULA_TOPICS: Topic[] = [
  {
    id: 'lookout',
    question: 'What is "be on the lookout"?',
    match: ['lookout', 'last seen', 'lastseen', 'check on me', 'safety check', 'am i safe', 'going missing', 'possible missing', 'im here', "i'm here"],
    answer: {
      text: 'A lookout tells the people who follow you that you may not be safe where you are going. They see the area and where you last checked in, and after 24 hours LulaFind asks them whether you are okay. Every yes closes it. One no flags you as a possible missing person, but only if you allowed LulaFind to post about you in the Safety centre. If you are safe, open the lookout and tap "I\'m here" - it closes and any post about you is deleted.',
      links: [{ label: 'Open the Safety centre', route: '/safety' }]
    }
  },
  {
    id: 'emergency',
    question: 'Someone is in danger right now - what do I do?',
    match: ['danger', 'emergency', 'hurt', 'attack', 'violence', 'abuse', 'unsafe', 'help now', 'in trouble'],
    answer: {
      text: 'If someone is in danger right now, call the police on 10111 (or 112 from a cellphone) or an ambulance on 10177. For gender-based violence, the GBV Command Centre is 0800 428 428, 24 hours. LulaFind cannot dispatch anyone, so please call yourself.',
      links: [{ label: 'Open all help lines', route: '/help' }]
    }
  },
  {
    id: 'report',
    question: 'How do I report a missing person?',
    match: ['report', 'missing person', 'post a case', 'create a post', 'someone is missing', 'lost my', 'my son', 'my daughter', 'my brother', 'my sister', 'my mother', 'my father'],
    answer: {
      text: 'Open the Create tab, choose Missing person, and add a clear recent photo, their name and age, what they were wearing and where they were last seen. There is no 24-hour waiting period in South Africa: report to SAPS straight away and ask for a case number, then add it to your post.',
      links: [{ label: 'Report a missing person', route: '/create/missing' }]
    }
  },
  {
    id: '72',
    question: 'What should I do in the first 72 hours?',
    match: ['72', 'first hour', 'first 24', 'first 48', 'first day', 'what should i do', 'what do i do', 'do first', 'checklist', 'where do i start', 'waiting period', 'wait 24', 'wait 48'],
    answer: {
      text: 'The first 72 hours matter most. 1) Open a SAPS case and get the number. 2) Choose one family spokesperson. 3) Gather a recent, clear photo. 4) Write down exactly what they wore, shoes and jewellery included. 5) Post on LulaFind and share the poster where they usually go: the taxi rank, clinic, church or school.',
      links: [{ label: 'Read the safety tips', route: '/tips' }]
    }
  },
  {
    id: 'poster',
    question: 'How do I make a poster?',
    match: ['poster', 'flyer', 'template', 'image to share', 'download'],
    answer: {
      text: 'Open your post and tap Poster. Pick a template, choose an accent colour, then share or download the image. Posters leave out the reward amount and one private detail only the family knows, so a caller has to name it before you trust them.'
    }
  },
  {
    id: 'sighting',
    question: 'I think I saw someone - what now?',
    match: ['saw someone', 'i saw', 'sighting', 'spotted', 'i think i saw', 'seen them', 'lead'],
    answer: {
      text: 'Thank you. Do not approach or confront anyone. Note the time, the exact place, what they wore and who they were with. Then comment on the case and tick "This is a lead", or report a sighting. If a child looks in danger, call 10111.',
      links: [{ label: 'Report a sighting', route: '/create/sighting' }]
    }
  },
  {
    id: 'khumbu',
    question: 'What is KhumbulEkhaya?',
    match: ['khumbu', 'ekhaya', 'left home', 'ran away', 'not been home'],
    answer: {
      text: 'KhumbulEkhaya is for someone who has left home and may not want to be forced back. The person can answer for themselves: "I am coming", "I am safe but not coming home", or "let us chat". Nobody is pressured to return.',
      links: [{ label: 'Post a KhumbulEkhaya', route: '/create/khumbulekhaya' }]
    }
  },
  {
    id: 'child',
    question: 'What if the missing person is a child?',
    match: ['child', 'kid', 'baby', 'under 18', 'minor', 'teenager'],
    answer: {
      text: 'A missing child is always urgent. Call SAPS on 10111 first. Childline is on 116 (free). A post about someone under 18 needs a parent, guardian or SAPS confirmation and is checked by a moderator before it goes public.',
      links: [{ label: 'Child help lines', route: '/help' }]
    }
  },
  {
    id: 'chat',
    question: 'How does private chat work?',
    match: ['private chat', 'message the poster', 'how do i chat', 'dm', 'message someone'],
    answer: {
      text: 'A private chat opens once you tap "Have an idea" on a post and you and the poster follow each other. Like, Support and Sad are reactions only and do not open chat. That keeps chats between people who really want to help. Never send money to someone you have not met.'
    }
  },
  {
    id: 'reactions',
    question: 'How do reactions work?',
    match: ['react', 'idea', 'support', 'sad', 'like button', 'long press', 'hold'],
    answer: {
      text: 'Tap the reaction button to say you Have an idea. Hold it to pick Like, Support, Sad or Have an idea instead. Tap again to take it back.'
    }
  },
  {
    id: 'found',
    question: 'How do I close a case when they come home?',
    match: ['found', 'came home', 'is home', 'close the case', 'mark as found', 'still searching'],
    answer: {
      text: 'Only the person who posted can close a case. Open the post and tap Mark as found, add where they were found and, if you like, who found them. If you are still looking, tap Still searching and the post stays open.'
    }
  },
  {
    id: 'privacy',
    question: 'Who can see what I post?',
    match: ['privacy', 'anonymous', 'private', 'hide my name', 'who can see', 'safe to post'],
    answer: {
      text: 'You can post anonymously, choose who sees a post (everyone, followers or a Spotlight community) and decide who sees your contact details. LulaFind only reads a location with the explicit, revocable consent of the person it belongs to.',
      links: [{ label: 'Safety & consent centre', route: '/safety' }]
    }
  },
  {
    id: 'community',
    question: 'What are Spotlight communities?',
    match: ['spotlight', 'community', 'surname group', 'join a'],
    answer: {
      text: 'Spotlight communities are groups built around a surname and province. Join one from the Spotlight tab. You can only post to a community you have joined.',
      links: [{ label: 'Open Spotlight', route: '/spotlight' }]
    }
  },
  {
    id: 'money',
    question: 'Someone is asking for money for information. Is that LulaFind?',
    match: ['pay', 'money', 'ransom', 'scam', 'reward', 'fraud'],
    answer: {
      text: 'LulaFind never asks for money. Predators watch missing-person posts and phone families asking for payment for "information". Never pay, and report the call to SAPS.'
    }
  },
  {
    id: 'story',
    question: 'How long do stories last?',
    match: ['story', 'stories', 'status'],
    answer: {
      text: 'Stories last 24 hours and only reach the audience you choose. Tap Create on the Create tab and choose Story, or use the story card in your feed. Story replies are private to the person who posted.',
      links: [{ label: 'Create a story', route: '/create-story' }]
    }
  },
  {
    id: 'hello',
    question: 'Say hello to Lula',
    match: ['hello', 'hi ', 'hey', 'howzit', 'sawubona', 'molo', 'good morning', 'good evening'],
    answer: { text: 'Hello! Ask me about reporting someone missing, posters, privacy or how anything in LulaFind works.' }
  },
  {
    id: 'thanks',
    question: 'Say thank you to Lula',
    match: ['thank', 'thanks', 'siyabonga', 'enkosi', 'ngiyabonga'],
    answer: { text: 'You\'re welcome. I hope they come home soon. Ask me anything else any time.' }
  }
];

export const LULA_FALLBACK: LulaAnswer = {
  text: 'I don\'t have a good answer to that yet, and I would rather say so than guess. Try the FAQs, or ask me about reporting, the first 72 hours, posters, privacy or private chat.',
  links: [{ label: 'Open the FAQs', route: '/faqs' }, { label: 'Help lines', route: '/help' }]
};

/**
 * Does the question contain this keyword, as a whole word, allowing a plural?
 *
 * Plain `includes()` missed the most obvious way to ask the most important
 * question in the app: "what do I do in the first hour" did not match the
 * topic keyword "first hours", so someone in the worst week of their life was
 * told to try the FAQs. Matching on word boundaries with an optional trailing
 * s fixes the singular/plural gap without letting "car" match "care".
 */
function hits(q: string, key: string): boolean {
  const k = key.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!k) return false;
  return new RegExp(`(^| )${k}s?( |$)`, 'i').test(q);
}

/** Picks the topic with the most matching keywords; ties go to the earlier (more urgent) topic. */
export function askLula(question: string): LulaAnswer {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ')} `;
  let best: Topic | null = null;
  let bestScore = 0;
  for (const topic of LULA_TOPICS) {
    let score = 0;
    for (const key of topic.match) {
      if (hits(q, key)) score += key.trim().length > 6 ? 2 : 1;
    }
    if (score > bestScore) { best = topic; bestScore = score; }
  }
  return best ? best.answer : LULA_FALLBACK;
}
