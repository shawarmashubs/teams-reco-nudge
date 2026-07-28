/* data.js — synthetic context files + persistent store.
   Everything here is fake. No real people, no real APIs. */

const KEY = "slackNudge.";
const K = {
  messages: KEY + "messages",
  channels: KEY + "channels",
  user: KEY + "currentUser",
  channel: KEY + "activeChannel",
  profiles: KEY + "profiles",
  history: KEY + "history",
  /* The mock Achievers platform's own store — what the recognition wall shows.
     Not agent memory: this is the other side of POST /v1/recognitions. */
  recognitions: KEY + "recognitions",
};

/* ------------------------------------------------------------------ people */

const DATA = {};

/* Budget is a three-part record, not a single number: what the program gave the
   sender this period, what they have already spent, and what is left. Auth only
   ever reads what is left — `budget` — but employees.csv has to show the ledger
   behind it, because "available balance per sender" is the PRD's data item and a
   bare number does not explain itself.

   `spent` and `budget` are placeholders here. They are recomputed further down
   from this month's accepted nudges, because a ledger that contradicts the
   outcome log is a bug waiting to be demoed. `carriedSpend` is the part of the
   month's spend that did not come through Slack — someone opening the Achievers
   platform and awarding directly. */
DATA.employees = [
  { id: "u1", name: "Priya Nair", handle: "priya", title: "Staff Designer", dept: "Design", managerId: "u4", color: "#5b3fa0", tz: "America/Toronto", allocated: 200, carriedSpend: 0, spent: 0, budget: 200, verified: true },
  { id: "u2", name: "Sam Okafor", handle: "sam", title: "Backend Engineer", dept: "Engineering", managerId: "u4", color: "#c4314b", tz: "Europe/London", allocated: 200, carriedSpend: 0, spent: 0, budget: 200, verified: true },
  { id: "u3", name: "Jordan Lee", handle: "jordan", title: "Product Manager", dept: "Product", managerId: "u4", color: "#0f6cbd", tz: "America/New_York", allocated: 200, carriedSpend: 0, spent: 0, budget: 200, verified: true },
  { id: "u4", name: "Ava Torres", handle: "ava", title: "Director, Product", dept: "Product", managerId: null, color: "#0e7f5a", tz: "America/New_York", allocated: 600, carriedSpend: 0, spent: 0, budget: 600, verified: true },
  /* Allocated the same $200 as everyone and spent all of it in the Achievers
     platform on the 2nd, then dismissed all seventeen nudges since. Not a
     disengaged recognizer — a disengaged *nudge* recipient, which is a different
     problem and the one a personalized threshold is supposed to solve. Auth
     stops him on budget before any of that matters. */
  { id: "u5", name: "Liam Chen", handle: "liam", title: "Data Analyst", dept: "Analytics", managerId: "u4", color: "#986f0b", tz: "America/Vancouver", allocated: 200, carriedSpend: 200, spent: 200, budget: 0, verified: true },
  { id: "u6", name: "Noor Haidari", handle: "noor", title: "Solutions Consultant", dept: "Customer Success", managerId: "u4", color: "#8764b8", tz: "Asia/Dubai", allocated: 200, carriedSpend: 0, spent: 0, budget: 200, verified: false },
  { id: "u7", name: "Diego Ramirez", handle: "diego", title: "QA Engineer", dept: "Engineering", managerId: "u4", color: "#b4009e", tz: "America/Mexico_City", allocated: 200, carriedSpend: 0, spent: 0, budget: 200, verified: true },
  { id: "u8", name: "Mei Tanaka", handle: "mei", title: "Content Strategist", dept: "Marketing", managerId: "u4", color: "#038387", tz: "Asia/Tokyo", allocated: 200, carriedSpend: 0, spent: 0, budget: 200, verified: true },
];

DATA.contractor = { id: "u9", name: "Alex Rowe", handle: "alex", title: "Contractor", dept: "External", color: "#616061" };

const BOT = { id: "bot-nudge", name: "Recognition Nudge", color: "#611f69", isBot: true };

/* The employment and Achievers-side facts the employee record does not carry.
   points_balance is the PRD's second at-risk persona in one column: the people
   sitting on a large unredeemed balance are exactly the ones who never log in. */
const HRIS_EXTRA = {
  u1: { hire_date: "2019-03-11", location: "Toronto, CA", employment_type: "full_time", enrolled_on: "2019-04-01", points_balance: 4150 },
  u2: { hire_date: "2021-09-06", location: "London, UK", employment_type: "full_time", enrolled_on: "2021-10-01", points_balance: 9800 },
  u3: { hire_date: "2020-01-20", location: "New York, US", employment_type: "full_time", enrolled_on: "2020-02-01", points_balance: 2600 },
  u4: { hire_date: "2017-06-05", location: "New York, US", employment_type: "full_time", enrolled_on: "2017-07-01", points_balance: 12400 },
  u5: { hire_date: "2022-11-14", location: "Vancouver, CA", employment_type: "full_time", enrolled_on: "2022-12-01", points_balance: 700 },
  u6: { hire_date: "2026-07-20", location: "Dubai, AE", employment_type: "full_time", enrolled_on: "2026-07-22", points_balance: 0 },
  u7: { hire_date: "2026-07-20", location: "Mexico City, MX", employment_type: "full_time", enrolled_on: "2026-07-22", points_balance: 0 },
  u8: { hire_date: "2018-08-27", location: "Tokyo, JP", employment_type: "full_time", enrolled_on: "2018-09-01", points_balance: 6350 },
};

/* HRIS is deliberately a subset of the people who appear in Slack — Alex Rowe is
   absent, which drives eval case 10. `achievers_enrolled` and
   `recognition_eligible` are the two receivability columns the Auth agent reads;
   both are "yes" for every active employee here, and Auth stops the chain if
   either ever isn't. */
DATA.hris = DATA.employees.map((e) => {
  const x = HRIS_EXTRA[e.id] || {};
  return {
    employee_id: e.id,
    legal_name: e.name,
    job_title: e.title,
    department: e.dept,
    manager_id: e.managerId || "",
    employment_type: x.employment_type || "full_time",
    location: x.location || "",
    hire_date: x.hire_date || "",
    status: "active",
    achievers_enrolled: "yes",
    enrolled_on: x.enrolled_on || "",
    recognition_eligible: "yes",
    points_balance: x.points_balance === undefined ? 0 : x.points_balance,
  };
});

/* The client's value taxonomy with the descriptions the PRD asks for. Labels
   alone are not a catalog — the Draft agent has to pick one value over four
   others, and "Excellence" versus "Going Above & Beyond" is only decidable if
   something says where the line is.

   `signals` is the machine-readable half of `looks_like`: the terms the Draft
   agent actually matches on, living in the file beside the prose they encode.
   The agent compiles them at read time, so a client who renames or re-scopes a
   value changes the agent's behaviour by editing this catalog and nothing else.
   Order is load-bearing — it breaks ties when two values score the same. */
DATA.coreValueCatalog = [
  {
    id: "teamwork",
    label: "Teamwork",
    description: "Work that only happened because someone stepped outside their own lane to make a colleague's job possible.",
    looks_like: ["Covering a deploy for someone who was out", "Pairing on a problem that was not theirs", "Unblocking another team before being asked"],
    not_this: "Doing your own job well — that is Excellence.",
    signals: ["helped", "help", "helping", "jumped in", "jumping in", "stepped in", "covered", "covering", "unblocked", "unblocking", "paired", "pairing", "short-handed", "short handed", "filled in", "took over", "backfilled"],
  },
  {
    id: "customer_focus",
    label: "Customer Focus",
    description: "A decision made from the customer's side of the table, especially when it cost something internally.",
    looks_like: ["Catching an escalation before the customer chased", "Rewriting a workflow because users kept failing at it", "Taking the support rotation during a launch"],
    not_this: "Any work that happens to touch a customer account.",
    signals: ["customer", "customers", "client", "clients", "escalation", "escalations", "renewal", "support rotation", "users", "end user", "churn"],
  },
  {
    id: "innovation",
    label: "Innovation",
    description: "A different approach that removed work rather than adding cleverness to it.",
    looks_like: ["Automating a step that used to be manual", "Proposing the simpler design that shipped", "Prototyping instead of arguing"],
    not_this: "Using a new tool. Novelty is not innovation.",
    signals: ["automated", "automating", "automation", "script", "scripted", "prototype", "prototyped", "new approach", "simpler", "simplified", "redesigned", "rethought", "removed a step", "cut a step"],
  },
  {
    id: "excellence",
    label: "Excellence",
    description: "Craft. Work that held up under pressure because of the care put into it before the pressure arrived.",
    looks_like: ["A review that caught the thing everyone else missed", "Documentation someone actually used", "A migration with no rollback"],
    not_this: "Volume of output.",
    signals: ["quality", "thorough", "thoroughly", "detail", "detailed", "review", "reviewed", "caught", "edge case", "documentation", "docs", "runbook", "rigour", "rigor", "accurate", "polish", "polished", "migration", "no rollback", "proofread"],
  },
  {
    id: "above_and_beyond",
    label: "Going Above & Beyond",
    description: "Discretionary effort. Someone chose to keep going at a point where stopping would have been entirely reasonable.",
    looks_like: ["Staying with an incident past handover", "Picking up a gap nobody owned", "Weekend work that was genuinely optional"],
    not_this: "Chronic overwork. Recognizing it rewards a staffing problem.",
    signals: ["weekend", "overnight", "after hours", "out of hours", "past handover", "stayed", "staying", "incident", "on-call", "oncall", "nobody owned", "no one owned", "extra mile", "went out of"],
  },
];

/* Program configuration as an admin would see it in the Achievers console:
   who may recognize whom, how often the agent may interrupt, and what the award
   may be. `cooldown_ladder_hours` mirrors COOLDOWN_LADDER_HOURS in agents.js —
   config is the statement of intent, the constant is the implementation. */
DATA.clientConfig = {
  client: "Northwind Collective",
  client_id: "cl_northwind",
  industry: "Professional services",
  program: "Applause",
  program_launch: "2023-02-01",
  currency: "USD",
  point_values: [0, 25, 50, 100],
  default_award: 25,
  min_award: 0,
  max_award: 100,
  per_user_monthly_budget: 200,
  budget_resets_on: "1st of each month",
  budget_carries_over: false,
  enabled_channels: ["C1", "C2", "C3"],
  public_channels_only: true,
  manager_approval_required: false,
  recognition_rules: {
    peer_to_peer: true,
    manager_only: false,
    upward_to_manager: true,
    cross_department: true,
    self_recognition: false,
    core_value_required: true,
    message_required: true,
    message_min_chars: 20,
    message_max_chars: 300,
    award_optional: true,
    award_chosen_by_sender: false,
  },
  frequency_caps: {
    max_nudges_per_sender_per_day: 4,
    max_nudges_per_sender_per_channel_per_hour: 1,
    max_recognitions_per_sender_per_week: 10,
    cooldown_ladder_hours: [2, 5, 24, 72],
    cooldown_resets_on_accept: true,
    suppressed_nudges_are_replayed: false,
    respect_user_opt_out: true,
    /* The escape hatch on the ladder itself. Without it the top rung is a
       one-way door: dismiss four times and the agent has quietly decided never
       to ask you again, which is a product decision nobody made on purpose. */
    probe_after_days_at_cap: 14,
    auto_pause_days_after_probe_dismissed: 30,
  },
  /* Who the agent is allowed to nudge at all, decided by the workspace admin
     rather than by the agent or the user. Three separate switches that are
     routinely conflated: the workspace default, per-department enrolment, and
     individual pauses. `admin_can_override_user_opt_out` is false and is not a
     configurable field — it is here to be read, not changed. */
  enrolment: {
    mode: "opt-out",
    enrolled_departments: ["Design", "Engineering", "Product", "Analytics", "Customer Success", "Marketing"],
    admin_paused_users: [
      {
        user_id: "u7",
        paused_on: "2026-07-23",
        paused_by: "admin:workspace-owner",
        reason: "New starter — paused until the recognition training module is complete.",
      },
    ],
    admin_can_override_user_opt_out: false,
  },
  enabled_features: {
    in_flow_nudge: true,
    background_auth: true,
    draft_generation: true,
    award_editing: false,
    redemption_nudge: false,
    anniversary_cards: false,
    manager_digest: false,
  },
  surfaces: { slack: "live", teams: "planned", outlook: "planned", zoom: "backlog" },
  core_values: DATA.coreValueCatalog.map((v) => v.label),
};

DATA.coreValues = DATA.clientConfig.core_values;

function reLiteral(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* House style as rules rather than prose. `recognition_guidelines.md` is
   rendered from this object, so the file a reader opens and the constraints the
   Draft agent composes and checks against are the same thing — the same reason
   agent_tuning_log.json replays through the Nudge agent's own function. A
   context file that can drift from the behaviour is decoration.

   `pattern` is a string rather than a RegExp literal so it survives JSON
   rendering: open the file and you are reading the expression the Check step
   compiles and runs, not a paraphrase of it.

   These run against the agent's own output only. What the human writes is the
   human's to write — employer_policy.md is the gate on that, and it is a
   different question from house style. */
DATA.recognitionRulebook = {
  max_sentences: 3,
  word_target: { min: 20, max: 60 },
  min_chars: 20,
  hard_char_ceiling: 300,
  one_value_only: true,

  avoid: [
    {
      id: "superlatives",
      label: "Superlatives without evidence",
      pattern: "\\b(amazing|incredible|outstanding|phenomenal|rockstar|rock star|ninja|superstar|legend|unbelievable|world[- ]class)\\b",
      why: "They describe the writer's enthusiasm, not the recipient's work.",
    },
    {
      id: "absolutes",
      label: "Always / never",
      pattern: "\\b(always|never)\\b",
      why: "\"You always deliver\" is unfalsifiable, so it is unread.",
    },
    {
      id: "comparisons",
      label: "Comparisons of any kind",
      pattern: "\\b(better than|unlike|more than (anyone|everyone)|best (on|in) the team|single[- ]handedly)\\b",
      why: "Recognition that ranks people turns a gift into a league table.",
    },
    {
      id: "apologetic",
      label: "Apologetic framing",
      pattern: "\\b(sorry to|hate to bother|not sure if this matters)\\b",
      why: "It undercuts the point before the recipient reaches it.",
    },
    {
      id: "titles_as_praise",
      label: "Titles as praise",
      pattern: "\\bour (best|top|star) \\w+",
      why: "Recognize the act, not the rank.",
    },
    {
      id: "character_traits",
      label: "Character attributed rather than behaviour described",
      pattern: "\\b(dedication|dedicated|tireless|commitment|work ethic|passion|positive attitude|team player)\\b",
      why: "The sender said none of that. This is the specific failure PRD eval Case 6 tests for.",
    },
    {
      id: "award_mention",
      label: "The award amount in the message body",
      pattern: "(\\$\\s?\\d|\\b\\d+\\s?(points|pts)\\b|\\bbonus\\b)",
      why: "Recognition that talks about its own price tag reads as a transaction.",
    },
    {
      /* The samples file already condemns this one: "You went above and beyond"
         is listed there as a weak example because it restates the label and
         says nothing. The value is a field on the record, not a sentence. */
      id: "value_label_echo",
      label: "Restating the core value label in the message",
      pattern: "\\b(" + DATA.coreValues.map(reLiteral).join("|") + "|above and beyond)\\b",
      why: "Naming the value in the body says nothing the value field does not already say.",
    },
  ],

  /* Indexed by the four relationships the table below distinguishes. The Draft
     agent picks one and composes to it — change a row and the drafts change. */
  register_by_relationship: {
    "direct-teammate": {
      row: "Direct teammate",
      register: "Plain, specific, first person",
      avoid: "Formality that sounds like distance",
      impact_override: null,
      suppress_warmth: false,
    },
    "cross-department": {
      row: "Cross-department",
      register: "Say what the work unblocked for you",
      avoid: "Internal jargon the recipient's team will not read",
      impact_override: { brief: "It unblocked us.", full: "It unblocked something on our side that we would have been stuck on." },
      suppress_warmth: false,
    },
    "manager-upward": {
      row: "Upward, to a manager",
      register: "Concrete and non-flattering",
      avoid: "Anything that reads as currying favour",
      impact_override: null,
      suppress_warmth: true,
    },
    "manager-downward": {
      row: "Downward, to a report",
      register: "Behaviour and impact, never potential",
      avoid: "\"You're going to go far\" — that is a review, not recognition",
      impact_override: null,
      suppress_warmth: false,
    },
  },

  thin_source:
    "Write the impact honestly and generally, or return `insufficient_detail` and let the human supply it. Fabricating a specific is worse than an unsent nudge.",
};

/* The markdown is generated from the rulebook above, not maintained alongside
   it. Every number and every avoid-rule in the rendered file is the one the
   agent runs. */
DATA.recognitionGuidelines = (function () {
  const r = DATA.recognitionRulebook;
  const avoid = r.avoid
    .map((a) => "- **" + a.label + "** — `" + a.pattern + "`\n  " + a.why)
    .join("\n");
  const register = Object.keys(r.register_by_relationship)
    .map((k) => {
      const row = r.register_by_relationship[k];
      return "| " + row.row + " | " + row.register + " | " + row.avoid + " |";
    })
    .join("\n");

  return `# Recognition Guidelines

## Write it like this

1. Name the specific behaviour, not the person's general character.
2. Tie the behaviour to exactly one core value. Two values means the draft has
   not decided what the work actually was.
3. Keep it to ${r.max_sentences} sentences or fewer. Recognition that reads like
   a performance review does not land.
4. Write in the sender's voice. Do not add praise the sender did not express.
5. Never invent detail. If the source message does not say what the work was,
   describe the impact in general terms rather than fabricating specifics.
6. No comparative praise ("better than the rest of the team").

## Length

- Target ${r.word_target.min}–${r.word_target.max} words. Hard ceiling
  ${r.hard_char_ceiling} characters.
- Below ${r.min_chars} characters it reads as a reflex, and the recipient treats
  it as one.
- One work object, one value, one sentence of impact. That is the whole shape.

## Register, by relationship

| Relationship | Register | Avoid |
|---|---|---|
${register}

## Words to avoid

Each of these is a hard stop in the Draft agent's Check step, and the pattern
shown is the one it runs against its own draft.

${avoid}

## The award

The award amount is set by the client program in \`client_config.json\`. It is
displayed in the draft for confirmation and is **not** adjustable by the sender.
Do not write about the amount in the message body — recognition that talks about
its own price tag reads as a transaction.

## When the source message is thin

If someone wrote "thanks for the help earlier" and nothing else, the draft has
no work object. ${r.thin_source}`;
})();

DATA.employerPolicy = `# Employer Policy — Recognition

Applies to every recognition sent through Slack, whether drafted by the agent or
typed by the human. The Submission agent re-checks the final text because the
human can rewrite anything the Draft agent produced.

## Recognition may

- Be sent peer-to-peer, upward to a manager, or across departments.
- Carry an award up to the sender's remaining monthly budget.
- Be posted publicly to the recipient's recognition wall.

## Recognition may never contain

| Category | Examples | Result |
|---|---|---|
| Insults or profanity | "idiot", "useless", "moron" | Blocked |
| Negative comparison | "better than the rest of the team" | Blocked |
| Protected characteristics | age, race, gender, disability, religion, nationality | Blocked |
| Health or personal circumstance | "even while dealing with everything at home" | Blocked |
| Compensation or promotion promises | "this should get you the raise" | Blocked |
| Confidential or customer-identifying detail | named accounts, deal values, incident specifics | Blocked |
| Self-recognition | sender and recipient are the same person | Blocked before the nudge appears |

## What the agent may keep

- **Message text is working memory only.** It exists for the duration of one
  nudge and is discarded when the card resolves — accepted or dismissed.
- **Persistent memory is behavioural and non-PII**: cooldown state, accept /
  dismiss / edit counts, and recipient affinity at *relationship category* level
  only (\`direct-teammate\`, \`manager\`, \`cross-department\`). Never a named
  individual, never a channel transcript, never a draft.
- Nothing is written to persistent memory that could reconstruct who said what
  about whom.

## Opting out

- Any user may turn nudges off, or lower their frequency, at any time. The
  setting takes effect on the next message and is never overridden by a
  high-confidence signal.
- Program admins may set the same controls for the whole client program, or for
  named channels. Admin settings are a ceiling, not a floor: a user may always
  be quieter than the program default, never louder.
- An opted-out user still receives recognition. They simply are not prompted to
  give it.

## When a check fails

Failures are **silent**. The user sees nothing — no nudge, no error, no
explanation of why they were not prompted. The reasoning is recorded in the
trace for the operator, not surfaced to the sender. A person who is told "you
cannot recognize this person" has been handed information about a colleague's
employment status that they were never entitled to.`;

/* The classifier corpus — the golden set. Two things share this list: the
   deterministic classifier in evals.js is tuned against it, and
   prompts/listener.js renders it verbatim as few-shot examples. Shape is
   therefore frozen at {text, label, why} — anything richer belongs in
   DATA.nudgeTriggerTranscripts.

   `why` is training signal, not a comment. It is rendered into the system
   prompt in parentheses after each verdict, so a vague rationale teaches the
   model nothing. Every one of them names the feature that decided the case.

   Three labels, two behaviours: anything that is not "trigger" renders as
   DO NOT FIRE. "trigger-adjacent" marks the negatives a reasonable person
   could argue with, and exists so the hard cases are findable rather than
   buried among the obvious ones.

   Deliberately negative-skewed. A false positive interrupts someone who was
   being polite and there is no downstream gate that can undo it; a miss costs
   one uncaptured recognition. The class balance is the same argument the
   prompt makes in prose.

   Section order is load-bearing for the UI: ui.js renders the first three
   triggers as the "try one of these" hints in the empty trace panel, so those
   three stay typeable demo strings. */
DATA.nudgeTriggerExamples = [
  /* ================================ FIRES ================================ */

  /* -- canonical: explicit praise tied to a named piece of work ----------- */
  { text: "Great job on the deck, Sam!", label: "trigger", why: "explicit praise + work object" },
  { text: "Kudos to Jordan for the launch", label: "trigger", why: "kudos keyword" },
  { text: "Thanks for turning the report around so fast", label: "trigger", why: "gratitude + work object" },
  { text: "Huge thanks to Mei for rewriting the onboarding copy", label: "trigger", why: "named recipient + specific deliverable" },
  { text: "Excellent work on the pricing model, Liam", label: "trigger", why: "praise + work object + named recipient" },
  { text: "thank you for the thorough review, it caught two things I'd missed", label: "trigger", why: "gratitude + the specific value it delivered" },

  /* -- explicit recognition markers; these carry without a work object ---- */
  { text: "shoutout to noor for covering my support rotation", label: "trigger", why: "shoutout keyword + concrete favour; lowercase is not a signal" },
  { text: "props to Diego, that was a nasty bug to track down", label: "trigger", why: "props marker + acknowledgement of difficulty" },
  { text: "Hats off to Priya for the empty-state work", label: "trigger", why: "idiomatic recognition marker + work object" },
  { text: "Take a bow, Mei. That copy is doing a lot of work.", label: "trigger", why: "recognition idiom, impact stated in the second clause" },
  { text: "Mad respect for how you handled that escalation", label: "trigger", why: "colloquial recognition marker + named situation" },

  /* -- causal credit: no gratitude word anywhere in the sentence ---------
     The largest class of misses in a keyword classifier. The recognition is
     carried entirely by attributing an outcome to a person. */
  { text: "Diego caught a regression that would have shipped to prod. Nice one.", label: "trigger", why: "named impact, praise closer, no gratitude keyword" },
  { text: "Priya's empty-state pass is the reason the flow tests clean now", label: "trigger", why: "possessive + 'is the reason' — outcome attributed to a person's work" },
  { text: "The migration went smoothly entirely because of Sam's prep", label: "trigger", why: "'because of' + named person is causal credit" },
  { text: "We only hit the date because Jordan re-cut the scope on Tuesday", label: "trigger", why: "'only ... because' credits the outcome to one person's decision" },
  { text: "That deploy went clean because Sam pre-staged everything on Friday", label: "trigger", why: "causal credit for discretionary preparation" },
  { text: "The reason legal signed off first pass is Mei's rewrite", label: "trigger", why: "'the reason X is Y's work' — credit with the person in final position" },
  { text: "Noor found the config drift before it reached the customer", label: "trigger", why: "averted-harm framing; the recognition is the counterfactual" },
  { text: "Liam's dashboard is what caught the spend anomaly", label: "trigger", why: "cleft sentence crediting an artefact to its author" },

  /* -- impact stated as a number ------------------------------------------ */
  { text: "Sam's fix took p95 from 400ms to 180ms", label: "trigger", why: "quantified outcome attributed to a named person" },
  { text: "Your runbook turned a two-hour job into fifteen minutes", label: "trigger", why: "second person + quantified saving; no praise word needed" },
  { text: "Mei's rewrite cut the support tickets on step 3 by half", label: "trigger", why: "measured downstream effect of a named person's work" },

  /* -- indebtedness and rescue phrasing ----------------------------------- */
  { text: "I owe Jordan for the rollback plan, that saved us today", label: "trigger", why: "indebtedness phrasing + work object" },
  { text: "You're a lifesaver, that unblocked the whole review", label: "trigger", why: "rescue idiom + stated unblocking" },
  { text: "Sam saved me about four hours with that script", label: "trigger", why: "quantified personal benefit credited to a person" },
  { text: "I owe you one for picking up the on-call swap", label: "trigger", why: "indebtedness + concrete favour, second person" },

  /* -- discretionary effort reported as plain fact ------------------------ */
  { text: "Sam stayed on the incident until 1am so the rest of us could sleep", label: "trigger", why: "effort beyond expectation, stated without adjectives" },
  { text: "Diego rewrote the entire regression suite over two days", label: "trigger", why: "scale of voluntary work is itself the recognition" },
  { text: "Noor took the weekend pager so the launch team could rest", label: "trigger", why: "sacrifice framed by who it benefited" },
  { text: "Priya sat with three users failing at step 3 and then fixed it", label: "trigger", why: "narrated effort ending in a resolved outcome" },

  /* -- slang and colloquialism -------------------------------------------- */
  { text: "you absolutely smashed that demo", label: "trigger", why: "intensifier + slang praise verb + work object" },
  { text: "Jordan carried that exec review", label: "trigger", why: "'carried' as praise; named person, named event" },
  { text: "clutch fix, Sam", label: "trigger", why: "two-word slang praise, still names the work and the person" },
  { text: "Mei you are a legend for turning that around", label: "trigger", why: "'legend' as recognition marker + turnaround credited" },
  { text: "nice one Diego, that was a proper catch", label: "trigger", why: "praise closer + named person + what they caught" },
  { text: "Priya ate that redesign, honestly", label: "trigger", why: "current slang for excelling; work object present" },
  { text: "Sam's the GOAT for that rate-limit fix", label: "trigger", why: "superlative slang tied to a specific fix" },

  /* -- non-US English ------------------------------------------------------ */
  { text: "Brilliant work on the migration notes, Sam", label: "trigger", why: "British intensifier the US-centric patterns miss" },
  { text: "Cracking job on the pitch, Jordan", label: "trigger", why: "regional praise adjective + work object" },
  { text: "Spot on analysis, Liam — that's exactly the cut we needed", label: "trigger", why: "idiomatic approval + why it was right" },
  { text: "Top work Mei, that reads so much better", label: "trigger", why: "praise + observed improvement" },
  { text: "Well played on the escalation, Noor", label: "trigger", why: "idiom for skilled handling of a named situation" },

  /* -- understated and dry ------------------------------------------------- */
  { text: "That was quietly excellent, Sam", label: "trigger", why: "low-volume praise is still praise" },
  { text: "Genuinely impressed by how you handled the crit, Priya", label: "trigger", why: "'genuinely' marks it as sincere rather than reflexive" },
  { text: "Not many people would have caught that. Good work Diego.", label: "trigger", why: "rarity framing + explicit praise" },
  { text: "That was a hard problem and you made it look ordinary", label: "trigger", why: "praise by contrast, no adjective in sight" },

  /* -- delayed and retrospective ------------------------------------------- */
  { text: "Meant to say last week — the pricing analysis was excellent, Liam", label: "trigger", why: "lateness does not weaken it; the work object is named" },
  { text: "Still thinking about how well the launch went. Jordan, that was your plan.", label: "trigger", why: "retrospective credit, person named in the second sentence" },
  { text: "Late to this but thank you Mei, the copy landed perfectly", label: "trigger", why: "hedged opener, substantive gratitude behind it" },

  /* -- how people actually type in Slack ----------------------------------- */
  { text: "honestly thank u for that review, caught 2 things i missed", label: "trigger", why: "abbreviation and no capitals do not make gratitude casual" },
  { text: "sam ur fix saved my afternoon, ty seriously", label: "trigger", why: "'ty' is bare on its own but here it closes a stated benefit" },
  { text: "priya that empty state work is so good", label: "trigger", why: "lowercase praise with a named person and a named artefact" },

  /* -- hedged, apologetic, or question-shaped ------------------------------ */
  { text: "sorry for the late ping — thank you for turning the spec around anyway", label: "trigger", why: "apology framing does not cancel the gratitude behind it" },
  { text: "I know it was a rough week, but the way you ran that crit was excellent", label: "trigger", why: "praise arrives after a concessive clause" },
  { text: "How did you turn the migration around that fast? Genuinely impressive.", label: "trigger", why: "rhetorical question answered by explicit praise" },

  /* -- relationship variants ----------------------------------------------- */
  { text: "Ava, thank you for taking the heat on the date change. That protected the team.", label: "trigger", why: "upward recognition; names the cost the recipient absorbed" },
  { text: "Diego, your first month of QA work has already caught two production bugs.", label: "trigger", why: "downward recognition stated as evidence, not potential" },
  { text: "Thanks to the Analytics side — Liam unblocked our whole reporting cut", label: "trigger", why: "cross-department, and one person is named inside the group thanks" },
  { text: "On behalf of the whole design team, thank you Sam for the API turnaround", label: "trigger", why: "collective sender, single resolvable recipient" },

  /* -- emoji present but not load-bearing ---------------------------------- */
  { text: "Appreciate you jumping on that at short notice 🙏", label: "trigger", why: "gratitude + effort object; emoji is decoration not signal" },
  { text: "🙏 Sam, the runbook saved me two hours this morning", label: "trigger", why: "emoji opener, substantive quantified benefit after it" },
  { text: "Mei, the pricing copy came back clean from legal first pass. That's your doing.", label: "trigger", why: "outcome credited to a named person" },
  { text: "Long week, three incidents, and Noor never dropped a single customer thread", label: "trigger", why: "praise buried in the final clause of a status-shaped sentence" },

  /* ============================= DOES NOT FIRE ============================ */

  /* -- bare courtesy and abbreviations ------------------------------------- */
  { text: "thanks", label: "no-trigger", why: "bare courtesy, no work object" },
  { text: "thx", label: "no-trigger", why: "abbreviated reflex" },
  { text: "ty", label: "no-trigger", why: "two characters cannot carry recognition" },
  { text: "cheers", label: "no-trigger", why: "regional courtesy token, same weight as 'thanks'" },
  { text: "thanks!", label: "no-trigger", why: "punctuation is not sincerity" },
  { text: "np", label: "no-trigger", why: "response to someone else's thanks, not gratitude of its own" },
  { text: "+1", label: "no-trigger", why: "agreement token" },
  { text: "🙌", label: "no-trigger", why: "reaction-as-message, no content to draft from" },
  { text: "lgtm", label: "no-trigger", why: "review approval shorthand, not praise" },

  /* -- acknowledging receipt ------------------------------------------------ */
  { text: "ok thanks will do", label: "no-trigger", why: "acknowledgement, not recognition" },
  { text: "got it, thanks", label: "no-trigger", why: "confirms receipt of information" },
  { text: "noted, thanks", label: "no-trigger", why: "same — the thanks is punctuation on an ack" },
  { text: "thanks, will review this afternoon", label: "no-trigger", why: "courtesy attached to the sender's own future action" },
  { text: "received, thanks Sam", label: "no-trigger", why: "names a person but only confirms delivery — the hardest negative in this section" },
  { text: "perfect, thank you", label: "no-trigger", why: "'perfect' agrees with a plan; nothing has been contributed yet" },

  /* -- forward-looking: nothing has happened yet ---------------------------- */
  { text: "thanks in advance", label: "no-trigger", why: "forward-looking request, nothing has happened yet" },
  { text: "thanks for taking a look when you get a chance", label: "no-trigger", why: "a request wearing gratitude as politeness" },
  { text: "would really appreciate a review on the PR today", label: "no-trigger", why: "'appreciate' in the conditional is an ask, not thanks" },

  /* -- declining outranks any gratitude word in the same sentence ---------- */
  { text: "thanks but no thanks", label: "no-trigger", why: "dismissal phrasing outranks gratitude" },
  { text: "no thanks, I'll take the later slot", label: "no-trigger", why: "declining an offer" },
  { text: "Appreciate it, but I'll pass on this one", label: "no-trigger", why: "concessive 'but' flips the sentence" },
  { text: "no need, I already merged it", label: "no-trigger", why: "declining help that was offered" },

  /* -- sarcasm; each one carries its tell inside the message ---------------
     The classifier is per-message by design, so a sarcastic line whose tell
     lives in a previous turn is a known limitation, not a labelling error.
     See DATA.nudgeTriggerTranscripts t3. */
  { text: "great work everyone, third outage this week", label: "no-trigger", why: "the second clause inverts the first" },
  { text: "awesome, another production incident 🙃", label: "no-trigger", why: "upside-down face is the sarcasm marker" },
  { text: "fantastic, exactly what we needed today", label: "no-trigger", why: "superlative attached to an unwelcome event" },
  { text: "brilliant, third time this week", label: "no-trigger", why: "praise adjective + repetition complaint" },
  { text: "thanks a lot for merging that without a review 🙄", label: "no-trigger", why: "gratitude form, grievance content" },
  { text: "amazing, the build is red again", label: "no-trigger", why: "'again' is doing the sarcasm" },
  { text: "nice one, that's the second time today", label: "no-trigger", why: "recognition idiom used as a complaint" },

  /* -- collective address with no resolvable recipient ---------------------- */
  { text: "Nice work everyone 🎉", label: "no-trigger", why: "collective address with no resolvable recipient" },
  { text: "well done team, big week", label: "no-trigger", why: "recognition needs one person to receive it" },
  { text: "well done all, that was a big lift", label: "no-trigger", why: "same shape — no recipient the Draft agent could fill in" },
  { text: "huge thanks to everyone who pitched in", label: "no-trigger", why: "sincere, substantive, and still unaddressable" },
  { text: "props to the whole launch crew", label: "no-trigger", why: "explicit marker, but the recipient is a group" },
  { text: "thanks all, calling it here", label: "no-trigger", why: "meeting close, no addressee and no work object" },

  /* -- praise aimed at a thing rather than a colleague ---------------------- */
  { text: "This is a great tool, we should have adopted it sooner", label: "trigger-adjacent", why: "praise aimed at a product, no human recipient" },
  { text: "great article, thanks for sharing", label: "trigger-adjacent", why: "the praise belongs to the author, who is not in this workspace" },
  { text: "the new brand work from the agency is excellent", label: "no-trigger", why: "external supplier, not a recognizable colleague" },
  { text: "Slack's search is finally usable, amazing", label: "no-trigger", why: "praise for a vendor's product" },

  /* -- self-praise ----------------------------------------------------------- */
  { text: "nailed my demo today 💪", label: "no-trigger", why: "sender and subject are the same person" },
  { text: "crushed it on the exec review if I do say so myself", label: "no-trigger", why: "explicitly self-directed; self-recognition is blocked anyway" },

  /* -- banter --------------------------------------------------------------- */
  { text: "lol amazing", label: "no-trigger", why: "reaction to something funny; superlative with no work object" },
  { text: "10/10 no notes 😂", label: "no-trigger", why: "joke review of something unspecified" },
  { text: "great work on absolutely destroying my calendar", label: "no-trigger", why: "praise frame, complaint content" },

  /* -- gratitude that belongs to somebody else ------------------------------ */
  { text: "Can you thank Sam for me when you see him?", label: "no-trigger", why: "reported gratitude, the sender is not recognizing anyone here" },
  { text: "I thanked Jordan already on the call", label: "no-trigger", why: "past reference to recognition that happened elsewhere" },
  { text: "the customer said to pass on a big thank you", label: "no-trigger", why: "relayed from outside the workspace; the sender is a courier" },
  { text: "Ava wanted me to say great work on the launch", label: "no-trigger", why: "relayed praise — attribution would name the wrong sender" },
  { text: "huge thanks to the Contoso team for their patience", label: "no-trigger", why: "recipient is a customer, not an enrolled colleague" },

  /* -- pleasantries and milestones ------------------------------------------ */
  { text: "thanks for joining everyone, notes to follow", label: "no-trigger", why: "meeting housekeeping" },
  { text: "thanks for the invite!", label: "no-trigger", why: "social courtesy, no contribution involved" },
  { text: "welcome to the team Noor!", label: "no-trigger", why: "warm and addressed to one person, but nothing has been contributed yet" },
  { text: "happy work anniversary Sam! 🎉", label: "trigger-adjacent", why: "appreciation-shaped and correctly addressed, but a date is not a contribution" },

  /* -- gratitude for something that is not work ----------------------------- */
  { text: "thanks for the coffee ☕", label: "no-trigger", why: "gratitude for a personal favour, not work" },
  { text: "thank you for the restaurant recommendation, it was perfect", label: "no-trigger", why: "substantive and sincere, and entirely outside work" },
  { text: "thanks for covering lunch yesterday", label: "no-trigger", why: "personal favour with a work-shaped verb" },

  /* -- "appreciate" meaning "understand" ------------------------------------
     A verb that reads as gratitude to a keyword matcher and as comprehension
     to a human. Consistently the most expensive false positive in this set. */
  { text: "I appreciate that the timeline is tight, but we need the spec by Thursday", label: "no-trigger", why: "'appreciate that' is acknowledgement of a fact, not thanks" },
  { text: "Appreciate the constraints here — let's talk Monday", label: "no-trigger", why: "same verb, same trap, shorter sentence" },
  { text: "I do appreciate why we scoped it that way", label: "no-trigger", why: "'appreciate why' can only mean understand" },

  /* -- status updates that happen to contain praise words ------------------- */
  { text: "Great, that works for me", label: "no-trigger", why: "agreement; 'great' modifies a plan, not a person" },
  { text: "great question", label: "no-trigger", why: "conversational filler" },
  { text: "Deck's ready for the exec review.", label: "no-trigger", why: "status update; the sender is reporting their own work" },
  { text: "the launch went well, full writeup tomorrow", label: "no-trigger", why: "outcome reported with nobody credited" },
  { text: "the migration is complete and the numbers look great", label: "no-trigger", why: "'great' describes metrics, not a colleague" },

  /* -- negation --------------------------------------------------------------- */
  { text: "not great work honestly, we need to redo the analysis", label: "no-trigger", why: "the praise phrase appears only to be negated" },
  { text: "this isn't the quality bar we agreed", label: "no-trigger", why: "criticism using recognition vocabulary" },
];

/* Multi-turn context the single-message classifier cannot see. Not consumed by
   the running prototype — the Listener is deliberately per-message — but kept as
   the reference set for the known limitation, and for whoever adds a window. */
DATA.nudgeTriggerTranscripts = [
  {
    id: "t1",
    channel: "C1",
    note: "The praise lands two turns after the work object. Per-message classification fires on turn 3 alone and has no idea what 'that' was.",
    turns: [
      { userId: "u2", text: "Rate-limit fix is deployed to staging." },
      { userId: "u3", text: "Confirmed, load test is green." },
      { userId: "u1", text: "Sam that was a fast turnaround, thank you", label: "trigger" },
    ],
  },
  {
    id: "t2",
    channel: "C2",
    note: "Reads like praise in isolation. In context it is agreement with a critique.",
    turns: [
      { userId: "u6", text: "The skip link on step 3 still reads like a dead end." },
      { userId: "u1", text: "Good catch", label: "no-trigger" },
    ],
  },
  {
    id: "t3",
    channel: "C1",
    note: "Sarcasm. Lexically identical to a fire case. The current classifier gets this wrong and the eval set records it as a known miss.",
    turns: [
      { userId: "u3", text: "Staging is down again." },
      { userId: "u2", text: "great work everyone", label: "no-trigger" },
    ],
  },
  {
    id: "t4",
    channel: "C3",
    note: "Recognition split across two messages by the same sender inside the grouping window. Only the second turn carries the gratitude.",
    turns: [
      { userId: "u8", text: "Diego rewrote the whole regression suite over two days" },
      { userId: "u8", text: "genuinely thank you for that, it was not a small job", label: "trigger" },
    ],
  },
];

/* Known-bad phrasings. Two consumers: policyHit() substring-matches against
   `text`, and prompts/policy-judge.js renders the pairs as few-shot examples.
   Entries must be full phrases — a bare word here would false-positive on any
   message that happens to contain it.

   Index 0 is referenced directly by an eval case. Do not reorder. */
DATA.policyViolationExamples = [
  { text: "thanks for cleaning up that idiot's code", violation: "insult" },
  { text: "you did better than everyone else on the team", violation: "negative comparison" },
  { text: "great work, unlike the rest of them", violation: "negative comparison" },
  { text: "finally someone on that team who is not useless", violation: "insult" },
  { text: "you carried those two who never show up", violation: "negative comparison" },
  { text: "thanks for fixing the mess the last person left", violation: "negative comparison" },
  { text: "amazing work for someone so junior", violation: "backhanded praise" },
  { text: "great job especially given everything you have going on at home", violation: "personal circumstance" },
  { text: "you are the only one here who actually delivers", violation: "negative comparison" },
  { text: "this should finally get you that promotion", violation: "compensation promise" },
  { text: "nice work saving the Contoso deal, that was worth six figures", violation: "confidential detail" },
  { text: "not bad at all for a contractor", violation: "employment status" },
  { text: "you were more organized than the whole team put together", violation: "negative comparison" },
];

/* One canonical sample per value — the flat shape prompts/drafter.js renders.
   Derived from the library below so the two cannot drift apart.

   `frames` is the same library read by the deterministic drafter in agents.js:
   the good samples above them with every specific removed, leaving `{name}` and
   `{object}` as the only slots. Those two slots are the only things the agent is
   allowed to fill, because they are the only things the sender gave it — a
   third slot would be an invitation to invent the deadline, the metric or the
   customer that recognition_guidelines.md forbids.

   `impact_brief` and `impact` are the same claim at two lengths. Which one a
   draft gets is decided by the sender's tone model, so the samples set the
   words and the tone model sets the shape. Editing a frame here changes what
   every future draft for that value says. */
DATA.recognitionSampleLibrary = {
  Teamwork: {
    frames: {
      object: "Thanks for jumping in on the {object}, {name}.",
      plain: "Thanks for jumping in when it counted, {name}.",
      impact_brief: "It kept the work moving.",
      impact: "You stepped outside your own lane to make someone else's job possible, and that should be on the record.",
    },
    good: [
      "Thank you for jumping in on the migration when the team was short-handed — it kept the release on track.",
      "You picked up the deploy while I was out and nothing about the handover was my problem to solve. That mattered.",
      "You spent an afternoon on a bug that was never yours to fix, and the team shipped because of it.",
    ],
    weak: [
      { text: "Thanks for being such a great team player!", why: "character, not behaviour — nothing here says what happened" },
      { text: "You always help everyone out.", why: "'always' is unfalsifiable, so it reads as filler" },
    ],
  },
  "Customer Focus": {
    frames: {
      object: "Thanks for how you handled the {object}, {name}.",
      plain: "Thanks for how you handled this, {name}.",
      impact_brief: "You called it from the customer's side.",
      impact: "You made the call from the customer's side of the table, and that is the standard worth holding.",
    },
    good: [
      "You caught the escalation before the customer had to chase us. That is the standard.",
      "You rewrote the flow because users kept failing at step three, not because anyone asked you to.",
      "You took the support rotation during launch week so the rest of us could stay heads-down.",
    ],
    weak: [
      { text: "Great customer service as always.", why: "no specific decision, no cost, no outcome" },
      { text: "You saved the Contoso renewal single-handedly.", why: "names a customer and overstates one person's contribution" },
    ],
  },
  Innovation: {
    frames: {
      object: "Thanks for the approach you took on the {object}, {name}.",
      plain: "Thanks for the approach you took here, {name}.",
      impact_brief: "It removed work rather than adding it.",
      impact: "It took work out of the process instead of adding cleverness to it, which is the harder version of the job.",
    },
    good: [
      "The approach you proposed cut a whole manual step out of the process.",
      "You prototyped it in an afternoon instead of letting us argue about it for another week.",
      "The script you wrote turned a two-hour job into something nobody has to think about again.",
    ],
    weak: [
      { text: "So innovative! Love the new tooling.", why: "novelty is not innovation, and no work is named" },
      { text: "Very clever solution.", why: "compliments cleverness rather than what it removed" },
    ],
  },
  Excellence: {
    frames: {
      object: "Thanks for the care you put into the {object}, {name}.",
      plain: "Thanks for the care you put into this, {name}.",
      impact_brief: "It held up when it had to.",
      impact: "It held up under pressure because of the work you did before the pressure arrived.",
    },
    good: [
      "The quality of the review you gave was the difference between shipping and slipping.",
      "Your migration notes were detailed enough that I ran it alone at 2am without waking anyone.",
      "You found the edge case three of us had read past.",
    ],
    weak: [
      { text: "Amazing work as usual, rockstar!", why: "superlative with no evidence; 'rockstar' describes the writer's mood" },
      { text: "You shipped more tickets than anyone this sprint.", why: "volume of output is not craft" },
    ],
  },
  "Going Above & Beyond": {
    frames: {
      object: "Thanks for staying with the {object}, {name}.",
      plain: "Thanks for staying with this, {name}.",
      impact_brief: "Stopping would have been reasonable.",
      impact: "You kept going at a point where stopping would have been entirely reasonable, and it did not go unnoticed.",
    },
    good: [
      "You stayed with this past the point anyone would have expected, and it showed in the result.",
      "You stayed on the incident past handover so the next shift started from a clean state.",
      "You picked up a gap nobody owned and closed it before it became a problem.",
    ],
    weak: [
      { text: "Thanks for working the weekend again!", why: "recognizing repeated overwork rewards a staffing problem" },
      { text: "You went above and beyond.", why: "restates the value label and says nothing" },
    ],
  },
};

DATA.recognitionSamples = Object.keys(DATA.recognitionSampleLibrary).reduce((acc, k) => {
  acc[k] = DATA.recognitionSampleLibrary[k].good[0];
  return acc;
}, {});

/* The frame used when no value in core_values.json matched the source message.
   It carries no value-specific claim, because there is no value-specific claim
   the agent has earned the right to make. */
DATA.recognitionHouseFrame = {
  object: "Thanks for the {object}, {name}.",
  plain: "Thanks for this, {name}.",
  impact_brief: "It moved the work forward.",
  impact: "It moved the work forward, and it belongs on the record rather than only in a channel.",
};

/* The register the samples exhibit, measured rather than asserted. The Draft
   agent reads these numbers to decide how long a draft should be and whether
   the house voice uses exclamation marks; the trace prints them; the file
   renders them. All three come from this one function, so adding a sample to
   the library moves the drafts. */
DATA.houseStyle = function () {
  const values = Object.keys(DATA.recognitionSampleLibrary);
  const good = values.reduce((acc, k) => acc.concat(DATA.recognitionSampleLibrary[k].good), []);
  const counts = good.map((s) => s.trim().split(/\s+/).length).sort((a, b) => a - b);
  const weak = values.reduce((n, k) => n + DATA.recognitionSampleLibrary[k].weak.length, 0);
  return {
    samples: good.length,
    weak_examples: weak,
    median_words: counts.length ? counts[Math.floor(counts.length / 2)] : 0,
    shortest_words: counts[0] || 0,
    longest_words: counts[counts.length - 1] || 0,
    exclamation_rate: good.length ? Math.round((good.filter((s) => s.indexOf("!") > -1).length / good.length) * 100) / 100 : 0,
    emoji_rate: good.length
      ? Math.round((good.filter((s) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)).length / good.length) * 100) / 100
      : 0,
  };
};

DATA.channels = [
  { id: "C1", name: "product-launch", topic: "Q3 launch coordination", private: false },
  { id: "C2", name: "design-crit", topic: "Weekly design reviews", private: false },
  { id: "C3", name: "general", topic: "Company-wide announcements", private: false },
  { id: "C4", name: "leadership-private", topic: "Not monitored — private channel", private: true },
];

/* Seed timestamps hang off the current clock so the date dividers read
   "Yesterday" and "Today". A hard-coded epoch drifts further out of view every
   week the demo sits unopened. */
const MIN = 60000;
const NOW = Date.now();
function ago(minutes) { return NOW - minutes * MIN; }

DATA.seedMessages = {
  C1: [
    { userId: "u4", text: "Morning all. Exec review moved to Thursday 2pm — one extra day, use it.", ts: ago(1560),
      reactions: [{ emoji: "👍", count: 5 }, { emoji: "🙌", count: 2 }] },
    { userId: "u3", text: "Noted. I'll use it to finish the rollback plan.", ts: ago(1552) },
    { userId: "u2", text: "Load test finished overnight: p95 at 180ms under 3x expected traffic.", ts: ago(1490),
      reactions: [{ emoji: "🚀", count: 4 }, { emoji: "🎉", count: 3 }],
      replyCount: 6, replyUsers: ["u3", "u1", "u4"] },
    { userId: "u2", text: "Full numbers are in the thread if anyone wants them.", ts: ago(1489) },
    { userId: "u3", text: "Launch checklist is up to date — we're green on everything except the pricing page copy.", ts: ago(180),
      reactions: [{ emoji: "✅", count: 3 }] },
    { userId: "u8", text: "Pricing copy is with legal. Expecting it back this afternoon.", ts: ago(174) },
    { userId: "u2", text: "I pushed the API rate-limit fix last night, that unblocks the load test.", ts: ago(120) },
    { userId: "u2", text: "Staging is redeployed, nothing else to do on my side.", ts: ago(119) },
    { userId: "u1", text: "Deck's ready for the exec review. Sam pulled the latency numbers for slide 6.", ts: ago(42),
      reactions: [{ emoji: "👏", count: 2 }],
      replyCount: 2, replyUsers: ["u3", "u2"] },
  ],
  C2: [
    { userId: "u1", text: "Posting the onboarding flow revisions for crit — third pass on the empty states.", ts: ago(1420),
      reactions: [{ emoji: "👀", count: 4 }] },
    { userId: "u8", text: "The microcopy on step 2 reads much better now.", ts: ago(1380) },
    { userId: "u6", text: "Agreed. One thing: the skip link on step 3 still reads like a dead end.", ts: ago(95),
      replyCount: 4, replyUsers: ["u1", "u8"] },
    { userId: "u1", text: "Fair. I'll rework it before Thursday.", ts: ago(88) },
  ],
  C3: [
    { userId: "u4", text: "Reminder: recognition budgets reset on the 1st. Anything unspent does not carry over.", ts: ago(1610),
      reactions: [{ emoji: "📣", count: 6 }] },
    { userId: "u4", text: "New starters this week — Noor on customer success and Diego on QA. Say hello.", ts: ago(210),
      reactions: [{ emoji: "👋", count: 11 }, { emoji: "🎉", count: 4 }] },
  ],
  C4: [
    { userId: "u4", text: "Private channel — the Listener agent is not subscribed here.", ts: ago(150) },
    { userId: "u4", text: "Headcount plan draft is in the canvas. Comments by Friday please.", ts: ago(60) },
  ],
};

/* ------------------------------------------------- behavioural memory (Tier 2)

   Everything above this line could be written the day before launch. Nothing
   below it could. This is the exhaust of the feature having actually run for
   five months, and it is the only thing the Personalization agent has to tune
   against — a confidence threshold, a tone model and a decision to stop asking
   are all claims about a person's past behaviour, and with no past there is
   nothing to claim. */

const HOUR = 60 * MIN;
function hoursAgo(h) { return NOW - h * HOUR; }
function daysAgo(d) { return NOW - d * 24 * HOUR; }
function isoDay(ts) { return new Date(ts).toISOString().slice(0, 10); }

/* The integration went live on this date. Everything dated before it belongs to
   the Achievers program, which is three years older than the Slack app. */
DATA.installedOn = isoDay(daysAgo(152));

/* Deterministic PRNG. Math.random() would hand the demo a different five months
   on every reload, and any eval that touched the history would be flaky by
   construction. Same seed, same workspace, every time. */
function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* One row per sender describing how they have actually behaved since install.
   The counters in personalization_profiles.json are derived from the rows this
   produces rather than typed alongside them — a profile that disagrees with its
   own history is the specific bug this shape is designed to make impossible.

   `acceptUntil` is the day the accepts stop: a sender who used the feature and
   then quietly gave up looks nothing like one who never engaged, and the
   difference is the whole case for the probe. */
const HISTORY_PLAN = [
  { id: "u1", start: 150, stop: 6, perWeek: 1.4, accept: 0.8, editShare: 0.34, acceptSecs: 13, dismissSecs: 9, channels: ["C1", "C2", "C3"] },
  { id: "u2", start: 150, stop: 6, perWeek: 0.9, accept: 0.66, editShare: 0.6, acceptSecs: 47, dismissSecs: 12, channels: ["C1", "C2"] },
  { id: "u3", start: 150, stop: 6, perWeek: 1.1, accept: 0.55, editShare: 0.3, acceptSecs: 21, dismissSecs: 6, channels: ["C1", "C2"], acceptUntil: 58 },
  { id: "u4", start: 150, stop: 6, perWeek: 2.1, accept: 0.9, editShare: 0.15, acceptSecs: 8, dismissSecs: 11, channels: ["C1", "C2", "C3"] },
  { id: "u5", start: 150, stop: 6, perWeek: 0.8, accept: 0.0, editShare: 0, acceptSecs: 0, dismissSecs: 2, channels: ["C1", "C3"] },
  { id: "u8", start: 150, stop: 6, perWeek: 1.3, accept: 0.76, editShare: 0.75, acceptSecs: 41, dismissSecs: 14, channels: ["C1", "C2", "C3"] },
  /* u6 and u7 were hired seven days ago. u7 got one nudge before an admin
     paused them for onboarding; u6 has never been nudged at all. */
  { id: "u7", start: 5, stop: 4, perWeek: 7, accept: 0.0, editShare: 0, acceptSecs: 0, dismissSecs: 7, channels: ["C1"] },
];

function buildSeedHistory() {
  const rows = [];
  HISTORY_PLAN.forEach((p, i) => {
    const rand = lcg(1013 + i * 7919);
    let d = p.start;
    for (let guard = 0; guard < 400; guard++) {
      d -= (7 / p.perWeek) * (0.55 + rand() * 0.95);
      if (d < p.stop) break;
      const roll = rand();
      const canAccept = p.acceptUntil === undefined || d > p.acceptUntil;
      const accepted = canAccept && roll < p.accept;
      rows.push({
        ts: daysAgo(d),
        userId: p.id,
        channelId: p.channels[Math.floor(rand() * p.channels.length)],
        outcome: accepted ? (rand() < p.editShare ? "edited" : "sent") : "dismissed",
        responseSeconds: Math.max(1, Math.round((accepted ? p.acceptSecs : p.dismissSecs) * (0.6 + rand() * 0.85))),
        ladderStepAfter: null,
      });
    }
  });
  return rows;
}

/* The last six days, written by hand rather than generated. The ladder state a
   sender walks into this session is decided entirely by their most recent rows,
   and that state is load-bearing for the demo — u3 has to arrive at the 72h
   ceiling and still inside a cooldown window, or the probe never fires. */
const RECENT_HISTORY = [
  { ts: daysAgo(5.4), userId: "u4", channelId: "C1", outcome: "sent", responseSeconds: 9 },
  { ts: daysAgo(5.1), userId: "u5", channelId: "C3", outcome: "dismissed", responseSeconds: 2 },
  { ts: daysAgo(4.6), userId: "u1", channelId: "C2", outcome: "edited", responseSeconds: 38 },
  { ts: daysAgo(4.2), userId: "u3", channelId: "C1", outcome: "dismissed", responseSeconds: 5 },
  { ts: daysAgo(3.8), userId: "u8", channelId: "C3", outcome: "sent", responseSeconds: 22 },
  { ts: daysAgo(3.3), userId: "u2", channelId: "C1", outcome: "sent", responseSeconds: 31 },
  { ts: daysAgo(3.1), userId: "u5", channelId: "C1", outcome: "dismissed", responseSeconds: 1 },
  { ts: daysAgo(2.7), userId: "u4", channelId: "C2", outcome: "sent", responseSeconds: 7 },
  { ts: daysAgo(2.4), userId: "u1", channelId: "C1", outcome: "sent", responseSeconds: 11 },
  { ts: daysAgo(1.9), userId: "u3", channelId: "C2", outcome: "dismissed", responseSeconds: 4 },
  { ts: hoursAgo(30), userId: "u2", channelId: "C1", outcome: "edited", responseSeconds: 44 },
  /* u3's fourth consecutive dismissal. Ladder pins at 72h, cooldown runs to
     roughly 41 hours from now, and no accept has landed in eight weeks — the
     three conditions the probe looks for. */
  { ts: hoursAgo(31), userId: "u3", channelId: "C1", outcome: "dismissed", responseSeconds: 3 },
  { ts: hoursAgo(26), userId: "u4", channelId: "C3", outcome: "sent", responseSeconds: 6 },
  { ts: hoursAgo(9), userId: "u1", channelId: "C1", outcome: "sent", responseSeconds: 13 },
];

/* Replays the ladder over the whole log rather than storing it per row, because
   the rule — reset on accept, one rung per explicit dismissal, pin at the top —
   is the same rule agents.js runs live, and two copies of it would drift. */
const LADDER_HOURS = DATA.clientConfig.frequency_caps.cooldown_ladder_hours;

function replayLadder(rows) {
  const step = {};
  rows.forEach((r) => {
    const cur = step[r.userId] === undefined ? -1 : step[r.userId];
    step[r.userId] = r.outcome === "dismissed" ? Math.min(cur + 1, LADDER_HOURS.length - 1) : -1;
    r.ladderStepAfter = step[r.userId];
  });
  return rows;
}

/* Prior nudge outcomes. Rendered above the live rows in nudge_history.csv and
   never pushed into the Store, so this session's cooldown evals still start
   from a clean ladder.

   Note what is not here: no message text, no recipient, no draft. The outcome
   log is the whole of what tuning needs, and anything more would be a
   transcript. `response_seconds` is time-to-decision, which is the only quality
   signal available without reading what was said. */
DATA.seedNudgeHistory = replayLadder(
  buildSeedHistory()
    .concat(RECENT_HISTORY.map((r) => Object.assign({ ladderStepAfter: null }, r)))
    .sort((a, b) => a.ts - b.ts),
);

/* --------------------------------------------- derived from the history above */

function median(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/* Everything a profile can honestly say about a sender, read back off their own
   outcome log. Carried ladder state is included: a sender who hit the ceiling
   yesterday is still inside that cooldown when this session opens, and
   pretending otherwise would reset five months of behaviour on page load. */
function deriveProfile(userId) {
  const rows = DATA.seedNudgeHistory.filter((r) => r.userId === userId);
  if (!rows.length) {
    return {
      nudges_shown: 0, accepts: 0, dismissals: 0, edits: 0,
      acceptance_rate: null, median_response_seconds: null,
      last_nudged_on: null, last_accepted_on: null,
      ladder_step: -1, cooldown_until: 0, days_since_last_accept: null,
    };
  }
  const accepted = rows.filter((r) => r.outcome !== "dismissed");
  const dismissed = rows.filter((r) => r.outcome === "dismissed");
  const last = rows[rows.length - 1];
  const lastAccept = accepted.length ? accepted[accepted.length - 1] : null;
  const step = last.ladderStepAfter;
  const cooldownUntil =
    last.outcome === "dismissed" ? last.ts + LADDER_HOURS[Math.min(step, LADDER_HOURS.length - 1)] * HOUR : 0;

  return {
    nudges_shown: rows.length,
    accepts: accepted.length,
    dismissals: dismissed.length,
    edits: rows.filter((r) => r.outcome === "edited").length,
    acceptance_rate: round2(accepted.length / rows.length),
    median_response_seconds: median(rows.map((r) => r.responseSeconds)),
    last_nudged_on: isoDay(last.ts),
    last_accepted_on: lastAccept ? isoDay(lastAccept.ts) : null,
    days_since_last_accept: lastAccept ? Math.floor((NOW - lastAccept.ts) / (24 * HOUR)) : null,
    ladder_step: step,
    /* Zeroed once elapsed, so a stale window can never suppress a nudge. */
    cooldown_until: cooldownUntil > NOW ? cooldownUntil : 0,
  };
}

/* Per-sender baselines. Counters and ladder state come from deriveProfile();
   what stays hand-written is the part behaviour cannot infer — the sensitivity
   the agent settled on, the opt-out, the voice model, and a note explaining
   what this person is a case of.

   `tone_signals` is derived from drafts the user approved or edited, never from
   their ordinary messages — the agent learns voice from the recognition they
   chose to send, not from surveillance of the channel. `category_affinity`
   stays at relationship-category level, which is the privacy line in
   employer_policy.md.

   Store.profile() counters from the live session are merged over the top of
   these at render time. */
const PROFILE_STATIC = {
  u1: {
    nudge_sensitivity: "standard",
    opted_out: false,
    tone_signals: { avg_words: 31, register: "warm-direct", uses_emoji: true, exclamation_rate: 0.36, learned_from_edits: 11, favours: ["specific artefact named", "second person"], avoids: ["superlatives"] },
    category_affinity: { "direct-teammate": 14, "cross-department": 9, manager: 3 },
    quiet_hours: { start: "18:00", end: "08:30", tz: "America/Toronto" },
    note: "The healthy case. Seven nudges in ten land, so the threshold has drifted below the house default and she gets asked on weaker signals than anyone else at standard sensitivity.",
  },
  u2: {
    nudge_sensitivity: "standard",
    opted_out: false,
    tone_signals: { avg_words: 24, register: "terse-technical", uses_emoji: false, exclamation_rate: 0.0, learned_from_edits: 9, favours: ["outcome first", "numbers"], avoids: ["adjectives", "exclamation marks"] },
    category_affinity: { "direct-teammate": 8, "cross-department": 4 },
    quiet_hours: { start: "19:00", end: "09:00", tz: "Europe/London" },
    note: "Accepts most nudges but rewrites almost all of them. The edit rate is what the tone model is built from — the drafts were never wrong, just not in his voice.",
  },
  u3: {
    nudge_sensitivity: "low",
    opted_out: false,
    tone_signals: { avg_words: 27, register: "measured", uses_emoji: false, exclamation_rate: 0.08, learned_from_edits: 5, favours: ["impact on the plan"], avoids: ["personal praise"] },
    category_affinity: { "direct-teammate": 7, "cross-department": 5 },
    quiet_hours: { start: "18:30", end: "08:00", tz: "America/New_York" },
    note: "Used the feature for three months, then stopped accepting entirely and has dismissed every nudge since. Sitting at the 72h ceiling, which is where a cooldown ladder quietly becomes a way of never asking again. This is the case the probe exists for.",
  },
  u4: {
    nudge_sensitivity: "high",
    opted_out: false,
    tone_signals: { avg_words: 22, register: "brief-formal", uses_emoji: false, exclamation_rate: 0.05, learned_from_edits: 4, favours: ["names the value explicitly"], avoids: ["long sentences"] },
    category_affinity: { "direct-teammate": 19, "cross-department": 22, manager: 0 },
    quiet_hours: null,
    note: "Manager with a 4x budget and the highest acceptance in the roster. The threshold has fallen far enough that she is nudged on signals nobody else would see.",
  },
  u5: {
    nudge_sensitivity: "minimal",
    opted_out: false,
    tone_signals: null,
    category_affinity: {},
    quiet_hours: { start: "17:00", end: "09:30", tz: "America/Vancouver" },
    note: "Not a disengaged recognizer — a disengaged nudge recipient. Spent his whole allocation in the Achievers platform on the 2nd, then dismissed all seventeen nudges since, median under three seconds. No tone signal exists because no draft was ever approved, so the bar sits at its ceiling and the agent has almost stopped asking.",
  },
  u6: {
    nudge_sensitivity: "standard",
    opted_out: false,
    tone_signals: null,
    category_affinity: {},
    quiet_hours: { start: "20:00", end: "08:00", tz: "Asia/Dubai" },
    note: "Hired seven days ago, identity unverified, never nudged. Threshold falls back to the house default and the Draft agent falls back to house style in recognition_samples.json.",
  },
  u7: {
    nudge_sensitivity: "standard",
    opted_out: false,
    admin_paused: true,
    admin_paused_on: DATA.clientConfig.enrolment.admin_paused_users[0].paused_on,
    tone_signals: null,
    category_affinity: {},
    quiet_hours: { start: "20:00", end: "08:00", tz: "America/Mexico_City" },
    note: "Hired seven days ago and paused by a workspace admin pending the recognition training module. One nudge got through before the pause. Admin state is a ceiling, not a signal — nothing about it goes into the tuning maths.",
  },
  u8: {
    nudge_sensitivity: "standard",
    opted_out: true,
    opted_out_on: isoDay(daysAgo(3)),
    opted_out_by: "user",
    tone_signals: { avg_words: 44, register: "editorial", uses_emoji: true, exclamation_rate: 0.19, learned_from_edits: 21, favours: ["rewrites the draft substantially", "concrete verbs"], avoids: ["generic openers"] },
    category_affinity: { "direct-teammate": 11, "cross-department": 13, manager: 2 },
    quiet_hours: { start: "19:00", end: "09:00", tz: "Asia/Tokyo" },
    note: "Opted out by choice while still accepting three quarters of her nudges — the highest edit rate in the workspace suggests the drafts were close but never right. Opt-out is honoured regardless; it is not a signal to argue with.",
  },
};

DATA.preferenceProfiles = Object.keys(PROFILE_STATIC).reduce((acc, id) => {
  acc[id] = Object.assign({}, PROFILE_STATIC[id], deriveProfile(id));
  return acc;
}, {});

/* Month-by-month adoption, rolled up from the same log. This is the view an
   admin would open, and the only place the demo says out loud that the thing
   has been running for a while. */
DATA.programMetrics = (function () {
  const months = {};
  DATA.seedNudgeHistory.forEach((r) => {
    const key = isoDay(r.ts).slice(0, 7);
    const m = months[key] || (months[key] = { month: key, nudges: 0, accepted: 0, dismissed: 0, edited: 0, senders: {} });
    m.nudges++;
    m.senders[r.userId] = true;
    if (r.outcome === "dismissed") m.dismissed++;
    else {
      m.accepted++;
      if (r.outcome === "edited") m.edited++;
    }
  });
  return Object.keys(months)
    .sort()
    .map((k) => {
      const m = months[k];
      return {
        month: m.month,
        nudges_shown: m.nudges,
        accepted: m.accepted,
        dismissed: m.dismissed,
        edited: m.edited,
        active_senders: Object.keys(m.senders).length,
        acceptance_rate: round2(m.accepted / m.nudges),
      };
    });
})();

/* --------------------------------------------------- agent tuning events */

/* The things that happened *to* the tuning loop that the outcome log cannot
   show: a sender turning their own dial, an admin pausing someone, and the two
   probe events. Threshold movements are not listed here — those are replayed
   from nudge_history.csv at read time, because a derived number written down
   twice is a number that will eventually disagree with itself.

   The `actor` column is the point of the file. Three parties can move this
   system, and after five months of running it should be possible to say which
   one did what without guessing. */
DATA.tuningEvents = [
  { ts: daysAgo(141), user_id: "u4", actor: "user", event: "sensitivity_changed", from: "standard", to: "high", detail: "Wants prompting on weaker signals — manager with 3x the budget." },
  { ts: daysAgo(112), user_id: "u3", actor: "user", event: "sensitivity_changed", from: "standard", to: "low", detail: "Asked to be interrupted less. Honoured immediately rather than inferred." },
  { ts: daysAgo(97), user_id: "u5", actor: "user", event: "sensitivity_changed", from: "standard", to: "minimal", detail: "Set the dial to its floor. Kept dismissing anyway — the dial was not the problem." },
  { ts: daysAgo(58), user_id: "u3", actor: "agent", event: "ladder_ceiling_reached", detail: "Fourth consecutive dismissal. Cooldown pinned at 72h, renewed on every dismissal since." },
  { ts: daysAgo(44), user_id: "u3", actor: "agent", event: "probe_sent", detail: "14 days at the ceiling with nothing accepted. One prompt allowed through the cooldown." },
  { ts: daysAgo(44), user_id: "u3", actor: "user", event: "probe_dismissed", detail: "Answered. The agent stops asking." },
  { ts: daysAgo(44), user_id: "u3", actor: "agent", event: "auto_paused", detail: "Self-imposed 30-day pause after the dismissed probe. No escalation, no second probe." },
  { ts: daysAgo(14), user_id: "u3", actor: "agent", event: "auto_pause_ended", detail: "Pause elapsed. Nudging resumed at the 72h ceiling; a second probe is available." },
  { ts: daysAgo(4), user_id: "u7", actor: "admin", event: "admin_paused", detail: "New starter paused pending the recognition training module. Sender cannot undo this." },
  { ts: daysAgo(3), user_id: "u8", actor: "user", event: "opted_out", detail: "Opted out at 77% acceptance. High acceptance is not consent — the preference wins outright." },
].sort((a, b) => a.ts - b.ts);

/* ------------------------------------------------- this period's ledger */

/* Recompute what each sender has spent from the accepted nudges dated inside the
   current calendar month, plus whatever they awarded directly in the platform.
   Budgets reset on the 1st and do not carry over, so the month boundary is the
   whole of the arithmetic. Auth reads `budget` and nothing else. */
const THIS_MONTH = isoDay(NOW).slice(0, 7);

DATA.employees.forEach((e) => {
  const slackAwards = DATA.seedNudgeHistory.filter(
    (r) => r.userId === e.id && r.outcome !== "dismissed" && isoDay(r.ts).slice(0, 7) === THIS_MONTH,
  ).length;
  e.slackSpend = slackAwards * DATA.clientConfig.default_award;
  e.spent = e.carriedSpend + e.slackSpend;
  e.budget = Math.max(0, e.allocated - e.spent);
});

/* Recognitions already published to Achievers, so the platform view is not an
   empty page on a workspace that has been running the integration since
   February. One row per accepted nudge this month, plus the direct awards that
   never went through Slack — which is the comparison the Achievers view exists
   to make. The recipient and message are the platform's record, not agent
   memory; nothing here is readable by any agent. */
DATA.seedRecognitions = (function () {
  const VALUES = DATA.coreValues;
  const LINES = [
    "Thank you for the work you put into the migration runbook. It made a real difference to the team, and it is exactly what {v} looks like here.",
    "You caught the regression before the customer did, and then stayed on to explain it. That is {v} in practice.",
    "The way you rewrote the onboarding flow after watching three people fail at it — {v}, and it shows.",
    "Thank you for covering the release while the rest of us were heads-down. Quiet {v}, and it did not go unnoticed.",
    "You took the escalation nobody wanted and turned it into a fix. {v}, plainly.",
    "The pricing analysis landed exactly when the decision needed it. Thank you — that is {v}.",
    "You unblocked our team before we had even asked. {v} at its most useful.",
    "Thank you for pushing back on the scope when everyone else was nodding. That was {v}, and it was right.",
  ];
  const rand = lcg(4409);
  const pool = DATA.employees.map((e) => e.id);
  const out = [];

  DATA.seedNudgeHistory.forEach((r, i) => {
    if (r.outcome === "dismissed") return;
    if (isoDay(r.ts).slice(0, 7) !== THIS_MONTH) return;
    let to = pool[Math.floor(rand() * pool.length)];
    while (to === r.userId) to = pool[Math.floor(rand() * pool.length)];
    const value = VALUES[Math.floor(rand() * VALUES.length)];
    out.push({
      id: "rec_seed_" + i,
      ts: r.ts + 90000,
      senderId: r.userId,
      recipientId: to,
      coreValue: value,
      message: LINES[Math.floor(rand() * LINES.length)].replace("{v}", value),
      amount: DATA.clientConfig.default_award,
      source: "slack",
    });
  });

  /* Liam's direct awards. Same platform, same budget, no agent involved — the
     control group of one. */
  const direct = ["u1", "u3", "u4", "u7", "u8", "u2", "u6", "u1"];
  for (let i = 0; i < DATA.employees.find((e) => e.id === "u5").carriedSpend / DATA.clientConfig.default_award; i++) {
    out.push({
      id: "rec_seed_direct_" + i,
      ts: daysAgo(25 - i * 0.12),
      senderId: "u5",
      recipientId: direct[i % direct.length],
      coreValue: VALUES[i % VALUES.length],
      message: "Nice work on this.",
      amount: DATA.clientConfig.default_award,
      source: "platform",
    });
  }

  return out.sort((a, b) => a.ts - b.ts);
})();

/* The Slack side of the integration. `monitored` is the only key the running
   Listener reads; everything else is here because a reviewer's first question
   about an always-listening agent is "what exactly is it subscribed to", and the
   honest answer has to be a scope list with a reason against each line. */
DATA.slackApiMock = {
  app: {
    name: "Recognition Nudge",
    app_id: "A0NUDGE01",
    bot_user_id: "bot-nudge",
    workspace: "northwind-collective",
    distribution: "org-installed, admin-approved",
  },
  event: "message.channels",
  event_subscriptions: ["message.channels", "member_joined_channel", "app_uninstalled"],
  subscribed_scopes: [
    { scope: "channels:history", why: "Read messages in public channels the app is a member of. This is the trigger source." },
    { scope: "chat:write", why: "Post the ephemeral nudge back to the sender." },
    { scope: "users:read", why: "Resolve a Slack user ID to a roster entry. Profile fields are not read." },
    { scope: "commands", why: "Serve /recognize for people who would rather not wait to be prompted." },
  ],
  scopes_deliberately_not_requested: [
    { scope: "im:history", why: "Direct messages are never read. Recognition is a public act." },
    { scope: "groups:history", why: "Private channels are out of scope — see C4." },
    { scope: "files:read", why: "Nothing the agent does needs file content." },
    { scope: "users:read.email", why: "Identity is resolved by Slack user ID. Email is unnecessary PII." },
  ],
  monitored: ["C1", "C2", "C3"],
  not_monitored: ["C4 (private)", "all direct messages", "threads in unmonitored channels"],
  example_event: {
    type: "message",
    channel: "C1",
    user: "u1",
    text: "Great job on the deck, Sam!",
    ts: "1753617000.000200",
    channel_type: "channel",
    event_ts: "1753617000.000200",
  },
  ignored_event_subtypes: ["message_changed", "message_deleted", "channel_join", "bot_message", "thread_broadcast"],
  ephemeral_request: {
    method: "chat.postEphemeral",
    channel: "C1",
    user: "u1",
    blocks: "[Block Kit — section + actions]",
    note: "Only the triggering user can see it. Slack controls persistence; there is no message ID to update after the client reloads.",
  },
  ephemeral_response: { ok: true, message_ts: "1753617002.000100" },
  ephemeral_note: "chat.postEphemeral — visible only to the triggering user. Slack controls persistence.",
  rate_limits: { tier: "Tier 3", chat_postEphemeral: "50+ per minute per workspace", backoff: "respect Retry-After, drop rather than queue" },
  latency_budget_ms: { event_to_listener: 200, listener_to_ephemeral: 800, hard_ceiling: 2000 },
};

/* The Achievers side. The Submission agent posts to /v1/recognitions and nothing
   else; the rest of the catalog is here so the error handling in agents.js can
   be read against the contract it is handling. */
DATA.achieversApiMock = {
  base_url: "https://api.achievers.mock/v1",
  endpoint: "POST /v1/recognitions",
  auth: "bearer <session_token>",
  fields: ["recipient_id", "core_value", "message", "points", "source"],
  endpoints: [
    { method: "POST", path: "/v1/recognitions", used_by: "Submission agent", why: "Create the recognition. The only write this app performs." },
    { method: "GET", path: "/v1/recognitions?recipient_id=", used_by: "Mock platform view", why: "Render the recognition wall." },
    { method: "GET", path: "/v1/members/{id}", used_by: "not wired", why: "Enrollment and points balance — the prototype reads hris_directory.csv instead." },
    { method: "GET", path: "/v1/programs/{client_id}/values", used_by: "not wired", why: "Core value catalog. Mirrored locally in core_values.json." },
  ],
  example_request: {
    headers: { Authorization: "Bearer <session_token>", "Content-Type": "application/json", "Idempotency-Key": "nudge_<card_id>" },
    body: {
      sender_id: "u1",
      recipient_id: "u2",
      core_value: "Teamwork",
      message: "Thanks for pulling the latency numbers for slide 6 — the deck landed because of it.",
      points: 25,
      source: "slack_nudge",
      client_id: "cl_northwind",
    },
  },
  example_response: {
    status: 201,
    body: { recognition_id: "rec_8f21c4", status: "published", posted_at: "2026-07-27T14:32:11Z", points_debited: 25, sender_budget_remaining: 25, wall_url: "https://achievers.mock/wall/u2" },
  },
  idempotency: "Idempotency-Key is the card ID, so a retry after a platform error cannot double-post or double-debit.",
  simulated_error_rate: 0.25,
  error_shape: { code: "platform_error", retryable: true },
  errors: [
    { http: 503, code: "platform_error", retryable: true, message: "Recognition service unavailable.", agent_behaviour: "Preserve the draft, offer Try again. This is the 25% path in the demo." },
    { http: 402, code: "insufficient_budget", retryable: false, message: "Sender budget exhausted.", agent_behaviour: "Should never reach here — Auth checks budget before the nudge is drawn." },
    { http: 404, code: "recipient_not_enrolled", retryable: false, message: "Recipient has no Achievers profile.", agent_behaviour: "Should never reach here — Auth checks HRIS enrollment first." },
    { http: 409, code: "duplicate_recognition", retryable: false, message: "This Idempotency-Key was already accepted.", agent_behaviour: "Treat as success. The first attempt landed." },
    { http: 401, code: "session_expired", retryable: true, message: "Session token has expired.", agent_behaviour: "Show the reconnect banner and keep the human's edits." },
    { http: 422, code: "policy_rejected", retryable: false, message: "Message failed server-side policy.", agent_behaviour: "Backstop only. The Submission agent should have caught this locally." },
  ],
  never_sent: ["Slack channel ID", "surrounding conversation", "the original message that triggered the nudge"],
};

/* Identity. Slack asserts who the sender is; this mock is the thin layer that
   maps that assertion onto an employee record and decides whether it is trusted
   enough to spend money on. u6 is unverified, which is what makes the login
   stage in the draft card reachable. */
DATA.authMock = {
  provider: "Slack OAuth",
  flow: "authorization_code + PKCE, org-level install",
  identity_claim: "slack_user_id -> employee_id",
  identity_map: [
    { slack_user_id: "u1", employee_id: "u1", verified: true, method: "sso_saml", last_verified: "2026-07-27T08:12:00Z" },
    { slack_user_id: "u2", employee_id: "u2", verified: true, method: "sso_saml", last_verified: "2026-07-27T07:40:00Z" },
    { slack_user_id: "u3", employee_id: "u3", verified: true, method: "sso_saml", last_verified: "2026-07-26T16:05:00Z" },
    { slack_user_id: "u4", employee_id: "u4", verified: true, method: "sso_saml", last_verified: "2026-07-27T09:01:00Z" },
    { slack_user_id: "u5", employee_id: "u5", verified: true, method: "sso_saml", last_verified: "2026-07-27T06:22:00Z" },
    { slack_user_id: "u6", employee_id: "u6", verified: false, method: "pending_first_login", last_verified: null },
    { slack_user_id: "u7", employee_id: "u7", verified: true, method: "sso_saml", last_verified: "2026-07-26T23:14:00Z" },
    { slack_user_id: "u8", employee_id: "u8", verified: true, method: "sso_saml", last_verified: "2026-07-27T02:48:00Z" },
    { slack_user_id: "u9", employee_id: null, verified: false, method: "no_account", last_verified: null },
  ],
  session_ttl_seconds: 45,
  session_ttl_note: "45s is a demo compression of a real 30-minute session, so the expiry path is reachable inside a five-minute walkthrough.",
  session_states: ["none", "active", "expiring_soon", "expired", "revoked"],
  refresh: { supported: true, rotates_refresh_token: true, on_expiry: "Show reconnect banner. Draft edits are held in working memory and survive the reconnect." },
  example_token: { token_type: "Bearer", access_token: "<redacted>", expires_in: 45, scope: "recognitions:write", subject: "u1", client_id: "cl_northwind" },
  unverified_users: ["u6"],
  failure_modes: [
    { code: "unverified_identity", when: "Slack asserts a user with no completed first login.", behaviour: "Card opens at the login stage instead of the draft. Nothing is posted." },
    { code: "no_account", when: "Slack user has no employee record at all (u9).", behaviour: "Chain stops in Auth. Silent." },
    { code: "session_expired", when: "TTL elapsed while the draft was open.", behaviour: "Reconnect banner. Edits preserved." },
    { code: "revoked", when: "Admin removed the app or the user left.", behaviour: "Chain stops before the Listener runs." },
  ],
  never_stored: ["access_token", "refresh_token", "email", "Slack profile fields", "message text"],
  note: "Identity is asserted by Slack. Unverified users must complete a manual login step.",
};

/* ------------------------------------------------------- file registry */

/* Rows come in as arrays of values, not pre-joined strings, so fields
   containing a comma — "Director, Product", "Toronto, CA" — get quoted instead
   of silently splitting into an extra column. */
function cell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csv(headers, rows) {
  return [headers.map(cell).join(","), ...rows.map((r) => (Array.isArray(r) ? r.map(cell).join(",") : r))].join("\n");
}

const FILES = [
  {
    name: "slack_api_mock.json",
    kind: "json",
    purpose: "Every Slack scope the app holds, with a reason against each — and the ones it deliberately does not request.",
    render: () => JSON.stringify(DATA.slackApiMock, null, 2),
  },
  {
    name: "nudge_trigger_examples.json",
    kind: "json",
    purpose: "Labeled corpus the classifier is tuned against, plus the multi-turn cases a per-message classifier cannot see.",
    render: () =>
      JSON.stringify(
        {
          note: "labeled_examples is what prompts/listener.js renders as few-shot. transcripts are reference only — the Listener is deliberately per-message and has no window.",
          counts: {
            trigger: DATA.nudgeTriggerExamples.filter((e) => e.label === "trigger").length,
            no_trigger: DATA.nudgeTriggerExamples.filter((e) => e.label !== "trigger").length,
          },
          labeled_examples: DATA.nudgeTriggerExamples,
          transcripts: DATA.nudgeTriggerTranscripts,
        },
        null,
        2,
      ),
  },
  {
    name: "employees.csv",
    kind: "csv",
    purpose: "Roster and budget ledger: who can send, how much they have left, and whether Slack's identity claim is trusted.",
    render: () =>
      csv(
        ["id", "name", "handle", "title", "dept", "manager_id", "timezone", "budget_allocated_usd", "budget_spent_usd", "budget_available_usd", "identity_verified"],
        DATA.employees.map((e) => [e.id, e.name, "@" + e.handle, e.title, e.dept, e.managerId || "", e.tz, e.allocated, e.spent, e.budget, e.verified]),
      ) + "\n\n// budget_available is the only column Auth reads. It resets on the 1st and does not carry over.",
  },
  {
    name: "hris_directory.csv",
    kind: "csv",
    purpose: "System of record for employment, Achievers enrollment and recognition eligibility. Auth stops the chain on a missing or non-receivable row.",
    render: () =>
      csv(
        Object.keys(DATA.hris[0]),
        DATA.hris.map((r) => Object.values(r)),
      ) +
      "\n\n// " + DATA.hris.length + " rows. " + DATA.contractor.name + " (" + DATA.contractor.id +
      ") appears in Slack but has no row here — that absence is the stop condition, not an error.",
  },
  {
    name: "client_config.json",
    kind: "json",
    purpose: "Program configuration: recognition rules, frequency caps, award bounds and which features are switched on.",
    render: () => JSON.stringify(DATA.clientConfig, null, 2),
  },
  {
    name: "employer_policy.md",
    kind: "md",
    purpose: "Hard constraints on content, memory and opt-out. Checked twice — once on the source message, once on the human's final text.",
    render: () => DATA.employerPolicy,
  },
  {
    name: "policy_violation_examples.json",
    kind: "json",
    purpose: "Known-bad phrasings, each a full phrase so substring matching cannot false-positive.",
    render: () => JSON.stringify(DATA.policyViolationExamples, null, 2),
  },
  {
    name: "auth_mock.json",
    kind: "json",
    purpose: "Simulated Slack OAuth: identity map, session states and the four ways identity can fail.",
    render: () => JSON.stringify(DATA.authMock, null, 2),
  },
  {
    name: "personalization_profiles.json",
    kind: "json",
    purpose: "Tier 2 memory: nudge preferences, outcome counters, tone signals and relationship-category affinity. No names, no message text.",
    render: () => {
      const live = {};
      DATA.employees.forEach((e) => {
        const p = Store.profile(e.id);
        if (p.ladderStep >= 0 || p.accepts || p.dismissals || p.edits) live[e.id] = p;
      });
      return JSON.stringify(
        {
          schema: {
            installed_on: DATA.installedOn,
            retained: ["nudge_sensitivity", "opted_out", "accept / dismiss / edit counts", "cooldown ladder step", "tone signals from approved drafts", "category_affinity"],
            never_retained: ["message text", "draft text", "recipient identity", "channel transcript"],
            affinity_granularity: "relationship category only — direct-teammate / manager / cross-department",
            derived: "Counters, rates, ladder_step and cooldown_until are read back off nudge_history.csv, not stored separately. A profile cannot disagree with its own log.",
          },
          carried_over: DATA.preferenceProfiles,
          this_session: Object.keys(live).length ? live : "// nothing recorded yet — post a message to populate",
        },
        null,
        2,
      );
    },
  },
  {
    name: "nudge_history.csv",
    kind: "csv",
    purpose: "Outcome log the cooldown ladder is tuned against. Stores no message text and no recipient.",
    render: () => {
      const TAIL = 40;
      const seed = DATA.seedNudgeHistory;
      const live = Store.history();
      const rollup = csv(
        ["month", "nudges_shown", "accepted", "dismissed", "edited", "active_senders", "acceptance_rate"],
        DATA.programMetrics.map((m) => [m.month, m.nudges_shown, m.accepted, m.dismissed, m.edited, m.active_senders, m.acceptance_rate]),
      );
      const rows = seed
        .slice(-TAIL)
        .map((r) => [new Date(r.ts).toISOString(), r.userId, r.channelId, r.outcome, r.responseSeconds, r.ladderStepAfter])
        .concat(live.map((r) => [new Date(r.ts).toISOString(), r.userId, r.channelId, r.outcome, "", ""]));
      return (
        "// installed " + DATA.installedOn + " — " + seed.length + " prior rows, " + live.length + " this session.\n" +
        "// Monthly rollup first; the full log is long and nothing reads it whole.\n\n" +
        rollup +
        "\n\n// Last " + Math.min(TAIL, seed.length) + " prior rows, then this session's.\n\n" +
        csv(["ts", "user_id", "channel_id", "outcome", "response_seconds", "ladder_step_after"], rows) +
        "\n\n// ladder_step_after -1 means the ladder reset — an accepted nudge clears the cooldown." +
        "\n// Live rows have no response_seconds: the viewer resolves cards without a timer."
      );
    },
  },
  {
    name: "core_values.json",
    kind: "json",
    purpose: "The client's value taxonomy with the descriptions that make one value pickable over another.",
    render: () =>
      JSON.stringify(
        {
          client_id: DATA.clientConfig.client_id,
          required_on_every_recognition: DATA.clientConfig.recognition_rules.core_value_required,
          note: "`signals` is what the Draft agent matches on — compiled from this file at read time, not mirrored in code. Highest number of distinct signal hits wins; order breaks ties, so it is load-bearing.",
          no_match_behaviour: "The field is left blank and the human picks. The agent does not default to whichever value sits first in the file.",
          values: DATA.coreValueCatalog,
        },
        null,
        2,
      ),
  },
  {
    name: "recognition_guidelines.md",
    kind: "md",
    purpose: "House style: length, register by relationship, words to avoid, and what to do when the source message is thin.",
    render: () => DATA.recognitionGuidelines,
  },
  {
    name: "recognition_samples.json",
    kind: "json",
    purpose: "Tone reference and the frames the Draft agent composes from. Includes near-misses, because what not to write is the harder half.",
    render: () =>
      JSON.stringify(
        {
          canonical: DATA.recognitionSamples,
          note: "canonical is one line per value — the flat map prompts/drafter.js renders. library carries the frames the deterministic drafter composes from, the alternates, and the weak examples with the reason each one fails.",
          house_style: DATA.houseStyle(),
          house_style_note: "Measured from the good samples below at read time, not typed in. The Draft agent aims at median_words and the trace prints these same numbers.",
          house_frame: DATA.recognitionHouseFrame,
          house_frame_note: "Used when no value in core_values.json matched. Carries no value-specific claim, because none was earned.",
          library: DATA.recognitionSampleLibrary,
        },
        null,
        2,
      ),
  },
  {
    name: "achievers_api_mock.json",
    kind: "json",
    purpose: "The recognition endpoint the Submission agent posts to, with the full error catalog it has to handle.",
    render: () => JSON.stringify(DATA.achieversApiMock, null, 2),
  },
  {
    name: "agent_tuning_log.json",
    kind: "json",
    purpose: "Every time the agent moved its own confidence bar, and every time a human or admin moved something for it. The one file that cannot exist until the feature has been running.",
    render: () => {
      /* Replay the bar over the seeded log using agents.js's own arithmetic, so
         this file can never quote a threshold the running agent disagrees with.
         Only movements are listed — a bar that held steady for six weeks is not
         an event. */
      const byUser = {};
      DATA.seedNudgeHistory.forEach((r) => (byUser[r.userId] = (byUser[r.userId] || []).concat([r])));

      const movements = [];
      Object.keys(byUser).forEach((id) => {
        const sens = (DATA.preferenceProfiles[id] || {}).nudge_sensitivity || "standard";
        const median = (DATA.preferenceProfiles[id] || {}).median_response_seconds;
        let accepts = 0;
        let decided = 0;
        let last = null;
        byUser[id].forEach((r) => {
          if (r.outcome !== "dismissed") accepts++;
          decided++;
          const t = Agents.__thresholdFor(sens, decided, accepts / decided, median === undefined ? null : median);
          if (last !== null && t.value === last) return;
          if (last !== null) {
            movements.push({
              ts: new Date(r.ts).toISOString(),
              user_id: id,
              actor: "agent",
              event: "threshold_moved",
              from: last,
              to: t.value,
              detail: t.basis,
            });
          }
          last = t.value;
        });
      });

      const events = DATA.tuningEvents.map((e) =>
        Object.assign({}, e, { ts: new Date(e.ts).toISOString() }),
      );
      const timeline = movements.concat(events).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

      const now = {};
      DATA.employees.forEach((e) => {
        const t = Agents.__threshold(e.id);
        now[e.id] = {
          bar: t.value,
          basis: t.basis,
          personalized: t.personalized,
          sensitivity: (DATA.preferenceProfiles[e.id] || {}).nudge_sensitivity || "standard",
        };
      });

      return JSON.stringify(
        {
          schema: {
            installed_on: DATA.installedOn,
            house_default: THRESHOLD_BASE,
            bounds: [THRESHOLD_MIN, THRESHOLD_MAX],
            min_sample_to_personalize: THRESHOLD_MIN_SAMPLE,
            actors: {
              agent: "moved by the tuning loop from observed outcomes",
              user: "moved by the sender's own preference",
              admin: "moved by a workspace admin — the sender cannot undo it",
            },
            derived: "threshold_moved rows are replayed from nudge_history.csv through the same function the Nudge agent calls. Nothing here is stored.",
            replay_caveat: "The replay applies each sender's current sensitivity across their whole history, so rows dated before a sensitivity_changed event carry the later offset. Only the final bar is exact.",
            bounds_rationale: "An agent that can tune itself past " + THRESHOLD_MAX + " has invented an opt-out nobody asked for; one that can go below " + THRESHOLD_MIN + " has invented spam.",
          },
          current_bars: now,
          timeline: timeline,
        },
        null,
        2,
      );
    },
  },
];

const FILE_NAMES = FILES.map((f) => f.name);
function getFile(name) {
  return FILES.find((f) => f.name === name) || null;
}

/* -------------------------------------------------------------- store */

function uid(prefix) {
  return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 8);
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* quota or private mode — prototype keeps running from memory */
  }
}

const listeners = [];

const Store = {
  subscribe(fn) {
    listeners.push(fn);
  },
  notify() {
    listeners.forEach((fn) => fn());
  },

  channels() {
    return read(K.channels, null) || DATA.channels;
  },

  messages(channelId) {
    const all = read(K.messages, null) || seedAll();
    return all[channelId] || [];
  },

  allMessages() {
    return read(K.messages, null) || seedAll();
  },

  addMessage(channelId, msg) {
    const all = Store.allMessages();
    const m = Object.assign({ id: uid("m"), ts: Date.now(), threadParentId: null, replyCount: 0, reactions: [], ephemeral: false, card: null }, msg);
    all[channelId] = (all[channelId] || []).concat([m]);
    write(K.messages, all);
    Store.notify();
    return m;
  },

  updateMessage(channelId, id, patch) {
    const all = Store.allMessages();
    const list = all[channelId] || [];
    const i = list.findIndex((m) => m.id === id);
    if (i === -1) return null;
    list[i] = Object.assign({}, list[i], patch);
    all[channelId] = list;
    write(K.messages, all);
    Store.notify();
    return list[i];
  },

  updateCard(channelId, id, patch) {
    const all = Store.allMessages();
    const list = all[channelId] || [];
    const i = list.findIndex((m) => m.id === id);
    if (i === -1 || !list[i].card) return null;
    list[i] = Object.assign({}, list[i], { card: Object.assign({}, list[i].card, patch) });
    all[channelId] = list;
    write(K.messages, all);
    Store.notify();
    return list[i];
  },

  getMessage(channelId, id) {
    return Store.messages(channelId).find((m) => m.id === id) || null;
  },

  removeMessage(channelId, id) {
    const all = Store.allMessages();
    all[channelId] = (all[channelId] || []).filter((m) => m.id !== id);
    write(K.messages, all);
    Store.notify();
  },

  currentUserId() {
    return read(K.user, null) || "u1";
  },
  setCurrentUserId(id) {
    write(K.user, id);
    Store.notify();
  },

  activeChannelId() {
    return read(K.channel, null) || "C1";
  },
  setActiveChannelId(id) {
    write(K.channel, id);
    Store.notify();
  },

  profile(userId) {
    const all = read(K.profiles, {});
    return Object.assign(
      {
        ladderStep: -1,
        cooldownUntil: 0,
        dismissals: 0,
        accepts: 0,
        edits: 0,
        categoryAffinity: {},
        lastNudgeAt: 0,
        /* Tone learning. Numbers only — the edited text itself is Tier 1 and is
           discarded with the rest of working memory the moment the card
           resolves. What survives is how far the human moved the draft, never
           where they moved it to. */
        toneSamples: 0,
        toneWords: 0,
        toneEmoji: 0,
        toneExclaim: 0,
        lastEditWordDelta: 0,
        /* Probe / auto-pause. `pausedUntil` is set by the agent on itself after
           a probe is dismissed; it is not an opt-out and not an admin action. */
        probeSentAt: 0,
        probesDismissed: 0,
        pausedUntil: 0,
      },
      all[userId] || {},
    );
  },

  setProfile(userId, patch) {
    const all = read(K.profiles, {});
    all[userId] = Object.assign(Store.profile(userId), patch);
    write(K.profiles, all);
    Store.notify();
    return all[userId];
  },

  allProfiles() {
    return read(K.profiles, {});
  },
  replaceProfiles(obj) {
    write(K.profiles, obj);
  },

  history() {
    return read(K.history, []);
  },
  pushHistory(entry) {
    const h = Store.history();
    h.push(Object.assign({ ts: Date.now() }, entry));
    write(K.history, h.slice(-100));
    Store.notify();
  },
  replaceHistory(arr) {
    write(K.history, arr);
  },

  recognitions() {
    return read(K.recognitions, []);
  },
  pushRecognition(rec) {
    const all = Store.recognitions();
    all.push(Object.assign({ id: uid("rec"), ts: Date.now() }, rec));
    write(K.recognitions, all.slice(-50));
    Store.notify();
  },
  replaceRecognitions(arr) {
    write(K.recognitions, arr || []);
  },

  reset() {
    Object.values(K).forEach((k) => localStorage.removeItem(k));
    seedAll();
    Store.notify();
  },
};

function seedAll() {
  const all = {};
  DATA.channels.forEach((c) => {
    all[c.id] = (DATA.seedMessages[c.id] || []).map((m) =>
      Object.assign({ id: uid("m"), threadParentId: null, replyCount: 0, reactions: [], ephemeral: false, card: null }, m),
    );
  });
  write(K.messages, all);
  return all;
}

/* --------------------------------------------------------------- users */

const User = {
  all() {
    return DATA.employees;
  },
  get(id) {
    if (id === BOT.id) return BOT;
    return DATA.employees.find((u) => u.id === id) || (id === DATA.contractor.id ? DATA.contractor : null);
  },
  current() {
    return User.get(Store.currentUserId());
  },
  byHandle(h) {
    return DATA.employees.find((u) => u.handle === String(h).replace(/^@/, "").toLowerCase()) || null;
  },
  byFirstName(n) {
    const first = String(n).toLowerCase();
    return DATA.employees.find((u) => u.name.split(" ")[0].toLowerCase() === first) || null;
  },
  initials(u) {
    return u.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  },
  /* Relationship category only — never a named individual. This is the
     privacy boundary the PRD draws around behavioural memory. */
  relationship(senderId, recipientId) {
    const a = User.get(senderId);
    const b = User.get(recipientId);
    if (!a || !b) return "cross-department";
    if (a.managerId === b.id || b.managerId === a.id) return "manager";
    if (a.dept === b.dept) return "direct-teammate";
    return "cross-department";
  },
};

function fmtTime(ts) {
  const d = new Date(ts);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + m + " " + ap;
}

if (!localStorage.getItem(K.messages)) seedAll();
