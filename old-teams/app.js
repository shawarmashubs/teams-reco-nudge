const STORAGE_KEY = "teamsChatPrototype.messages"; // { [conversationId]: [{id,userId,text,ts}] }
const CHATS_KEY = "teamsChatPrototype.chats"; // [{id, participantIds:[...], name?}]
const CURRENT_USER_KEY = "teamsChatPrototype.currentUserId";
const SELECTED_CONV_KEY = "teamsChatPrototype.selectedConversation"; // "channel:c1" | "chat:dm1"
const CURRENT_VIEW_KEY = "teamsChatPrototype.currentView"; // "chats" | "teams"
const PERSONALIZATION_KEY = "teamsChatPrototype.personalization"; // { [userId]: {ladderIndex, cooldownUntil} }

// budget simulates the Auth + Validation Agent's recognition-budget check —
// Liam is seeded at 0 so his flow demonstrates the design's silent
// no-nudge case (PRD Design > Escalation rules, case 3: no budget).
// identityIssue simulates Auth returning an identity thumbs-down — Noor's
// flow demonstrates the design's flagged nudge -> manual login case (PRD
// Design > Escalation rules, case 4).
const USERS = [
  { id: "u1", name: "Priya Nair", color: "#5b3fa0", budget: 50 },
  { id: "u2", name: "Sam Okafor", color: "#c4314b", budget: 50 },
  { id: "u3", name: "Jordan Lee", color: "#0f6cbd", budget: 50 },
  { id: "u4", name: "Ava Torres", color: "#0e7f5a", budget: 50 },
  { id: "u5", name: "Liam Chen", color: "#986f0b", budget: 0 },
  { id: "u6", name: "Noor Haidari", color: "#8764b8", budget: 50, identityIssue: true },
  { id: "u7", name: "Diego Ramirez", color: "#b4009e", budget: 50 },
  { id: "u8", name: "Mei Tanaka", color: "#038387", budget: 50 },
];

const BOT = { id: "bot-nudge", name: "Recognition Nudge", color: "#5b3fa0", isBot: true };

const TEAMS = [
  {
    id: "t1",
    name: "Acme Product Org",
    channels: [
      { id: "c1", name: "General" },
      { id: "c2", name: "Product Team" },
      { id: "c3", name: "Random" },
    ],
  },
  {
    id: "t2",
    name: "Design Guild",
    channels: [
      { id: "c4", name: "Feedback" },
      { id: "c5", name: "Resources" },
    ],
  },
];

const DEFAULT_CHATS = [
  { id: "dm1", participantIds: ["u1", "u2"] },
  { id: "dm2", participantIds: ["u1", "u3", "u4"], name: "Launch Squad" },
  { id: "dm3", participantIds: ["u6", "u7"] },
  { id: "dm4", participantIds: ["u5", "u8"] },
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function getInitials(name) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getUser(userId) {
  if (userId === BOT.id) return BOT;
  return USERS.find((u) => u.id === userId);
}

function allChannels() {
  return TEAMS.flatMap((team) =>
    team.channels.map((c) => ({ ...c, teamId: team.id, teamName: team.name }))
  );
}

function getChannel(channelId) {
  return allChannels().find((c) => c.id === channelId);
}

// ---- Chats persistence ----

function loadChats() {
  const raw = localStorage.getItem(CHATS_KEY);
  if (raw) return JSON.parse(raw);
  saveChats(DEFAULT_CHATS);
  return DEFAULT_CHATS;
}

function saveChats(chats) {
  localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
}

function getChat(chatId) {
  return loadChats().find((c) => c.id === chatId);
}

function chatDisplayName(chat, viewerUserId) {
  if (chat.name) return chat.name;
  const others = chat.participantIds
    .filter((id) => id !== viewerUserId)
    .map(getUser)
    .filter(Boolean);
  return others.map((u) => u.name).join(", ") || "Just you";
}

function isGroupChat(chat) {
  return chat.participantIds.length > 2;
}

function findExistingChat(participantIds) {
  const target = [...participantIds].sort().join(",");
  return loadChats().find(
    (c) => [...c.participantIds].sort().join(",") === target
  );
}

function createChat(participantIds) {
  const existing = findExistingChat(participantIds);
  if (existing) return existing;
  const chats = loadChats();
  const chat = {
    id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    participantIds,
  };
  chats.push(chat);
  saveChats(chats);
  return chat;
}

// ---- Messages persistence (generic over any conversation id) ----

function loadAllMessages() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
}

function saveAllMessages(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getMessages(conversationId) {
  const all = loadAllMessages();
  return all[conversationId] || [];
}

// parentId is null for a chat message or a new channel post, or the id of
// the top-level post this message replies to (channel threads only). card is
// non-null only for Recognition Nudge bot messages — see buildCardMessageRow.
function addMessage(conversationId, userId, text, parentId = null, card = null) {
  const all = loadAllMessages();
  if (!all[conversationId]) all[conversationId] = [];
  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    text,
    ts: Date.now(),
    parentId: parentId || null,
    card,
  };
  all[conversationId].push(message);
  saveAllMessages(all);
  return message;
}

// Merges `patch` into a message's `.card` (e.g. { resolved: "sent" }) — used
// by the nudge card's action buttons.
function updateMessageCard(conversationId, messageId, patch) {
  const all = loadAllMessages();
  const messages = all[conversationId] || [];
  const message = messages.find((m) => m.id === messageId);
  if (!message || !message.card) return;
  message.card = { ...message.card, ...patch };
  saveAllMessages(all);
}

// A post plus its replies, in chronological order — used both to render a
// thread and to give resolveResponder the right slice of history to look at.
function getThreadMessages(conversationId, postId) {
  return getMessages(conversationId).filter(
    (m) => m.id === postId || m.parentId === postId
  );
}

// ---- Personalization / cooldown (Personalization Agent simulation) ----
//
// Mirrors personalization_profiles.json's adaptive cooldown state (PRD
// Design > Memory). Dismissal escalates along the 1h -> 4h -> 24h -> 72h-cap
// ladder; mid-flow cancels and unacted expiries apply a smaller partial
// bump without moving the ladder position; successful submission resets to
// baseline immediately. The design's "7 consecutive days at the cap fires a
// single probe nudge" escape hatch is not implemented here — it requires
// real multi-day elapsed time to ever trigger and isn't observable in a
// normal session.

const COOLDOWN_LADDER_HOURS = [1, 4, 24, 72];
const PARTIAL_COOLDOWN_MS = 30 * 60 * 1000;

function loadPersonalization() {
  const raw = localStorage.getItem(PERSONALIZATION_KEY);
  return raw ? JSON.parse(raw) : {};
}

function savePersonalization(data) {
  localStorage.setItem(PERSONALIZATION_KEY, JSON.stringify(data));
}

function getProfile(userId) {
  const all = loadPersonalization();
  return all[userId] || { ladderIndex: -1, cooldownUntil: 0 };
}

function setProfile(userId, patch) {
  const all = loadPersonalization();
  all[userId] = { ...getProfile(userId), ...patch };
  savePersonalization(all);
}

function isInCooldown(userId) {
  return getProfile(userId).cooldownUntil > Date.now();
}

function applyDismissCooldown(userId) {
  const nextIndex = Math.min(
    getProfile(userId).ladderIndex + 1,
    COOLDOWN_LADDER_HOURS.length - 1
  );
  setProfile(userId, {
    ladderIndex: nextIndex,
    cooldownUntil: Date.now() + COOLDOWN_LADDER_HOURS[nextIndex] * 3600 * 1000,
  });
}

function applyPartialCooldown(userId) {
  setProfile(userId, { cooldownUntil: Date.now() + PARTIAL_COOLDOWN_MS });
}

function resetCooldown(userId) {
  setProfile(userId, { ladderIndex: -1, cooldownUntil: 0 });
}

// ---- Current user / view / selection ----

function getCurrentUserId() {
  return localStorage.getItem(CURRENT_USER_KEY) || USERS[0].id;
}

function setCurrentUserId(userId) {
  localStorage.setItem(CURRENT_USER_KEY, userId);
}

function getCurrentView() {
  return localStorage.getItem(CURRENT_VIEW_KEY) || "chats";
}

function setCurrentView(view) {
  localStorage.setItem(CURRENT_VIEW_KEY, view);
}

function getSelectedConversation() {
  const raw =
    localStorage.getItem(SELECTED_CONV_KEY) ||
    `channel:${TEAMS[0].channels[0].id}`;
  const [type, id] = raw.split(":");
  return { type, id };
}

function setSelectedConversation(type, id) {
  localStorage.setItem(SELECTED_CONV_KEY, `${type}:${id}`);
}

function getConversationParticipants(selected) {
  if (selected.type === "channel") return USERS; // public: anyone can post
  const chat = getChat(selected.id);
  return chat ? chat.participantIds.map(getUser).filter(Boolean) : [];
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---- Reply generation ----

const TIME_COMMITMENTS = [
  "within the hour",
  "by end of day",
  "by tomorrow morning",
  "by Friday",
  "by end of week",
];

function randomTimeCommitment() {
  return pick(TIME_COMMITMENTS);
}

function extractDeadlinePhrase(text) {
  const match = text.match(/\b(?:by|before)\s+([^.?!]+)/i);
  return match ? match[1].trim().replace(/\s+/g, " ") : null;
}

const REPLY_RULES = [
  {
    test: /\b(what do you mean|what does that mean|can you clarify|clarify that|not sure what you mean|explain that)\b/i,
    replies: [
      "Sorry, let me clarify — I just need to double check a couple of things before I can confirm.",
      "My bad — I meant I need a little more time to verify the details first.",
      "Sorry for the confusion, I just want to make sure the numbers are right before committing.",
      "Let me rephrase — it's doable, I just need to confirm a couple of details first.",
    ],
  },
  {
    test: /\b(when can i expect|how long will|how long does it take|what'?s the eta|how soon)\b/i,
    reply: () => `You should have it ${randomTimeCommitment()}.`,
  },
  {
    test: /\b(what'?s your answer|do you have (an )?answer|yes or no\??$|any update)\b/i,
    reply: () =>
      pick([
        `Yes — I'll get it done ${randomTimeCommitment()}.`,
        "Confirmed, it's already in progress.",
        `Yes, that works. I'll follow up ${randomTimeCommitment()}.`,
      ]),
  },
  {
    test: /\b(could i get|can i get|could you send|can you send|i need|could you prepare|can you prepare|could you put together|can you put together|could you pull together|can you pull together)\b/i,
    reply: (text) => {
      const deadline = extractDeadlinePhrase(text);
      return deadline
        ? `Sure, I'll have that ready by ${deadline}.`
        : `Sure, I'll get that together ${randomTimeCommitment()}.`;
    },
  },
  {
    test: /\b(hi|hello|hey|good morning|good afternoon|good evening)\b/i,
    replies: ["Hey! 👋", "Hello!", "Hi there!", "Hey, what's up?"],
  },
  {
    test: /\b(thanks|thank you|thx|appreciate it)\b/i,
    replies: [
      "You're welcome!",
      "Anytime!",
      "No problem at all.",
      "Happy to help!",
    ],
  },
  {
    test: /\b(bye|goodbye|see you|see ya|gotta go|heading out|talk later)\b/i,
    replies: ["See you later!", "Bye! 👋", "Catch you later.", "Talk soon!"],
  },
  {
    test: /\b(bug|broken|crash(ed)?|error|not working|issue with|doesn'?t work)\b/i,
    replies: [
      "Ugh, let me take a look.",
      "Can you send a screenshot or more details?",
      "I'll dig into it and report back.",
      "Thanks for flagging — filing a ticket now.",
    ],
  },
  {
    test: /\b(meet|meeting|sync|call|hop on|schedule|calendar)\b/i,
    replies: [
      "Works for me — what time?",
      "I'm free after 2pm, does that work?",
      "Sure, I'll send an invite.",
      "Yep, I can hop on a call.",
    ],
  },
  {
    test: /\b(review|feedback|thoughts on|take a look|check this out|check out)\b/i,
    replies: [
      "On it, will review shortly.",
      "Looks good to me so far!",
      "Sure, I'll send my notes soon.",
      "Yep, I'll take a pass at it today.",
    ],
  },
  {
    test: /\b(deadline|due (today|tomorrow)|running late|behind schedule)\b/i,
    replies: [
      "Noted, I'll prioritize it.",
      "Got it — tight, but doable.",
      "I'll make sure it's done in time.",
      "Thanks for the heads up on the timeline.",
    ],
  },
  {
    test: /\b(lunch|coffee|break|grab a bite)\b/i,
    replies: [
      "I'm in! What time?",
      "Sounds great, count me in.",
      "Maybe in a bit, wrapping something up first.",
      "Yes please, I could use a break.",
    ],
  },
  {
    test: /^(can|could|would|should|is|are|do|does|did|will|have|has)\b.*\?\s*$/i,
    replies: [
      "Yes, that should work.",
      "I believe so — I'll double check and confirm.",
      "That's the plan, yes.",
      "Yes, I don't see why not.",
    ],
  },
  {
    test: /\?\s*$/,
    replies: [
      "Let me look into that and follow up shortly.",
      "I'll find out and get back to you.",
      "Good question — checking now.",
      "I'll have an answer for you soon.",
    ],
  },
  {
    test: /\b(agree|sounds good|makes sense|good idea|i think so)\b/i,
    replies: ["Agreed!", "Same here.", "Couldn't agree more.", "Yep, exactly."],
  },
];

const FALLBACK_REPLIES = [
  "Sounds good!",
  "Got it, thanks!",
  "I'll take a look and get back to you.",
  "👍",
  "Makes sense to me.",
  "Thanks for the update!",
  "Interesting, tell me more.",
  "Ha, fair point.",
  "On it.",
];

function pickReplyFor(messageText) {
  const rule = REPLY_RULES.find((r) => r.test.test(messageText));
  if (!rule) return pick(FALLBACK_REPLIES);
  return rule.reply ? rule.reply(messageText) : pick(rule.replies);
}

// Decides who should answer: an explicitly named user (within this
// conversation's participants), otherwise whoever the sender last talked to
// within `historyMessages` (the whole chat, or just this one thread for a
// channel post), otherwise a random participant. Pass an empty history to
// force a fresh pick — used for brand new channel posts, since each new
// post is its own topic rather than a continuation of the last thread.
function resolveResponder(historyMessages, senderUserId, messageText, pool) {
  const others = pool.filter((u) => u.id !== senderUserId);
  if (others.length === 0) return null;

  const mentioned = others.find((u) => {
    const firstName = u.name.split(" ")[0];
    return new RegExp(`\\b${firstName}\\b`, "i").test(messageText);
  });
  if (mentioned) return mentioned;

  for (let i = historyMessages.length - 1; i >= 0; i--) {
    if (historyMessages[i].userId !== senderUserId) {
      const lastPartner = others.find((u) => u.id === historyMessages[i].userId);
      if (lastPartner) return lastPartner;
      break;
    }
  }

  return pick(others);
}

// ---- Recognition Nudge Bot: qualification (Listener Agent simulation) ----

// Strong signals read as recognition-grade on their own. Plain "thanks"-style
// phrases are ambiguous -- the PRD's own example ("Thanks for the heads up")
// is explicitly casual politeness, not genuine gratitude -- so those only
// qualify when they're clearly tied to a specific piece of work (a named
// deliverable, or enough surrounding detail to read as substantive).
const STRONG_RECOGNITION_PATTERNS = [
  /\b(great|awesome|amazing|excellent|outstanding|fantastic) (job|work)\b/i,
  /\bwell done\b/i,
  /\b(crushed|killed|nailed) it\b/i,
  /\bso helpful\b/i,
  /\bkudos\b/i,
  /\bshout ?out\b/i,
  /\bprops to\b/i,
  /\byou'?re the best\b/i,
  /\babove and beyond\b/i,
  /\bcouldn'?t have done (it|this) without you\b/i,
  // A superlative used as its own exclamation ("Amazing, thanks for the
  // support") doesn't match the "(great|...) (job|work)" pattern above since
  // "job"/"work" never appears -- but paired with a nearby thanks/appreciate,
  // it's the same strength of signal. Found via a real test conversation
  // ("amazing, thanks for the support") that the original pattern missed.
  /\b(great|awesome|amazing|excellent|outstanding|fantastic)\b.{0,30}\b(thanks|thank you|appreciate)\b/i,
];

const WEAK_GRATITUDE_PATTERNS = [/\b(thanks|thank you|thx|appreciate)\b/i];

const WORK_OBJECT_WORDS =
  /\b(deck|report|presentation|pitch|launch|doc|document|code|pr|pull request|review|bug|fix|ticket|demo|proposal|analysis|design|spec|slides|draft|research|campaign|release|migration|dashboard|project|onboarding|training)\b/i;

// A dismissal/decline reads as "thanks" lexically but is not gratitude at
// all -- it's a polite no. This must win over every other signal (including
// STRONG_RECOGNITION_PATTERNS) since it's a hard negation of the message,
// not a weaker version of praise. Eval 0 case: "thanks but no thanks" must
// never nudge, and the false-positive bar (<=5%) is the one Eval 0 gate the
// whole product depends on -- see PRD Design > Evaluation.
const DISMISSAL_PATTERNS = [
  /\bno,?\s+thanks?\b/i,
  /\bthanks?,?\s+but\b/i,
  /\b(appreciate (it|that|you)),?\s+but\b/i,
  /\b(i'?ll pass|not interested|no need(ed)?|not necessary|not this time)\b/i,
];

function qualifiesForNudge(text) {
  if (DISMISSAL_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (STRONG_RECOGNITION_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (WEAK_GRATITUDE_PATTERNS.some((pattern) => pattern.test(text))) {
    return WORK_OBJECT_WORDS.test(text) || text.trim().split(/\s+/).length >= 8;
  }
  return false;
}

// ---- Eval 0: classifier accuracy (PRD Design > Evaluation) ----
//
// Stands in for nudge_trigger_examples.json + sample_conversations.json --
// the full labeled set the Listener's classifier is run against before any
// scenario testing. `nudge: true` means a real employee would consider this
// genuine, recognition-grade appreciation; `nudge: false` covers casual
// politeness, dismissals/declines, and unrelated chatter. Pass bar per PRD:
// >=90% overall accuracy, <=5% false positives (noise wrongly nudged).
const EVAL_0_DATASET = [
  { text: "Great job on the deck, that really landed with the client.", nudge: true },
  { text: "You crushed it on the launch this week.", nudge: true },
  { text: "Well done on the migration, that was a nightmare of a project.", nudge: true },
  { text: "Couldn't have done this without you on the pitch.", nudge: true },
  { text: "Kudos on the redesign, it looks incredible.", nudge: true },
  { text: "Shoutout to the whole team for shipping the release early.", nudge: true },
  { text: "Props to Sam for catching that bug before launch.", nudge: true },
  { text: "You're the best for pulling together that analysis overnight.", nudge: true },
  { text: "Thanks so much for the thorough code review, it really helped me.", nudge: true },
  { text: "Really appreciate you staying late to fix the production bug.", nudge: true },
  { text: "Thank you for putting together such a clear proposal for the client.", nudge: true },
  { text: "So helpful walking me through the onboarding process.", nudge: true },
  { text: "Above and beyond effort on the dashboard rebuild, seriously impressive.", nudge: true },
  { text: "Excellent work pulling that research together on short notice.", nudge: true },
  { text: "Amazing job leading the demo today, the client loved it.", nudge: true },
  { text: "Thank you for the detailed spec, it made implementation so much easier.", nudge: true },
  { text: "Appreciate you jumping on that fix at 9pm, above and beyond.", nudge: true },
  { text: "Outstanding work on the campaign, the numbers speak for themselves.", nudge: true },
  { text: "Fantastic job coordinating the release across three teams.", nudge: true },
  { text: "Nailed it with the presentation, the board had zero questions.", nudge: true },
  { text: "Thanks for pulling an all-nighter to get the ticket resolved before the demo.", nudge: true },
  { text: "I really appreciate how much extra work you put into the training materials this quarter.", nudge: true },
  { text: "Huge thanks to Priya for mentoring me through the onboarding project this whole month.", nudge: true },
  { text: "Well done pushing that release out despite the migration issues.", nudge: true },
  { text: "Thank you so much for reviewing my draft twice this week, it made a real difference.", nudge: true },
  // From a real test conversation (a coworker helping resolve an urgent
  // bug) -- kept here so this exact regression can never silently return.
  { text: "amazing, thanks for the support", nudge: true },
  { text: "thanks but lose the attitude", nudge: false },
  { text: "appreciate it", nudge: false },
  { text: "Thanks for the heads up.", nudge: false },
  { text: "thanks but no thanks", nudge: false },
  { text: "No thanks, I'm good.", nudge: false },
  { text: "Thanks, but I already handled it.", nudge: false },
  { text: "Appreciate it, but I'll pass.", nudge: false },
  { text: "I'll pass on that, thanks anyway.", nudge: false },
  { text: "Not interested, but thanks for asking.", nudge: false },
  { text: "Thanks!", nudge: false },
  { text: "Thx", nudge: false },
  { text: "Thanks a lot.", nudge: false },
  { text: "Thank you.", nudge: false },
  { text: "Hey, good morning!", nudge: false },
  { text: "Can you send me the report by Friday?", nudge: false },
  { text: "Are we still meeting at 2pm?", nudge: false },
  { text: "The build is broken again.", nudge: false },
  { text: "Let's grab coffee later.", nudge: false },
  { text: "Running a bit late, sorry!", nudge: false },
  { text: "What do you mean by that?", nudge: false },
  { text: "See you tomorrow!", nudge: false },
  { text: "Thanks, catch you later.", nudge: false },
  { text: "No need, I've got it covered.", nudge: false },
  { text: "Not necessary, but thanks for offering.", nudge: false },
  { text: "Thanks for letting me know.", nudge: false },
  { text: "Thanks for the quick reply.", nudge: false },
  { text: "Appreciate the update, thanks.", nudge: false },
];

// Runs the full labeled set through the real classifier and scores it the
// way the PRD's Eval 0 defines: overall accuracy, false-positive rate (share
// of noise wrongly nudged -- the "product becomes noise" risk), and
// false-negative rate (share of genuine moments missed).
function runEval0() {
  const positives = EVAL_0_DATASET.filter((c) => c.nudge);
  const negatives = EVAL_0_DATASET.filter((c) => !c.nudge);
  const misclassified = [];
  let truePos = 0;
  let falsePos = 0;

  EVAL_0_DATASET.forEach((c) => {
    const predicted = qualifiesForNudge(c.text);
    if (predicted === c.nudge) {
      if (predicted && c.nudge) truePos++;
    } else {
      misclassified.push({ ...c, predicted });
      if (predicted && !c.nudge) falsePos++;
    }
  });

  const total = EVAL_0_DATASET.length;
  const correct = total - misclassified.length;
  const accuracy = correct / total;
  const falsePositiveRate = negatives.length ? falsePos / negatives.length : 0;
  const falseNegativeRate = positives.length ? (positives.length - truePos) / positives.length : 0;

  return {
    total,
    accuracy,
    falsePositiveRate,
    falseNegativeRate,
    pass: accuracy >= 0.9 && falsePositiveRate <= 0.05,
    misclassified,
  };
}

const CORE_VALUES = [
  "Teamwork",
  "Customer Focus",
  "Innovation",
  "Excellence",
  "Going Above & Beyond",
];

function pickCoreValue(text) {
  if (/\b(team|together|help|support)\b/i.test(text)) return "Teamwork";
  if (/\b(client|customer|user)\b/i.test(text)) return "Customer Focus";
  if (/\b(idea|innovat|creative)\b/i.test(text)) return "Innovation";
  if (/\b(above and beyond|extra mile|late night|weekend)\b/i.test(text)) {
    return "Going Above & Beyond";
  }
  return "Excellence";
}

function generateDraftText(targetName) {
  const who = targetName || "you";
  return pick([
    `Just want to formally recognize ${who} for the great work here — it really made a difference and I appreciate you.`,
    `Huge thanks to ${who} for stepping up on this. Excellent work, truly appreciated.`,
    `${who}, this deserves to be called out — thank you for going above and beyond.`,
    `Recognizing ${who} for outstanding work and support. Well deserved!`,
  ]);
}

// Placeholder policy check simulating the Draft/Submission Agents' guideline
// screen (PRD Design > Escalation rules, case 10). Real system would check
// against recognition_guidelines.md / employer_policy.md.
const POLICY_VIOLATION_WORDS = /\b(stupid|idiot|hate|terrible|worthless|fire (him|her|them))\b/i;

// Predicts who the praise was for: an explicitly named channel member, else
// (for a reply) the author of the post being replied to, else null — a
// soft-fail left for the user to fill in rather than a wrong guess.
function resolveRecognitionTarget(text, parentPost, pool, senderUserId) {
  const others = pool.filter((u) => u.id !== senderUserId);

  const mentioned = others.find((u) => {
    const firstName = u.name.split(" ")[0];
    return new RegExp(`\\b${firstName}\\b`, "i").test(text);
  });
  if (mentioned) return mentioned;

  if (parentPost && parentPost.userId !== senderUserId) {
    return getUser(parentPost.userId) || null;
  }

  return null;
}

// key `${conversationId}:${parentId || "root"}` -> userId currently "typing"
const typingByConversation = {};
let searchTerm = "";
const collapsedTeams = new Set();

const REPLY_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 4L3 7.5L6.5 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 7.5H10C11.6569 7.5 13 8.84315 13 10.5V12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---- DOM refs ----

const railChats = document.getElementById("railChats");
const railTeams = document.getElementById("railTeams");
const userSwitcherBtn = document.getElementById("userSwitcherBtn");
const userMenu = document.getElementById("userMenu");
const listPanelTitle = document.getElementById("listPanelTitle");
const newChatBtn = document.getElementById("newChatBtn");
const searchInput = document.getElementById("searchInput");
const chatsListView = document.getElementById("chatsListView");
const teamsListView = document.getElementById("teamsListView");
const conversationAvatarGroup = document.getElementById(
  "conversationAvatarGroup"
);
const conversationTitle = document.getElementById("conversationTitle");
const conversationSubtitle = document.getElementById("conversationSubtitle");
const chatTabs = document.getElementById("chatTabs");
const messageListEl = document.getElementById("messageList");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const newChatModal = document.getElementById("newChatModal");
const participantPicker = document.getElementById("participantPicker");
const cancelNewChat = document.getElementById("cancelNewChat");
const startNewChat = document.getElementById("startNewChat");
const evalConsoleBtn = document.getElementById("evalConsoleBtn");
const evalConsoleModal = document.getElementById("evalConsoleModal");
const closeEvalConsole = document.getElementById("closeEvalConsole");
const runEvalSuiteBtn = document.getElementById("runEvalSuiteBtn");
const evalResults = document.getElementById("evalResults");

function avatarSpan(user, extraClass) {
  const span = document.createElement("span");
  span.className = `${extraClass} `.trim();
  span.style.background = user.color;
  span.textContent = getInitials(user.name);
  return span;
}

// ---- Rendering: rail + user switcher ----

function renderRail() {
  const view = getCurrentView();
  railChats.classList.toggle("active", view === "chats");
  railTeams.classList.toggle("active", view === "teams");
  chatsListView.classList.toggle("hidden", view !== "chats");
  teamsListView.classList.toggle("hidden", view !== "teams");
  listPanelTitle.textContent = view === "chats" ? "Chat" : "Teams";
  newChatBtn.classList.toggle("hidden", view !== "chats");
}

function renderUserAvatarButton() {
  const user = getUser(getCurrentUserId());
  userSwitcherBtn.textContent = getInitials(user.name);
  userSwitcherBtn.style.background = user.color;
  userSwitcherBtn.title = `Signed in as ${user.name} — click to switch`;
}

function renderUserMenu() {
  const currentUserId = getCurrentUserId();
  userMenu.innerHTML = "";

  const label = document.createElement("div");
  label.className = "user-menu-label";
  label.textContent = "Switch user";
  userMenu.appendChild(label);

  USERS.forEach((user) => {
    const item = document.createElement("div");
    item.className = "user-menu-item";
    const avatar = avatarSpan(user, "user-menu-avatar");
    const label = document.createElement("span");
    label.textContent = user.name + (user.id === currentUserId ? " (you)" : "");
    item.append(avatar, label);
    item.addEventListener("click", () => {
      setCurrentUserId(user.id);
      userMenu.classList.add("hidden");
      renderAll();
    });
    userMenu.appendChild(item);
  });
}

// ---- Rendering: chats list ----

function renderChatsList() {
  const currentUserId = getCurrentUserId();
  const selected = getSelectedConversation();
  const term = searchTerm.trim().toLowerCase();

  const chats = loadChats()
    .filter((c) => c.participantIds.includes(currentUserId))
    .filter((c) => chatDisplayName(c, currentUserId).toLowerCase().includes(term));

  chatsListView.innerHTML = "";

  if (chats.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No chats yet. Click + to start one.";
    chatsListView.appendChild(empty);
    return;
  }

  chats
    .slice()
    .sort((a, b) => {
      const lastA = getMessages(a.id).slice(-1)[0];
      const lastB = getMessages(b.id).slice(-1)[0];
      return (lastB ? lastB.ts : 0) - (lastA ? lastA.ts : 0);
    })
    .forEach((chat) => {
      const otherUsers = chat.participantIds
        .filter((id) => id !== currentUserId)
        .map(getUser)
        .filter(Boolean);
      const messages = getMessages(chat.id);
      const last = messages[messages.length - 1];

      const row = document.createElement("div");
      row.className =
        "chat-row" +
        (selected.type === "chat" && selected.id === chat.id ? " active" : "");

      const avatarGroup = document.createElement("div");
      avatarGroup.className =
        "chat-row-avatars" + (otherUsers.length === 1 ? " single" : "");
      otherUsers.slice(0, 2).forEach((u, idx) => {
        avatarGroup.appendChild(
          avatarSpan(u, `stacked-avatar pos-${idx}`)
        );
      });

      const text = document.createElement("div");
      text.className = "chat-row-text";
      const name = document.createElement("div");
      name.className = "chat-row-name";
      name.textContent = chatDisplayName(chat, currentUserId);
      const preview = document.createElement("div");
      preview.className = "chat-row-preview";
      preview.textContent = last
        ? `${getUser(last.userId)?.name?.split(" ")[0] || ""}: ${last.text}`
        : "No messages yet";
      text.append(name, preview);

      row.append(avatarGroup, text);

      if (last) {
        const time = document.createElement("div");
        time.className = "chat-row-time";
        time.textContent = formatTime(last.ts);
        row.appendChild(time);
      }

      row.addEventListener("click", () => {
        setSelectedConversation("chat", chat.id);
        renderAll();
      });

      chatsListView.appendChild(row);
    });
}

// ---- Rendering: teams / channels tree ----

function renderTeamsList() {
  const selected = getSelectedConversation();
  const term = searchTerm.trim().toLowerCase();
  teamsListView.innerHTML = "";

  TEAMS.forEach((team) => {
    const matchingChannels = team.channels.filter((c) =>
      c.name.toLowerCase().includes(term)
    );
    if (term && matchingChannels.length === 0) return;

    const header = document.createElement("div");
    header.className = "team-header";
    header.innerHTML = `
      <span class="team-chevron">${collapsedTeams.has(team.id) ? "▸" : "▾"}</span>
      <span class="team-avatar">${getInitials(team.name)}</span>
      <span class="team-name">${team.name}</span>
    `;
    header.addEventListener("click", () => {
      if (collapsedTeams.has(team.id)) collapsedTeams.delete(team.id);
      else collapsedTeams.add(team.id);
      renderTeamsList();
    });
    teamsListView.appendChild(header);

    if (collapsedTeams.has(team.id)) return;

    matchingChannels.forEach((channel) => {
      const isActive =
        selected.type === "channel" && selected.id === channel.id;
      const item = document.createElement("div");
      item.className = "channel-item" + (isActive ? " active" : "");
      item.innerHTML = `<span class="channel-hash">#</span><span>${channel.name}</span>`;
      item.addEventListener("click", () => {
        setSelectedConversation("channel", channel.id);
        renderAll();
      });
      teamsListView.appendChild(item);
    });
  });
}

// ---- Rendering: conversation header + messages ----

function renderConversationHeader(selected) {
  conversationAvatarGroup.innerHTML = "";
  chatTabs.classList.toggle("hidden", selected.type !== "channel");

  if (selected.type === "channel") {
    const channel = getChannel(selected.id);
    conversationTitle.textContent = `# ${channel.name}`;
    conversationSubtitle.textContent = channel.teamName;
    conversationAvatarGroup.appendChild(
      Object.assign(document.createElement("span"), {
        className: "team-avatar",
        textContent: getInitials(channel.teamName),
      })
    );
    messageInput.placeholder = "Start a new conversation";
    sendBtn.textContent = "Post";
    return;
  }

  const chat = getChat(selected.id);
  const currentUserId = getCurrentUserId();
  const otherUsers = chat.participantIds
    .filter((id) => id !== currentUserId)
    .map(getUser)
    .filter(Boolean);

  conversationTitle.textContent = chatDisplayName(chat, currentUserId);
  conversationSubtitle.textContent = isGroupChat(chat)
    ? `${chat.participantIds.length} people`
    : "";

  const group = document.createElement("div");
  group.className =
    "chat-row-avatars" + (otherUsers.length === 1 ? " single" : "");
  otherUsers.slice(0, 2).forEach((u, idx) => {
    group.appendChild(avatarSpan(u, `stacked-avatar pos-${idx}`));
  });
  conversationAvatarGroup.appendChild(group);
  messageInput.placeholder = "Type a new message";
  sendBtn.textContent = "Send";
}

function buildMessageRow(user, ts, text, { own, small } = {}) {
  const row = document.createElement("div");
  row.className = "message-row" + (own ? " own" : "") + (small ? " reply-row" : "");

  const avatar = avatarSpan(user, "message-avatar");
  const content = document.createElement("div");
  content.className = "message-content";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.innerHTML = `<span class="message-sender">${user.name}</span><span class="message-time">${formatTime(
    ts
  )}</span>`;

  const textEl = document.createElement("div");
  textEl.className = "message-text";
  textEl.textContent = text;

  content.append(meta, textEl);
  row.append(avatar, content);
  return row;
}

// Builds the Draft Agent's payload once a nudge is accepted: predicted
// recipient (if any), a contextual core value, generated draft text, and the
// program's fixed award amount. Mirrors PRD Design > Output format.
function buildDraft(channelId, card) {
  const pool = getConversationParticipants({ type: "channel", id: channelId });
  const recipient = card.targetName
    ? pool.find((u) => u.name === card.targetName)
    : null;
  return {
    recipientId: recipient ? recipient.id : null,
    coreValue: pickCoreValue(card.sourceText || ""),
    draftText: generateDraftText(card.targetName),
    amount: "$25",
    sessionExpired: false,
    sessionExpiresAt: Date.now() + SESSION_TTL_MS,
  };
}

// ---- Session expiry mid-flow (PRD Design > Escalation rules, case 9) ----
//
// The Achievers session token is short-lived and can expire while the
// employee is still reviewing the draft. Detected independently of the
// Submit click (a real timer, not a submit-time check) and never discards
// the draft -- expireDraftSession folds in whatever the employee had
// already typed/selected so nothing is lost, matching the submissionError
// path's same care further down.
const SESSION_TTL_MS = 45 * 1000;
// message.id -> true while a real-time expiry timer is pending, so
// re-rendering the same draft card (which happens often) never stacks a
// second timer for the same message.
const scheduledSessionExpiries = new Set();

function expireDraftSession(fieldsPatch) {
  return { ...fieldsPatch, sessionExpired: true };
}

function reconnectDraftSession() {
  return { sessionExpired: false, sessionExpiresAt: Date.now() + SESSION_TTL_MS };
}

// Schedules the real-time auto-expiry for a draft card exactly once per
// message, reading current field values out of the live DOM at fire time so
// in-progress edits survive the transition (identical intent to the
// submissionError path, which captures the same three fields at submit
// time).
function scheduleSessionExpiry(channelId, message, fields) {
  if (scheduledSessionExpiries.has(message.id)) return;
  scheduledSessionExpiries.add(message.id);

  const delay = Math.max(0, message.card.sessionExpiresAt - Date.now());
  setTimeout(() => {
    scheduledSessionExpiries.delete(message.id);
    const latest = getMessages(channelId).find((m) => m.id === message.id);
    if (!latest || !latest.card || latest.card.resolved || latest.card.stage !== "draft") return;
    if (latest.card.sessionExpired) return;
    updateMessageCard(
      channelId,
      message.id,
      expireDraftSession({
        recipientId: fields.recipientSelect.value,
        coreValue: fields.valueSelect.value,
        draftText: fields.textarea.value,
      })
    );
    renderMessages();
  }, delay);
}

// Nudge stage: the discreet accept/dismiss prompt (PRD Design > Output
// format > Nudge Prompt). Accepting doesn't send anything yet -- it hands
// off to the Draft stage below for human review.
function buildNudgeCardBody(channelId, message) {
  const card = message.card;
  const wrap = document.createDocumentFragment();

  const body = document.createElement("div");
  body.className = "message-text";
  body.textContent = card.targetName
    ? `Looks like you gave ${card.targetName} a shoutout — want to send it as real recognition?`
    : "That sounded like recognition-worthy praise — want to send it as real recognition?";
  wrap.appendChild(body);

  const expiry = document.createElement("div");
  expiry.className = "card-expiry";
  expiry.textContent = `Expires in ~${card.ttlHours}h if there's no response`;
  wrap.appendChild(expiry);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const acceptBtn = document.createElement("button");
  acceptBtn.type = "button";
  acceptBtn.className = "btn-primary";
  acceptBtn.textContent = "Accept";
  acceptBtn.addEventListener("click", () => {
    // Identity failure (PRD Design > Escalation rules, case 4): the nudge
    // still surfaces, but acceptance routes through manual login first --
    // Draft only opens once auth is (re-)established.
    if (card.needsLogin) {
      updateMessageCard(channelId, message.id, { stage: "login" });
    } else {
      updateMessageCard(channelId, message.id, {
        stage: "draft",
        ...buildDraft(channelId, card),
      });
    }
    renderMessages();
  });

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "btn-secondary";
  dismissBtn.textContent = "Dismiss";
  dismissBtn.addEventListener("click", () => {
    updateMessageCard(channelId, message.id, { resolved: "dismissed" });
    applyDismissCooldown(card.senderId);
    renderMessages();
  });

  actions.append(acceptBtn, dismissBtn);
  wrap.appendChild(actions);
  return wrap;
}

// Manual login stage (PRD Design > Escalation rules, case 4): shown only
// when Auth flagged an identity failure. Signing in resumes the flow into
// the Draft stage; cancelling ends the flow as "abandoned-at-login" with a
// softer cooldown increment than a full dismissal.
function buildLoginCardBody(channelId, message) {
  const card = message.card;
  const wrap = document.createDocumentFragment();

  const body = document.createElement("div");
  body.className = "message-text";
  body.textContent =
    "We couldn't verify your Achievers account for this nudge — sign in to continue.";
  wrap.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const signInBtn = document.createElement("button");
  signInBtn.type = "button";
  signInBtn.className = "btn-primary";
  signInBtn.textContent = "Sign in to Achievers";
  signInBtn.addEventListener("click", () => {
    updateMessageCard(channelId, message.id, {
      stage: "draft",
      ...buildDraft(channelId, card),
    });
    renderMessages();
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    updateMessageCard(channelId, message.id, { resolved: "abandoned-at-login" });
    applyPartialCooldown(card.senderId);
    renderMessages();
  });

  actions.append(signInBtn, cancelBtn);
  wrap.appendChild(actions);
  return wrap;
}

// Draft stage: the reviewable recognition card (PRD Design > Output format >
// Recognition Draft). Recipient/core value/text are all editable; award
// amount is fixed by the program and displayed read-only. Submit is disabled
// until a recipient is picked (soft-fail recipient matching) and the text
// clears a placeholder policy check (escalation case 10).
function buildDraftCardBody(channelId, message) {
  const card = message.card;
  const pool = getConversationParticipants({ type: "channel", id: channelId }).filter(
    (u) => u.id !== BOT.id && u.id !== card.senderId
  );

  const wrap = document.createElement("div");
  wrap.className = "draft-card";

  const heading = document.createElement("div");
  heading.className = "message-text draft-heading";
  heading.textContent = "Recognition draft — review before sending";
  wrap.appendChild(heading);

  const recipientField = document.createElement("label");
  recipientField.className = "draft-field";
  recipientField.innerHTML = `<span class="draft-label">Recipient</span>`;
  const recipientSelect = document.createElement("select");
  recipientSelect.className = "draft-select";
  if (!card.recipientId) {
    const blankOpt = document.createElement("option");
    blankOpt.value = "";
    blankOpt.textContent = "No match found — select recipient…";
    recipientSelect.appendChild(blankOpt);
  }
  pool.forEach((u) => {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = u.name;
    if (u.id === card.recipientId) opt.selected = true;
    recipientSelect.appendChild(opt);
  });
  recipientField.appendChild(recipientSelect);
  wrap.appendChild(recipientField);

  const valueField = document.createElement("label");
  valueField.className = "draft-field";
  valueField.innerHTML = `<span class="draft-label">Core value</span>`;
  const valueSelect = document.createElement("select");
  valueSelect.className = "draft-select";
  CORE_VALUES.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    if (v === card.coreValue) opt.selected = true;
    valueSelect.appendChild(opt);
  });
  valueField.appendChild(valueSelect);
  wrap.appendChild(valueField);

  const textField = document.createElement("label");
  textField.className = "draft-field";
  textField.innerHTML = `<span class="draft-label">Message</span>`;
  const textarea = document.createElement("textarea");
  textarea.className = "draft-textarea";
  textarea.value = card.draftText;
  textField.appendChild(textarea);
  wrap.appendChild(textField);

  const warning = document.createElement("div");
  warning.className = "draft-warning hidden";
  warning.textContent =
    "This message may not meet recognition guidelines — please revise before sending.";
  wrap.appendChild(warning);

  // Submission failure (PRD Design > Output format > Submission
  // Confirmation): the draft is preserved and the user can retry.
  if (card.submissionError) {
    const failure = document.createElement("div");
    failure.className = "draft-warning";
    failure.textContent =
      "Sorry, submission failed — we couldn't reach Achievers just now. Your draft is saved; try submitting again.";
    wrap.appendChild(failure);
  }

  // Session expiry mid-flow (PRD Design > Escalation rules, case 9): fields
  // stay exactly as the employee left them; only Submit is blocked until
  // they reconnect.
  const sessionBanner = document.createElement("div");
  sessionBanner.className = "draft-warning session-expired-banner" + (card.sessionExpired ? "" : " hidden");
  sessionBanner.innerHTML =
    'Your Achievers session expired while you were reviewing this draft. Reconnect to continue — nothing you\'ve entered is lost.<button type="button" class="btn-primary reconnect-btn">Reconnect</button>';
  wrap.appendChild(sessionBanner);
  const reconnectBtn = sessionBanner.querySelector(".reconnect-btn");
  reconnectBtn.addEventListener("click", () => {
    scheduledSessionExpiries.delete(message.id);
    updateMessageCard(channelId, message.id, {
      ...reconnectDraftSession(),
      recipientId: recipientSelect.value,
      coreValue: valueSelect.value,
      draftText: textarea.value,
    });
    renderMessages();
  });

  if (!card.sessionExpired && !card.resolved) {
    scheduleSessionExpiry(channelId, message, { recipientSelect, valueSelect, textarea });
  }

  const amountRow = document.createElement("div");
  amountRow.className = "draft-amount";
  amountRow.textContent = `Award amount: ${card.amount} · fixed by your program, not editable`;
  wrap.appendChild(amountRow);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "btn-primary";
  submitBtn.textContent = "Submit";

  function validate() {
    const violates = POLICY_VIOLATION_WORDS.test(textarea.value);
    warning.classList.toggle("hidden", !violates);
    submitBtn.disabled =
      violates || !recipientSelect.value || !textarea.value.trim() || card.sessionExpired;
  }
  recipientSelect.addEventListener("change", validate);
  textarea.addEventListener("input", validate);
  validate();

  // Demo-only trigger: waiting on the real 45s timer during a scripted demo
  // recording is impractical, so this reproduces case 9 on click. Same
  // expireDraftSession() path the real timer uses in scheduleSessionExpiry.
  if (!card.sessionExpired && !card.resolved) {
    const forceExpireLink = document.createElement("button");
    forceExpireLink.type = "button";
    forceExpireLink.className = "force-expiry-link";
    forceExpireLink.textContent = "Simulate session timeout (demo)";
    forceExpireLink.addEventListener("click", () => {
      scheduledSessionExpiries.delete(message.id);
      updateMessageCard(
        channelId,
        message.id,
        expireDraftSession({
          recipientId: recipientSelect.value,
          coreValue: valueSelect.value,
          draftText: textarea.value,
        })
      );
      renderMessages();
    });
    wrap.appendChild(forceExpireLink);
  }

  submitBtn.addEventListener("click", () => {
    const recipient = getUser(recipientSelect.value);
    // Field edits are persisted whether or not the submission succeeds, so
    // a simulated failure below never loses the user's edits.
    const fieldsPatch = {
      recipientId: recipientSelect.value,
      recipientName: recipient ? recipient.name : card.targetName,
      coreValue: valueSelect.value,
      draftText: textarea.value.trim(),
    };

    // Simulates the design's "platform error" submission failure (PRD
    // Design > Output format > Submission Confirmation). The other three
    // listed failure reasons -- auth expired, budget insufficient, field
    // invalid -- either need infra this prototype doesn't build or are
    // already prevented by the validate() gate above, so a platform error
    // is the one that's both faithful (real infra failures are inherently
    // non-deterministic) and demoable here.
    if (Math.random() < 0.25) {
      updateMessageCard(channelId, message.id, {
        ...fieldsPatch,
        submissionError: "platform_error",
      });
      renderMessages();
      return;
    }

    updateMessageCard(channelId, message.id, {
      ...fieldsPatch,
      resolved: "sent",
      submissionError: null,
    });
    resetCooldown(card.senderId);
    renderMessages();
    renderChatsList();
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    updateMessageCard(channelId, message.id, { resolved: "cancelled-at-draft" });
    applyPartialCooldown(card.senderId);
    renderMessages();
  });

  actions.append(submitBtn, cancelBtn);
  wrap.appendChild(actions);
  return wrap;
}

// Renders a Recognition Nudge bot message as an Adaptive-Card-style reply
// (bot avatar + "App" badge) instead of a plain text bubble. Walks the
// nudge -> draft -> resolved stages described in PRD Design > Agent loop.
function buildCardMessageRow(channelId, message) {
  const row = document.createElement("div");
  row.className = "message-row reply-row card-message";

  const avatar = avatarSpan(BOT, "message-avatar");
  const content = document.createElement("div");
  content.className = "message-content";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.innerHTML = `<span class="message-sender">${BOT.name}</span><span class="bot-badge">App</span><span class="message-time">${formatTime(
    message.ts
  )}</span>`;
  content.appendChild(meta);

  const card = message.card;

  if (card.resolved === "sent") {
    const body = document.createElement("div");
    body.className = "message-text";
    body.textContent = "Recognition Nudge";
    content.appendChild(body);

    const resolved = document.createElement("div");
    resolved.className = "card-resolved";
    resolved.innerHTML = `✓ Recognition successfully published to <strong>${
      card.recipientName || card.targetName || "the recipient"
    }</strong> — ${card.coreValue || "Recognition"} · ${card.amount || ""}`;
    content.appendChild(resolved);
  } else if (card.resolved === "dismissed") {
    const body = document.createElement("div");
    body.className = "message-text";
    body.textContent = "Recognition nudge dismissed.";
    content.appendChild(body);
  } else if (card.resolved === "cancelled-at-draft") {
    const body = document.createElement("div");
    body.className = "message-text";
    body.textContent = "Recognition draft cancelled.";
    content.appendChild(body);
  } else if (card.resolved === "abandoned-at-login") {
    const body = document.createElement("div");
    body.className = "message-text";
    body.textContent = "Login cancelled — recognition not sent.";
    content.appendChild(body);
  } else if (card.resolved === "expired") {
    const body = document.createElement("div");
    body.className = "message-text";
    body.textContent = "Recognition nudge expired.";
    content.appendChild(body);
  } else if (card.stage === "login") {
    content.appendChild(buildLoginCardBody(channelId, message));
  } else if (card.stage === "draft") {
    content.appendChild(buildDraftCardBody(channelId, message));
  } else {
    content.appendChild(buildNudgeCardBody(channelId, message));
  }

  row.append(avatar, content);
  return row;
}

function buildTypingRow(user) {
  const row = document.createElement("div");
  row.className = "message-row typing-row";
  const avatar = avatarSpan(user, "message-avatar");
  const content = document.createElement("div");
  content.className = "message-content";
  content.innerHTML = `
    <div class="message-meta"><span class="message-sender">${user.name}</span></div>
    <div class="typing-bubble">
      <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
    </div>
  `;
  row.append(avatar, content);
  return row;
}

function handleReplySubmit(channelId, postId, input) {
  const text = input.value.trim();
  if (!text) return;

  const senderUserId = getCurrentUserId();
  const historyMessages = getThreadMessages(channelId, postId);
  addMessage(channelId, senderUserId, text, postId);
  input.value = "";
  renderAll();

  const parentPost = getMessages(channelId).find((m) => m.id === postId) || null;
  const nudged = maybeTriggerNudge(channelId, postId, senderUserId, text, parentPost);
  if (!nudged) {
    triggerAutoReply(channelId, postId, senderUserId, text, USERS, historyMessages);
  }
}

function buildPostElement(channelId, post, replies, currentUserId) {
  const user = getUser(post.userId);
  if (!user) return document.createDocumentFragment();

  const wrapper = document.createElement("div");
  wrapper.className = "post";
  const mainRow = buildMessageRow(user, post.ts, post.text, {
    own: post.userId === currentUserId,
  });
  mainRow.classList.add("post-main");
  wrapper.appendChild(mainRow);

  const thread = document.createElement("div");
  thread.className = "post-thread";

  if (replies.length > 0) {
    const count = document.createElement("div");
    count.className = "reply-count";
    count.textContent = `${replies.length} ${
      replies.length === 1 ? "reply" : "replies"
    }`;
    thread.appendChild(count);

    replies.forEach((reply) => {
      if (reply.card) {
        thread.appendChild(buildCardMessageRow(channelId, reply));
        return;
      }
      const ru = getUser(reply.userId);
      if (!ru) return;
      thread.appendChild(
        buildMessageRow(ru, reply.ts, reply.text, {
          own: reply.userId === currentUserId,
          small: true,
        })
      );
    });
  }

  const typingUserId = typingByConversation[`${channelId}:${post.id}`];
  if (typingUserId) thread.appendChild(buildTypingRow(getUser(typingUserId)));

  const replyForm = document.createElement("form");
  replyForm.className = "reply-compose";
  replyForm.innerHTML = `
    <span class="reply-icon">${REPLY_ICON_SVG}</span>
    <input type="text" placeholder="Reply" autocomplete="off" />
    <button type="submit">Reply</button>
  `;
  const replyInput = replyForm.querySelector("input");
  replyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    handleReplySubmit(channelId, post.id, replyInput);
  });
  thread.appendChild(replyForm);

  wrapper.appendChild(thread);
  return wrapper;
}

function renderChannelPosts(channelId) {
  const currentUserId = getCurrentUserId();
  const allMsgs = getMessages(channelId);
  const posts = allMsgs.filter((m) => !m.parentId);

  messageListEl.classList.add("posts-list");
  messageListEl.innerHTML = "";

  if (posts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No posts yet. Start the conversation!";
    messageListEl.appendChild(empty);
    return;
  }

  posts.forEach((post) => {
    const replies = allMsgs.filter((m) => m.parentId === post.id);
    messageListEl.appendChild(
      buildPostElement(channelId, post, replies, currentUserId)
    );
  });

  messageListEl.scrollTop = messageListEl.scrollHeight;
}

function renderChatMessages(chatId) {
  const currentUserId = getCurrentUserId();
  const messages = getMessages(chatId);
  const typingUserId = typingByConversation[`${chatId}:root`];

  messageListEl.classList.remove("posts-list");
  messageListEl.innerHTML = "";

  if (messages.length === 0 && !typingUserId) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No messages yet. Say hello!";
    messageListEl.appendChild(empty);
    return;
  }

  messages.forEach((msg) => {
    const user = getUser(msg.userId);
    if (!user) return;
    messageListEl.appendChild(
      buildMessageRow(user, msg.ts, msg.text, {
        own: msg.userId === currentUserId,
      })
    );
  });

  if (typingUserId) {
    messageListEl.appendChild(buildTypingRow(getUser(typingUserId)));
  }

  messageListEl.scrollTop = messageListEl.scrollHeight;
}

function renderMessages() {
  const selected = getSelectedConversation();
  renderConversationHeader(selected);

  if (selected.type === "channel") renderChannelPosts(selected.id);
  else renderChatMessages(selected.id);
}

// parentId: null for a chat message, or the post id a channel reply attaches
// to. historyMessages scopes "who was I just talking to" — the whole chat
// for a DM, just this one thread for a channel reply, or [] for a brand new
// post (each post is its own topic, so pick fresh rather than continuing
// whatever the last thread happened to be).
function triggerAutoReply(
  conversationId,
  parentId,
  senderUserId,
  messageText,
  pool,
  historyMessages
) {
  const responder = resolveResponder(
    historyMessages,
    senderUserId,
    messageText,
    pool
  );
  if (!responder) return;

  const typingKey = `${conversationId}:${parentId || "root"}`;
  typingByConversation[typingKey] = responder.id;
  if (getSelectedConversation().id === conversationId) renderMessages();

  const delay = 900 + Math.random() * 1800;
  setTimeout(() => {
    delete typingByConversation[typingKey];
    const reply = pickReplyFor(messageText);
    addMessage(conversationId, responder.id, reply, parentId);
    renderChatsList();
    if (getSelectedConversation().id === conversationId) renderMessages();
  }, delay);
}

// Recognition Nudge bot: passively "sees" every human-typed channel message
// (never the bot's own, never the scripted coworker auto-replies) and, if it
// reads as peer praise/gratitude, replies in-thread with a nudge card instead
// of the usual coworker auto-reply. parentPost is the top-level post being
// replied to (for target-recipient prediction), or null for a brand new post.
// Returns true if a nudge was triggered, so the caller can skip the human
// auto-reply for this message.
function maybeTriggerNudge(channelId, postId, senderUserId, text, parentPost) {
  if (senderUserId === BOT.id) return false;
  if (!qualifiesForNudge(text)) return false;

  // Auth + Validation's zero-budget case is silent end-to-end (PRD Design >
  // Escalation rules, case 3): no nudge UX at all, flow falls through to the
  // normal coworker auto-reply as if nothing recognition-related happened.
  const sender = getUser(senderUserId);
  if (sender && sender.budget === 0) return false;

  // Cooldown active (Listener Agent): a qualifying signal is discarded
  // entirely -- no buffering, no deferred firing, nothing recorded (PRD
  // Design > Escalation rules, case 2; Eval case 6).
  if (isInCooldown(senderUserId)) return false;

  const target = resolveRecognitionTarget(text, parentPost, USERS, senderUserId);

  // TTL mirrors the Nudge Agent's decay timer: a brief "thanks" gets a
  // shorter window than a longer, multi-turn exchange. Real wall-clock
  // hours, per design -- expiresAt is the actual timestamp swept by
  // sweepExpiredNudges().
  const wordCount = text.trim().split(/\s+/).length;
  const ttlHours =
    wordCount < 12 ? 2 + Math.floor(Math.random() * 3) : 8 + Math.floor(Math.random() * 5);

  const typingKey = `${channelId}:${postId}`;
  typingByConversation[typingKey] = BOT.id;
  if (getSelectedConversation().id === channelId) renderMessages();

  const delay = 900 + Math.random() * 1200;
  setTimeout(() => {
    delete typingByConversation[typingKey];
    addMessage(channelId, BOT.id, "Recognition nudge suggested.", postId, {
      stage: "nudge",
      senderId: senderUserId,
      targetName: target ? target.name : null,
      sourceText: text,
      ttlHours,
      expiresAt: Date.now() + ttlHours * 3600 * 1000,
      needsLogin: !!(sender && sender.identityIssue),
      resolved: null,
    });
    renderChatsList();
    if (getSelectedConversation().id === channelId) renderMessages();
  }, delay);

  return true;
}

// Sweeps every conversation for unacted nudge cards past their real-time
// expiresAt and resolves them as "expired" (PRD Design > Agent behavior >
// Nudge Agent: "On expiry, remove the card -- silently deleted, no retry, no
// reminder"). Applies the same partial cooldown bump as a mid-flow cancel
// (Eval case 8).
function sweepExpiredNudges() {
  const all = loadAllMessages();
  const now = Date.now();
  const selected = getSelectedConversation();
  let currentConvAffected = false;

  Object.keys(all).forEach((conversationId) => {
    all[conversationId].forEach((m) => {
      if (
        m.card &&
        m.card.stage === "nudge" &&
        !m.card.resolved &&
        m.card.expiresAt &&
        now >= m.card.expiresAt
      ) {
        updateMessageCard(conversationId, m.id, { resolved: "expired" });
        applyPartialCooldown(m.card.senderId);
        if (selected.type === "channel" && selected.id === conversationId) {
          currentConvAffected = true;
        }
      }
    });
  });

  if (currentConvAffected) renderMessages();
}

// ---- Eval Console: Cases 1-10 (PRD Design > Evaluation) ----
//
// Exercises the real Listener/Nudge/Auth/Draft/Personalization logic the
// app already runs, against scratch users/conversations that never touch
// real demo data. Every helper below snapshots whatever it's about to
// change and restores it when done, so running the suite mid-demo is safe.

const EVAL_SCRATCH_USER = "__eval_scratch_user__";
const EVAL_SCRATCH_CONV = "__eval_scratch_conv__";

function withScratchProfile(userIds, fn) {
  const before = {};
  userIds.forEach((id) => {
    before[id] = getProfile(id);
  });
  try {
    return fn();
  } finally {
    userIds.forEach((id) => setProfile(id, before[id]));
  }
}

function withScratchConversation(conversationId, fn) {
  const all = loadAllMessages();
  const existed = Object.prototype.hasOwnProperty.call(all, conversationId);
  const before = existed ? all[conversationId] : undefined;
  try {
    return fn();
  } finally {
    const after = loadAllMessages();
    if (existed) after[conversationId] = before;
    else delete after[conversationId];
    saveAllMessages(after);
  }
}

// Case 1 -- Happy path: genuine high-confidence appreciation, budgeted
// sender, valid identity -- everything downstream should pre-fill cleanly.
function runCase1() {
  const senderId = "u1"; // Priya Nair -- budget 50, no identity issue
  return withScratchProfile([senderId], () => {
    resetCooldown(senderId);
    const text = "Great job on the deck, Sam — that really landed with the client.";
    const sender = getUser(senderId);
    const qualifies = qualifiesForNudge(text);
    const budgetOk = sender.budget > 0;
    const cooldownOk = !isInCooldown(senderId);
    const target = resolveRecognitionTarget(text, null, USERS, senderId);
    const draft = buildDraft("c1", { targetName: target ? target.name : null, sourceText: text });
    const policyOk = !POLICY_VIOLATION_WORDS.test(draft.draftText);
    const pass =
      qualifies &&
      budgetOk &&
      cooldownOk &&
      !!target &&
      !!draft.recipientId &&
      CORE_VALUES.includes(draft.coreValue) &&
      !!draft.draftText.trim() &&
      draft.amount === "$25" &&
      policyOk;
    return {
      id: "case1",
      title: "Case 1 — Happy path",
      pass,
      detail: pass
        ? `Classified as genuine; ${sender.name} has budget and isn't in cooldown; recipient predicted as ${target && target.name}; draft pre-fills a valid core value, text, and the fixed award amount, and clears the policy check.`
        : "One or more happy-path steps failed to produce a clean, submittable draft.",
    };
  });
}

// Case 2 -- Zero budget: Auth's no-budget thumbs-down must be completely
// silent, end to end.
function runCase2() {
  const senderId = "u5"; // Liam Chen -- budget 0
  return withScratchProfile([senderId], () => {
    resetCooldown(senderId);
    const text = "Amazing job on the launch this week!";
    const triggered = maybeTriggerNudge(EVAL_SCRATCH_CONV, "scratch-post", senderId, text, null);
    const pass = qualifiesForNudge(text) === true && triggered === false;
    return {
      id: "case2",
      title: "Case 2 — Zero budget (silent)",
      pass,
      detail: pass
        ? "Message reads as genuine appreciation, but Liam Chen has $0 recognition budget — Auth's no-budget thumbs-down ends the flow silently with no nudge shown."
        : "Expected the zero-budget sender to produce no nudge at all.",
    };
  });
}

// Case 3 -- Identity failure: the nudge still surfaces, flagged to route
// through manual login on acceptance.
function runCase3() {
  const senderId = "u6"; // Noor Haidari -- identityIssue: true, budget 50
  return withScratchProfile([senderId], () => {
    resetCooldown(senderId);
    const sender = getUser(senderId);
    const text = "Kudos to Diego for the fantastic support this week.";
    const qualifies = qualifiesForNudge(text);
    const wouldNeedLogin = !!(sender && sender.identityIssue);
    const pass = qualifies && sender.budget > 0 && !isInCooldown(senderId) && wouldNeedLogin;
    return {
      id: "case3",
      title: "Case 3 — Identity failure → manual login",
      pass,
      detail: pass
        ? "Auth can't map Noor's Teams identity to an Achievers account. The nudge still surfaces (needsLogin), and accepting it routes through manual login before Draft opens."
        : "Expected the identity-issue sender to be flagged for manual login on an otherwise-qualifying signal.",
    };
  });
}

// Case 4 -- Recipient not found: a soft fail that leaves the field blank
// without invalidating the rest of the draft.
function runCase4() {
  const text = "Really appreciate the extra effort on the migration this week.";
  const target = resolveRecognitionTarget(text, null, USERS, "u2");
  const draft = buildDraft("c1", { targetName: target ? target.name : null, sourceText: text });
  const pass =
    target === null &&
    draft.recipientId === null &&
    !!draft.coreValue &&
    !!draft.draftText.trim() &&
    draft.amount === "$25";
  return {
    id: "case4",
    title: "Case 4 — Recipient not found (soft fail)",
    pass,
    detail: pass
      ? "No name is mentioned and there's no parent post to infer from, so recipient matching comes back empty. The nudge isn't invalidated — the draft opens with the recipient field blank and every other field pre-populated."
      : "Expected an unmatched recipient to leave the field blank without blocking the rest of the draft.",
  };
}

// Case 5 -- Low-confidence signal: casual politeness (the PRD's own
// "Thanks for the heads up" example) must never fire.
function runCase5() {
  const examples = [
    "Thanks for the heads up.",
    "Thanks for letting me know.",
    "Appreciate the update, thanks.",
    "Thanks a lot.",
  ];
  const results = examples.map((text) => ({ text, qualifies: qualifiesForNudge(text) }));
  const pass = results.every((r) => r.qualifies === false);
  return {
    id: "case5",
    title: "Case 5 — Low-confidence signal (must not fire)",
    pass,
    detail: pass
      ? `Casual politeness below the confidence threshold (e.g. "${examples[0]}") is disregarded — no Auth call, no nudge, nothing recorded.`
      : `Expected these to be disregarded: ${results
          .filter((r) => r.qualifies)
          .map((r) => `"${r.text}"`)
          .join(", ")}.`,
  };
}

// Case 6 -- Cooldown: a qualifying signal during an active cooldown is
// discarded entirely; a fresh one after expiry is not blocked.
function runCase6() {
  const senderId = `${EVAL_SCRATCH_USER}_cooldown`;
  return withScratchProfile([senderId], () => {
    const text = "Great job on the proposal, above and beyond effort.";

    setProfile(senderId, { ladderIndex: 0, cooldownUntil: Date.now() + 3600 * 1000 });
    const duringCooldown = isInCooldown(senderId);
    const triggeredDuringCooldown = maybeTriggerNudge(
      EVAL_SCRATCH_CONV,
      "scratch-post",
      senderId,
      text,
      null
    );

    setProfile(senderId, { cooldownUntil: Date.now() - 1000 });
    const cooldownCleared = !isInCooldown(senderId);
    const wouldFireAfterCooldown = qualifiesForNudge(text) && !isInCooldown(senderId);

    const pass =
      duringCooldown && triggeredDuringCooldown === false && cooldownCleared && wouldFireAfterCooldown;
    return {
      id: "case6",
      title: "Case 6 — Cooldown",
      pass,
      detail: pass
        ? "A qualifying signal during an active cooldown is discarded entirely — no buffering, no deferred firing. Once the cooldown window passes, an equivalent fresh signal is no longer blocked."
        : "Expected the signal to be discarded during cooldown and to clear again once the cooldown window passed.",
    };
  });
}

// Case 7 -- Progressive cooldown ladder across a dismiss/dismiss/cancel/
// submit sequence.
function runCase7() {
  const senderId = `${EVAL_SCRATCH_USER}_ladder`;
  return withScratchProfile([senderId], () => {
    resetCooldown(senderId);
    const now = Date.now();
    const hoursMs = (idx) => COOLDOWN_LADDER_HOURS[idx] * 3600 * 1000;

    applyDismissCooldown(senderId);
    const afterFirstDismiss = getProfile(senderId);

    applyDismissCooldown(senderId);
    const afterSecondDismiss = getProfile(senderId);

    const ladderBeforePartial = afterSecondDismiss.ladderIndex;
    applyPartialCooldown(senderId);
    const afterPartial = getProfile(senderId);

    resetCooldown(senderId);
    const afterSubmit = getProfile(senderId);

    const step1Ok =
      afterFirstDismiss.ladderIndex === 0 &&
      Math.abs(afterFirstDismiss.cooldownUntil - (now + hoursMs(0))) < 5000;
    const step2Ok =
      afterSecondDismiss.ladderIndex === 1 &&
      Math.abs(afterSecondDismiss.cooldownUntil - (now + hoursMs(1))) < 5000;
    const partialOk =
      afterPartial.ladderIndex === ladderBeforePartial &&
      Math.abs(afterPartial.cooldownUntil - (now + PARTIAL_COOLDOWN_MS)) < 5000;
    const resetOk = afterSubmit.ladderIndex === -1 && afterSubmit.cooldownUntil === 0;

    const pass = step1Ok && step2Ok && partialOk && resetOk;
    return {
      id: "case7",
      title: "Case 7 — Progressive cooldown window",
      pass,
      detail: pass
        ? "Dismissal escalates 1h → 4h; a mid-flow cancel applies only the smaller partial bump without moving the ladder position; a successful submission resets straight back to baseline."
        : "Expected 1h → 4h escalation on dismissal, an unchanged ladder position on partial cooldown, and a full reset on submit.",
      note: "The \"7 consecutive days at the cap fires a single probe nudge\" escape hatch isn't simulated here — it requires real multi-day elapsed time to observe.",
    };
  });
}

// Case 8 -- Nudge expiry: an untouched nudge past its TTL resolves silently
// with a partial cooldown bump.
function runCase8() {
  const senderId = `${EVAL_SCRATCH_USER}_ttl`;
  const convId = `${EVAL_SCRATCH_CONV}_ttl`;
  return withScratchProfile([senderId], () =>
    withScratchConversation(convId, () => {
      resetCooldown(senderId);
      const all = loadAllMessages();
      all[convId] = [
        {
          id: "scratch-nudge-1",
          userId: BOT.id,
          text: "Recognition nudge suggested.",
          ts: Date.now() - 1000,
          parentId: "scratch-post-1",
          card: {
            stage: "nudge",
            senderId,
            targetName: null,
            sourceText: "Great job on the deck.",
            ttlHours: 2,
            expiresAt: Date.now() - 1000,
            needsLogin: false,
            resolved: null,
          },
        },
      ];
      saveAllMessages(all);

      sweepExpiredNudges();

      const after = getMessages(convId).find((m) => m.id === "scratch-nudge-1");
      const resolvedExpired = !!after && after.card.resolved === "expired";
      const cooldownApplied = isInCooldown(senderId);
      const pass = resolvedExpired && cooldownApplied;

      return {
        id: "case8",
        title: "Case 8 — Nudge expiry (TTL)",
        pass,
        detail: pass
          ? "An untouched nudge past its TTL is silently resolved as \"expired\" (no retry, no reminder) and the softer partial cooldown increment is applied."
          : "Expected the past-TTL nudge to resolve as expired and apply a partial cooldown.",
      };
    })
  );
}

// Case 9 -- Session token expiry mid-flow: detected independently of
// Submit, preserves every field, and re-arms cleanly on reconnect.
function runCase9() {
  const original = {
    recipientId: "u2",
    coreValue: "Teamwork",
    draftText: "Thanks Sam, you crushed the launch.",
  };
  const expired = expireDraftSession(original);
  const reconnected = reconnectDraftSession();

  const pass =
    expired.sessionExpired === true &&
    expired.recipientId === original.recipientId &&
    expired.coreValue === original.coreValue &&
    expired.draftText === original.draftText &&
    reconnected.sessionExpired === false &&
    typeof reconnected.sessionExpiresAt === "number";

  return {
    id: "case9",
    title: "Case 9 — Session token expires mid-flow",
    pass,
    detail: pass
      ? "Expiry is detected independently of Submit and carries the draft's fields through unchanged; reconnecting clears the flag and re-arms a fresh session window without discarding anything."
      : "Expected session expiry to preserve every draft field and reconnect to clear the flag cleanly.",
    note: 'In the live UI this also fires automatically ~45s into reviewing a draft, or immediately via the "Simulate session timeout (demo)" link on the draft card.',
  };
}

// Case 10 -- Policy-violating text: (a) the final check blocks Submit;
// (b) auto-generated drafts are pre-vetted and can't trip it themselves.
function runCase10() {
  const violatingText = "This work was terrible, you're an idiot for shipping it like this.";
  const cleanText = "Great job on the deck, that really landed with the client.";
  const violatingFlagged = POLICY_VIOLATION_WORDS.test(violatingText);
  const cleanNotFlagged = !POLICY_VIOLATION_WORDS.test(cleanText);
  const pass = violatingFlagged && cleanNotFlagged;
  return {
    id: "case10",
    title: "Case 10 — Policy-violating text",
    pass,
    detail: pass
      ? "(a) Editing a draft into violating content is caught by the policy check, which disables Submit until it's corrected. (b) Every auto-generated draft template is pre-vetted clean text."
      : "Expected the policy check to flag violating text and leave clean text untouched.",
    note: "Part (b) — the Draft Agent's own check catching its own bad output — can't be demonstrated here since generateDraftText() only ever produces pre-vetted clean templates. Documented as a known prototype limitation rather than faked.",
  };
}

function runFullEvalSuite() {
  return {
    eval0: runEval0(),
    cases: [
      runCase1(),
      runCase2(),
      runCase3(),
      runCase4(),
      runCase5(),
      runCase6(),
      runCase7(),
      runCase8(),
      runCase9(),
      runCase10(),
    ],
  };
}

function renderAll() {
  renderRail();
  renderUserAvatarButton();
  renderUserMenu();
  renderChatsList();
  renderTeamsList();
  renderMessages();
}

// ---- New chat modal ----

function openNewChatModal() {
  const currentUserId = getCurrentUserId();
  participantPicker.innerHTML = "";

  USERS.filter((u) => u.id !== currentUserId).forEach((user) => {
    const row = document.createElement("label");
    row.className = "picker-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = user.id;
    const avatar = avatarSpan(user, "picker-avatar");
    const name = document.createElement("span");
    name.textContent = user.name;
    row.append(checkbox, avatar, name);
    participantPicker.appendChild(row);
  });

  newChatModal.classList.remove("hidden");
}

function closeNewChatModal() {
  newChatModal.classList.add("hidden");
}

function handleStartNewChat() {
  const selectedIds = Array.from(
    participantPicker.querySelectorAll("input[type=checkbox]:checked")
  ).map((el) => el.value);

  if (selectedIds.length === 0) return;

  const chat = createChat([getCurrentUserId(), ...selectedIds]);
  setSelectedConversation("chat", chat.id);
  setCurrentView("chats");
  closeNewChatModal();
  renderAll();
}

// ---- Eval Console ----

function pillEl(pass) {
  const pill = document.createElement("span");
  pill.className = "eval-pill " + (pass ? "eval-pill-pass" : "eval-pill-fail");
  pill.textContent = pass ? "PASS" : "FAIL";
  return pill;
}

function pct(n) {
  return `${Math.round(n * 100)}%`;
}

function renderEvalResults(suite) {
  evalResults.innerHTML = "";

  const { eval0, cases } = suite;
  const allPass = eval0.pass && cases.every((c) => c.pass);

  const summary = document.createElement("div");
  summary.className = "eval-overall-summary";
  summary.append(pillEl(allPass));
  const summaryText = document.createElement("span");
  const casePasses = cases.filter((c) => c.pass).length;
  summaryText.textContent = ` Eval 0 ${eval0.pass ? "passed" : "failed"} its bar, and ${casePasses}/${cases.length} scenario cases passed.`;
  summary.appendChild(summaryText);
  evalResults.appendChild(summary);

  const eval0Section = document.createElement("div");
  eval0Section.className = "eval-section";
  const eval0Heading = document.createElement("div");
  eval0Heading.className = "eval-section-heading";
  eval0Heading.append(pillEl(eval0.pass));
  const eval0Title = document.createElement("strong");
  eval0Title.textContent = " Eval 0 — Classifier accuracy";
  eval0Heading.appendChild(eval0Title);
  eval0Section.appendChild(eval0Heading);

  const stats = document.createElement("div");
  stats.className = "eval-stats";
  stats.textContent = `${eval0.total} labeled messages · accuracy ${pct(eval0.accuracy)} (bar: ≥90%) · false positives ${pct(
    eval0.falsePositiveRate
  )} (bar: ≤5%) · false negatives ${pct(eval0.falseNegativeRate)}`;
  eval0Section.appendChild(stats);

  if (eval0.misclassified.length > 0) {
    const list = document.createElement("ul");
    list.className = "eval-miss-list";
    eval0.misclassified.forEach((m) => {
      const li = document.createElement("li");
      li.textContent = `${m.predicted ? "False positive" : "False negative"} — "${m.text}"`;
      list.appendChild(li);
    });
    eval0Section.appendChild(list);
  }
  evalResults.appendChild(eval0Section);

  cases.forEach((c) => {
    const section = document.createElement("div");
    section.className = "eval-section";
    const heading = document.createElement("div");
    heading.className = "eval-section-heading";
    heading.append(pillEl(c.pass));
    const title = document.createElement("strong");
    title.textContent = ` ${c.title}`;
    heading.appendChild(title);
    section.appendChild(heading);

    const detail = document.createElement("div");
    detail.className = "eval-stats";
    detail.textContent = c.detail;
    section.appendChild(detail);

    if (c.note) {
      const note = document.createElement("div");
      note.className = "eval-note";
      note.textContent = c.note;
      section.appendChild(note);
    }

    evalResults.appendChild(section);
  });
}

function openEvalConsole() {
  evalConsoleModal.classList.remove("hidden");
}

function closeEvalConsoleModal() {
  evalConsoleModal.classList.add("hidden");
}

// ---- Events ----

railChats.addEventListener("click", () => {
  setCurrentView("chats");
  searchTerm = "";
  searchInput.value = "";
  renderAll();
});

railTeams.addEventListener("click", () => {
  setCurrentView("teams");
  searchTerm = "";
  searchInput.value = "";
  renderAll();
});

userSwitcherBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  userMenu.classList.toggle("hidden");
});

document.addEventListener("click", () => {
  userMenu.classList.add("hidden");
});

userMenu.addEventListener("click", (e) => e.stopPropagation());

searchInput.addEventListener("input", (e) => {
  searchTerm = e.target.value;
  if (getCurrentView() === "chats") renderChatsList();
  else renderTeamsList();
});

newChatBtn.addEventListener("click", openNewChatModal);
cancelNewChat.addEventListener("click", closeNewChatModal);
startNewChat.addEventListener("click", handleStartNewChat);
newChatModal.addEventListener("click", (e) => {
  if (e.target === newChatModal) closeNewChatModal();
});

evalConsoleBtn.addEventListener("click", openEvalConsole);
closeEvalConsole.addEventListener("click", closeEvalConsoleModal);
runEvalSuiteBtn.addEventListener("click", () => {
  renderEvalResults(runFullEvalSuite());
});
evalConsoleModal.addEventListener("click", (e) => {
  if (e.target === evalConsoleModal) closeEvalConsoleModal();
});

messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  const selected = getSelectedConversation();
  const senderUserId = getCurrentUserId();
  const pool = getConversationParticipants(selected);

  if (selected.type === "channel") {
    // A new post is its own topic: the bot's reply threads under it, and
    // gets a fresh responder pick (empty history) rather than continuing
    // whatever the last post's thread happened to be about.
    const post = addMessage(selected.id, senderUserId, text, null);
    messageInput.value = "";
    renderAll();
    const nudged = maybeTriggerNudge(selected.id, post.id, senderUserId, text, null);
    if (!nudged) {
      triggerAutoReply(selected.id, post.id, senderUserId, text, pool, []);
    }
  } else {
    addMessage(selected.id, senderUserId, text, null);
    messageInput.value = "";
    renderAll();
    triggerAutoReply(
      selected.id,
      null,
      senderUserId,
      text,
      pool,
      getMessages(selected.id)
    );
  }
});

// Keep tabs/windows in sync if data changes in another tab
window.addEventListener("storage", (e) => {
  if ([STORAGE_KEY, CHATS_KEY].includes(e.key)) {
    renderChatsList();
    renderMessages();
  }
  if ([SELECTED_CONV_KEY, CURRENT_USER_KEY, CURRENT_VIEW_KEY].includes(e.key)) {
    renderAll();
  }
});

renderAll();
sweepExpiredNudges();
setInterval(sweepExpiredNudges, 30000);
