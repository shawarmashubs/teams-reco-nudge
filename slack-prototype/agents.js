/* agents.js — the six-agent bounded loop and the trace bus that makes it visible.
   Pure logic: no DOM, no rendering. Loads after data.js and evals.js. */

const SESSION_TTL_MS = 45000;
const COOLDOWN_LADDER_HOURS = [2, 5, 24, 72];
const PLATFORM_ERROR_RATE = 0.25;
/* Read from the rulebook rather than restated, so raising the ceiling in
   recognition_guidelines.md raises it here and the file cannot claim a limit the
   agent does not enforce. */
const MAX_DRAFT_CHARS = DATA.recognitionRulebook.hard_char_ceiling;

/* Personalized confidence threshold. The house default is what a static feature
   would ship with; everything else is the agent moving that number per person
   based on what they have actually done with the last few months of nudges.
   Bounded on both ends, because an agent that can tune itself to 0.99 has
   invented an opt-out the user never asked for, and one that can tune itself to
   0.1 has invented spam. */
const THRESHOLD_BASE = 0.55;
const THRESHOLD_TARGET_ACCEPT = 0.7;
const THRESHOLD_MIN = 0.35;
const THRESHOLD_MAX = 0.9;
const THRESHOLD_MIN_SAMPLE = 5;
const FAST_DISMISS_SECONDS = 5;

/* Sensitivity is the user-facing dial; the threshold is the machinery under it.
   Both exist because "nudge me less" is a preference the agent must honour
   immediately, not slowly infer. */
const SENSITIVITY_OFFSET = { high: -0.1, standard: 0, low: 0.08, minimal: 0.15 };

const PROBE_AFTER_DAYS = DATA.clientConfig.frequency_caps.probe_after_days_at_cap;
const AUTO_PAUSE_DAYS = DATA.clientConfig.frequency_caps.auto_pause_days_after_probe_dismissed;
const DAY_MS = 86400000;

/* There is no decay timer on a nudge. The card is a Slack ephemeral, so its
   lifetime is Slack's to control: it stands until the sender acts on it or their
   client reloads, and no reminder is ever sent. `sessionExpiresAt` therefore
   applies only to the draft stage, where it carries the auth session deadline. */

/* ------------------------------------------------------------------ trace */

const traceRuns = [];
const traceListeners = [];

const Trace = {
  begin(input) {
    const runId = uid("r");
    traceRuns.unshift({ runId, input: input, steps: [], outcome: null, startedAt: Date.now() });
    if (traceRuns.length > 20) traceRuns.length = 20;
    Trace.notify();
    return runId;
  },

  step(step) {
    const run = Trace.get(step.runId);
    if (!run) return null;
    const s = Object.assign({ reads: [], status: "info", at: Date.now() }, step);
    run.steps.push(s);
    Trace.notify(run);
    return s;
  },

  end(runId, outcome) {
    const run = Trace.get(runId);
    if (!run || run.outcome) return;
    run.outcome = outcome;
    Trace.notify(run);
  },

  get(runId) {
    return traceRuns.find((r) => r.runId === runId) || null;
  },
  all() {
    return traceRuns.slice();
  },
  current() {
    return traceRuns[0] || null;
  },
  subscribe(fn) {
    traceListeners.push(fn);
  },
  notify(run) {
    traceListeners.forEach((fn) => fn(run || Trace.current()));
  },
  clear() {
    traceRuns.length = 0;
    Trace.notify();
  },
  /* Used by the eval harness to put the viewer's trace back after a scratch run.
     Eval cases drive the same pipeline, so without this the trace panel fills
     with #__eval_channel__ internals the moment someone opens the console. */
  restore(runs) {
    traceRuns.length = 0;
    Array.prototype.push.apply(traceRuns, runs || []);
    Trace.notify();
  },
};

/* ------------------------------------------------------------- utilities */

/* The deterministic floor. Everything this catches is blocked outright, and the
   model's policy pass in Submission cannot overrule it — it can only add blocks
   the list missed.

   That ordering is deliberate. On the one path where failing open means
   publishing an insult onto a colleague's permanent award record, the certain
   check goes first and the judgment goes second. A model that has a bad day
   costs us a violation we should have caught; a word list that has a bad day
   costs somebody ten seconds rephrasing.

   The price is false positives, and they are real: "I hate that you had to work
   the weekend to fix this" is a warm message containing "hate", and it is
   blocked. That is a stated limitation of the design, not a bug to be patched
   by loosening the floor.

   Widened on hard terms only — slurs, profanity, explicit demeaning language,
   and protected characteristics. Deliberately not widened on ambiguous words,
   because every soft term added here is another innocent sentence blocked, and
   the ambiguous cases are exactly what the model pass is for. */
const POLICY_PATTERNS = [
  {
    violation: "insult",
    re: /\b(stupid|idiot|idiotic|moron|moronic|imbecile|dumb|dumbass|jackass|clueless|incompetent|pathetic|useless|worthless|hopeless|lazy|garbage|trash|rubbish|loser|deadweight|dead weight|screw-?up|liability|hate|terrible|awful|fire (him|her|them))\b/i,
  },
  {
    violation: "insult",
    re: /\b(fuck\w*|shit\w*|bullshit|asshole|bastard|bitch|prick|douche\w*|piss\w*)\b/i,
  },
  {
    violation: "negative comparison",
    re: /\b(better|smarter|faster|sharper|more competent) than (the rest|everyone|everybody|the others|them|anyone|the whole team)\b/i,
  },
  {
    violation: "negative comparison",
    re: /\b(unlike (the rest|everyone|everybody|the others|them|certain people|some people)|puts? (the rest of )?(us|them|the team) to shame|the only one who (actually|really)?\s*\w+|carried the (whole )?team)\b/i,
  },
  {
    violation: "protected characteristic",
    re: /\bfor (a|an) (woman|man|girl|guy|mother|mom|father|dad|immigrant|foreigner|older \w+|young \w+)\b/i,
  },
  {
    violation: "protected characteristic",
    re: /\b(despite|considering|even with) (her|his|their) (age|disability|pregnancy|religion|accent|condition|illness)\b/i,
  },
  {
    violation: "protected characteristic",
    re: /\b(for (someone|somebody) (her|his|their) age|surprisingly (articulate|well.spoken|capable)|so articulate for)\b/i,
  },
];

function policyHit(text) {
  const t = String(text || "");
  const pattern = POLICY_PATTERNS.find((p) => p.re.test(t));
  if (pattern) return pattern.violation;
  const lower = t.toLowerCase();
  const known = DATA.policyViolationExamples.find((e) => lower.includes(e.text.toLowerCase()));
  return known ? known.violation : null;
}

/* Which receivability column failed. Named for the trace only — the sender is
   never shown any of this, because it is information about someone else's
   employment record. */
function ineligibleReason(row) {
  if (row.status !== "active") return "employment status is " + row.status;
  if (row.achievers_enrolled !== "yes") return "not enrolled in the Achievers program";
  return "recognition_eligible is " + row.recognition_eligible;
}

/* Tier 2 preference baseline merged with whatever this session recorded. The
   seeded profile is the starting point, Store is the delta. */
function preferences(userId) {
  return Object.assign({ nudge_sensitivity: "standard", opted_out: false }, DATA.preferenceProfiles[userId] || {});
}

/* The single view of a sender the tuning agents read: five months of seeded
   outcomes plus whatever this session has added.

   Carried ladder and cooldown state apply only until this session records its
   own outcome for the sender. After that the live profile is authoritative —
   otherwise a reload would resurrect a cooldown the user has already worked
   through, and the demo's own cooldown cases would never start clean. */
function memory(userId) {
  const seeded = DATA.preferenceProfiles[userId] || {};
  const live = Store.profile(userId);
  const touched = live.lastNudgeAt > 0;

  const accepts = (seeded.accepts || 0) + live.accepts;
  const dismissals = (seeded.dismissals || 0) + live.dismissals;
  const decided = accepts + dismissals;

  return {
    accepts: accepts,
    dismissals: dismissals,
    edits: (seeded.edits || 0) + live.edits,
    decided: decided,
    acceptanceRate: decided ? accepts / decided : null,
    medianResponseSeconds: seeded.median_response_seconds === undefined ? null : seeded.median_response_seconds,
    daysSinceAccept:
      live.accepts > 0 ? 0 : seeded.days_since_last_accept === undefined ? null : seeded.days_since_last_accept,
    ladderStep: touched ? live.ladderStep : seeded.ladder_step === undefined ? live.ladderStep : seeded.ladder_step,
    cooldownUntil: touched ? live.cooldownUntil : Math.max(live.cooldownUntil, seeded.cooldown_until || 0),
    carried: !touched && !!seeded.nudges_shown,
    live: live,
  };
}

function clampThreshold(n) {
  return Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, Math.round(n * 100) / 100));
}

/* Behaviour #1: the per-sender confidence bar.

   One rule, stated plainly: the further a sender's acceptance rate sits below
   the program's target, the stronger the signal has to be before the agent is
   willing to interrupt them. A fast-dismisser gets an extra penalty, because
   deciding in two seconds is not the same as considering it and declining.

   Below a handful of decided nudges there is nothing to personalize on and the
   function says so rather than reading noise as preference. This is the whole
   argument for an agent over a static feature, so it is worth being able to
   point at the arithmetic. */
function thresholdFor(sensitivity, decided, acceptanceRate, medianResponseSeconds) {
  const sens = SENSITIVITY_OFFSET[sensitivity] || 0;

  if (decided < THRESHOLD_MIN_SAMPLE) {
    return {
      value: clampThreshold(THRESHOLD_BASE + sens),
      basis: "cold start — house default",
      sample: decided,
      personalized: false,
      fastDismisser: false,
    };
  }

  const gap = THRESHOLD_TARGET_ACCEPT - acceptanceRate;
  const fast =
    medianResponseSeconds !== null && medianResponseSeconds < FAST_DISMISS_SECONDS && acceptanceRate < 0.5;

  return {
    value: clampThreshold(THRESHOLD_BASE + 0.5 * gap + sens + (fast ? 0.08 : 0)),
    basis:
      Math.round(acceptanceRate * 100) +
      "% accepted over " +
      decided +
      " nudges" +
      (fast ? ", median decision under " + FAST_DISMISS_SECONDS + "s" : ""),
    sample: decided,
    personalized: true,
    fastDismisser: fast,
  };
}

/* The same arithmetic against a live sender. Split from thresholdFor so the
   tuning log can replay the bar over historical counts without a second copy of
   the formula quietly drifting out of step with this one. */
function confidenceThreshold(userId) {
  const m = memory(userId);
  return thresholdFor(preferences(userId).nudge_sensitivity, m.decided, m.acceptanceRate, m.medianResponseSeconds);
}

/* Behaviour #4, admin half. Three separate ways an admin can put a sender out of
   scope, kept separate because they fail for different reasons and a merged
   "not allowed" would be untraceable. Returns null when the sender is in scope. */
function adminGate(userId) {
  const cfg = DATA.clientConfig.enrolment;
  if (!cfg) return null;
  const user = User.get(userId);

  const paused = (cfg.admin_paused_users || []).find((p) => p.user_id === userId);
  if (paused) {
    return {
      code: "admin-paused",
      why: "A workspace admin paused nudges for this sender on " + paused.paused_on + ".",
      detail: [
        ["Paused by", paused.paused_by],
        ["Reason", paused.reason],
        ["Sender can undo", "no — this is an admin control, not a preference"],
      ],
    };
  }

  if (cfg.mode === "opt-in" && user && (cfg.enrolled_departments || []).indexOf(user.dept) === -1) {
    return {
      code: "not-enrolled",
      why: "Workspace is in opt-in mode and " + user.dept + " has not been enrolled.",
      detail: [
        ["Enrolment mode", cfg.mode],
        ["Enrolled departments", (cfg.enrolled_departments || []).join(", ") || "none"],
      ],
    };
  }

  return null;
}

/* Behaviour #3: the escape hatch on the top rung.

   A sender who has dismissed four times in a row sits at 72h forever, and each
   further dismissal renews it. That is indistinguishable from an opt-out the
   user never chose. After PROBE_AFTER_DAYS with no accepted nudge, the agent is
   allowed exactly one prompt through the cooldown — and if that one is dismissed
   too, it stops on its own for a month. Asking once is a question; asking
   forever is harassment, and the pause is the agent taking the hint. */
function probeCheck(userId) {
  const m = memory(userId);
  const top = COOLDOWN_LADDER_HOURS.length - 1;
  const now = Date.now();

  if (m.ladderStep < top) return { eligible: false, reason: "not at the cooldown ceiling" };
  if (m.daysSinceAccept === null) return { eligible: false, reason: "no accepted nudge on record to age from" };
  if (m.daysSinceAccept < PROBE_AFTER_DAYS) {
    return { eligible: false, reason: m.daysSinceAccept + "d since last accept, probe opens at " + PROBE_AFTER_DAYS + "d" };
  }
  if (m.live.probeSentAt && now - m.live.probeSentAt < AUTO_PAUSE_DAYS * DAY_MS) {
    return { eligible: false, reason: "a probe has already been spent in this window" };
  }
  return {
    eligible: true,
    reason: m.daysSinceAccept + "d at the " + COOLDOWN_LADDER_HOURS[top] + "h ceiling with nothing accepted",
  };
}

/* Behaviour #2: what the sender's approved and edited drafts say about their
   voice. Seeded signals merged with whatever this session's edits have added.
   Everything here is a count or an average — there is no stored text to read. */
function toneModel(userId) {
  const seeded = (DATA.preferenceProfiles[userId] || {}).tone_signals || null;
  const live = Store.profile(userId);
  if (!seeded && !live.toneSamples) return null;

  const base = seeded || { avg_words: 0, register: "unknown", uses_emoji: false, exclamation_rate: 0, favours: [], avoids: [] };
  if (!live.toneSamples) return Object.assign({ samples: seeded ? seeded.learned_from_edits || 0 : 0 }, base);

  const seedWeight = (seeded && seeded.learned_from_edits) || 0;
  const n = seedWeight + live.toneSamples;
  return {
    avg_words: Math.round((base.avg_words * seedWeight + live.toneWords) / (n || 1)),
    register: base.register,
    uses_emoji: live.toneEmoji > 0 || base.uses_emoji,
    exclamation_rate: Math.round(((base.exclamation_rate * seedWeight + live.toneExclaim) / (n || 1)) * 100) / 100,
    favours: base.favours,
    avoids: base.avoids,
    samples: n,
    last_edit_word_delta: live.lastEditWordDelta,
  };
}

/* What the human actually changed, reduced to numbers before it is stored.
   The two strings go in; nothing that could reconstruct them comes out. */
function editSignal(originalText, finalText) {
  const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
  const exclaims = (s) => (String(s || "").match(/!/g) || []).length;
  const emoji = (s) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(String(s || ""));
  return {
    finalWords: words(finalText),
    wordDelta: words(finalText) - words(originalText),
    exclaimDelta: exclaims(finalText) - exclaims(originalText),
    addedEmoji: emoji(finalText) && !emoji(originalText),
    rewritten: words(finalText) > 0 && words(originalText) > 0
      ? Math.abs(words(finalText) - words(originalText)) / words(originalText) > 0.4
      : false,
  };
}

function resolveRecipient(text, senderId, parentMessage) {
  const mention = String(text).match(/@([a-z]+)/i);
  if (mention) {
    const byHandle = User.byHandle(mention[1]);
    if (byHandle) return { user: byHandle, how: "@mention" };
  }
  const words = String(text).split(/[^A-Za-z]+/).filter(Boolean);
  for (const w of words) {
    const byName = User.byFirstName(w);
    if (byName && byName.id !== senderId) return { user: byName, how: "first-name match in roster" };
  }
  if (parentMessage && parentMessage.userId && parentMessage.userId !== senderId) {
    const u = User.get(parentMessage.userId);
    if (u) return { user: u, how: "thread parent author" };
  }
  return { user: null, how: "unresolved" };
}

/* Only an explicit dismissal advances the ladder, so every rung is a whole step.
   An ignored ephemeral tells the app nothing — Slack does not report it — and so
   it cannot move the cooldown. Step -1 means the sender is off the ladder. */
function ladderHours(step) {
  if (step < 0) return 0;
  return COOLDOWN_LADDER_HOURS[Math.min(step, COOLDOWN_LADDER_HOURS.length - 1)];
}

function ladderLabel(step) {
  if (step < 0) return "none";
  return "step " + step + " · " + ladderHours(step) + "h";
}

/* core_values.json is the source, not a mirror of one. The signals are compiled
   from the catalog on every call rather than cached, so a client who renames a
   value, re-scopes it, or drops it changes what the agent matches by editing the
   file and nothing else. The keyword map that used to live here meant the
   taxonomy could be replaced wholesale and every draft would still come back
   "Teamwork". */
function valueMatchers() {
  return DATA.coreValueCatalog.map((v) => ({
    label: v.label,
    terms: (v.signals || []).map((s) => ({
      term: s,
      re: new RegExp("\\b" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i"),
    })),
  }));
}

/* Most distinct signal hits wins; catalog order breaks ties, which is why
   core_values.json says the order is load-bearing.

   Nothing matching is a real answer, not a failure to be papered over. The old
   fallthrough returned "Teamwork" for any message the map missed — including
   every message in the demo script — so the field arrived pre-filled with a
   claim about the work that no evidence supported. Now it arrives blank and the
   human supplies it. */
function pickCoreValue(text) {
  const src = String(text || "");
  const scores = valueMatchers().map((v) => {
    const hits = v.terms.filter((t) => t.re.test(src)).map((t) => t.term);
    return { value: v.label, hits: hits, score: hits.length };
  });
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a), scores[0] || { score: 0 });

  if (!best || best.score === 0) {
    return {
      value: null,
      matched: [],
      scores: scores,
      basis: "no signal in core_values.json matched the source message",
    };
  }
  return {
    value: best.value,
    matched: best.hits,
    scores: scores,
    basis: 'matched ' + best.hits.map((h) => '"' + h + '"').join(", ") + " against the " + best.value + " signal list",
  };
}

/* The model proposes a core value; this decides whether it survives.

   The drafter prompt requires the model to return one of the five values, and
   it has no way to answer "none of these". Left alone that reinstates exactly
   the fallthrough this codebase removed — a value arriving pre-filled on a
   permanent award record with no evidence behind it — only now the guess comes
   from a model instead of a keyword map, which makes it harder to see, not
   easier.

   So the proposal is checked against the same signal lists pickCoreValue()
   uses, compiled from core_values.json on every call. If a signal for the
   proposed value appears in the source text, the model's pick stands: it read
   the message and chose between supported options, which is the judgment we
   want from it. If no signal supports it, the field goes blank and the human
   fills it in.

   Note what the gate does not do: it does not force the model onto the
   rule's own highest-scoring value. Where several values have support, the
   model's reading wins. The file bounds the answer; it does not dictate it. */
function gateCoreValue(proposed, sourceText) {
  const label = String(proposed || "").trim();
  const rule = pickCoreValue(sourceText);

  if (!label) {
    return { value: null, proposed: "", gate: "model returned no value", ruleBasis: rule.basis, scores: rule.scores };
  }

  const match = valueMatchers().find((v) => v.label.toLowerCase() === label.toLowerCase());
  if (!match) {
    return {
      value: null,
      proposed: label,
      gate: '"' + label + '" is not in core_values.json',
      ruleBasis: rule.basis,
      scores: rule.scores,
    };
  }

  const hits = match.terms.filter((t) => t.re.test(String(sourceText || ""))).map((t) => t.term);
  if (!hits.length) {
    return {
      value: null,
      proposed: label,
      gate: "no signal for " + match.label + " in core_values.json appears in the source message",
      ruleBasis: rule.basis,
      scores: rule.scores,
    };
  }

  return {
    value: match.label,
    proposed: label,
    gate: "confirmed — " + hits.map((h) => '"' + h + '"').join(", ") + " in the source matches the " + match.label + " signal list",
    matched: hits,
    ruleBasis: rule.basis,
    scores: rule.scores,
  };
}

/* recognition_guidelines.md indexes its register table by four relationships;
   User.relationship() collapses both manager directions into one category
   because that is the granularity Tier 2 memory is allowed to store. Draft needs
   the direction to pick a row, so it derives it here, in working memory, and
   never writes it down. */
function registerFor(senderId, recipientId) {
  const a = User.get(senderId);
  const b = User.get(recipientId);
  if (a && b && a.managerId === b.id) return "manager-upward";
  if (a && b && b.managerId === a.id) return "manager-downward";
  return User.relationship(senderId, recipientId);
}

/* Every rule in recognition_guidelines.md that can be checked, checked. The
   patterns come out of the file rather than being restated here, so a rule
   added to the rulebook is enforced without touching this function.

   Runs on the agent's own draft only. What the human writes afterwards is the
   human's to write; employer_policy.md is the gate on that, and Submission owns
   it. House style is advice to the agent, not a rule imposed on a colleague. */
function guidelineCheck(message) {
  const r = DATA.recognitionRulebook;
  const text = String(message || "");
  const trimmed = text.trim();
  const sentences = trimmed ? (trimmed.match(/[^.!?]+[.!?]*/g) || []).filter((s) => s.trim()).length : 0;
  const words = trimmed ? trimmed.split(/\s+/).length : 0;

  const hit = r.avoid.filter((a) => new RegExp(a.pattern, "i").test(text));
  const broke = hit.map((a) => a.label); // prose, for the trace panel
  const brokeIds = hit.map((a) => a.id); // stable keys, for assertions

  const failures = [];
  if (!trimmed) failures.push("empty draft");
  else if (trimmed.length < r.min_chars) failures.push("under the " + r.min_chars + "-character floor");
  if (text.length > r.hard_char_ceiling) failures.push("over the " + r.hard_char_ceiling + "-character ceiling");
  if (sentences > r.max_sentences) failures.push(sentences + " sentences, ceiling is " + r.max_sentences);
  broke.forEach((b) => failures.push(b.toLowerCase()));

  return {
    ok: failures.length === 0,
    failures: failures,
    broke: broke,
    brokeIds: brokeIds,
    words: words,
    sentences: sentences,
    chars: text.length,
    /* Advisory, not a stop. The guidelines call 20–60 words a target and the
       canonical samples themselves run shorter, so a terse sender's draft
       landing under it is the tone model working, not a defect. */
    onTarget: words >= r.word_target.min && words <= r.word_target.max,
    rulesRun: r.avoid.length + 3,
  };
}

/* Draft copy stays close to what the sender actually said. The guidelines
   forbid inventing specifics, so we reference the work object only when the
   source text named one. */
const WORK_OBJECT = /\b(deck|report|presentation|pitch|launch|doc|document|code|pr|pull request|review|bug|fix|ticket|demo|proposal|analysis|design|spec|slides|draft|research|campaign|release|migration|dashboard|project|onboarding|training)\b/i;

/* Three files decide what a draft says, and none of the words are in this
   function:

   - recognition_samples.json supplies the frame — the good samples for the
     chosen value with the specifics stripped out. No value matched means the
     house frame, which makes no value-specific claim.
   - recognition_guidelines.md supplies the register. Cross-department drafts
     say what the work unblocked because the guidelines table says they should;
     upward drafts suppress warmth because the same table calls it currying
     favour. Change a row, change the drafts.
   - personalization_profiles.json, via `tone`, picks the shape.

   Behaviour #2, the consuming half. With no tone model the house voice is used
   unchanged, which is the correct behaviour for a new starter and not a degraded
   one. The variants are deliberately few: a tone model derived from a couple of
   dozen edits can honestly support "this person writes short and drops the
   flourishes" — it cannot support inventing a personality, and a draft that
   overreaches on thin evidence is worse than the house default.

   Note what the old version of this function did that the samples file already
   forbade: it ended every draft with "exactly what Teamwork looks like here",
   and recognition_samples.json lists "You went above and beyond" as a weak
   example precisely because restating the label says nothing. The file was
   cited in the trace and contradicted in the code. */
function composeDraft(recipientName, sourceText, coreValue, tone, registerKey) {
  const style = DATA.houseStyle();
  const reg =
    DATA.recognitionRulebook.register_by_relationship[registerKey] ||
    DATA.recognitionRulebook.register_by_relationship["direct-teammate"];
  const frame =
    (coreValue && DATA.recognitionSampleLibrary[coreValue] && DATA.recognitionSampleLibrary[coreValue].frames) ||
    DATA.recognitionHouseFrame;

  const first = String(recipientName).split(" ")[0];
  const obj = String(sourceText).match(WORK_OBJECT);
  const thing = obj ? obj[0].toLowerCase() : null;
  const fill = (s) => String(s).replace(/\{name\}/g, first).replace(/\{object\}/g, thing || "");

  const avoids = (tone && tone.avoids) || [];
  const terse =
    !!tone && (avoids.indexOf("adjectives") > -1 || avoids.indexOf("long sentences") > -1 || tone.avg_words <= style.median_words);
  const warm = !!tone && tone.uses_emoji && tone.exclamation_rate >= 0.25 && !reg.suppress_warmth;

  let open = fill(thing ? frame.object : frame.plain);
  /* The sender's own punctuation habit applied to house language. Nothing is
     added that the tone model did not measure — the words stay the file's. */
  if (warm) open = open.replace(/^Thanks\b/, "Thank you").replace(/\.$/, "!");

  const impact = reg.impact_override
    ? terse ? reg.impact_override.brief : reg.impact_override.full
    : fill(terse ? frame.impact_brief : frame.impact);

  return {
    text: open + " " + impact,
    shape: terse ? "terse" : warm ? "warm" : "house",
    register: registerKey,
    registerRow: reg.row,
    workObject: thing,
    houseStyle: style,
    frameSource: coreValue ? "recognition_samples.json · " + coreValue + " frames" : "recognition_samples.json · house frame",
    impactSource: reg.impact_override ? "recognition_guidelines.md · " + reg.row + " register" : "recognition_samples.json",
  };
}

function shortText(t, n) {
  const s = String(t || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/* ------------------------------------------------------------- the agents */

const Agents = {
  /* Set true to force a submission error, "never" to suppress it. Evals use this. */
  __forceSubmitError: null,

  /* Read-only window onto the per-sender bar. The eval console has to be able to
     print the arithmetic, and a case that infers the threshold from whether a
     card appeared is testing the wrong thing. */
  __threshold: confidenceThreshold,
  __thresholdFor: thresholdFor,

  /* 1. Listener — Observe the stream, Decide whether this is recognition. */
  listener(runId, channelId, message) {
    const channel = Store.channels().find((c) => c.id === channelId);
    const monitored = DATA.slackApiMock.monitored.indexOf(channelId) !== -1;

    Trace.step({
      runId,
      agent: "Listener",
      phase: "Observe",
      reads: ["slack_api_mock.json", "nudge_trigger_examples.json", "employees.csv"],
      decision: monitored
        ? "Message received on message.channels in #" + (channel ? channel.name : channelId) + "."
        : "#" + (channel ? channel.name : channelId) + " is not a subscribed channel.",
      status: monitored ? "pass" : "info",
      detail: [
        ["Channel", "#" + (channel ? channel.name : channelId) + (channel && channel.private ? " (private)" : "")],
        ["Subscribed", monitored ? "yes" : "no — private channels and DMs are out of scope"],
        ["Author", (User.get(message.userId) || {}).name || message.userId],
      ],
    });

    if (!monitored) {
      Trace.step({
        runId,
        agent: "Listener",
        phase: "Decide",
        reads: [],
        decision: "Not listening here. The loop never starts.",
        status: "stop",
      });
      return { fire: false, stopped: "unmonitored" };
    }

    const verdict = classify(message.text);
    const parent = message.threadParentId ? Store.getMessage(channelId, message.threadParentId) : null;
    const resolved = verdict.fire ? resolveRecipient(message.text, message.userId, parent) : { user: null, how: "n/a" };

    Trace.step({
      runId,
      agent: "Listener",
      phase: "Decide",
      reads: [],
      decision: verdict.reason,
      status: verdict.fire ? "pass" : "stop",
      confidence: verdict.confidence,
      detail: verdict.fire
        ? [
            ["Matched", verdict.matched],
            ["Decided by", verdict.source || "deterministic classifier"],
            ["Recipient", resolved.user ? resolved.user.name : "could not resolve"],
            ["Resolved by", resolved.how],
          ]
        : [
            ["Matched", verdict.matched || "nothing"],
            ["Decided by", verdict.source || "deterministic classifier"],
          ],
    });

    if (!verdict.fire) return { fire: false, stopped: "no-signal" };
    if (!resolved.user) {
      Trace.step({
        runId,
        agent: "Listener",
        phase: "Check",
        reads: ["employees.csv"],
        decision: "Recognition detected but no recipient could be identified. Nothing to act on.",
        status: "stop",
      });
      return { fire: false, stopped: "no-recipient" };
    }

    return { fire: true, confidence: verdict.confidence, recipient: resolved.user, how: resolved.how };
  },

  /* 2. Auth + Validation — the gate. Returns a verdict to the chain and holds
     the full package back for Draft. That split is the least-privilege claim. */
  auth(runId, channelId, message, recipient) {
    const sender = User.get(message.userId);
    const hrisRow = DATA.hris.find((r) => r.employee_id === (recipient && recipient.id));
    const violation = policyHit(message.text);
    const relationship = recipient ? User.relationship(sender.id, recipient.id) : "unknown";

    Trace.step({
      runId,
      agent: "Auth + Validation",
      phase: "Observe",
      reads: ["hris_directory.csv", "client_config.json", "employer_policy.md", "policy_violation_examples.json", "auth_mock.json"],
      decision: "Checking policy, employment record, receivability, self-recognition, budget and identity.",
      status: "pass",
      detail: [["Checks", "5 blocking + 1 non-blocking, first failure wins"]],
    });

    /* Order matters. HRIS presence is checked before receivability because a
       missing row and an ineligible row are different facts, and the trace has
       to be able to say which one stopped the chain. */
    let fail = null;
    if (violation) fail = { code: "policy", why: "Source text trips the employer policy (" + violation + "). Blocked before drafting." };
    else if (!hrisRow) fail = { code: "no-hris", why: "Recipient is not in the HRIS directory, so they are not recognition-eligible." };
    else if (hrisRow.status !== "active" || hrisRow.achievers_enrolled !== "yes" || hrisRow.recognition_eligible !== "yes")
      fail = { code: "not-eligible", why: "Recipient is in HRIS but not receivable: " + ineligibleReason(hrisRow) + ". Suppressed silently — the sender is not told why." };
    else if (recipient.id === sender.id) fail = { code: "self", why: "Sender and recipient are the same person. Self-recognition is not permitted." };
    else if (sender.budget === 0) fail = { code: "budget", why: "Sender has no recognition budget remaining. Suppressed silently — no nudge is shown." };

    /* Verdict only. The chain upstream never sees budget figures or HRIS rows. */
    Trace.step({
      runId,
      agent: "Auth + Validation",
      phase: "Decide",
      reads: [],
      decision: fail ? fail.why : "All blocking checks passed.",
      status: fail ? (fail.code === "policy" ? "stop" : "stop") : "pass",
      detail: [
        ["Verdict", fail ? "👎 fail" : "👍 pass"],
        ["Scope", "verdict only → Listener / Nudge"],
      ],
    });

    if (fail) return { ok: false, code: fail.code, why: fail.why };

    return {
      ok: true,
      needsLogin: !sender.verified,
      package: {
        senderId: sender.id,
        recipientId: recipient.id,
        budgetRemaining: sender.budget,
        hrisRow: hrisRow,
        policy: "clean",
        relationship: relationship,
        awardCap: DATA.clientConfig.per_user_monthly_budget,
      },
    };
  },

  /* Releases the full validation package — only ever to Draft. */
  releasePackage(runId, pkg) {
    Trace.step({
      runId,
      agent: "Auth + Validation",
      phase: "Act",
      reads: ["hris_directory.csv", "client_config.json"],
      decision: "Releasing the full validation package to the Draft agent.",
      status: "pass",
      detail: [
        ["Scope", "full package → Draft only"],
        ["Budget remaining", "$" + pkg.budgetRemaining],
        ["HRIS", pkg.hrisRow.legal_name + " · " + pkg.hrisRow.job_title + " · " + pkg.hrisRow.department],
        ["Eligible", pkg.hrisRow.recognition_eligible],
        ["Policy", pkg.policy],
        ["Relationship", pkg.relationship],
      ],
    });
  },

  /* 3. Nudge — five gates in strict precedence: the user's own opt-out, the
     admin's scope, the agent's self-imposed pause, this sender's personalized
     confidence bar, and finally cooldown. Suppressed signals are discarded at
     every one of them; nothing is buffered or replayed.

     The order is the design. Preference beats policy configuration, both beat
     anything the agent has inferred about itself, and the tuned threshold is
     consulted before the blunt time-based cap. The one exception is the probe,
     which is allowed past the threshold and the cooldown precisely because both
     of them are what it exists to escape. */
  nudge(runId, senderId, confidence) {
    const now = Date.now();
    const mem = memory(senderId);
    const prefs = preferences(senderId);
    const admin = adminGate(senderId);
    const threshold = confidenceThreshold(senderId);
    const probe = probeCheck(senderId);
    const selfPaused = now < mem.live.pausedUntil;
    const inCooldown = now < mem.cooldownUntil;
    const minsLeft = inCooldown ? Math.ceil((mem.cooldownUntil - now) / 60000) : 0;
    const conf = typeof confidence === "number" ? confidence : 1;
    const belowBar = conf < threshold.value;

    const blocked = prefs.opted_out || admin || selfPaused || (!probe.eligible && (belowBar || inCooldown));

    Trace.step({
      runId,
      agent: "Nudge",
      phase: "Observe",
      reads: ["personalization_profiles.json", "nudge_history.csv", "client_config.json"],
      decision: prefs.opted_out
        ? "Sender has nudges switched off."
        : admin
          ? "Sender is out of scope for this workspace's enrolment settings."
          : selfPaused
            ? "The agent paused itself for this sender after a dismissed probe."
            : probe.eligible
              ? "Sender is stuck at the cooldown ceiling. A probe is available."
              : belowBar
                ? "Signal is below this sender's personalized confidence bar."
                : inCooldown
                  ? "Sender is inside an active cooldown window."
                  : "Clear on preference, scope, confidence and cooldown.",
      status: blocked ? "wait" : "pass",
      detail: [
        ["Nudges", prefs.opted_out ? "opted out (" + (prefs.opted_out_by || "user") + ")" : "on · " + prefs.nudge_sensitivity + " sensitivity"],
        ["Enrolment", admin ? admin.code : DATA.clientConfig.enrolment.mode + " · in scope"],
        ["Confidence", conf.toFixed(2) + " vs bar " + threshold.value.toFixed(2)],
        ["Bar set by", threshold.personalized ? threshold.basis : threshold.basis + " (" + threshold.sample + "/" + THRESHOLD_MIN_SAMPLE + " decided)"],
        ["Ladder step", ladderLabel(mem.ladderStep) + (mem.carried ? " · carried in" : "")],
        ["Cooldown left", inCooldown ? minsLeft + " min" : "—"],
        ["Prior dismissals", String(mem.dismissals)],
      ],
    });

    /* Opt-out outranks confidence. A high-confidence signal is exactly the case
       where it would be tempting to override, which is why it cannot be. */
    if (prefs.opted_out) {
      Trace.step({
        runId,
        agent: "Nudge",
        phase: "Decide",
        reads: ["employer_policy.md"],
        decision: "Sender has opted out of nudges. Signal discarded — confidence does not override the preference.",
        status: "stop",
        detail: [
          ["Still receives recognition", "yes — opt-out only stops the prompt to give it"],
          ["Admin override", DATA.clientConfig.enrolment.admin_can_override_user_opt_out ? "permitted" : "not permitted"],
        ],
      });
      return { ok: false };
    }

    if (admin) {
      Trace.step({
        runId,
        agent: "Nudge",
        phase: "Decide",
        reads: ["client_config.json"],
        decision: admin.why + " Signal discarded, and the sender is told nothing — from their side the feature is simply not on.",
        status: "stop",
        detail: admin.detail,
      });
      return { ok: false };
    }

    if (selfPaused) {
      Trace.step({
        runId,
        agent: "Nudge",
        phase: "Decide",
        reads: ["personalization_profiles.json"],
        decision: "Auto-paused after a dismissed probe. The agent asked once more, got its answer, and stopped.",
        status: "stop",
        detail: [
          ["Paused until", new Date(mem.live.pausedUntil).toISOString().slice(0, 10)],
          ["Paused by", "the agent, on itself"],
          ["Probes dismissed", String(mem.live.probesDismissed)],
        ],
      });
      return { ok: false };
    }

    if (probe.eligible) {
      Store.setProfile(senderId, { probeSentAt: now });
      Trace.step({
        runId,
        agent: "Nudge",
        phase: "Decide",
        reads: ["nudge_history.csv", "client_config.json"],
        decision:
          "Sending a probe. " +
          probe.reason +
          " — the ladder has become a silent opt-out, so the agent spends its one prompt to check whether that is what the sender actually wants.",
        status: "pass",
        detail: [
          ["Bypasses", "confidence bar and cooldown, both of which it exists to escape"],
          ["Cost of being wrong", "one interruption, then a " + AUTO_PAUSE_DAYS + "-day auto-pause"],
          ["Probes left in this window", "0"],
        ],
      });
      return { ok: true, probe: true, probeReason: probe.reason, threshold: threshold };
    }

    if (belowBar) {
      Trace.step({
        runId,
        agent: "Nudge",
        phase: "Decide",
        reads: ["personalization_profiles.json"],
        decision:
          "Confidence " + conf.toFixed(2) + " is below this sender's bar of " + threshold.value.toFixed(2) +
          ". The same signal would have fired for someone else — that difference is the personalization.",
        status: "stop",
        detail: [
          ["House default", THRESHOLD_BASE.toFixed(2)],
          ["This sender", threshold.value.toFixed(2)],
          ["Moved by", threshold.basis],
        ],
      });
      return { ok: false };
    }

    if (inCooldown) {
      Trace.step({
        runId,
        agent: "Nudge",
        phase: "Decide",
        reads: [],
        decision: "Signal discarded. It is not buffered or replayed later — by design, a suppressed nudge is simply lost.",
        status: "stop",
      });
      return { ok: false };
    }
    return { ok: true, probe: false, threshold: threshold };
  },

  /* 4. Draft — produces the four output fields the human will approve. */
  draft(runId, card) {
    const recipient = User.get(card.recipientId);
    const tone = toneModel(card.senderId);
    const rules = DATA.recognitionRulebook;
    const style = DATA.houseStyle();

    Trace.step({
      runId,
      agent: "Draft",
      phase: "Observe",
      reads: ["core_values.json", "recognition_guidelines.md", "recognition_samples.json", "personalization_profiles.json", "client_config.json"],
      decision: tone
        ? "Reading house style, the value taxonomy, and " + tone.samples + " prior edits of this sender's own drafts."
        : "Reading house style and the value taxonomy. No tone history for this sender — falling back to the samples file.",
      status: "pass",
      detail: [
        ["Value taxonomy", DATA.coreValueCatalog.length + " values · " + DATA.coreValueCatalog.reduce((n, v) => n + (v.signals || []).length, 0) + " signals compiled from core_values.json"],
        ["House style", style.samples + " samples · median " + style.median_words + " words · " + style.exclamation_rate.toFixed(2) + " exclamation rate — measured from recognition_samples.json, not assumed"],
        ["Rulebook", rules.avoid.length + " avoid-rules + length limits, compiled from recognition_guidelines.md"],
        ["Voice", tone ? tone.register + " · ~" + tone.avg_words + " words · " + (tone.uses_emoji ? "uses emoji" : "no emoji") : "house style"],
        ["Learned from", tone ? tone.samples + " approved or edited drafts" : "recognition_samples.json"],
      ],
    });

    /* The model writes the words when it can. composeDraft() still runs either
       way: it is the fallback when there is no key or the call failed, and its
       register and tone readings are the trace's account of this sender's voice
       regardless of which path produced the text. */
    const registerKey = registerFor(card.senderId, recipient.id);
    const modelDraft =
      typeof LLM !== "undefined" && LLM.cachedDraft
        ? LLM.cachedDraft(card.sourceText, card.senderId, recipient.id)
        : null;

    /* Value comes from the model when the model drafted, gated against
       core_values.json; from the signal lists directly when it did not. Both
       roads end at the same place — blank when nothing in the file supports a
       claim about this person's work. */
    const pick = modelDraft
      ? gateCoreValue(modelDraft.proposedValue, card.sourceText)
      : Object.assign(pickCoreValue(card.sourceText), { proposed: "", gate: "" });

    const composed = composeDraft(recipient.name, card.sourceText, pick.value, tone, registerKey);
    const message = modelDraft ? modelDraft.message : composed.text;
    const writtenBy = modelDraft ? modelDraft.source : "composeDraft() — deterministic fallback";
    /* Stored as a number so it stays comparable against point_values and the
       budget cap. Only the trace and the modal add the currency symbol. */
    const amount = DATA.clientConfig.default_award;

    Trace.step({
      runId,
      agent: "Draft",
      phase: "Decide",
      reads: ["core_values.json", "recognition_guidelines.md", "recognition_samples.json"],
      decision: pick.value
        ? "Core value " + pick.value + " — " + (modelDraft ? pick.gate : pick.basis) + "."
        : "No core value. " +
          (modelDraft ? pick.gate : pick.basis) +
          ", so the field is left blank for the human rather than defaulted to whichever value sits first in the file.",
      status: pick.value ? "pass" : "info",
      detail: [
        ["Written by", writtenBy],
        modelDraft
          ? ["Value proposed", (pick.proposed || "none") + " — proposed by the model, checked against core_values.json before it reached the field"]
          : ["Scores", pick.scores.map((s) => s.value + " " + s.score).join(" · ")],
        modelDraft
          ? ["Gate", pick.gate]
          : ["Tie-break", "catalog order in core_values.json"],
        ["Register", composed.registerRow + " — " + rules.register_by_relationship[registerKey].register],
        ["Shape", composed.shape + (tone ? " (from this sender's tone model)" : " (no tone model — house default)")],
        modelDraft
          ? ["Boundary self-check", modelDraft.addedNothing ? "the model states every claim is traceable to the source" : "the model could not confirm every claim is traceable to the source"]
          : ["Frame", composed.frameSource],
        modelDraft
          ? ["Model rationale", modelDraft.rationale || "—"]
          : ["Impact clause", composed.impactSource],
        ["Work object", composed.workObject ? '"' + composed.workObject + '" — named by the sender' : "none in the source; impact stated generally"],
      ],
    });

    const fields = { recipientId: recipient.id, coreValue: pick.value || "", message: message, amount: amount };
    /* Kept so Personalization can diff the human's final text against what the
       agent proposed. Tier 1 — cleared with the rest of working memory when the
       card resolves. */
    card.draftMessage = message;

    Trace.step({
      runId,
      agent: "Draft",
      phase: "Act",
      reads: [],
      decision: "Drafted recognition for human review. Nothing is sent yet.",
      status: "pass",
      output: {
        Recipient: recipient.name,
        "Core value": pick.value || "— blank, for the human to choose",
        Message: message,
        Award: "$" + amount,
      },
    });

    /* Two separate questions, both run on the agent's own words. House style is
       the rulebook out of recognition_guidelines.md; policy is employer_policy.md
       and is the same check Submission will run again on whatever the human
       submits. Either one failing means the draft is never shown. */
    const house = guidelineCheck(message);
    const violation = policyHit(message);
    const clean = house.ok && !violation;

    Trace.step({
      runId,
      agent: "Draft",
      phase: "Check",
      reads: ["recognition_guidelines.md", "employer_policy.md"],
      decision: clean
        ? "Draft passes all " + house.rulesRun + " rules in recognition_guidelines.md and the policy check. Handing to the human."
        : "Draft failed its own output check and will not be shown: " + house.failures.concat(violation ? [violation] : []).join("; ") + ".",
      status: clean ? "pass" : "stop",
      detail: [
        ["Rules run", house.rulesRun + " from recognition_guidelines.md"],
        ["Length", house.chars + " / " + MAX_DRAFT_CHARS + " chars · " + house.sentences + " / " + DATA.recognitionRulebook.max_sentences + " sentences"],
        [
          "Word target",
          house.words + " words · target " + DATA.recognitionRulebook.word_target.min + "–" + DATA.recognitionRulebook.word_target.max +
            (house.onTarget ? " · on target" : " · off target, advisory only — the tone model outranks it"),
        ],
        ["Avoid-list", house.broke.length ? house.broke.join("; ") : "clean"],
        ["Policy", violation ? violation : "clean"],
      ],
    });

    if (!clean) return null;

    Trace.step({
      runId,
      agent: "Human",
      phase: "Decide",
      reads: [],
      decision: "Waiting on the human: submit, edit the fields, or dismiss.",
      status: "wait",
    });

    return fields;
  },

  /* 5. Submission — runs only on an explicit human submit. */
  submission(runId, card) {
    const recipient = User.get(card.fields.recipientId);
    const rules = DATA.clientConfig.recognition_rules;

    /* Required fields, from client_config.json rather than from a list typed
       here. The Draft agent leaves the core value blank when core_values.json
       gave it nothing to go on, and the modal disables Submit while it is —
       but the disabled button is only the early warning. The refusal lives in
       the agent that owns the call, the same way the policy block does. */
    const missing = [];
    if (rules.core_value_required && !String(card.fields.coreValue || "").trim()) missing.push("core value");
    if (rules.message_required && !String(card.fields.message || "").trim()) missing.push("message");
    if (!card.fields.recipientId) missing.push("recipient");
    if (missing.length) {
      Trace.step({
        runId,
        agent: "Submission",
        phase: "Check",
        reads: ["client_config.json", "core_values.json"],
        decision: "Required field missing: " + missing.join(", ") + ". The platform is not called.",
        status: "stop",
        detail: [
          ["Missing", missing.join(", ")],
          ["Required by", "recognition_rules in client_config.json"],
          ["Recoverable", "yes — the human fills the field and submits again"],
        ],
      });
      return { ok: false, error: "missing_required", missing: missing };
    }

    /* Final check, and the only one that matters: Draft vetted its own text, but
       the human may have rewritten it since. This runs on what is actually about
       to be posted, before the POST step exists.

       Two passes, in this order and never the other way round. The word list
       decides first and its answer is final. Only text it has already cleared
       reaches the model, so the model can add a block but can never lift one. */
    const violation = policyHit(card.fields.message);
    if (violation) {
      Trace.step({
        runId,
        agent: "Submission",
        phase: "Check",
        reads: ["employer_policy.md", "policy_violation_examples.json"],
        decision: "Final check failed on the human's edited text. The platform is not called at all.",
        status: "stop",
        detail: [
          ["Issue", violation],
          ["Caught by", "the deterministic word list — no model call needed"],
          ["Checked", "human-edited message, not the drafted one"],
          ["Recoverable", "yes — correct the message and submit again"],
        ],
      });
      return { ok: false, error: "policy_block", violation: violation };
    }

    /* Second pass. Null whenever there is no key, the call failed, or nothing
       was warmed — in every one of those cases the word list's clearance stands
       and this adds nothing, which is the point of running it second. */
    const judged =
      typeof LLM !== "undefined" && LLM.cachedPolicy ? LLM.cachedPolicy(card.fields.message) : null;
    if (judged && !judged.allowed) {
      Trace.step({
        runId,
        agent: "Submission",
        phase: "Check",
        reads: ["employer_policy.md", "policy_violation_examples.json"],
        decision:
          "The word list cleared this text and the policy judge did not. Blocked on the judge's reading. The platform is not called at all.",
        status: "stop",
        detail: [
          ["Issue", judged.violation || "policy"],
          ["Caught by", judged.source + " — the word list had no match for it"],
          ["Quote", judged.quote || "—"],
          ["Explanation", judged.explanation || "—"],
          ["Recoverable", "yes — correct the message and submit again"],
        ],
      });
      return { ok: false, error: "policy_block", violation: judged.violation || "policy" };
    }

    /* null/undefined = the demo's simulated 25% failure. Anything else is an
       eval pinning the outcome: true forces the error, any falsy override
       forces success. */
    const forced = Agents.__forceSubmitError;
    const errored = forced === null || forced === undefined
      ? Math.random() < PLATFORM_ERROR_RATE
      : forced === true;

    Trace.step({
      runId,
      agent: "Submission",
      phase: "Act",
      reads: ["achievers_api_mock.json"],
      decision: "POST /v1/recognitions with the approved fields.",
      status: "pass",
      detail: [
        ["Recipient", recipient ? recipient.name : card.fields.recipientId],
        ["Points", "$" + card.fields.amount],
        ["Source", "slack:" + card.runId],
      ],
    });

    if (errored) {
      Trace.step({
        runId,
        agent: "Submission",
        phase: "Check",
        reads: [],
        decision: "Platform returned an error. The draft is preserved and the human can retry — nothing is lost.",
        status: "stop",
        detail: [["Code", "platform_error"], ["Retryable", "yes"]],
      });
      return { ok: false, error: "platform_error" };
    }

    Trace.step({
      runId,
      agent: "Submission",
      phase: "Check",
      reads: [],
      decision: "Recognition accepted by the platform.",
      status: "pass",
      detail: [["Status", "201 created"]],
    });

    /* The mock platform's side of the call — the record the Achievers view
       reads back. Not agent memory; no behavioural data lives here. */
    Store.pushRecognition({
      senderId: card.senderId,
      recipientId: card.fields.recipientId,
      coreValue: card.fields.coreValue,
      message: card.fields.message,
      amount: card.fields.amount,
      source: "slack:" + card.runId,
    });

    return { ok: true };
  },

  /* 6. Personalization — the only agent that writes to durable memory. */
  personalization(runId, card, outcome, channelId) {
    const senderId = card.senderId;
    const before = Store.profile(senderId);
    let step = before.ladderStep;
    let cooldownUntil = 0;
    let note = "";

    const top = COOLDOWN_LADDER_HOURS.length - 1;

    if (outcome === "sent" || outcome === "edited") {
      step = -1;
      cooldownUntil = 0;
      note = "Accepted — cooldown ladder reset to the bottom.";
    } else if (outcome === "dismissed") {
      step = Math.min(before.ladderStep + 1, top);
      cooldownUntil = Date.now() + ladderHours(step) * 3600000;
      note = "Explicit dismissal — ladder advances one step to " + ladderHours(step) + "h.";
    } else {
      note = "Terminal state recorded. Cooldown unchanged.";
      cooldownUntil = before.cooldownUntil;
      step = before.ladderStep;
    }

    /* Behaviour #3, the closing half. A probe is a question with exactly one
       follow-up: dismissed, and the agent stops asking for a month without
       waiting to be told. This is the only place the agent restricts itself. */
    let pausedUntil = before.pausedUntil;
    let probesDismissed = before.probesDismissed;
    if (card.probe && outcome === "dismissed") {
      pausedUntil = Date.now() + AUTO_PAUSE_DAYS * DAY_MS;
      probesDismissed = before.probesDismissed + 1;
      note = "Probe dismissed. The agent is pausing itself for " + AUTO_PAUSE_DAYS + " days — no further prompts, no escalation.";
    } else if (card.probe && (outcome === "sent" || outcome === "edited")) {
      note = "Probe accepted after " + PROBE_AFTER_DAYS + "+ days of silence. The ladder was wrong about this sender; it resets.";
    }

    /* Behaviour #2, the learning half. The human's edit is the only ground truth
       the agent gets about voice, and it is reduced to five numbers before
       anything is written. No draft text, no final text, nothing reconstructable
       — the diff is computed in working memory and thrown away with it.

       Gated on the message text actually differing, not on `wasEdited`. Filling
       in a core value the agent left blank is an edit to the record, not a
       statement about voice — counting it would have the agent learning its own
       words back as if a human had chosen them. */
    const edit =
      outcome === "edited" && card.draftMessage && card.fields && card.fields.message !== card.draftMessage
        ? editSignal(card.draftMessage, card.fields.message)
        : null;

    const category = card.recipientId ? User.relationship(senderId, card.recipientId) : "unknown";
    const affinity = Object.assign({}, before.categoryAffinity);
    if (category !== "unknown") affinity[category] = (affinity[category] || 0) + 1;

    Store.setProfile(senderId, {
      ladderStep: step,
      cooldownUntil: cooldownUntil,
      dismissals: before.dismissals + (outcome === "dismissed" ? 1 : 0),
      accepts: before.accepts + (outcome === "sent" || outcome === "edited" ? 1 : 0),
      edits: before.edits + (card.wasEdited ? 1 : 0),
      categoryAffinity: affinity,
      lastNudgeAt: Date.now(),
      pausedUntil: pausedUntil,
      probesDismissed: probesDismissed,
      toneSamples: before.toneSamples + (edit ? 1 : 0),
      toneWords: before.toneWords + (edit ? edit.finalWords : 0),
      toneEmoji: before.toneEmoji + (edit && edit.addedEmoji ? 1 : 0),
      toneExclaim: before.toneExclaim + (edit && edit.exclaimDelta > 0 ? 1 : 0),
      lastEditWordDelta: edit ? edit.wordDelta : before.lastEditWordDelta,
    });

    Store.pushHistory({ userId: senderId, outcome: outcome, channelId: channelId });

    /* Tier 1 is working memory, so the Listener's cached model verdict has to go
       with the message text. Otherwise the claim in the trace below is a lie. */
    if (typeof LLM !== "undefined") LLM.forget(card.sourceText);

    const after = confidenceThreshold(senderId);

    Trace.step({
      runId,
      agent: "Personalization",
      phase: "Act",
      reads: ["personalization_profiles.json", "nudge_history.csv"],
      decision: note,
      status: "info",
      detail: [
        ["Outcome", outcome + (card.probe ? " (probe)" : "")],
        ["New ladder step", ladderLabel(step)],
        ["Confidence bar now", after.value.toFixed(2) + " · " + after.basis],
        [
          "Tone learned",
          edit
            ? (edit.rewritten ? "substantial rewrite" : "light edit") +
              " · " + (edit.wordDelta >= 0 ? "+" : "") + edit.wordDelta + " words" +
              (edit.addedEmoji ? " · added emoji" : "") +
              (edit.exclaimDelta > 0 ? " · added emphasis" : "")
            : "nothing new — no edit to learn from",
        ],
        ["Affinity stored", category + " — category only, never a named individual"],
        ["Message text", "discarded; working memory cleared"],
      ],
    });
  },
};

/* --------------------------------------------------------------- pipeline */

const Pipeline = {
  onMessage(channelId, message) {
    if (!message || message.userId === BOT.id || message.ephemeral) return;

    const runId = Trace.begin({
      messageId: message.id,
      channelId: channelId,
      userId: message.userId,
      text: message.text,
    });

    const heard = Agents.listener(runId, channelId, message);
    if (!heard.fire) {
      Trace.end(runId, heard.stopped === "no-signal" ? "silent" : "blocked");
      return;
    }

    const verdict = Agents.auth(runId, channelId, message, heard.recipient);
    if (!verdict.ok) {
      Trace.end(runId, verdict.code === "policy" ? "blocked" : "silent");
      return;
    }

    /* The Listener answers "is this recognition" — a judgment about text, the
       same for everyone. Whether that answer clears the bar for *this* sender is
       a personalization question, so the confidence travels here and the
       threshold lives in the Nudge agent. */
    const gate = Agents.nudge(runId, message.userId, heard.confidence);
    if (!gate.ok) {
      Trace.end(runId, "silent");
      return;
    }

    /* Small delay so a viewer sees the chain resolve rather than teleport.
       Evals set __immediate to make the same path synchronous. */
    const emit = () => {
      const card = {
        runId: runId,
        stage: verdict.needsLogin ? "login" : "nudge",
        resolution: null,
        senderId: message.userId,
        recipientId: heard.recipient.id,
        recipientName: heard.recipient.name,
        sourceText: message.text,
        needsLogin: verdict.needsLogin,
        confidence: heard.confidence,
        /* Set only when the Nudge agent spent its one escape-hatch prompt.
           Personalization reads it to decide whether a dismissal means "not this
           one" or "stop asking". */
        probe: !!gate.probe,
        /* Why the probe was allowed through, in the agent's own words. The card
           says it out loud rather than looking like an ordinary nudge that
           mysteriously ignored the cooldown. */
        probeReason: gate.probeReason || null,
        threshold: gate.threshold ? gate.threshold.value : null,
        draftMessage: null,
        validation: verdict.package,
        fields: null,
        wasEdited: false,
        createdAt: Date.now(),
        /* Set only when the card reaches the draft stage — an ephemeral nudge has
           no deadline of its own. */
        sessionExpiresAt: 0,
        sessionExpired: false,
        submissionError: null,
        /* Set by the Submission agent's final check once a human edit exists. */
        policyViolation: null,
      };

      Trace.step({
        runId,
        agent: "Nudge",
        phase: "Act",
        reads: [],
        decision: verdict.needsLogin
          ? "Posting an ephemeral prompt, but identity is unverified — the human must log in first."
          : "Posting an ephemeral nudge visible only to the sender.",
        status: verdict.needsLogin ? "wait" : "pass",
        detail: [
          ["Surface", "chat.postEphemeral"],
          ["Visible to", (User.get(message.userId) || {}).name + " only"],
          ["Identity", verdict.needsLogin ? "unverified — manual login required" : "verified via Slack OAuth"],
        ],
      });

      Store.addMessage(channelId, { userId: BOT.id, text: "", ephemeral: true, card: card });
    };

    if (Pipeline.__immediate) emit();
    else setTimeout(emit, 600 + Math.floor(Math.random() * 600));
  },

  /* opts.deferDraft is set by ui.js, and only when a key is present. It opens
     the modal on an empty message field so the human sees the shell of the
     draft immediately, then ui.js awaits the model and calls redraft().

     The eval harness calls accept() with no options and gets the old fully
     synchronous behaviour, which is why ~11 cases that read fields on the next
     line still work. Deferral is a property of the browser's impatience, not of
     the agent. */
  accept(channelId, messageId, opts) {
    const msg = Store.getMessage(channelId, messageId);
    if (!msg || !msg.card || msg.card.resolution) return;
    const card = msg.card;

    Trace.step({
      runId: card.runId,
      agent: "Human",
      phase: "Act",
      reads: [],
      decision: "Human accepted the nudge and asked for a draft.",
      status: "pass",
    });

    Agents.releasePackage(card.runId, card.validation);

    if (opts && opts.deferDraft) {
      const recipient = User.get(card.recipientId);
      Store.updateCard(channelId, messageId, {
        stage: "draft",
        drafting: true,
        fields: { recipientId: card.recipientId, coreValue: "", message: "", amount: DATA.clientConfig.default_award },
        draftMessage: null,
        sessionExpiresAt: Date.now() + SESSION_TTL_MS,
        sessionExpired: false,
      });
      Trace.step({
        runId: card.runId,
        agent: "Draft",
        phase: "Act",
        reads: [],
        decision: "Writing the recognition. The form is open; the message field fills when the model returns.",
        status: "pass",
        detail: [["Recipient", recipient ? recipient.name : card.recipientId], ["Award", "$" + DATA.clientConfig.default_award]],
      });
      return;
    }

    const fields = Agents.draft(card.runId, card);

    if (!fields) {
      Store.updateCard(channelId, messageId, { stage: "resolved", resolution: "blocked", draftMessage: null });
      Agents.personalization(card.runId, card, "blocked", channelId);
      Trace.end(card.runId, "blocked");
      return;
    }

    Store.updateCard(channelId, messageId, {
      stage: "draft",
      fields: fields,
      /* The agent's own words, kept only so Personalization can diff them against
         whatever the human submits. Cleared on every resolution path below. */
      draftMessage: fields.message,
      sessionExpiresAt: Date.now() + SESSION_TTL_MS,
      sessionExpired: false,
    });
  },

  /* The second half of a deferred accept. Runs the Draft agent for real, now
     that ui.js has awaited the model and the draft is sitting in the cache.
     Falls through to composeDraft() if the call failed, so a dead network gives
     a slightly slower version of the old behaviour rather than an empty form. */
  redraft(channelId, messageId) {
    const msg = Store.getMessage(channelId, messageId);
    if (!msg || !msg.card || msg.card.resolution) return;
    const card = msg.card;
    if (!card.drafting) return;

    const fields = Agents.draft(card.runId, card);

    if (!fields) {
      Store.updateCard(channelId, messageId, { stage: "resolved", resolution: "blocked", drafting: false, draftMessage: null });
      Agents.personalization(card.runId, card, "blocked", channelId);
      Trace.end(card.runId, "blocked");
      return;
    }

    Store.updateCard(channelId, messageId, {
      stage: "draft",
      drafting: false,
      fields: fields,
      draftMessage: fields.message,
    });
  },

  login(channelId, messageId) {
    const msg = Store.getMessage(channelId, messageId);
    if (!msg || !msg.card || msg.card.resolution) return;
    const card = msg.card;

    Trace.step({
      runId: card.runId,
      agent: "Human",
      phase: "Act",
      reads: [],
      decision: "Human completed the manual login.",
      status: "pass",
    });

    Trace.step({
      runId: card.runId,
      agent: "Auth + Validation",
      phase: "Check",
      reads: ["auth_mock.json"],
      decision: "Identity verified. Session opened.",
      status: "pass",
      detail: [["Verdict", "👍 pass"], ["Session TTL", SESSION_TTL_MS / 1000 + "s"]],
    });

    Store.updateCard(channelId, messageId, { stage: "nudge", needsLogin: false });
  },

  editField(channelId, messageId, field, value) {
    const msg = Store.getMessage(channelId, messageId);
    if (!msg || !msg.card || !msg.card.fields || msg.card.resolution) return;
    const card = msg.card;
    const fields = Object.assign({}, card.fields);
    fields[field] = value;

    /* One trace step per run, not per keystroke. */
    if (!card.wasEdited) {
      Trace.step({
        runId: card.runId,
        agent: "Human",
        phase: "Act",
        reads: [],
        decision: "Human edited the drafted fields before approving.",
        status: "pass",
        detail: [["First edit", field]],
      });
    }

    /* Submission's final check, run early so Submit can disable the moment the
       edit lands rather than only on the click. Gated on the verdict changing,
       so correcting the text is as visible in the trace as breaking it. */
    const was = card.policyViolation || null;
    const now = policyHit(fields.message) || null;
    if (now !== was) {
      Trace.step({
        runId: card.runId,
        agent: "Submission",
        phase: "Check",
        reads: ["employer_policy.md", "policy_violation_examples.json"],
        decision: now
          ? "The edited draft breaks employer policy. Submit is blocked until the human corrects it — nothing is queued or sent."
          : "The edited draft is clean again. Submit re-enabled.",
        status: now ? "stop" : "pass",
        detail: [["Issue", now || "none"], ["Checked", "human-edited message"]],
      });
    }

    /* A field the human has now filled is no longer missing. Cleared here rather
       than on the next submit so the banner and the Submit button track what is
       on screen. */
    const stillMissing = (card.missingRequired || []).filter((f) =>
      f === "core value" ? !String(fields.coreValue || "").trim()
      : f === "message" ? !String(fields.message || "").trim()
      : !fields.recipientId,
    );

    Store.updateCard(channelId, messageId, {
      fields: fields,
      wasEdited: true,
      policyViolation: now,
      missingRequired: stillMissing.length ? stillMissing : null,
      submissionError: card.submissionError === "missing_required" && !stillMissing.length ? null : card.submissionError,
    });
  },

  submit(channelId, messageId) {
    const msg = Store.getMessage(channelId, messageId);
    if (!msg || !msg.card || !msg.card.fields || msg.card.resolution) return;
    const card = msg.card;
    if (card.sessionExpired) return;

    Trace.step({
      runId: card.runId,
      agent: "Human",
      phase: "Act",
      reads: [],
      decision: "Approved and submitted.",
      status: "pass",
    });

    const result = Agents.submission(card.runId, card);
    if (!result.ok) {
      Store.updateCard(channelId, messageId, {
        submissionError: result.error,
        policyViolation: result.violation || null,
        missingRequired: result.missing || null,
      });
      return;
    }

    Store.updateCard(channelId, messageId, {
      stage: "resolved",
      resolution: "sent",
      submissionError: null,
      policyViolation: null,
      missingRequired: null,
      draftMessage: null,
    });
    const outcome = card.wasEdited ? "edited" : "sent";
    Agents.personalization(card.runId, Object.assign({}, card, { wasEdited: card.wasEdited }), outcome, channelId);
    Trace.end(card.runId, "sent");
  },

  dismiss(channelId, messageId, via) {
    const msg = Store.getMessage(channelId, messageId);
    if (!msg || !msg.card || msg.card.resolution) return;
    const card = msg.card;
    const label =
      via === "x" ? "Dismissed via ✕" : via === "clickaway" ? "Dismissed by clicking away" : "Dismissed via Not now";

    Trace.step({
      runId: card.runId,
      agent: "Human",
      phase: "Act",
      reads: [],
      decision: label + ".",
      status: "stop",
      detail: [["Path", via]],
    });

    Store.updateCard(channelId, messageId, { stage: "resolved", resolution: "dismissed", draftMessage: null });
    Agents.personalization(card.runId, card, "dismissed", channelId);
    Trace.end(card.runId, "dismissed");
  },

  reconnect(channelId, messageId) {
    const msg = Store.getMessage(channelId, messageId);
    if (!msg || !msg.card || msg.card.resolution) return;
    const card = msg.card;

    Trace.step({
      runId: card.runId,
      agent: "Auth + Validation",
      phase: "Act",
      reads: ["auth_mock.json"],
      decision: "Session re-established. The draft the human already edited is intact.",
      status: "pass",
      detail: [["Verdict", "👍 pass"], ["Edits preserved", card.wasEdited ? "yes" : "n/a"]],
    });

    Store.updateCard(channelId, messageId, {
      sessionExpired: false,
      sessionExpiresAt: Date.now() + SESSION_TTL_MS,
    });
  },

  /* Idempotent and cheap — runs on a 30s interval. */
  sweep() {
    const now = Date.now();
    Store.channels().forEach((channel) => {
      Store.messages(channel.id).forEach((msg) => {
        const card = msg.card;
        if (!card || card.resolution) return;

        if (card.stage === "draft" && !card.sessionExpired && card.sessionExpiresAt && now > card.sessionExpiresAt) {
          Store.updateCard(channel.id, msg.id, { sessionExpired: true });
          Trace.step({
            runId: card.runId,
            agent: "Auth + Validation",
            phase: "Check",
            reads: ["auth_mock.json"],
            decision: "Session expired mid-draft. Edits are held; the human can reconnect without losing work.",
            status: "wait",
            detail: [["Session TTL", SESSION_TTL_MS / 1000 + "s"]],
          });
          return;
        }

        /* No nudge-stage branch: an ephemeral card has no expiry the app can
           observe. It stands until the sender acts or Slack drops it on reload. */
      });
    });
  },
};
