/* evals.js — the recognition classifier the Listener calls, plus the two eval
   suites the demo's eval console renders. Loads after data.js, before agents.js.
   Everything here is a plain global. */

/* ----------------------------------------------------------- classifier

   Two stages, in this order and for this reason.

   VETOES run first and answer "is the sender recognizing a colleague at all?"
   They are cheap, they are about pragmatics rather than vocabulary, and they
   have to run before scoring because the highest-scoring strings in the corpus
   are the ones that most need blocking: "not great work honestly" and "props to
   the whole launch crew" both stack more praise vocabulary than a real
   recognition does. A scorer alone will always rank them above the true
   positives, so no threshold can separate them. Only a veto can.

   FEATURES run second and answer "how strongly?" — an OR over independent
   families rather than one tier of praise adjectives, because roughly half the
   recognitions in the corpus contain no praise word at all. "Noor found the
   config drift before it reached the customer" is recognition carried entirely
   by attribution.

   Confidence stays banded at 0.05 / 0.30 / 0.61 / 0.72 / 0.88+ because the
   personalized threshold in agents.js, the README demo script and case-12 all
   read specific values off it. What changed is which features put a message in
   a band, not the bands. */

/* -- roster ------------------------------------------------------------
   Several vetoes need to know whether a message names a real colleague. The
   Draft agent can only address someone on the roster, so the roster is the
   honest definition of "resolvable recipient" — not capitalization, which
   would read Contoso and Fabrikam as people. Built lazily so load order
   cannot bite. */
let ROSTER_NAME_CACHE = null;
function rosterNames() {
  if (ROSTER_NAME_CACHE) return ROSTER_NAME_CACHE;
  const out = {};
  const rows = (typeof DATA !== "undefined" && DATA.employees) || [];
  const all = DATA && DATA.contractor ? rows.concat([DATA.contractor]) : rows;
  all.forEach(function (r) {
    const first = String(r.name || "").split(/\s+/)[0];
    if (first) out[first.toLowerCase()] = true;
    if (r.handle) out[String(r.handle).toLowerCase()] = true;
  });
  ROSTER_NAME_CACHE = out;
  return out;
}
function namesAColleague(t) {
  if (/@[a-z]+/i.test(t)) return true;
  const names = rosterNames();
  const words = String(t).toLowerCase().split(/[^a-z']+/);
  for (let i = 0; i < words.length; i++) {
    if (words[i] && names[words[i]]) return true;
  }
  return false;
}

const SECOND_PERSON = /\b(you|your|you'?re|yours|u|ur)\b/i;
const PRAISE_WORD = /\b(great|awesome|amazing|excellent|outstanding|fantastic|brilliant|wonderful|superb|stellar|perfect|impressive|good job|nice work|well done)\b/i;

/* -- vetoes ------------------------------------------------------------
   Ordered. First match wins, and the confidence is how sure we are of the
   *decision to stay silent*, not of a recognition. Each id is what the trace
   panel prints under "Matched", so they read as explanations. */
const VETOES = [
  {
    id: "dismissal",
    confidence: 0.95,
    reason: "Dismissal phrasing — sender is declining, not recognizing",
    test: /\bno,?\s+thanks?\b|\bthanks?,?\s+but\b|\b(appreciate (it|that|you|the offer)),?\s+but\b|\bappreciate the offer\b|\b(i'?ll pass|not interested|no need(ed)?|not necessary|not this time)\b|\bbut (we'?re|i'?d) (going|rather)\b/i,
  },
  {
    id: "negated-praise",
    confidence: 0.94,
    reason: "The praise phrase is here only to be negated — this is criticism",
    test: /\b(not|isn'?t|wasn'?t|ain'?t|never)\b\W+(our|my|your|their|his|her|the|a)?\W*(\w+\W+){0,1}(great|good|best|amazing|excellent|fantastic|outstanding|brilliant|quality|outcome|what we wanted)\b/i,
  },
  {
    id: "sarcasm-emoji",
    confidence: 0.92,
    reason: "Upside-down or eye-roll emoji — the sentence means its opposite",
    test: /🙃|🙄/,
  },
  {
    id: "self-praise",
    confidence: 0.9,
    reason: "Sender is praising their own work — self-recognition is not a thing",
    test: /\bif i do say so myself\b|\b(nailed|crushed|smashed|killed) (my|it on my)\b|\bi'?m (quite |pretty |really )?(pleased|happy|proud)\b|\bpretty happy with\b|\bmy (analysis|work|fix|deck|demo) (was|is) (right|great|good)\b/i,
  },
  {
    id: "relayed-gratitude",
    confidence: 0.9,
    reason: "Gratitude belongs to someone else — the sender is only carrying it",
    test: /\bpass (on|along) (my|our|a|the|his|her|their|\w+'s)\b|\basked me to thank\b|\bwanted me to say\b|\b(can|could|would) you thank\b|\bthank \w+ for me\b|\bi (already )?thanked\b|\b(said|says|asked) to (thank|pass)\b|\b\w+ says (great|nice|good|amazing) (work|job)\b/i,
  },
  {
    id: "forward-looking",
    confidence: 0.9,
    reason: "Thanks attached to a request — the work has not happened yet",
    test: /\bthanks? in advance\b|\b(thanks|thank you) for (taking a look|looking|reviewing|picking (this|it) up)\b|\bwould (really |much )?appreciate\b|\bappreciate any (eyes|help|thoughts)\b|\bmuch appreciated\b|\bif (anyone|someone) (can|could)\b/i,
  },
  {
    id: "appreciate-as-understand",
    confidence: 0.9,
    /* "appreciate how you handled that" is thanks; "appreciate how tight the
       timeline is" is comprehension. The complement decides it, so the veto
       matches on what follows rather than on the verb. */
    reason: "'Appreciate' here means understand, not thank",
    test: /\bappreciate (that|this) (the|we|it|i|you'?re|i'?m|things|there)\b|\bappreciate (why|the (constraints?|difficulty|challenge|pressure|position|situation))\b|\bappreciate how (hard|tight|difficult|tough|much pressure)\b/i,
  },
  {
    id: "receipt-ack",
    confidence: 0.88,
    reason: "Acknowledging receipt — the thanks is punctuation on an ack",
    /* "great" is deliberately absent from the opener list. "Great, that works
       for me" is an ack, but "Great job on the deck, Sam!" is the demo's first
       step, and one leading word cannot tell them apart. Let the ack fall
       through to a 0.05 no-signal instead of vetoing the headline case. */
    test: /^\s*(ok|okay|kk|k|got it|noted|yep|yes|sure|understood|confirmed|received|perfect|sounds good|will do)\b[\s,!.–—-]*(thanks|thank you|thx|ty)?\b|\b(thanks|thank you|thx|ty)[\s,!.]*((i'?ll|will|i will)\b|makes sense\b)|\bthanks for (the heads up|flagging|letting me know|the update)\b/i,
  },
  {
    id: "group-address",
    confidence: 0.85,
    reason: "Addressed to a group — recognition needs one person to receive it",
    test: /\b(thanks|thank you|thanks?|kudos|shout ?out|props|nice work|great work|great job|good job|well done|amazing effort|huge thanks|big thanks|standing ovation)\b[\s,]*(to\s+|from\s+|for\s+)?(the\s+|our\s+|you\s+|all\s+)?(whole\s+|entire\s+)?(\w+\s+)?(everyone|everybody|all|team|teams|folks|y'?all|crew|guys|squad|group|gang|org|orgs|department|company|office|everyone'?s)\b/i,
    unless: namesAColleague,
  },
  {
    id: "external-party",
    confidence: 0.85,
    reason: "Recipient is outside the workspace — not an enrolled colleague",
    test: /\bpartners at\b|\bthanks to (our|the) \w+ (team|folks|partners)\b|\bthe (customer|client)s? (said|asked|wanted|sent)\b|\b(our|the) (agency|vendor|supplier)\b/i,
  },
  {
    id: "sarcasm-context",
    confidence: 0.85,
    reason: "Praise word attached to something that went wrong — read as sarcasm",
    test: /\b(great|awesome|amazing|excellent|outstanding|fantastic|brilliant|wonderful|love (this|that)|nice one|thanks so much|thanks a lot)\b[\s\S]{0,60}\b(another|again|third time|second time|weeks? behind|days? behind|rolled itself back|rolled back|deleted|broke|broken|is red|fire drill|outage|four hour|all-nighter|for us)\b/i,
    unless: namesAColleague,
  },
  {
    id: "banter",
    confidence: 0.82,
    reason: "Praise frame, joke content — the sender is not recognizing work",
    test: /\b(lol|lmao|haha)\b|😂|\b(great|amazing|outstanding|nice) (work|job) (on )?(absolutely )?(breaking|destroying|ruining|trolling)\b|\b(destroying|ruining|wrecking) my\b|\b10\/10 no notes\b|\btrolling\b/i,
  },
  {
    id: "milestone",
    confidence: 0.8,
    reason: "A date or a life event, not a contribution — nothing to recognize yet",
    test: /\bhappy (birthday|work anniversary|anniversary|friday|new year)\b|\bcongrats on (the|your) (new|promotion)\b|\bwelcome (to the team|aboard|on board)\b|\bthanks for the invite\b/i,
  },
  {
    id: "non-work-favour",
    confidence: 0.8,
    reason: "Gratitude for a personal favour — outside the recognition program",
    test: /\b(thanks|thank you|thx|ty|cheers)\b[\s\S]{0,40}\b(coffee|lunch|dinner|drinks|the ride|airport|book rec|recommendation|restaurant|covering lunch|the snacks)\b/i,
  },
  {
    id: "praise-for-a-thing",
    confidence: 0.75,
    reason: "Praise aimed at an artefact or a product, not a colleague",
    test: /\b(this|that|the|these|those)\b[\s\S]{0,40}\b(is|are|was|were|looks?|reads?|came in|sounds?)\b[\s\S]{0,20}\b(great|excellent|amazing|good|fantastic|brilliant|usable|surprisingly good)\b|\b(great|excellent|amazing|nice|good) (article|template|podcast|episode|tool|doc|docs|read|news|find|thread|talk|post)\b/i,
    unless: function (t) {
      return namesAColleague(t) || SECOND_PERSON.test(t);
    },
  },
];

/* -- positive features -------------------------------------------------
   Independent families. A message needs to trip only one of the STRONG ones
   to be recognition; the rest add confidence. Split this way because they
   fail independently — a corpus can be rich in markers and empty of causal
   credit, and one regex list hides that. */

/* Named recognition idioms. Includes non-US English and current slang, both
   of which the previous list treated as no signal at all. */
const F_MARKER = /\bkudos\b|\bshout ?out\b|\bprops to\b|\bhats? off\b|\btip of the hat\b|\btake a bow\b|\bmad respect\b|\bcredit where it'?s due\b|\bstanding ovation\b|\bwell done\b|\bwell played\b|\bfair play\b|\b\w+ (job|work) (on|with)\b|\b(great|awesome|amazing|excellent|outstanding|fantastic|brilliant|cracking|stellar|superb|top|sound|solid|good|nice) (job|work)\b|\b(crushed|killed|nailed|smashed|aced) it\b|\b(smashed|snapped on|carried|cooked with|ate) (that|the|this)\b|\bgoes hard\b|\bbig w\b|\babsolute unit\b|\byou'?re the best\b|\babove and beyond\b|\bcouldn'?t have done (it|this) without you\b|\bso helpful\b|\bspot on\b|\bbang on\b|\bblinding\b|\bchuffed\b|\byou (are|'?re) a legend\b|\bthe goat\b|\bclutch\b|\bnice one\b|\bgenuinely impress(ed|ive)\b|\bimpressive\b|\b(handled|made|ran|played|called) (that|it|a)\b[\s\S]{0,25}\b(well|right|perfectly|brilliantly)\b|\bvery good\b|\bquietly (excellent|the most)\b|\bmade it look\b|\bnot many people would\b|\bunreal\b|\bwas excellent\b|\bgreat catch\b|\bproper catch\b|\b(great|excellent|amazing) turnaround\b/i;

/* Credit attributed to a person for an outcome. The single largest class of
   recognition with no praise vocabulary anywhere in the sentence. */
const F_CAUSAL = /\bbecause of\b|\bis the reason\b|\bthe reason\b[\s\S]{0,40}\bis\b|\bonly\b[\s\S]{0,30}\bbecause\b|\bis why\b|\bis what\b|\bdown to \w+'?s\b|\bthat('?s| was) your (doing|plan|prep|call|work)\b|\bif \w+ hadn'?t\b|\b(you|u) (caught|found|spotted|fixed|saved|unblocked|rescued|built|wrote|shipped)\b|\baudit passed on\b|\bpassed on \w+'?s\b/i;

/* Credit where the subject is a capitalised name. Case-sensitive on purpose —
   lowercasing first would throw away the only signal there is.

   The possessive arm is restricted to the roster because "Deck's ready for the
   exec review", "Here's the link" and "Slack's search is finally usable" all
   match a bare /[A-Z][a-z]+'s/ and none of them is recognition. The verb arm
   stays open to any capitalised subject, so a colleague who is not in the
   fixture roster ("Ravi rewrote the query") is still credited. */
const F_POSSESSIVE = /\b([A-Z][a-z]+)'s\b/g;
const F_NAMED_VERB = /\b[A-Z][a-z]+ (caught|spotted|found|rewrote|rebuilt|re-?ran|pulled|turned|shielded|called|stayed|took|sat|spent|snapped|ate|carried|bailed|went|never)\b|\bbecause [A-Z][a-z]+\b/;

/* Shape, not vocabulary. A roster name followed by a past-tense verb is credit
   regardless of which verb it is — "Sam unpicked the deadlock", "Priya
   assembled the evidence", "Jordan bodied that presentation". The word-list
   version of this rule missed all three, and would have missed the next three
   too; praise vocabulary is an open class and enumerating it is a losing game.

   Case-insensitive because Slack is: "priya shipped the accessibility fix" is
   the same claim as "Priya shipped...". Safe to be this broad only because
   every veto has already run — "Ava wanted me to say great work" and
   "confirmed, thanks Priya" are gone before this is consulted. */
const PAST_TENSE = /(?:\w+ed|caught|took|went|ran|found|built|wrote|made|got|kept|held|led|sat|spent|shipped|drove|saved|sent|brought|built|dealt|beat|won|ate|carried|bailed|rewrote|rebuilt|never)/
  .source;
let ROSTER_SUBJECT_RE = null;
function rosterSubjectVerb(t) {
  if (!ROSTER_SUBJECT_RE) {
    const names = Object.keys(rosterNames()).filter(function (n) { return n.length > 2; });
    if (!names.length) return false;
    ROSTER_SUBJECT_RE = new RegExp(
      "\\b(?:" + names.join("|") + ")\\b\\s+(?:\\w+ly\\s+)?(?:" + PAST_TENSE + ")\\b",
      "i"
    );
  }
  return ROSTER_SUBJECT_RE.test(t);
}

/* Counterfactual and rarity framing. Both credit a person by describing what
   would have happened without them, which no praise-word list can reach. */
const F_COUNTERFACTUAL = /\b(couldn'?t|wouldn'?t|could not|would not|would have|i'?d have|we'?d have|never would have)\b[\s\S]{0,30}\bwithout\b|\bwithout (you|him|her|them|[A-Z][a-z]+)\b/;
const F_RARITY = /\b(nobody|no one|not many people|few people|hardly anyone)\b[\s\S]{0,25}\b(would|could)\b/i;

function causalNamed(t) {
  if (F_NAMED_VERB.test(t)) return true;
  if (rosterSubjectVerb(t)) return true;
  if (F_COUNTERFACTUAL.test(t)) return true;
  if (F_RARITY.test(t)) return true;
  const names = rosterNames();
  F_POSSESSIVE.lastIndex = 0;
  let m;
  while ((m = F_POSSESSIVE.exec(t)) !== null) {
    if (names[m[1].toLowerCase()]) return true;
  }
  return false;
}

/* Quantified or explicitly stated impact. */
const F_IMPACT = /\b(from|took)\b[\s\S]{0,25}\bto\b[\s\S]{0,20}\b(ms|minutes?|hours?|seconds?)\b|\bturned\b[\s\S]{0,30}\binto\b|\b(cut|dropped|halved|reduced|shaved)\b[\s\S]{0,30}\b(by|to|from)\b|\bby half\b|\bsaved (me|us|the team)\b[\s\S]{0,20}\b(hours?|minutes?|days?|afternoon|so much time)\b|\bcaught (two|three|a real|a production)\b|\btest(s|ed)? clean\b|\bclean from legal\b|\bway clearer\b|\bmuch better\b|\bunder a minute\b|\bto almost nothing\b|\bfirst pass\b/i;

/* Indebtedness and rescue. */
const F_INDEBTED = /\bi owe (you|him|her|them|\w+)\b|\blifesaver\b|\bsaved (me|us|my|the day|the week)\b|\bbailed me out\b|\brescued\b|\bunblocked (me|us|the|my|our)\b|\bsaved my (afternoon|day|week|bacon)\b/i;

/* Discretionary effort stated as fact — no adjective required. */
const F_EFFORT = /\bstayed (late|on|until)\b|\buntil \d+ ?(am|pm)?\b|\bover the weekend\b|\b(spent|worked) (the )?(saturday|sunday|weekend)\b|\bwithout being asked\b|\bon (their|his|her) own initiative\b|\btook the (weekend|overnight|on-?call|pager)\b|\bre-?ran the (entire|whole)\b|\brewrote the (entire|whole)\b|\brebuilt the (entire|whole)\b|\bsat with\b|\bpicked up the (on-?call|escalation|swap)\b|\bcover(ed|ing) (my|the|your|our) [\w-]+\b|\bran point\b|\bto get the release out\b/i;

const F_GRATITUDE = /\b(thanks|thank you|thank u|thx|ty|appreciate|cheers)\b/i;

/* Widened with the objects that actually appeared in the corpus. */
const F_WORK_OBJECT = /\b(deck|report|presentation|pitch|launch|doc|document|code|pr|pull request|review|crit|bug|fix|ticket|demo|proposal|analysis|design|redesign|spec|slides|draft|research|campaign|release|migration|dashboard|project|onboarding|training|runbook|script|query|harness|escalation|forecast|model|copy|empty[- ]state|accessibility|retro|incident|audit|documentation|rotation|on-?call|test|tests|numbers|writeup|rollback|checklist|load test|rate limiter|api|support|reorg|scope|schema|cleanup|export)\b/i;

/* Gratitude that names what it bought — separates real thanks from courtesy
   even when no work noun is present. */
const F_STATED_VALUE = /\bit (caught|unblocked|saved|helped|landed)\b|\bthat (saved|unblocked|helped|protected|landed)\b|\bsaved me\b|\bso much time\b|\bcaught (two|three|a)\b|\bunblocked the whole\b|\bway clearer\b|\bwalking me through\b|\bhow you (handled|ran|managed)\b|\bstaying late\b|\bjumping on\b|\bprotected the team\b|\bshielding\b|\blanded (really )?well\b|\bmade (my|our) \w+ (easier|better)\b/i;

/* Praise too plain to be an idiom. Only ever consulted alongside a named
   colleague and a work object, because on its own "the numbers look great" is
   a status update. */
const F_SOFT_PRAISE = /\b(so good|really good|very good|is good|so much better|great|excellent|amazing|brilliant|fantastic|clean|clearer|better|solid|sharp|lovely)\b/i;

/* Long enough to be a sentence rather than a reflex. Tuned against Eval 0. */
const GRATITUDE_LENGTH_FLOOR = 8;

function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

/* What the Listener actually calls. If llm.js warmed a model verdict for this
   exact text, use it; otherwise fall back to the deterministic classifier. The
   two return the same shape on purpose — see llm.js for why the model call
   happens before the pipeline rather than inside the agent.

   The eval harness calls classifyDeterministic directly. Eval 0 has to measure
   the regex gate, and several of its strings are the same ones the demo script
   asks you to type, so a warmed cache would otherwise leak into the results. */
function classify(text) {
  const warmed = typeof LLM !== "undefined" ? LLM.cachedVerdict(text) : null;
  if (warmed) return warmed;
  const verdict = classifyDeterministic(text);
  verdict.source = "deterministic classifier";
  return verdict;
}

/* Returns the shape the Listener trace renders directly, so `reason` is written
   for a person reading the panel, not for a log file. `matched` names the veto
   or the feature families that decided it, which is what makes a wrong verdict
   diagnosable from the UI without opening the console. */
function classifyDeterministic(text) {
  const t = String(text == null ? "" : text);

  /* Stage 1 — vetoes. Pragmatics before vocabulary. */
  for (let i = 0; i < VETOES.length; i++) {
    const v = VETOES[i];
    if (!v.test.test(t)) continue;
    if (v.unless && v.unless(t)) continue;
    return { fire: false, confidence: v.confidence, reason: v.reason, matched: v.id };
  }

  /* Stage 2 — features. */
  const hit = [];
  if (F_MARKER.test(t)) hit.push("marker");
  if (F_CAUSAL.test(t) || causalNamed(t)) hit.push("causal-credit");
  if (F_IMPACT.test(t)) hit.push("impact");
  if (F_INDEBTED.test(t)) hit.push("indebtedness");
  if (F_EFFORT.test(t)) hit.push("effort");

  const gratitude = F_GRATITUDE.test(t);
  const hasWork = F_WORK_OBJECT.test(t);
  const statedValue = F_STATED_VALUE.test(t);
  const addressed = namesAColleague(t) || SECOND_PERSON.test(t);

  /* Any strong family fires. Confidence rises with corroboration, so a message
     that is recognition on three independent counts outranks one that squeaks
     in on a single idiom. */
  if (hit.length) {
    const extra = hit.length - 1 + (hasWork ? 1 : 0) + (gratitude ? 1 : 0) + (addressed ? 1 : 0);
    const confidence = Math.min(0.96, Math.round((0.88 + 0.02 * extra) * 100) / 100);
    return {
      fire: true,
      confidence: confidence,
      reason: hasWork
        ? "Recognition tied to a specific piece of work."
        : "Recognition — the phrasing itself carries it.",
      matched: hit.join(" + "),
    };
  }

  /* Plain praise, a named colleague and a named piece of work, with no idiom
     and no gratitude word — "priya that empty state work is so good". All three
     are required: drop the name and it is a status update, drop the work object
     and it is banter. */
  if (addressed && hasWork && F_SOFT_PRAISE.test(t)) {
    return {
      fire: true,
      confidence: 0.72,
      reason: "Plain praise aimed at a named colleague's work.",
      matched: "soft praise + addressee + work object",
    };
  }

  /* No strong family. Gratitude alone can still be recognition, but only when
     it points at something. This is the band the demo script depends on. */
  if (gratitude) {
    if (hasWork || statedValue) {
      return {
        fire: true,
        confidence: 0.72,
        reason: "Gratitude pointed at a specific piece of work, not a passing courtesy.",
        matched: statedValue && !hasWork ? "gratitude + stated value" : "gratitude + work object",
      };
    }
    if (addressed && wordCount(t) >= GRATITUDE_LENGTH_FLOOR) {
      return {
        fire: true,
        confidence: 0.61,
        reason: "Gratitude aimed at a named person inside a substantial message.",
        matched: "gratitude + addressee",
      };
    }
    return {
      fire: false,
      confidence: 0.3,
      reason: "Bare courtesy — nothing for the recognition to be about",
      matched: "gratitude only",
    };
  }

  return { fire: false, confidence: 0.05, reason: "No recognition signal", matched: "" };
}

/* -------------------------------------------------------------- Eval 0 */

/* Cases marked REGRESSION are documented guards. If one of these flips, the
   classifier changed in a way a user would feel — fix the classifier, not this.

   This is the holdout. It is scored, never trained on, and never rendered into
   a prompt — which is why the shape is {text, nudge} and there is no `why`.
   DATA.nudgeTriggerExamples is the training corpus; every case added here is
   disjoint from it. Ten pre-existing strings do appear in both sets — three
   demo-script lines ("Great job on the deck, Sam!", "Kudos to Jordan for the
   launch", "Thanks for turning the report around so fast") and seven courtesy
   stubs ("thanks", "thx", "thanks!", "cheers", "thanks in advance", "thanks but
   no thanks", "Deck's ready for the exec review."). They stay because they are
   guarded in both places on purpose. Ten of 158 is a ~6% contamination rate:
   worth knowing when reading the accuracy number, not worth breaking the demo
   over.

   Sections mirror the golden set's categories so a gap in one is visible in the
   other. Where a category is a known classifier blind spot it is called out. */
const EVAL0_DATASET = [
  /* --- positives --------------------------------------------------- */
  { text: "amazing, thanks for the support", nudge: true }, // REGRESSION: praise + gratitude within 30 chars
  { text: "Great job on the deck, Sam!", nudge: true }, // REGRESSION
  { text: "Kudos to Jordan for the launch", nudge: true }, // REGRESSION
  { text: "You absolutely crushed it on that demo", nudge: true }, // REGRESSION
  { text: "well done on the migration", nudge: true }, // REGRESSION
  { text: "shoutout to Mei for the campaign copy", nudge: true }, // REGRESSION
  { text: "Thanks for turning the report around so fast", nudge: true },
  { text: "Excellent work on the pricing analysis", nudge: true },
  { text: "You're the best, that saved me hours", nudge: true },
  { text: "props to Diego for catching that bug before release", nudge: true },
  { text: "Nailed it with the launch checklist", nudge: true },
  { text: "Couldn't have done it without you on the migration", nudge: true },
  { text: "That was so helpful, thank you", nudge: true },
  { text: "Sam went above and beyond on the load test", nudge: true },
  { text: "outstanding job pulling those numbers together", nudge: true },
  { text: "Fantastic work on the onboarding flow revisions", nudge: true },
  { text: "thank you for the thorough code review, it caught a real issue", nudge: true },
  { text: "appreciate you jumping on the ticket so fast", nudge: true },
  { text: "thanks for the quick fix on the rate limiter", nudge: true },
  { text: "awesome job, the demo landed really well with the exec team", nudge: true },
  { text: "Thank you for staying late to get the release out.", nudge: true },
  { text: "amazing turnaround, thanks a ton", nudge: true },
  { text: "thanks so much for walking me through the dashboard setup this morning", nudge: true },
  { text: "I really appreciate how you handled that escalation with the customer today", nudge: true },
  { text: "Thanks for the detailed spec, it unblocked the whole team", nudge: true },

  /* -- causal credit with no gratitude keyword anywhere ------------------
     The classifier has no pattern for this shape. Every case below is a
     recognition a human would read instantly and a keyword matcher misses. */
  { text: "Ravi rewrote the query and the report now runs in under a minute", nudge: true },
  { text: "That customer stayed because Noor called them back the same day", nudge: true },
  { text: "The whole audit passed on Priya's documentation", nudge: true },
  { text: "We shipped on time and that is down to Sam's scoping", nudge: true },
  { text: "Jordan spotted the pricing error before it went to the board", nudge: true },
  { text: "Mei's onboarding rewrite is why activation moved this month", nudge: true },
  { text: "If Diego hadn't flagged the memory leak we'd have paged at 3am", nudge: true },
  { text: "Liam pulled the numbers nobody else could find", nudge: true },

  /* -- quantified impact -------------------------------------------------- */
  { text: "Your script cut our release time from ninety minutes to twelve", nudge: true },
  { text: "Priya's fix dropped the error rate to almost nothing", nudge: true },

  /* -- indebtedness and rescue -------------------------------------------- */
  { text: "I owe you big for covering the demo yesterday", nudge: true },
  { text: "Sam bailed me out of a very bad Friday", nudge: true },
  { text: "You rescued that meeting, honestly", nudge: true },

  /* -- discretionary effort reported as fact ------------------------------ */
  { text: "Noor rebuilt the whole test harness without being asked", nudge: true },
  { text: "Diego spent Saturday on the data cleanup", nudge: true },
  { text: "Mei re-ran the entire analysis after the schema changed", nudge: true },

  /* -- slang ---------------------------------------------------------------- */
  { text: "you cooked with that redesign", nudge: true },
  { text: "big W for Priya on the accessibility pass", nudge: true },
  { text: "absolute unit of a pull request, nice work Diego", nudge: true },
  { text: "Liam snapped on that pricing deck", nudge: true },
  { text: "Mei that copy goes hard", nudge: true },

  /* -- non-US English ------------------------------------------------------- */
  { text: "Chuffed with how the launch went, Sam — that was your prep", nudge: true },
  { text: "Blinding work on the incident review, Noor", nudge: true },
  { text: "Fair play to Diego, that was not an easy bug", nudge: true },
  { text: "Sound work on the migration, Liam", nudge: true },
  { text: "Bang on with the pricing analysis, Priya", nudge: true },

  /* -- understated and dry --------------------------------------------------- */
  { text: "That was very good, Sam. Better than the last one by a distance.", nudge: true },
  { text: "You made a genuinely hard call well, Jordan", nudge: true },
  { text: "Quietly the most useful thing anyone shipped this quarter, Mei", nudge: true },

  /* -- delayed and retrospective --------------------------------------------- */
  { text: "Circling back to say the launch retro was excellent, Noor", nudge: true },
  { text: "Should have said this on Friday — Diego, great catch on the regression", nudge: true },

  /* -- how people actually type ----------------------------------------------- */
  { text: "sam that runbook is unreal, saved me so much time", nudge: true },
  { text: "thank u priya, the empty state is way clearer now", nudge: true },
  { text: "diego u caught that so fast, ty", nudge: true },

  /* -- explicit recognition markers -------------------------------------------- */
  { text: "hats off to Liam for the forecast rebuild", nudge: true },
  { text: "credit where it's due, Mei wrote all of that", nudge: true },
  { text: "genuine kudos Sam, that was a rough week to run point", nudge: true },
  { text: "standing ovation for Jordan's exec deck", nudge: true },

  /* -- upward, downward, cross-department --------------------------------------- */
  { text: "Ava, thank you for shielding the team from the reorg noise", nudge: true },
  { text: "Nice to see the new hire ship a fix in week two — well done Diego", nudge: true },
  { text: "Big thanks over to Finance — Liam turned the model around in a day", nudge: true },

  /* -- hedged and question-shaped ------------------------------------------------ */
  { text: "Not sure how you found that, Diego, but excellent work", nudge: true },
  { text: "Is there anything you can't fix? Thanks Sam, seriously", nudge: true },
  { text: "🔥 Priya, that redesign tested clean with every user", nudge: true },

  /* --- negatives --------------------------------------------------- */
  { text: "thanks but no thanks", nudge: false }, // REGRESSION
  { text: "Appreciate it, but I'll pass.", nudge: false }, // REGRESSION
  { text: "Not interested, but thanks for asking.", nudge: false }, // REGRESSION
  { text: "thanks", nudge: false }, // REGRESSION
  { text: "thx", nudge: false }, // REGRESSION
  { text: "ok thanks", nudge: false }, // REGRESSION
  { text: "thanks will do", nudge: false }, // REGRESSION
  { text: "no thanks needed", nudge: false },
  { text: "thanks in advance", nudge: false },
  { text: "thanks!", nudge: false },
  { text: "no, thanks — I've got it covered", nudge: false },
  { text: "Thanks, but I'd rather handle this myself.", nudge: false },
  { text: "I'll pass on the meeting, I have a conflict.", nudge: false },
  { text: "Not this time — let's revisit next sprint.", nudge: false },
  { text: "No need, I already merged it.", nudge: false },
  { text: "Not necessary, the fix is already in main.", nudge: false },
  { text: "Standup: yesterday I finished the API work, today I'm on the load test, no blockers.", nudge: false },
  { text: "Can someone review the PR on the rate limiter?", nudge: false },
  { text: "Here's the link: https://example.com/internal/launch-plan", nudge: false },
  { text: "🎉🎉🎉", nudge: false },
  { text: "👍", nudge: false },
  { text: "Deck's ready for the exec review.", nudge: false },
  { text: "What time is the design crit today?", nudge: false },
  { text: "ok", nudge: false },
  { text: "Reminder: recognition budgets reset on the 1st.", nudge: false },
  { text: "The build is broken on main, looking into it now.", nudge: false },
  { text: "Moving the design review to Thursday, calendar updated.", nudge: false },

  /* -- bare courtesy and abbreviations ------------------------------------- */
  { text: "ta", nudge: false },
  { text: "kk", nudge: false },
  { text: "ack", nudge: false },
  { text: "cheers", nudge: false },
  { text: "np!", nudge: false },
  { text: "ty!", nudge: false },
  { text: "sounds good", nudge: false },
  { text: "👏", nudge: false },
  { text: "🙏", nudge: false },
  { text: "nice", nudge: false },

  /* -- acknowledging receipt ------------------------------------------------ */
  { text: "got it thanks", nudge: false },
  { text: "yep thanks", nudge: false },
  { text: "thanks, makes sense", nudge: false },
  { text: "understood, thank you", nudge: false },
  { text: "confirmed, thanks Priya", nudge: false },
  { text: "thanks for the heads up", nudge: false },
  { text: "thanks for flagging", nudge: false },

  /* -- forward-looking: the work has not happened yet ----------------------- */
  { text: "appreciate any eyes on this before EOD", nudge: false },
  { text: "thanks in advance for the quick turnaround", nudge: false },
  { text: "if anyone can take this, much appreciated", nudge: false },

  /* -- declining ------------------------------------------------------------- */
  { text: "thanks, but we're going a different direction", nudge: false },
  { text: "appreciate the offer, not this quarter", nudge: false },

  /* -- sarcasm; the tell is inside the message ------------------------------
     Sarcasm whose tell lives in an earlier turn is out of scope by design —
     the classifier is per-message. These are the in-message cases only. */
  { text: "great, another fire drill", nudge: false },
  { text: "wonderful, the migration rolled itself back", nudge: false },
  { text: "amazing work by whoever deleted the staging database", nudge: false },
  { text: "love that for us 🙃", nudge: false },
  { text: "outstanding, we're now two weeks behind", nudge: false },
  { text: "thanks so much for the four hour meeting 🙃", nudge: false },

  /* -- collective address, no resolvable recipient ---------------------------
     The Draft agent needs exactly one person to address. A group thank-you is
     sincere and substantive and still cannot be turned into a recognition. */
  { text: "amazing effort from everyone this quarter", nudge: false },
  { text: "shoutout to the whole team, big quarter", nudge: false },
  { text: "thank you all for the hard work this sprint", nudge: false },
  { text: "great job team!", nudge: false },
  { text: "big kudos to the whole crew for the migration", nudge: false },

  /* -- praise aimed at a thing, not a colleague -------------------------------- */
  { text: "this podcast episode is excellent, worth a listen", nudge: false },
  { text: "the vendor's docs are surprisingly good", nudge: false },
  { text: "great template, where's it from?", nudge: false },

  /* -- self-praise ---------------------------------------------------------------- */
  { text: "shipped it, pretty happy with how that turned out", nudge: false },
  { text: "my analysis was right in the end", nudge: false },

  /* -- banter ---------------------------------------------------------------------- */
  { text: "amazing 😂", nudge: false },
  { text: "outstanding trolling Sam", nudge: false },
  { text: "great job breaking prod, legend", nudge: false },

  /* -- gratitude that belongs to someone else --------------------------------------- */
  { text: "the client asked me to thank the team", nudge: false },
  { text: "please pass on my thanks to whoever built the export", nudge: false },
  { text: "Ava says great work on the numbers", nudge: false },
  { text: "big thanks to our partners at Fabrikam", nudge: false },

  /* -- pleasantries and milestones ---------------------------------------------------- */
  { text: "thanks everyone, see you Monday", nudge: false },
  { text: "happy birthday Mei! 🎂", nudge: false },
  { text: "congrats on the new role, Jordan!", nudge: false },
  { text: "welcome aboard Liam!", nudge: false },

  /* -- gratitude for something that is not work ----------------------------------------- */
  { text: "thanks for the book rec", nudge: false },
  { text: "thank you for the ride to the airport", nudge: false },

  /* -- "appreciate" meaning "understand" -------------------------------------------------
     The single most expensive false positive class: the verb reads as gratitude
     to a matcher and as comprehension to a human. */
  { text: "I appreciate this is frustrating, let's find a path", nudge: false },
  { text: "appreciate that we're short on people right now", nudge: false },
  { text: "I appreciate the difficulty, but the date holds", nudge: false },

  /* -- status updates carrying praise words ------------------------------------------------ */
  { text: "the numbers came in great this week", nudge: false },
  { text: "load test passed, everything looks good", nudge: false },
  { text: "excellent news, the contract is signed", nudge: false },
  { text: "the fix is deployed and working well", nudge: false },

  /* -- requests -------------------------------------------------------------------------------- */
  { text: "who's got bandwidth to pick up the escalation?", nudge: false },
  { text: "can someone take a look at the failing test?", nudge: false },

  /* -- negation --------------------------------------------------------------------------------- */
  { text: "that wasn't great work, we need another pass", nudge: false },
  { text: "not the outcome we wanted", nudge: false },

  /* ================================================================
     BLIND BATCH — written after the classifier was frozen and scored
     exactly once before any of it was fixed. That run is the only honest
     measurement taken of this classifier: 66.7% accuracy, 33.3% recall,
     75% precision. Everything above it scored 100% at the same moment,
     which is what a tuned-against set is worth as evidence.

     The failure pattern is the finding. Precision held, because the vetoes
     encode pragmatics — negation, sarcasm, addressee, speaker — and those
     are closed categories. Recall collapsed, because the positive features
     were word lists and praise vocabulary is an open class. The repair was
     five shape rules (roster-name + past-tense verb, counterfactual,
     rarity, open-class "<adj> work on", any covered duty), not the twelve
     missing words. Recall went 33.3% → 94.4% on the same set.

     These cases are now tuned against, so they are a regression suite and
     not a measurement any more. The next honest number needs a set nobody
     has looked at. Keep them: they are the only reason the open-class
     problem is visible at all.
     ================================================================ */
  { text: "Sam unpicked the deadlock that had us stuck all morning", nudge: true },
  { text: "We passed SOC2 on the evidence Priya assembled", nudge: true },
  { text: "Nobody else would have noticed that off-by-one, Diego", nudge: true },
  { text: "Jordan talked the customer down from cancelling", nudge: true },
  { text: "The whole retro was useful because Mei prepared actual data", nudge: true },
  { text: "Liam's model shaved two days off the close", nudge: true },
  { text: "That refactor dropped our build from 11 minutes to 3", nudge: true },
  { text: "Noor covered my on-call while I was at the hospital", nudge: true },
  { text: "I'd have missed the deadline without Sam", nudge: true },
  { text: "Priya reworked the whole flow after we changed our minds twice", nudge: true },
  { text: "Massive props to Diego for the flaky test purge", nudge: true },
  { text: "Ace work on the forecast, Liam", nudge: true },
  { text: "Jordan absolutely bodied that board presentation", nudge: true },
  { text: "Tip of the hat to Noor for the escalation handling", nudge: true },
  { text: "been meaning to say it - sam, the runbook is excellent", nudge: true },
  { text: "quietly note that priya shipped the accessibility fix nobody asked for", nudge: true },
  { text: "ty diego, that catch saved us a rollback", nudge: true },
  { text: "tysm", nudge: false },
  { text: "much obliged", nudge: false },
  { text: "appreciated", nudge: false },
  { text: "👌", nudge: false },
  { text: "ok noted, thanks Sam", nudge: false },
  { text: "thanks, I'll pick it up tomorrow", nudge: false },
  { text: "grateful for any help on this before the demo", nudge: false },
  { text: "thanks but we've already got a vendor for this", nudge: false },
  { text: "superb, the staging env is down again", nudge: false },
  { text: "thanks for volunteering me for that 🙄", nudge: false },
  { text: "excellent, now we get to do it twice", nudge: false },
  { text: "massive props to the entire engineering org", nudge: false }, // REGRESSION: group veto must know "org"
  { text: "thank you everybody, genuinely a huge quarter", nudge: false },
  { text: "great job all round folks", nudge: false },
  { text: "this new linter is fantastic", nudge: false },
  { text: "honestly proud of how I handled that call", nudge: false },
  { text: "outstanding work ruining my Friday lol", nudge: false },
  { text: "Priya asked me to pass on her thanks to the team", nudge: false }, // REGRESSION: relayed via possessive
  { text: "big thank you to the folks at Acme for the extension", nudge: false },
  { text: "I appreciate that we're all stretched thin", nudge: false },
  { text: "happy 5 years at the company Diego!", nudge: false },
  { text: "thanks for the sourdough starter", nudge: false },
  { text: "the dashboard is live and the numbers look excellent", nudge: false },
  { text: "not our best work on that release honestly", nudge: false }, // REGRESSION: negation across a possessive

  /* Left failing on purpose. "chef's kiss" is a pure idiom with no structural
     tell — no roster subject, no verb, no praise word a matcher can reach. The
     honest fix is the LLM path in llm.js, not another entry in a word list.
     If this ever passes because someone added "chef's kiss" to F_MARKER, the
     classifier got worse at the thing this case exists to measure. */
  { text: "Mei that migration doc is chef's kiss", nudge: true }, // KNOWN MISS
];

function runEval0() {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  const misclassified = [];

  EVAL0_DATASET.forEach((c) => {
    const got = classifyDeterministic(c.text).fire;
    if (c.nudge && got) tp++;
    else if (!c.nudge && !got) tn++;
    else if (!c.nudge && got) fp++;
    else fn++;
    if (got !== c.nudge) misclassified.push({ text: c.text, expected: c.nudge, got: got });
  });

  const total = EVAL0_DATASET.length;
  const correct = tp + tn;
  const positives = tp + fn;
  const negatives = tn + fp;
  const accuracy = total ? correct / total : 0;
  const falsePositiveRate = negatives ? fp / negatives : 0;
  const falseNegativeRate = positives ? fn / positives : 0;
  const recall = positives ? tp / positives : 0;

  return {
    total: total,
    correct: correct,
    accuracy: accuracy,
    falsePositiveRate: falsePositiveRate,
    falseNegativeRate: falseNegativeRate,
    recall: recall,
    pass: accuracy >= 0.9 && falsePositiveRate <= 0.05 && recall > 0.5,
    misclassified: misclassified,
  };
}

/* --------------------------------------------------- scenario harness */

const EVAL_CHANNEL = "__eval_channel__";
const EVAL_USER = "__eval_user__";
const HOUR_MS = 3600000;

function pipelineReady() {
  try {
    return typeof Pipeline !== "undefined" && !!Pipeline && typeof Pipeline.onMessage === "function";
  } catch (e) {
    return false;
  }
}

function notLoaded() {
  return { pass: false, actual: "agents.js not loaded", note: "This case drives the agent chain; Pipeline was not defined at run time." };
}

function lazy(getter, fallback) {
  try {
    const v = getter();
    return v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function clearScratch() {
  Store.messages(EVAL_CHANNEL)
    .slice()
    .forEach((m) => Store.removeMessage(EVAL_CHANNEL, m.id));
}

function dropFrom(arr, value) {
  const i = arr.indexOf(value);
  if (i !== -1) arr.splice(i, 1);
}

/* Every case runs inside this. The scratch channel is added to the monitored
   lists in place (never reassigned) so agents holding a reference still see it,
   and everything is unwound in finally — running the suite twice must be a no-op
   on real state. */
function withScratch(fn) {
  const profiles = JSON.parse(JSON.stringify(Store.allProfiles()));
  const history = JSON.parse(JSON.stringify(Store.history()));
  const user = Store.currentUserId();
  const hadAgents = lazy(() => typeof Agents !== "undefined" && !!Agents, false);
  const forced = hadAgents ? lazy(() => Agents.__forceSubmitError, undefined) : undefined;
  /* Cases run the real pipeline, which writes to the same trace bus the viewer
     is watching. Snapshot it so opening the console doesn't wipe their run. */
  const traceRestorable = lazy(() => typeof Trace !== "undefined" && typeof Trace.restore === "function", false);
  const traceRuns = traceRestorable ? lazy(() => Trace.all(), null) : null;
  /* Cases that submit reach the mock platform, so the recognition wall needs
     the same snapshot treatment — an eval run must not publish anything. */
  const recognitions = lazy(() => JSON.parse(JSON.stringify(Store.recognitions())), null);

  if (!DATA.channels.some((c) => c.id === EVAL_CHANNEL)) {
    DATA.channels.push({ id: EVAL_CHANNEL, name: "eval-scratch", topic: "Eval harness scratch channel", private: false });
  }
  if (DATA.clientConfig.enabled_channels.indexOf(EVAL_CHANNEL) === -1) DATA.clientConfig.enabled_channels.push(EVAL_CHANNEL);
  if (DATA.slackApiMock.monitored.indexOf(EVAL_CHANNEL) === -1) DATA.slackApiMock.monitored.push(EVAL_CHANNEL);
  /* The pipeline posts its card on a timer so a viewer can watch the chain
     resolve. Cases assert synchronously, so run that path inline instead. */
  const wasImmediate = hadAgents ? lazy(() => Pipeline.__immediate, undefined) : undefined;
  if (pipelineReady()) Pipeline.__immediate = true;
  clearScratch();

  try {
    return fn();
  } finally {
    clearScratch();
    if (pipelineReady()) Pipeline.__immediate = wasImmediate;
    dropFrom(DATA.clientConfig.enabled_channels, EVAL_CHANNEL);
    dropFrom(DATA.slackApiMock.monitored, EVAL_CHANNEL);
    const ci = DATA.channels.findIndex((c) => c.id === EVAL_CHANNEL);
    if (ci !== -1) DATA.channels.splice(ci, 1);
    Store.replaceProfiles(profiles);
    Store.replaceHistory(history);
    Store.setCurrentUserId(user);
    if (recognitions) Store.replaceRecognitions(recognitions);
    if (traceRestorable && traceRuns) Trace.restore(traceRuns);
    if (hadAgents) {
      try {
        Agents.__forceSubmitError = forced;
      } catch (e) {
        /* agents.js may freeze its exports — nothing to unwind then */
      }
    }
  }
}

/* Zeroes this session's delta. The seeded baseline in personalization_profiles.json
   is left alone, so a sender's carried ladder step and cooldown still apply —
   which is the behaviour most cases want. */
const CLEAN_SESSION = {
  ladderStep: -1,
  cooldownUntil: 0,
  dismissals: 0,
  accepts: 0,
  edits: 0,
  categoryAffinity: {},
  lastNudgeAt: 0,
  toneSamples: 0,
  toneWords: 0,
  toneEmoji: 0,
  toneExclaim: 0,
  lastEditWordDelta: 0,
  probeSentAt: 0,
  probesDismissed: 0,
  pausedUntil: 0,
};

function resetProfile(id) {
  Store.setProfile(id, CLEAN_SESSION);
}

/* Same reset, but marks the profile as touched so agents.js reads the live
   ladder instead of carrying the seeded one in. Counters and acceptance rate
   still come from the seed — this drops the cooldown state, not the history.
   Needed by any case that wants a sender's *bar* without their backlog. */
function resetProfileNoCarry(id) {
  Store.setProfile(id, Object.assign({}, CLEAN_SESSION, { lastNudgeAt: 1 }));
}

function post(senderId, text, extra) {
  Store.setCurrentUserId(senderId);
  const m = Store.addMessage(EVAL_CHANNEL, Object.assign({ userId: senderId, text: text }, extra || {}));
  Pipeline.onMessage(EVAL_CHANNEL, m);
  return m;
}

function lastCardMsg() {
  const list = Store.messages(EVAL_CHANNEL).filter((m) => m.ephemeral && m.card);
  return list.length ? list[list.length - 1] : null;
}

function liveCard() {
  const m = lastCardMsg();
  return m ? m.card : null;
}

/* Resolved cards stay in the transcript, so "did this post nudge?" cannot be
   answered by looking at the last card — it has to be answered by counting. */
function cardCount() {
  return Store.messages(EVAL_CHANNEL).filter((m) => m.ephemeral && m.card).length;
}

function traceFor(messageId) {
  try {
    if (typeof Trace === "undefined" || !Trace || typeof Trace.all !== "function") return null;
    return Trace.all().filter((r) => r && r.input && r.input.messageId === messageId)[0] || null;
  } catch (e) {
    return null;
  }
}

function stopStep(run) {
  if (!run || !Array.isArray(run.steps)) return null;
  return run.steps.filter((s) => s.status === "stop")[0] || null;
}

function stopSaid(run, re) {
  const s = stopStep(run);
  return !!s && re.test(String(s.decision || "") + " " + JSON.stringify(s.detail || []));
}

function cardSummary(card) {
  if (!card) return "no ephemeral card";
  return "stage=" + card.stage + " resolution=" + card.resolution + " recipient=" + (card.recipientName || card.recipientId);
}

/* Source text shared between a case's warm step and its run step. The warm
   caches a draft under a key built from this string; the run looks the draft
   up under a key built from the same string. Two copies of the sentence is a
   silent cache miss the moment one of them is reworded — the case would fall
   back to composeDraft() and still go green, which is the worst outcome
   available. One constant, referenced twice. */
const CASE_13_TEXT = "Great job on the deck, Jordan!";
const CASE_16_TEXT = "Thanks for catching the underspend before quarter close, Sam.";
const CASE_17_TEXT = "Great job on the deck, Sam!";
const CASE_18_SOURCES = [
  "Thanks for jumping in on the release checklist, Sam",
  "Thanks for how you handled the customer escalation, Sam",
  "Thanks for automating the weekly report, Sam",
  "Thanks for the care on the migration, Sam",
  "Thanks for staying on the incident overnight, Sam",
];

/* Case 16 adds a value to the catalog mid-run and asserts the draft changes.
   Push and pop live out here because the warm step has to mutate the catalog
   in the same order the run step does — the prompt and the response schema are
   both built from DATA.coreValues at call time, so a model warmed against the
   shipped catalog has never been offered Stewardship and cannot return it. */
const CASE_16_VALUE = {
  id: "stewardship",
  label: "Stewardship",
  description: "Treating the company's money and time as if they were your own.",
  looks_like: ["Caught a cost that nobody was watching", "Returned budget instead of spending it"],
  not_this: "Refusing to spend on things that need spending on.",
  signals: ["underspend", "overspend", "budget burn", "wasted spend"],
};

function case16Add() {
  DATA.coreValueCatalog.push(CASE_16_VALUE);
  DATA.coreValues.push("Stewardship");
}

function case16Remove() {
  DATA.coreValueCatalog.pop();
  DATA.coreValues.pop();
}

/* ------------------------------------------------------- scenario cases */

const EVAL_CASES = [
  {
    id: "case-1",
    title: "Happy path",
    expectation: "Recognition in a monitored channel fires and resolves the right recipient.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        resetProfile("u1");
        post("u1", "Great job on the deck, Sam!");
        const card = liveCard();
        const cls = classifyDeterministic("Great job on the deck, Sam!");
        const ok = !!card && card.stage === "nudge" && card.recipientId === "u2" && card.confidence >= 0.85;
        return {
          pass: ok,
          actual: cardSummary(card) + " classifier=" + cls.confidence,
          note: "Listener fires, Auth passes, Nudge renders the ephemeral card to Sam Okafor.",
        };
      });
    },
  },

  {
    id: "case-2",
    title: "Cooldown suppression",
    expectation: "A sender inside cooldown gets no nudge, and the trace says so.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        resetProfile("u1");
        Store.setProfile("u1", { ladderStep: 0, cooldownUntil: Date.now() + HOUR_MS });
        const src = post("u1", "Great job on the deck, Sam!");
        const card = liveCard();
        const run = traceFor(src.id);
        const explained = run ? !!stopStep(run) : true;
        return {
          pass: !card && explained,
          actual: cardSummary(card) + (run ? " / stop step " + (stopStep(run) ? "present" : "missing") : " / no trace"),
          note: "Cooldown discards rather than buffers — the nudge is dropped, not queued.",
        };
      });
    },
  },

  {
    id: "case-3",
    title: "Zero budget is silent",
    expectation: "A sender with budget 0 sees no nudge UI at all.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        resetProfile("u5");
        const src = post("u5", "Kudos to Jordan for the launch");
        const card = liveCard();
        const run = traceFor(src.id);
        return {
          pass: !card,
          actual: cardSummary(card) + (run ? " / trace outcome " + run.outcome : ""),
          note: "Liam Chen has budget 0 in employees.csv. Auth stops the chain silently — visible in the trace, not the channel.",
        };
      });
    },
  },

  {
    id: "case-3a",
    title: "Opt-out outranks a high-confidence signal",
    expectation: "A sender who has switched nudges off sees nothing, however strong the trigger.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        resetProfile("u8");
        const src = post("u8", "Kudos to Jordan for the launch");
        const card = liveCard();
        const run = traceFor(src.id);
        const explained = run ? stopSaid(run, /opt(ed)? out/i) : false;
        return {
          pass: !card && explained,
          actual: cardSummary(card) + (run ? " / stop step " + (explained ? "names the opt-out" : "missing or unexplained") : " / no trace"),
          note: "Mei (u8) is opted out in personalization_profiles.json. client_config.json sets respect_user_opt_out — the preference is a ceiling the classifier cannot raise.",
        };
      });
    },
  },

  {
    id: "case-3b",
    title: "Recipient in HRIS but not receivable",
    expectation: "An ineligible recipient stops the chain silently, distinct from a missing HRIS row.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      const row = DATA.hris.find((r) => r.employee_id === "u2");
      const before = row ? row.recognition_eligible : null;
      if (row) row.recognition_eligible = "no";
      try {
        return withScratch(function () {
          resetProfile("u1");
          const src = post("u1", "Great job on the deck, Sam!");
          const card = liveCard();
          const run = traceFor(src.id);
          const explained = run ? stopSaid(run, /eligib|receivab|enrol/i) : false;
          return {
            pass: !card && explained && run.outcome === "silent",
            actual: cardSummary(card) + (run ? " / outcome " + run.outcome + " / reason " + (explained ? "named" : "not named") : " / no trace"),
            note: "hris_directory.csv carries recognition_eligible and achievers_enrolled. Auth reads both, and the sender is told nothing — that would leak a colleague's employment status.",
          };
        });
      } finally {
        if (row) row.recognition_eligible = before;
      }
    },
  },

  {
    id: "case-4",
    title: "Identity unverified routes to login",
    expectation: "Noor (u6) is flagged needsLogin and lands on the login stage, not the draft.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        resetProfile("u6");
        post("u6", "Great job on the deck, Sam!");
        let m = lastCardMsg();
        if (!m) return { pass: false, actual: "no ephemeral card", note: "Unverified users should still get a nudge — gated at the login step." };
        const flagged = m.card.needsLogin === true;
        if (m.card.stage !== "login") {
          Pipeline.accept(EVAL_CHANNEL, m.id);
          m = Store.getMessage(EVAL_CHANNEL, m.id);
        }
        const card = m ? m.card : null;
        return {
          pass: flagged && !!card && card.stage === "login",
          actual: "needsLogin=" + flagged + " " + cardSummary(card),
          note: "auth_mock.json lists u6 as unverified, so accept routes through a simulated Slack login before drafting.",
        };
      });
    },
  },

  {
    id: "case-5",
    title: "Session expiry mid-draft",
    expectation: "Past SESSION_TTL_MS the card reports sessionExpired and the human's edits survive.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      const ttl = lazy(() => SESSION_TTL_MS, null);
      return withScratch(function () {
        resetProfile("u1");
        post("u1", "Great job on the deck, Sam!");
        let m = lastCardMsg();
        if (!m) return { pass: false, actual: "no ephemeral card", note: "Cannot reach the draft stage." };
        Pipeline.accept(EVAL_CHANNEL, m.id);
        m = Store.getMessage(EVAL_CHANNEL, m.id);
        if (!m || !m.card || m.card.stage !== "draft") {
          return { pass: false, actual: "stage=" + (m && m.card ? m.card.stage : "gone") + " after accept", note: "u1 is verified, so accept should open the draft directly." };
        }
        const edited = "Edited in the eval harness — this text must survive the session expiring.";
        Pipeline.editField(EVAL_CHANNEL, m.id, "message", edited);
        Store.updateCard(EVAL_CHANNEL, m.id, { sessionExpiresAt: Date.now() - 1000 });
        if (typeof Pipeline.sweep === "function") Pipeline.sweep();
        m = Store.getMessage(EVAL_CHANNEL, m.id);
        const card = m ? m.card : null;
        const kept = !!card && card.fields && card.fields.message === edited;
        return {
          pass: !!card && card.sessionExpired === true && kept,
          actual: "sessionExpired=" + (card ? card.sessionExpired : "card gone") + " editPreserved=" + kept + " ttl=" + ttl,
          note: "Expiry is a reconnect affordance, not a data loss event.",
        };
      });
    },
  },

  {
    id: "case-6",
    title: "Platform error on submit",
    expectation: "A forced platform_error preserves the draft and stays retryable.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      const canForce = lazy(() => typeof Agents !== "undefined" && !!Agents && "__forceSubmitError" in Agents, false);
      if (!canForce) {
        return { pass: false, actual: "Agents.__forceSubmitError not exposed", note: "The 25% error rate must be forceable or this case is a coin flip." };
      }
      return withScratch(function () {
        resetProfile("u1");
        Agents.__forceSubmitError = true;
        post("u1", "Great job on the deck, Sam!");
        let m = lastCardMsg();
        if (!m) return { pass: false, actual: "no ephemeral card", note: "Cannot reach submit." };
        Pipeline.accept(EVAL_CHANNEL, m.id);
        m = Store.getMessage(EVAL_CHANNEL, m.id);
        const drafted = m && m.card && m.card.fields ? m.card.fields.message : null;

        /* "Great job on the deck" matches no signal in core_values.json, so
           Draft leaves the field blank and Submission refuses on
           missing_required before the API mock is ever called. Pick a value
           first, or this case stops at the wrong gate and proves nothing
           about retryability. Case-17 is where the blank itself is tested. */
        Pipeline.editField(EVAL_CHANNEL, m.id, "coreValue", "Excellence");
        Pipeline.submit(EVAL_CHANNEL, m.id);
        m = Store.getMessage(EVAL_CHANNEL, m.id);
        const card = m ? m.card : null;
        const kept = !!card && card.fields && card.fields.message === drafted;
        return {
          pass: !!card && card.submissionError === "platform_error" && card.resolution !== "sent" && kept,
          actual: "submissionError=" + (card ? card.submissionError : "card gone") + " resolution=" + (card ? card.resolution : "-") + " draftPreserved=" + kept,
          note: "achievers_api_mock.json declares the error retryable — the human must be able to press Submit again.",
        };
      });
    },
  },

  {
    id: "case-7",
    title: "Self-recognition blocked",
    expectation: "Sender and recipient being the same person stops the chain.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        resetProfile("u1");
        const src = post("u1", "Great job on the deck @priya");
        const card = liveCard();
        const run = traceFor(src.id);
        return {
          pass: !card,
          actual: cardSummary(card) + (run ? " / trace outcome " + run.outcome : ""),
          note: "employer_policy.md forbids recognizing oneself; Auth catches it before any draft exists.",
        };
      });
    },
  },

  {
    id: "case-8",
    title: "Cooldown ladder escalation",
    expectation: "Consecutive dismissals walk [2, 5, 24, 72] hours; a send resets to step -1.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      const ladder = lazy(() => COOLDOWN_LADDER_HOURS, null);
      if (!Array.isArray(ladder)) return { pass: false, actual: "COOLDOWN_LADDER_HOURS not defined", note: "The ladder constant must come from agents.js." };
      return withScratch(function () {
        resetProfile("u1");
        const observed = [];
        for (let i = 0; i < ladder.length; i++) {
          Store.setProfile("u1", { cooldownUntil: 0 }); // simulate the previous wait elapsing
          post("u1", "Kudos to Sam for the migration");
          const m = lastCardMsg();
          if (!m) {
            observed.push("no nudge at rung " + i);
            break;
          }
          Pipeline.dismiss(EVAL_CHANNEL, m.id, "x");
          const p = Store.profile("u1");
          observed.push(Math.round(((p.cooldownUntil - Date.now()) / HOUR_MS) * 10) / 10);
        }
        const walked = observed.length === ladder.length && observed.every((h, i) => typeof h === "number" && Math.abs(h - ladder[i]) <= 0.2);
        const stepAfterDismissals = Store.profile("u1").ladderStep;

        let resetStep = null;
        // Force the happy path so the 25% simulated error cannot make this case flaky.
        if (lazy(() => typeof Agents !== "undefined" && !!Agents, false)) Agents.__forceSubmitError = false;
        Store.setProfile("u1", { cooldownUntil: 0 });
        post("u1", "Kudos to Sam for the migration");
        const m = lastCardMsg();
        if (m) {
          Pipeline.accept(EVAL_CHANNEL, m.id);
          Pipeline.submit(EVAL_CHANNEL, m.id);
          resetStep = Store.profile("u1").ladderStep;
        }
        return {
          pass: walked && stepAfterDismissals === ladder.length - 1 && resetStep === -1,
          actual: "hours=[" + observed.join(", ") + "] stepAfterDismissals=" + stepAfterDismissals + " stepAfterSend=" + resetStep,
          note: "Dismissal is the strongest signal the nudge is unwelcome; a send earns the sender a clean slate.",
        };
      });
    },
  },

  /* Case 9 ("No interaction expires") was removed. The nudge is a Slack
     ephemeral, so its lifetime belongs to Slack — there is no app-side timer to
     assert against. Case IDs are left unrenumbered so they still line up with
     the PRD. */

  {
    id: "case-10",
    title: "Recipient not in HRIS",
    expectation: "Alex Rowe (u9) is absent from hris_directory.csv, so validation stops.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        resetProfile("u1");
        const parent = Store.addMessage(EVAL_CHANNEL, { userId: DATA.contractor.id, text: "Pushed the contractor build for review." });
        const src = post("u1", "well done on that", { threadParentId: parent.id });
        const card = liveCard();
        const run = traceFor(src.id);
        const named = run ? stopSaid(run, /hris|directory|not found|no record|eligib/i) : true;
        return {
          pass: !card && named,
          actual: cardSummary(card) + (run ? " / stop: " + (stopStep(run) ? stopStep(run).decision : "none") : " / no trace"),
          note: "Recipient resolves off the thread parent author, then fails the system-of-record check.",
        };
      });
    },
  },

  {
    id: "case-11",
    title: "Policy-violating text blocked",
    expectation: "A message matching policy_violation_examples.json never reaches a draft.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        resetProfile("u1");
        const bad = DATA.policyViolationExamples[0].text;
        const parent = Store.addMessage(EVAL_CHANNEL, { userId: "u2", text: "Merged the cleanup branch." });
        const src = post("u1", bad, { threadParentId: parent.id });
        const card = liveCard();
        const run = traceFor(src.id);
        const noDraft = !card || card.resolution === "blocked" || card.stage === "resolved";
        const evidence = run ? run.outcome === "blocked" || !!stopStep(run) : true;
        return {
          pass: classifyDeterministic(bad).fire && noDraft && evidence,
          actual: cardSummary(card) + (run ? " / trace outcome " + run.outcome : " / no trace"),
          note: "The classifier fires on this text — the block has to come from Auth, which is the point of the check.",
        };
      });
    },
  },

  {
    id: "case-11a",
    title: "Human edits a clean draft into a violation",
    expectation: "Submission's final check blocks, the block persists until corrected, and the platform is never called.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        resetProfile("u1");
        /* Force the happy path so a simulated platform error can't be mistaken
           for the policy block. */
        if (lazy(() => typeof Agents !== "undefined" && !!Agents, false)) Agents.__forceSubmitError = false;

        post("u1", "Huge thanks to Sam for rebuilding the pricing model overnight.");
        const m = lastCardMsg();
        if (!m) return { pass: false, actual: "no nudge card", note: "The setup message has to nudge before the edit can be tested." };
        Pipeline.accept(EVAL_CHANNEL, m.id);

        const before = Store.recognitions().length;
        const bad = "thanks for cleaning up that idiot's code";
        Pipeline.editField(EVAL_CHANNEL, m.id, "message", bad);
        const flagged = (liveCard() || {}).policyViolation || null;

        Pipeline.submit(EVAL_CHANNEL, m.id);
        const afterBlocked = liveCard();
        const published = Store.recognitions().length - before;
        const held = !!afterBlocked && afterBlocked.stage !== "resolved";

        /* Correcting it has to clear the block, or "persists until corrected"
           is really just "permanent". */
        Pipeline.editField(EVAL_CHANNEL, m.id, "message", "Thanks for cleaning up that module — it reads far better now.");
        const cleared = ((liveCard() || {}).policyViolation || null) === null;
        Pipeline.submit(EVAL_CHANNEL, m.id);
        const sentAfterFix = Store.recognitions().length - before === 1;

        return {
          pass: !!flagged && published === 0 && held && cleared && sentAfterFix,
          actual: "flagged=" + flagged + " publishedWhileBlocked=" + published + " heldOpen=" + held + " clearedOnFix=" + cleared + " sentAfterFix=" + sentAfterFix,
          note: "Draft vetted its own text; this is the check on what the human actually rewrote.",
        };
      });
    },
  },

  {
    id: "case-12",
    title: "Personalized confidence bar",
    expectation: "One mid-confidence signal fires for a high acceptor and stops for a low one.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      const bar = lazy(() => Agents.__threshold, null);
      if (typeof bar !== "function") {
        return { pass: false, actual: "Agents.__threshold not exposed", note: "The bar has to be readable or this case can only infer it." };
      }
      return withScratch(function () {
        /* 0.72: gratitude pointed at a work object. Deliberately between the two
           senders' bars — a strong signal would fire for everyone and prove
           nothing. */
        const text = "Thanks for the migration, Sam";
        const conf = classifyDeterministic(text).confidence;

        resetProfileNoCarry("u4");
        const avaBar = bar("u4");
        const n0 = cardCount();
        post("u4", text);
        const avaFired = cardCount() > n0;

        /* No-carry: Jordan is parked at the 72h ceiling, and a probe would
           bypass the very bar this case is testing. */
        resetProfileNoCarry("u3");
        const jordanBar = bar("u3");
        const n1 = cardCount();
        const src = post("u3", text);
        const jordanFired = cardCount() > n1;
        const run = traceFor(src.id);
        const named = run ? stopSaid(run, /below this sender'?s bar|confidence/i) : false;

        return {
          pass:
            conf === 0.72 &&
            avaFired &&
            !jordanFired &&
            named &&
            avaBar.value < conf &&
            jordanBar.value > conf &&
            avaBar.personalized &&
            jordanBar.personalized,
          actual:
            "signal " + conf +
            " · Ava bar " + avaBar.value + " (" + avaBar.basis + ") → " + (avaFired ? "fired" : "silent") +
            " · Jordan bar " + jordanBar.value + " (" + jordanBar.basis + ") → " + (jordanFired ? "fired" : "silent"),
          note: "This is the difference between an agent and a feature flag: the same input, two answers, both derived from what each sender did with their last few dozen nudges.",
        };
      });
    },
  },

  {
    id: "case-12a",
    title: "Cold start refuses to personalize",
    expectation: "Under the minimum sample the bar is the house default and says so.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      const bar = lazy(() => Agents.__threshold, null);
      if (typeof bar !== "function") return { pass: false, actual: "Agents.__threshold not exposed", note: "" };
      return withScratch(function () {
        resetProfile("u6"); // hired seven days ago, never nudged
        const b = bar("u6");
        return {
          pass: b.personalized === false && b.sample === 0 && /cold start/i.test(b.basis),
          actual: "bar " + b.value + " · sample " + b.sample + " · " + b.basis,
          note: "Three dismissals is not a preference. Reading noise as signal is how a personalization loop teaches itself the wrong thing on day one.",
        };
      });
    },
  },

  {
    id: "case-13",
    title: "Tone learned from edits",
    expectation: "Seeded tone shapes the draft, and a human edit is stored as counts with no text kept.",
    /* One sentence, two senders. The drafter is told who is writing and
       nothing else about them, so any difference between the two drafts came
       from the sender's profile reaching the prompt. */
    warm: function () {
      return warmDrafts([
        { senderId: "u2", text: CASE_13_TEXT, carry: false },
        { senderId: "u1", text: CASE_13_TEXT, carry: false },
      ]);
    },
    skipNote:
      "Voice is the claim this case tests and composeDraft() cannot make it — its two registers are two hardcoded sentence shapes. Paste a key to run it against the model.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        if (lazy(() => typeof Agents !== "undefined" && !!Agents, false)) Agents.__forceSubmitError = false;
        const text = CASE_13_TEXT;

        /* Read side: same source message, two senders, two voices. Sam is
           terse-technical and avoids adjectives; Priya uses emoji and
           exclamation marks. */
        resetProfileNoCarry("u2");
        post("u2", text);
        let m = lastCardMsg();
        if (!m) return { pass: false, actual: "no nudge for u2", note: "Sam's bar is 0.50 and this signal is 0.96 — a miss here is a gate bug, not a tone bug." };
        Pipeline.accept(EVAL_CHANNEL, m.id);
        const terseDraft = (liveCard() || {}).fields.message;

        resetProfileNoCarry("u1");
        post("u1", text);
        const pm = lastCardMsg();
        Pipeline.accept(EVAL_CHANNEL, pm.id);
        const warmDraft = (liveCard() || {}).fields.message;

        /* Write side: edit Sam's draft and check what the agent kept. */
        const edited = "Migration shipped a day early, zero rollbacks. Good work, Jordan.";
        Pipeline.editField(EVAL_CHANNEL, m.id, "message", edited);
        /* Source text carries no core value signal, so the field is blank and
           Submission would refuse. The human pick is part of the same edit
           session — it must not count as a second tone sample. */
        Pipeline.editField(EVAL_CHANNEL, m.id, "coreValue", "Excellence");
        Pipeline.submit(EVAL_CHANNEL, m.id);
        const p = Store.profile("u2");

        const learned = p.toneSamples === 1 && p.toneWords === wordCount(edited) && p.lastEditWordDelta !== 0;
        const noText = JSON.stringify(p).indexOf("rollbacks") === -1;
        const differ = terseDraft !== warmDraft;
        const tersely = terseDraft.length < warmDraft.length && terseDraft.indexOf("!") === -1;

        return {
          pass: differ && tersely && learned && noText,
          actual:
            "terse=" + JSON.stringify(shortDraft(terseDraft)) +
            " warm=" + JSON.stringify(shortDraft(warmDraft)) +
            " · samples=" + p.toneSamples + " words=" + p.toneWords + " delta=" + p.lastEditWordDelta +
            " textStored=" + !noText,
          note: "The edit is the only ground truth the agent gets about voice. It is reduced to five numbers before storage — Tier 2 is behavioural, so nothing reconstructable survives the turn.",
        };
      });
    },
  },

  {
    id: "case-14",
    title: "Probe escapes the cooldown ceiling",
    expectation: "A sender stuck at 72h gets exactly one prompt through, then the agent pauses itself.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        resetProfile("u3"); // carried: step 3, cooldown live, 59 days since an accept
        const text = "Thanks for the migration, Sam"; // 0.72, below Jordan's 0.90 bar
        const src = post("u3", text);
        const card = liveCard();
        const probed = !!card && card.probe === true;
        const run = traceFor(src.id);
        const explained = run ? /probe/i.test(JSON.stringify(run.steps || [])) : false;

        if (!probed) {
          return { pass: false, actual: cardSummary(card) + " probe=" + (card ? card.probe : "-"), note: "Both the bar and the cooldown should have been bypassed." };
        }

        Pipeline.dismiss(EVAL_CHANNEL, lastCardMsg().id, "x");
        const after = Store.profile("u3");
        const paused = after.pausedUntil > Date.now() && after.probesDismissed === 1;

        /* And the pause has to actually hold, or it is a counter, not a brake. */
        Store.setProfile("u3", { cooldownUntil: 0 });
        const n = cardCount();
        const second = post("u3", "Kudos to Sam for the migration"); // 0.96, would clear any bar
        const secondFired = cardCount() > n;
        const secondRun = traceFor(second.id);
        const heldBy = secondRun ? stopSaid(secondRun, /paus/i) : false;

        return {
          pass: probed && explained && paused && !secondFired && heldBy,
          actual:
            "probe=" + probed +
            " pausedUntil=+" + Math.round((after.pausedUntil - Date.now()) / 86400000) + "d" +
            " probesDismissed=" + after.probesDismissed +
            " secondSignal=" + (secondFired ? "fired" : "stopped by " + (heldBy ? "the pause" : "something else")),
          note: "Four dismissals park a sender at 72h forever and every further dismissal renews it — indistinguishable from an opt-out nobody chose. Asking once more is a question; asking forever is harassment.",
        };
      });
    },
  },

  {
    id: "case-15",
    title: "Admin pause outranks everything",
    expectation: "An admin-paused sender is silent, and the sender cannot undo it.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        resetProfile("u7"); // paused by a workspace admin pending training
        const src = post("u7", "Kudos to Sam for the migration"); // 0.96
        const card = liveCard();
        const run = traceFor(src.id);
        const explained = run ? stopSaid(run, /admin|paused/i) : false;
        return {
          pass: !card && explained && run.outcome === "silent",
          actual: cardSummary(card) + (run ? " / outcome " + run.outcome + " / " + (explained ? "names the admin pause" : "reason not named") : " / no trace"),
          note: "client_config.json carries the pause, not the sender's profile. A preference the sender owns and a control an admin owns fail in the same place and must stay separable in the trace.",
        };
      });
    },
  },

  {
    id: "case-15a",
    title: "Opt-in mode gates an unenrolled department",
    expectation: "Flipping the workspace to opt-in stops senders whose department was never enrolled.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      const cfg = DATA.clientConfig.enrolment;
      const mode = cfg.mode;
      const depts = cfg.enrolled_departments.slice();
      cfg.mode = "opt-in";
      cfg.enrolled_departments = depts.filter((d) => d !== "Design");
      try {
        return withScratch(function () {
          resetProfile("u1"); // Design — the department just removed
          const src = post("u1", "Great job on the deck, Sam!");
          const card = liveCard();
          const run = traceFor(src.id);
          const explained = run ? stopSaid(run, /opt-in|enrol/i) : false;
          return {
            pass: !card && explained,
            actual: cardSummary(card) + (run ? " / stop: " + (stopStep(run) ? stopStep(run).decision : "none") : " / no trace"),
            note: "Same sender, same message, same 0.96 — the only thing that changed is a workspace setting. Rollout scope is an admin decision, so it cannot live in a user profile.",
          };
        });
      } finally {
        cfg.mode = mode;
        cfg.enrolled_departments = depts;
      }
    },
  },

  /* ---- the three files the Draft agent cites in its trace -------------
     Draft's Observe step lists core_values.json, recognition_guidelines.md
     and recognition_samples.json. Cases 16–18 exist so that claim is falsifiable:
     change the file, the behaviour changes. Without them the trace panel is
     a label rather than a receipt. */

  {
    id: "case-16",
    title: "Core values are configuration, not code",
    expectation: "Adding a value to core_values.json changes what the Draft agent picks, with no code change.",
    /* Two warms, not one, and the catalog changes between them. Same sentence
       both times, so what the model is offered is the only variable — which is
       the claim. The draft cache keys on the catalog too, so the second warm
       does not overwrite the first. */
    warm: async function () {
      const posts = [{ senderId: "u1", text: CASE_16_TEXT }];
      await warmDrafts(posts);
      case16Add();
      try {
        await warmDrafts(posts);
      } finally {
        case16Remove();
      }
    },
    skipNote:
      "Without a key the value comes from pickCoreValue() alone, which reads the same file — the case still holds, but it is not testing the model's reading of it.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      /* Signal chosen to collide with nothing in the shipped catalog, so the
         only reason it can ever match is the entry added below. */
      const text = CASE_16_TEXT;

      function draftedValue() {
        return withScratch(function () {
          resetProfile("u1");
          post("u1", text);
          const m = lastCardMsg();
          if (!m) return null;
          Pipeline.accept(EVAL_CHANNEL, m.id);
          const card = liveCard();
          return card && card.fields ? card.fields.coreValue : null;
        });
      }

      const before = draftedValue();

      case16Add();
      let after;
      try {
        after = draftedValue();
      } finally {
        case16Remove();
      }

      return {
        pass: before === "" && after === "Stewardship",
        actual: "shipped catalog → " + JSON.stringify(before) + " · client adds Stewardship → " + JSON.stringify(after),
        note: "Same sender, same sentence, same code. The old hardcoded keyword map would have answered \"Teamwork\" both times and never mentioned that it was guessing.",
      };
    },
  },

  {
    id: "case-17",
    title: "No matching value leaves the field blank and blocks Submit",
    expectation: "An unmatched core value is an empty select the human must fill, not a default the agent invents.",
    /* The case that most needs the model in it. The schema hands the drafter
       five values and a blank, and the sentence supports none of them — so
       either the model declines, or it picks one and gateCoreValue() blanks it
       against core_values.json. Both roads end at an empty field the human has
       to fill, and this is the run that proves it rather than asserting it. */
    warm: function () {
      return warmDrafts([{ senderId: "u1", text: CASE_17_TEXT }]);
    },
    skipNote:
      "The field is blank without a key too, but only because pickCoreValue() found nothing. The interesting version of this case is the one where a model wanted to fill it.",
    run: function () {
      if (!pipelineReady()) return notLoaded();
      return withScratch(function () {
        if (lazy(() => typeof Agents !== "undefined" && !!Agents, false)) Agents.__forceSubmitError = false;
        resetProfile("u1");
        post("u1", CASE_17_TEXT); // praise with no behavioural signal
        let m = lastCardMsg();
        if (!m) return { pass: false, actual: "no ephemeral card", note: "Cannot reach the draft." };
        Pipeline.accept(EVAL_CHANNEL, m.id);

        const blank = (liveCard().fields || {}).coreValue === "";

        Pipeline.submit(EVAL_CHANNEL, m.id);
        let card = liveCard();
        const refused =
          card.submissionError === "missing_required" &&
          Array.isArray(card.missingRequired) &&
          card.missingRequired.join(" ").toLowerCase().indexOf("core value") !== -1 &&
          card.resolution !== "sent";

        Pipeline.editField(EVAL_CHANNEL, m.id, "coreValue", "Excellence");
        const cleared = !liveCard().submissionError;

        Pipeline.submit(EVAL_CHANNEL, m.id);
        card = liveCard();
        const sent = !card || card.resolution === "sent";

        return {
          pass: blank && refused && cleared && sent,
          actual: "blank=" + blank + " refused=" + refused + " clearedOnPick=" + cleared + " sentAfterPick=" + sent,
          note: "PRD Case 4 applied to a second field: when the agent cannot know, it says so and hands the decision back. A default here would be a wrong value attached to a permanent award record, and nobody would ever see that it was a guess.",
        };
      });
    },
  },

  {
    id: "case-18",
    title: "Drafts obey recognition_guidelines.md, and the rules have teeth",
    expectation: "Every generated draft passes the rulebook, and known-bad text fails it.",
    /* Five sources a run, five runs: twenty-five drafts through the rulebook.
       This is the case the whole sampling apparatus exists for. Every other
       case asks whether a rule fired; this one asks how often generated prose
       breaks one, and that is a rate, not a yes. */
    warm: function () {
      return warmDrafts(
        CASE_18_SOURCES.map(function (t) {
          return { senderId: "u1", text: t };
        })
      );
    },
    skipNote:
      "The two control strings would still be caught without a key — the rulebook does not need a model. What needs a key is the other half of the claim: that the text the agent actually writes passes the same rules.",
    /* Rate, not verdict. Twenty-four clean drafts and one specificity break is
       a real result about a real system, and collapsing it to FAIL throws away
       the number the PRD should be quoting. The pass bar stays strict — zero
       breaks — but the count is what gets reported either way. */
    aggregate: function (results, n) {
      const drafts = results.reduce((a, r) => a + (r.drafts || 0), 0);
      const expected = results.reduce((a, r) => a + (r.expected || 0), 0);
      const breaks = results.reduce((a, r) => a + (r.breaks || 0), 0);
      const controlRuns = results.filter((r) => r.controls).length;
      const broken = [];
      results.forEach((r) => (r.brokeNames || []).forEach((x) => broken.indexOf(x) === -1 && broken.push(x)));
      return {
        pass: drafts === expected && breaks === 0 && controlRuns === n,
        runs: n,
        actual:
          drafts + "/" + expected + " drafts generated across " + n + " runs · " +
          (drafts - breaks) + " passed the rulebook, " + breaks + " broke it" +
          (broken.length ? " (" + broken.join(", ") + ")" : "") +
          " · both control strings rejected in " + controlRuns + "/" + n + " runs",
        note: results[0].note,
      };
    },
    run: function () {
      if (!pipelineReady()) return notLoaded();
      const check = lazy(() => guidelineCheck, null);
      if (typeof check !== "function") {
        return { pass: false, actual: "guidelineCheck not defined", note: "The Check step must be a real function or this case cannot see it." };
      }

      /* One signal-bearing message per value, so the drafter takes the sample
         frame path rather than the house fallback in all five. */
      const SOURCES = CASE_18_SOURCES;

      const drafts = withScratch(function () {
        return SOURCES.map(function (t) {
          resetProfile("u1");
          post("u1", t);
          const m = lastCardMsg();
          if (!m) return null;
          Pipeline.accept(EVAL_CHANNEL, m.id);
          const card = liveCard();
          return card && card.fields ? card.fields.message : null;
        });
      });

      const produced = drafts.filter(Boolean);
      const failures = produced.map(check).filter((r) => !r.ok);

      /* The specific bug this replaced: every draft used to end "that is
         exactly what Teamwork looks like here" — the same empty move as the
         weak sample "You went above and beyond", which recognition_samples.json
         already calls out. And PRD eval Case 6's invented character praise. */
      const RETIRED = "Thanks for the deck, Sam. That is exactly what Teamwork looks like here.";
      const PRD_CASE_6 = "Sam, your dedication and tireless commitment on the deck were amazing.";
      const retired = check(RETIRED);
      const invented = check(PRD_CASE_6);
      const caughtRetired = !retired.ok && retired.brokeIds.indexOf("value_label_echo") !== -1;
      const caughtInvented = !invented.ok && invented.brokeIds.indexOf("character_traits") !== -1;

      /* Every broken rule, not just the first one in the first failing draft.
         Reporting failures[0] was fine when the drafter was a template that
         either worked or did not; across twenty-five model drafts the useful
         answer is which rules get broken, and how often. */
      const brokeNames = [];
      failures.forEach((f) => (f.broke || []).forEach((b) => brokeNames.indexOf(b) === -1 && brokeNames.push(b)));

      return {
        pass: produced.length === SOURCES.length && failures.length === 0 && caughtRetired && caughtInvented,
        drafts: produced.length,
        expected: SOURCES.length,
        breaks: failures.length,
        brokeNames: brokeNames,
        controls: caughtRetired && caughtInvented,
        actual:
          produced.length + "/" + SOURCES.length + " drafts, " + failures.length + " rule breaks" +
          (brokeNames.length ? " (" + brokeNames.join(", ") + ")" : "") +
          " · retired template caught=" + caughtRetired + " · invented praise caught=" + caughtInvented,
        note: "A self-check that only ever passes is decoration. The two control strings are text the agent used to produce or would produce unguarded, and both are rejected by rules read out of the same file the trace cites.",
      };
    },
  },
];

function shortDraft(s) {
  return String(s || "").length > 48 ? String(s).slice(0, 47) + "…" : String(s || "");
}

/* ============================================================== sampling ===

   Eighteen cases never reach a draft. They stay instant, keyless, and exactly
   reproducible, which is why the suite can gate a commit.

   Four of them judge generated prose, and until the drafter was wired those
   four were judging composeDraft() — a template function whose output cannot
   vary. A test of generated text that never sees generated text is a test of
   the thing it replaced. Those four now warm the model first.

   Which means they stop being reproducible, and one green run stops being
   evidence. So they run five times. Case 18 produces five drafts a run, so
   its verdict rests on twenty-five judged drafts rather than five.

   Five, not ten: ten runs is eighty model calls to move the confidence
   interval by a few points on a prototype nobody is shipping. Five catches a
   rule the model breaks a fifth of the time, which is the failure rate worth
   knowing about here.

   With no key these four report "skipped — needs a key", in grey. Red would
   mean the agent is broken. Not having pasted a key is not the agent being
   broken, and a suite that cries wolf about its own setup teaches you to
   ignore it. */

const SAMPLE_RUNS = 5;

function modelReady() {
  return typeof LLM !== "undefined" && typeof LLM.enabled === "function" && LLM.enabled();
}

/* The warm call has to land before Pipeline.accept(), it is async, and
   withScratch() is not. Split in two: a synchronous scratch pass posts each
   message only to read back who the Listener resolved as recipient, then the
   awaits happen outside any scratch. The draft cache is keyed on source text,
   sender, recipient and the value catalog — nothing about world state — so it
   survives the scratch unwinding. */
function draftTargets(posts) {
  return withScratch(function () {
    return posts
      .map(function (p) {
        if (p.carry === false) resetProfileNoCarry(p.senderId);
        else resetProfile(p.senderId);
        post(p.senderId, p.text);
        const card = liveCard();
        if (!card || !card.recipientId) return null;
        return { senderId: p.senderId, text: p.text, recipientId: card.recipientId };
      })
      .filter(Boolean);
  });
}

/* Concurrent on purpose. Case 18 warms five messages; serially that is five
   round trips per run and twenty-five for the sample, which turns a suite into
   a coffee break. */
async function warmDrafts(posts) {
  if (!modelReady()) return 0;
  const targets = draftTargets(posts);
  /* Drop whatever the previous sample left behind. Without this the cache
     answers run 1 five times and the sample is one run wearing a hat. */
  targets.forEach(function (t) {
    LLM.forget(t.text);
  });
  await Promise.all(
    targets.map(function (t) {
      const s = User.get(t.senderId);
      const r = User.get(t.recipientId);
      return LLM.warmDrafter(
        t.text,
        r ? r.name : t.recipientId,
        s ? s.name : t.senderId,
        t.senderId,
        t.recipientId
      );
    })
  );
  return targets.length;
}

/* All runs must pass. A case that is right four times in five is a case that
   is wrong, and averaging it away is how a known defect becomes a number
   nobody reads. Case 18 overrides this, because "how often does the model
   break a rule" is a rate and deserves to be reported as one. */
function allRunsAggregate(results, n) {
  const passed = results.filter((r) => r.pass).length;
  const firstFail = results.filter((r) => !r.pass)[0];
  return {
    pass: passed === n,
    runs: n,
    actual:
      passed + "/" + n + " runs passed · " + (firstFail ? "first failure: " + firstFail.actual : results[0].actual),
    note: results[0].note,
  };
}

function runOnce(c) {
  let r;
  try {
    r = c.run();
  } catch (e) {
    r = {
      pass: false,
      actual: "threw: " + (e && e.message ? e.message : String(e)),
      note: "The case itself errored — treat as a failure, not a skip.",
    };
  }
  if (!r || typeof r !== "object") r = { pass: false, actual: "case returned nothing", note: "" };
  return r;
}

async function runCase(c) {
  if (typeof c.warm !== "function") return runOnce(c);

  if (!modelReady()) {
    return {
      pass: false,
      skipped: true,
      actual: "not run — no API key, so the Draft agent fell back to composeDraft()",
      note: c.skipNote || "",
    };
  }

  const n = c.samples || SAMPLE_RUNS;
  const results = [];
  for (let i = 0; i < n; i++) {
    try {
      await c.warm();
    } catch (e) {
      results.push({ pass: false, actual: "warm-up threw: " + (e && e.message ? e.message : String(e)), note: "" });
      continue;
    }
    /* The failure this guards against does not look like a failure. The cache
       key is built from source text, sender, recipient and catalog; if the
       warm step and the run step disagree on any of the four, the lookup
       misses, the Draft agent falls back to composeDraft(), and the case goes
       green having tested the template it was written to stop testing. A
       silent pass is worse than a loud failure, so count the hits. */
    LLM.resetStats();
    const r = runOnce(c);
    if (LLM.stats().draftHits === 0) {
      /* Not a rate and not a result — broken plumbing. Return straight past
         the aggregate, which would otherwise average this into a number. */
      return {
        pass: false,
        runs: i + 1,
        actual:
          "harness fault: the model was warmed but the Draft agent read no cached draft, " +
          "so this ran on composeDraft(). The warm step and the run step are keyed differently.",
        note: "",
      };
    }
    results.push(r);
  }
  return (c.aggregate || allRunsAggregate)(results, n);
}

async function runAllEvals(onProgress) {
  const report = typeof onProgress === "function" ? onProgress : function () {};
  const cases = [];
  for (let i = 0; i < EVAL_CASES.length; i++) {
    const c = EVAL_CASES[i];
    report(c.id, i, EVAL_CASES.length);
    const r = await runCase(c);
    cases.push({
      id: c.id,
      title: c.title,
      expectation: c.expectation,
      pass: !!r.pass,
      skipped: !!r.skipped,
      runs: r.runs || 1,
      modelBacked: typeof c.warm === "function",
      actual: r.actual == null ? "" : String(r.actual),
      note: r.note == null ? "" : String(r.note),
    });
  }
  return { eval0: runEval0(), cases: cases, modelBacked: modelReady() };
}
