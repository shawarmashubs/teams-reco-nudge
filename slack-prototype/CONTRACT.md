# BUILD CONTRACT — Slack R&R Nudge Prototype

**This file is frozen. Do not change any name defined here. Implement against it exactly.**

Vanilla JS/HTML/CSS. No build step, no framework, no npm, no imports/exports.
Files load in this order via `<script>` tags and communicate through globals:

```
data.js   ->  evals.js  ->  agents.js  ->  ui.js
```

`data.js` is already written. Read it before you start.

---

## 0. The loop this app must make legible

```
[input message]
  -> agent READS [context files]
  -> DECIDES [decision + confidence]
  -> DRAFTS [output fields]
  -> HUMAN clicks Submit (approve) | edits | dismisses (✕ or click-away)
```

Every one of those five stages must be visibly labeled in the UI. That is the
central requirement, not a nice-to-have.

---

## 1. Globals defined by `data.js` (already exists — consume, don't redefine)

```js
DATA.employees          // array of employee records
DATA.hris               // hris directory rows
DATA.clientConfig       // { budgetCap, coreValues, enabledChannels, ... }
DATA.coreValues         // ["Teamwork", ...]
DATA.channels           // seeded Slack channels
DATA.seedMessages       // seeded conversation per channel
DATA.recognitionGuidelines   // markdown string, RENDERED FROM recognitionRulebook
DATA.employerPolicy          // markdown string
DATA.nudgeTriggerExamples    // labeled few-shot examples
DATA.policyViolationExamples
DATA.recognitionSamples      // tone/voice samples for Draft agent

/* The Draft agent's three inputs. Prose renders from structure, never the
   reverse — a file the agent cites must not be able to drift from the object
   the agent uses. Change the structure and both the behaviour and the rendered
   file move together. */
DATA.coreValueCatalog        // [{ id, label, description, looks_like[],
                             //    not_this, signals[] }]  — signals are the
                             //    machine-readable half of looks_like.
                             //    ORDER IS LOAD-BEARING: first match wins ties.
DATA.recognitionRulebook     // { max_sentences, word_target{min,max}, min_chars,
                             //    hard_char_ceiling, one_value_only,
                             //    avoid: [{ id, label, pattern, why }],
                             //    register_by_relationship{}, thin_source }
                             //    `pattern` is a STRING, not a RegExp literal,
                             //    so it survives JSON rendering in the viewer.
DATA.recognitionSampleLibrary// { [valueLabel]: { frames{}, good[], weak[] } }
DATA.recognitionHouseFrame   // frames used when no core value matched
DATA.houseStyle()            // -> measured stats over the good samples:
                             //    { samples, weak_examples, median_words,
                             //      shortest_words, longest_words,
                             //      exclamation_rate, emoji_rate }

FILES                   // ordered registry, see §2
getFile(name)           // -> registry entry or null
FILE_NAMES              // array of file name strings

Store                   // localStorage-backed state, see §3
User                    // helpers: User.get(id), User.current(), User.all()
fmtTime(ts)             // "10:32 AM"
uid(prefix)             // unique id string
```

---

## 2. Context-file registry (`FILES`)

Each entry:

```js
{
  name: "employees.csv",
  kind: "csv" | "json" | "md",
  purpose: "Short human sentence: why an agent reads this.",
  render: () => "string preview of the file contents"
}
```

The trace UI renders `name` as a clickable chip; clicking opens a viewer showing
`purpose` + `render()`. Agents cite files **by exact `name` string**.

Registry contents (exact names — agents must cite these verbatim):

| name | read by |
|---|---|
| `slack_api_mock.json` | Listener |
| `nudge_trigger_examples.json` | Listener |
| `employees.csv` | Listener, Auth |
| `hris_directory.csv` | Auth |
| `client_config.json` | Auth, Draft |
| `employer_policy.md` | Auth |
| `policy_violation_examples.json` | Auth |
| `auth_mock.json` | Auth |
| `personalization_profiles.json` | Nudge, Personalization |
| `nudge_history.csv` | Nudge, Personalization |
| `core_values.json` | Draft |
| `recognition_guidelines.md` | Draft |
| `recognition_samples.json` | Draft |
| `achievers_api_mock.json` | Submission |

---

## 3. `Store` API (already implemented in data.js)

```js
Store.channels()                       // -> [{id, name, topic, private}]
Store.messages(channelId)              // -> [msg]
Store.addMessage(channelId, msg)       // msg gets id + ts if absent; returns msg
Store.updateMessage(channelId, id, patch)
Store.removeMessage(channelId, id)
Store.currentUserId() / Store.setCurrentUserId(id)
Store.activeChannelId() / Store.setActiveChannelId(id)
Store.profile(userId)                  // -> { ladderStep, cooldownUntil, dismissals,
                                       //      accepts, edits, categoryAffinity, lastNudgeAt }
Store.setProfile(userId, patch)
Store.history()                        // -> [ {ts, userId, outcome, channelId} ]
Store.pushHistory(entry)
Store.reset()                          // wipe all keys, reseed
Store.subscribe(fn)                    // fn() on any mutation
```

localStorage key prefix is `slackNudge.` — never `teamsChatPrototype.`.

### Message shape

```js
{
  id: "m_ab12",
  userId: "u1",              // or "bot-nudge"
  text: "Great job on the deck, Sam!",
  ts: 1737900000000,
  threadParentId: null,      // set on thread replies
  replyCount: 0,
  reactions: [],
  ephemeral: false,          // true = Slack ephemeral nudge card
  card: null                 // present only when ephemeral === true, see §5
}
```

---

## 4. Trace bus — the spine of the whole demo

`agents.js` **must** implement and expose this. `ui.js` consumes it.

```js
Trace.begin(input) -> runId
// input: { messageId, channelId, userId, text }

Trace.step({
  runId,
  agent:   "Listener" | "Auth + Validation" | "Nudge" | "Draft"
         | "Submission" | "Personalization" | "Human",
  phase:   "Observe" | "Decide" | "Act" | "Check",
  reads:   ["employees.csv", ...],   // exact FILES names, may be []
  decision: "Recognition detected — fire nudge",   // one short line
  status:  "pass" | "stop" | "wait" | "info",
  confidence: 0.91,                  // optional, 0..1
  detail:  [ ["label","value"], ... ],   // optional key/value rows
  output:  { field: value }          // optional drafted fields
})

Trace.end(runId, outcome)   // outcome: "sent"|"dismissed"|"edited"|"blocked"|"silent"
Trace.get(runId)            // -> { runId, input, steps: [...], outcome, startedAt }
Trace.all()                 // -> runs, newest first
Trace.current()             // -> most recent run
Trace.subscribe(fn)         // fn(run) on every begin/step/end
Trace.clear()
```

Rules:
- **Every** agent call emits at least one step. A gate that stops the chain emits a
  step with `status: "stop"` and a `decision` saying why. Silence must be visible.
- Human actions emit `agent: "Human"` steps: `"Approved and submitted"`,
  `"Edited draft fields"`, `"Dismissed via ✕"`, `"Dismissed by clicking away"`.

---

## 5. Card shape (ephemeral nudge state machine)

```js
card: {
  runId: "r_xx",
  stage: "nudge" | "login" | "draft" | "resolved",
  resolution: null | "sent" | "dismissed" | "cancelled" | "abandoned" | "blocked",
  senderId: "u1",
  recipientId: "u2",
  recipientName: "Sam Okafor",
  sourceText: "Great job on the deck, Sam!",
  needsLogin: false,
  confidence: 0.91,
  fields: {
    recipientId, coreValue, message, amount,   // the drafted output fields
    // coreValue is "" when nothing in core_values.json matched the source.
    // Blank is a real state, not a bug: the human must pick before Submit.
  },
  sessionExpiresAt: 0,   // draft stage only — a nudge has no expiry of its own
  sessionExpired: false,
  submissionError: null,     // "platform_error" | "missing_required" | null
  missingRequired: null      // ["core value", ...] when submissionError is
                             // "missing_required"; cleared as soon as the human
                             // fills the field, without a second Submit
}
```

---

## 6. `agents.js` public API

```js
Pipeline.onMessage(channelId, message) -> void
// Runs Listener -> Auth(eligibility) -> Nudge. If all pass, inserts the
// ephemeral bot message carrying card.stage="nudge" (or "login").
// Emits trace steps at every hop. Returns nothing.

Pipeline.accept(channelId, messageId)      // human clicked "Yes, recognize"
Pipeline.login(channelId, messageId)       // human completed simulated Slack login
Pipeline.editField(channelId, messageId, field, value)
Pipeline.submit(channelId, messageId)      // human clicked Submit
Pipeline.dismiss(channelId, messageId, via) // via: "x" | "clickaway" | "button"
Pipeline.reconnect(channelId, messageId)   // re-auth after session expiry
Pipeline.sweep()                           // expire open draft sessions; called on interval
```

### Agent behaviour (from PRD — implement exactly)

**Listener** — Observe: reads `slack_api_mock.json`, `nudge_trigger_examples.json`,
`employees.csv`. Decide: `classify(text)` (in evals.js) returns
`{fire, confidence, reason, matched}`. Dismissal patterns take precedence over
recognition patterns. Resolves recipient from @mention, then first-name match,
then thread parent author. Stops the chain if `fire === false`.

**Auth + Validation** — Observe: `hris_directory.csv`, `client_config.json`,
`employer_policy.md`, `policy_violation_examples.json`, `auth_mock.json`.
Checks in this order, first failure wins:
1. policy violation in source text -> `blocked`
2. recipient not found in HRIS -> `stop`
3. self-recognition (sender === recipient) -> `stop`
4. sender budget === 0 -> `stop` (silent, no nudge shown)
5. identity unverified -> passes but sets `needsLogin: true`

**Least privilege is a demo point:** the step Auth emits toward Listener/Nudge must
show only `verdict: 👍 / 👎`. The full validation package (budget, HRIS record,
policy result) is only emitted on the step feeding **Draft**. Label it in the trace.

**Nudge** — Observe: `personalization_profiles.json`, `nudge_history.csv`.
Decide: in cooldown -> `stop` (discard, no buffering). Else act: render ephemeral.

**Draft** — four phases, not three. Every file listed here must be *consumed*;
citing a file the code does not read is a contract violation, and cases 16–18 in
`evals.js` exist to catch it.

- *Observe*: `core_values.json`, `recognition_guidelines.md`,
  `recognition_samples.json`, `client_config.json`,
  `personalization_profiles.json`, plus the full validation package.
- *Decide*: `pickCoreValue(text)` scores the source against every `signals` entry
  in `DATA.coreValueCatalog` and the step prints the per-value tally, the
  tie-break, the register row, the frame source and the impact source. **No
  keyword map lives in `agents.js`.**
- *Act*: produce `fields` = `{recipientId, coreValue, message, amount}` via
  `composeDraft()`. `coreValue` is `""` when nothing matched — the agent does not
  default. The Act step says so in the trace.
- *Check*: `guidelineCheck(message)` runs the rulebook — length floor, the
  `hard_char_ceiling`, the sentence ceiling, and every compiled `avoid` pattern —
  plus `policyHit()`. Reads `recognition_guidelines.md` and `employer_policy.md`.
  The word target is **advisory**: a terse sender landing under it is the tone
  model working, not a defect.

Opens a 45s session (`SESSION_TTL_MS`), after which `sessionExpired` becomes true
and the card shows a reconnect affordance without losing edits.

Draft-side functions other code may rely on:

```js
pickCoreValue(text)   // -> { value: string|null, matched[], scores[], basis }
composeDraft(recipientName, sourceText, coreValue, tone, registerKey)
                      // -> { text, shape, register, registerRow, workObject,
                      //      houseStyle, frameSource, impactSource }
guidelineCheck(msg)   // -> { ok, failures[], broke[], brokeIds[], words,
                      //      sentences, chars, onTarget, rulesRun }
                      // assert on brokeIds — `broke` is prose for the trace
registerFor(senderId, recipientId)
                      // -> "direct-teammate" | "cross-department" |
                      //    "manager-upward" | "manager-downward"
                      // Splits the profile's collapsed "manager" by direction
                      // at call time. Never persisted — Tier 2 stores the
                      // category, not who reports to whom.
MAX_DRAFT_CHARS       // === DATA.recognitionRulebook.hard_char_ceiling
```

**Submission** — only runs on explicit human Submit. Reads `achievers_api_mock.json`.
Checks required fields from `DATA.clientConfig.recognition_rules` **before** the
policy check and returns `{ok: false, error: "missing_required", missing: [...]}`
without calling the platform. Then a simulated 25% `platform_error` that preserves
the draft and lets the human retry.

**Personalization** — runs on every terminal outcome. Reads/writes
`personalization_profiles.json`, `nudge_history.csv`. Cooldown ladder
`[2, 5, 24, 72]` hours. Explicit dismissal advances one step; a send resets to
step -1. There are no half-steps: a nudge is a Slack ephemeral, Slack does not
report non-interaction, so ignoring one cannot move the ladder. Recipient
affinity is stored at **relationship category level only** (`direct-teammate` |
`manager` | `cross-department`) — never a named individual. Say so in the trace
detail.

Tone learning is gated on the **message text** actually differing from
`card.draftMessage`, not merely on `outcome === "edited"`. Filling a blank
required field marks the card edited without the human having written a word, and
learning from that teaches the agent its own voice back as the sender's.

Constants to export from agents.js: `SESSION_TTL_MS = 45000`,
`COOLDOWN_LADDER_HOURS = [2,5,24,72]`, `PLATFORM_ERROR_RATE = 0.25`.
`MAX_DRAFT_CHARS` is **derived**, not a literal — see §6 Draft.

---

## 7. `evals.js` public API

```js
classify(text) -> { fire:boolean, confidence:number, reason:string, matched:string }
EVAL0_DATASET  // >= 200 labeled cases (holdout; see the header comment in evals.js)
runEval0()     // -> { total, correct, accuracy, falsePositiveRate, falseNegativeRate,
               //      recall, pass, misclassified: [{text, expected, got}] }
EVAL_CASES     // -> [ { id, title, expectation, run: () => ({pass, actual, note}),
               //        warm?: async () => void, samples?: number,
               //        aggregate?: (results, n) => ({pass, actual, note, runs}) } ]
runAllEvals(onProgress?)  // async -> { eval0, modelBacked,
               //   cases: [ {id, title, expectation, pass, skipped, runs,
               //             modelBacked, actual, note} ] }
```

`runAllEvals` is async because a case may declare `warm`, an async step that
calls the model before `run()`. A case with `warm` is sampled `samples` times
(default 5) and reports `runs`. With no API key it returns `skipped: true` and
`pass: false` — callers must count skipped separately, since a skip is "not
run", not "failed". Cases 13, 16, 17 and 18 declare `warm`; the other eighteen
stay synchronous, offline and exactly reproducible.

`runEval0().pass` requires accuracy ≥ 0.90 AND falsePositiveRate ≤ 0.05 AND recall > 0.50.

Case scenarios (PRD): 1 happy path, 2 cooldown suppression, 3 zero budget
silent, 4 identity unverified -> login, 5 session expiry mid-draft, 6 platform
error on submit, 7 self-recognition blocked, 8 cooldown ladder escalation,
10 recipient not in HRIS, 11 policy-violating text. Ten cases, not eleven —
Case 9 (no-interaction expiry) was dropped when the nudge became a Slack
ephemeral. IDs stay unrenumbered so they still match the PRD.

Cases 16–18 are not from the PRD. They exist because a trace that lists a file
the code never opens is a lie the demo tells confidently, and only an eval can
stop that from regressing:

- **16** mutates `DATA.coreValueCatalog` at run time and asserts the drafted
  value follows the data. Restores in a `finally`.
- **17** asserts an unmatched value leaves the field blank, that Submission
  refuses with `missing_required`, and that filling it lets the send through.
- **18** asserts every generated draft passes `guidelineCheck`, **and** that two
  known-bad control strings fail it. Half of that case is there to prove the
  check can fail at all.

Every case must snapshot and restore any state it touches. Use scratch ids
`__eval_user__` / `__eval_channel__`. A green suite after running it twice in a
row is the correctness bar.

---

## 8. UI contract — class names are frozen

Slack layout, top to bottom then left to right:

```
.sk-app
  .sk-topbar          global bar — history controls, search, help
  .sk-body            the four-column grid
    .sk-rail          workspace switcher + labeled nav (#350d36)
    .sk-sidebar       aubergine channel list (#3F0E40)
    .sk-main          channel header + message list + composer
    .sk-trace         the labeled agent-trace panel (right, white)
```

The grid lives on `.sk-body`, not `.sk-app`. Every column needs `min-height: 0`
— grid items default to `min-height: auto`, which makes `.sk-main` grow to fit
the whole transcript and pushes the composer off screen.

Required classes (ui.js emits them, styles.css styles them):

Top bar: `.sk-topbar`, `.sk-topbar-side`, `.sk-topbar-side-right`,
`.sk-topbar-search`, `.sk-topbar-search-icon`, `.sk-top-icon`.

Rail: `.sk-rail`, `.sk-rail-ws`, `.sk-rail-nav`, `.sk-rail-btn`, `.sk-rail-glyph`,
`.sk-rail-label`, `.sk-rail-foot`, `.sk-rail-avatar`.

Sidebar: `.sk-sidebar`, `.sk-sidebar-scroll`, `.sk-sidebar-note`,
`.sk-sidebar-note-dot`, `.sk-workspace`, `.sk-ws-btn`, `.sk-ws-name`,
`.sk-ws-caret`, `.sk-ws-compose`, `.sk-section`, `.sk-section-title`,
`.sk-twisty`, `.sk-sb-item`, `.sk-sb-glyph`, `.sk-sb-add`, `.sk-sb-add-glyph`,
`.sk-channel`, `.sk-channel.is-active`, `.sk-ch-glyph`, `.sk-ch-name`,
`.sk-ch-note`, `.sk-ch-badge`, `.sk-dm-avatar`, `.sk-presence`.

Channel column: `.sk-main`, `.sk-chan-header`, `.sk-chan-left`, `.sk-chan-name`,
`.sk-chan-caret`, `.sk-chan-glyph`, `.sk-chan-members`, `.sk-chan-count`,
`.sk-chan-topic`, `.sk-chan-actions`, `.sk-chan-icon`, `.sk-chan-sep`,
`.sk-facepile`, `.sk-messages`, `.sk-composer`, `.sk-composer-format`,
`.sk-composer-box`, `.sk-composer-input`, `.sk-composer-actions`, `.sk-fmt`,
`.sk-fmt-sep`, `.sk-send`.

Channel intro: `.sk-intro`, `.sk-intro-glyph`, `.sk-intro-title`,
`.sk-intro-text`, `.sk-intro-actions`, `.sk-intro-note`.

Messages: `.sk-msg`, `.sk-msg-gutter`, `.sk-msg-avatar`, `.sk-msg-body`,
`.sk-msg-head`, `.sk-msg-author`, `.sk-msg-time`, `.sk-msg-text`,
`.sk-msg-thread`, `.sk-msg-tools`, `.sk-msg-tool`, `.sk-reactions`,
`.sk-reaction`, `.sk-reaction-emoji`, `.sk-reaction-add`, `.sk-thread-count`,
`.sk-thread-last`, `.sk-thread-caret`.

Date dividers: `.sk-day-group`, `.sk-day`, `.sk-day-pill`, `.sk-day-caret`.
`.sk-day` is sticky and its containing block **must** be the per-day
`.sk-day-group`. Sticky straight onto `.sk-messages` makes every divider pin at
`top: 0` and pile up. `.sk-messages` must also carry no top padding — scroll
padding shifts the sticky origin and leaves a gap for messages to show through.

Ephemeral nudge: `.sk-ephemeral`, `.sk-eph-head`, `.sk-eph-bot`, `.sk-eph-eye`,
`.sk-eph-only-you`, `.sk-eph-x`, `.sk-eph-main`, `.sk-eph-body`,
`.sk-eph-quote`, `.sk-eph-actions`, `.sk-btn`, `.sk-btn-primary`,
`.sk-btn-danger`, `.sk-btn-ghost`, `.sk-btn-outline`.

Block Kit blocks: `.sk-bk-section`, `.sk-bk-context`, `.sk-bk-actions`,
`.sk-bk-tag`, `.sk-bk-dot`.

`.sk-eph-actions` and `.sk-eph-x` carry no CSS of their own. They are frozen
names the browser harness selects on, emitted alongside the class that does the
styling (`.sk-bk-actions` and `.sk-msg-tool`). Removing them as dead classes
breaks the tests.

Draft modal (Block Kit style): `.sk-modal-scrim`, `.sk-modal`, `.sk-modal-head`,
`.sk-modal-title`, `.sk-modal-x`, `.sk-modal-body`, `.sk-modal-foot`,
`.sk-field`, `.sk-field-label`, `.sk-field-hint`, `.sk-input`, `.sk-select`,
`.sk-textarea`, `.sk-banner`, `.sk-banner-warn`, `.sk-banner-error`.

Trace panel: `.sk-trace`, `.sk-trace-head`, `.sk-trace-heading`,
`.sk-trace-title`, `.sk-trace-sub`, `.sk-trace-x`, `.sk-stage`, `.sk-stage-num`,
`.sk-stage-head`, `.sk-stage-agent`, `.sk-stage-phase`, `.sk-stage-status`,
`.sk-reads`, `.sk-file-chip`, `.sk-decision`, `.sk-conf`, `.sk-conf-bar`,
`.sk-conf-fill`, `.sk-detail`, `.sk-detail-row`, `.sk-output`,
`.sk-output-row`, `.sk-empty`, `.sk-empty-icon`.
Status modifiers: `.is-pass`, `.is-stop`, `.is-wait`, `.is-info`.

Eval console: `.sk-eval-modal`, `.sk-eval-section`, `.sk-eval-row`, `.sk-pill`,
`.sk-pill-pass`, `.sk-pill-fail`, `.sk-eval-note`, `.sk-eval-miss`.

File viewer: `.sk-file-body`, `.sk-file-purpose`.
User switcher: `.sk-userlist`, `.sk-userrow`, `.sk-userrow-main`,
`.sk-userrow-name`, `.sk-userrow-hint`, `.sk-userrow-check`.
Shared: `.sk-icon`, `.sk-sprite`, `.sk-counter`.

### Slack visual tokens (styles.css must define these)

```css
--sk-aubergine: #3F0E40;
--sk-aubergine-dark: #350d36;
--sk-aubergine-hover: #4a154b;
--sk-active: #1164A3;
--sk-green: #007a5a;
--sk-green-hover: #148567;
--sk-text: #1d1c1d;
--sk-text-muted: #616061;
--sk-border: #dddddd;
--sk-bg: #ffffff;
--sk-ephemeral-bg: #fff8e6;   /* quoted-message tint inside the nudge */
--sk-danger: #e01e5a;
```

Derived tokens styles.css also defines: `--sk-sb-text`, `--sk-sb-glyph`,
`--sk-sb-hover`, `--sk-presence`, `--sk-badge`, `--sk-link`, `--sk-amber`,
`--sk-grey`, `--sk-hover-bg`, `--sk-line`, `--sk-focus`, `--sk-hairline`,
`--sk-rail-w`, `--sk-sidebar-w`, `--sk-trace-w`, `--sk-font`, `--sk-mono`.

Typography: `Lato, "Helvetica Neue", Arial, sans-serif`, base 15px, line-height 1.46667.
Sidebar text is a warm lilac `#cfc3cf`, not white-alpha; active channel is white
on `--sk-active`. Message hover background `#f8f8f8`. Every interactive element
needs a visible `:focus-visible` ring.

### Fidelity rules that are easy to break

- `--sk-ephemeral-bg` tints the **quoted message inside** the nudge, not the
  nudge row. A Slack ephemeral has no tint, border, or rounding — it is an
  ordinary message row, and the `APP` badge plus the *Only visible to you*
  footer are the whole difference. Emphasis comes from the Block Kit attachment
  bar on `.sk-eph-body`.
- `.sk-send` is never `disabled`. Slack keeps it clickable and just drops the
  green fill; `.is-ready` adds the fill. The browser harness clicks it directly.
- `.sk-messages` is bottom-anchored by `margin-top: auto` on its first child, not
  by `justify-content: flex-end` — that makes overflow above the fold
  unreachable by scrolling.
- Hover toolbars may use `opacity: 0` / `pointer-events: none`; harness clicks go
  through CDP `.click()` and are unaffected.

### Dismissal — three paths, all required
1. Click the `✕` on the ephemeral card -> `Pipeline.dismiss(ch, id, "x")`
2. Click anywhere outside the card -> `Pipeline.dismiss(ch, id, "clickaway")`
3. Click the "Not now" button -> `Pipeline.dismiss(ch, id, "button")`

Click-away must not fire when the click originates inside the card, inside the
modal, or on the composer.

---

## 9. Ground rules

- Synthetic data only. No real names of real people, no real API calls.
- No `alert()`, no `confirm()`. Use in-app banners.
- Keyboard accessible: Enter sends, Esc closes modal and dismisses the card.
- Comment sparingly. Match the surrounding style.
- Do not create files other than the one you are assigned.

---

## 10. Additions since freeze

Nothing above was changed. This section records names added afterwards, so the
contract stays the single place to look them up.

### `Store` — mock platform record

The other side of `POST /v1/recognitions`. **Not agent memory:** no behavioural
data lives here, and the two-tier memory rules in §5 do not apply to it. Cleared
by `Store.reset()` along with everything else.

```js
Store.recognitions()          // -> [ {id, ts, senderId, recipientId, coreValue,
                              //       message, amount, source} ]  newest last, capped at 50
Store.pushRecognition(rec)    // stamps id + ts, writes, notifies
Store.replaceRecognitions(arr)// bulk restore — used by the eval harness to unwind
```

`evals.js` must snapshot and restore this in `withScratch`, or an eval run
publishes to the demo's recognition wall.

### Card field

```js
policyViolation: null   // "insult" | "negative comparison" | null
```

Set by `Pipeline.editField` when the human's rewrite breaks employer policy, and
cleared when they correct it. `Agents.submission` re-checks independently and is
the actual gate — the field only lets the UI disable Submit before the click.

### Award amount is read-only

`card.fields.amount` comes from `client_config.json` and has no editable control.
The draft modal renders it as `<input class="sk-input is-locked" readonly>` so the
`<label for="fAmount">` association survives; `submitDraft` must not flush it.

### Class names

- `.sk-input.is-locked` — the fixed award field.
- Mock Achievers view: `.sk-ach-modal`, `.sk-ach-head`, `.sk-ach-brand`,
  `.sk-ach-sub`, `.sk-ach-stats`, `.sk-ach-stat`, `.sk-ach-stat-n`,
  `.sk-ach-stat-l`, `.sk-ach-wall`, `.sk-ach-card`, `.sk-ach-card-head`,
  `.sk-ach-who`, `.sk-ach-line`, `.sk-ach-meta`, `.sk-ach-points`,
  `.sk-ach-value`, `.sk-ach-msg`, `.sk-ach-source`, `.sk-ach-source-icon`, and
  `.sk-msg-avatar.is-ach`.

Modal type `"achievers"` (one at a time, like `"draft"`); `syncModals` re-renders
its wall on every store mutation.

### `llm.js` and `prompts/` — the model path

Loaded between `data.js` and `evals.js`: prompts first (they build from `DATA`),
then `llm.js`. Nothing else in the app may call the API directly.

```js
LLM.enabled()                        -> boolean, is a key set
LLM.setKey(k) / LLM.clearKey()       // localStorage "slackNudge.apiKey"
LLM.warmListener(text, channelName)  -> Promise<verdict|null>   // async, awaited by ui.js send()
LLM.cachedVerdict(text)              -> verdict|null            // sync, read by classify()
LLM.forget(text) / LLM.clearCache()  // Tier 1 memory
LLM.lastError()                      -> string|null

PROMPTS.shared
PROMPTS.listener   / listenerTurn(text, channel)          / listenerSchema
PROMPTS.drafter    / drafterTurn(recipient, src, sender)  / drafterSchema      // STUB, not called
PROMPTS.policyJudge/ policyJudgeTurn(stage, text)         / policyJudgeSchema  // STUB, not called
```

Model is `claude-opus-5`. Raw `fetch`, not the npm SDK — there is no build step
and no module loader here.

**The agents stay synchronous.** `evals.js` drives `Pipeline` synchronously and
every scenario case reads the result on the next line, so no agent may become
async. The model call happens in `ui.js send()` *before* `callPipeline`, writes
its verdict to a cache, and `classify()` reads that cache first:

```js
classify(text)              // cache first, deterministic fallback; adds .source
classifyDeterministic(text) // regex only — what the eval harness must call
```

Eval 0 measures the regex gate, and several of its strings are also in the demo
script, so eval call sites use `classifyDeterministic` and never see a warmed
verdict. Both paths return the same four fields; `.source` names which one ran
and is rendered as *Decided by* in the Listener trace.

With no key set, or on any failure — network, non-2xx, `stop_reason: "refusal"`,
no text block, unparseable JSON — `warmListener` returns `null` and the loop runs
on the deterministic classifier. The model path is never load-bearing.

### Two new stop paths

§6 lists Auth's checks as four blocking plus one non-blocking. There are now
five blocking, and the Nudge agent gates on preference before cooldown.

**Auth — `not-eligible`, inserted between `no-hris` and `self`:**

```js
row.status !== "active" || row.achievers_enrolled !== "yes" || row.recognition_eligible !== "yes"
```

A missing HRIS row and an unreceivable one are different facts and the trace has
to say which one stopped the chain, so the order is load-bearing.
`ineligibleReason(row)` names the failing column **for the trace only** — like
every non-policy Auth stop, the sender is shown nothing, because the reason is a
fact about a colleague's employment record.

**Nudge — opt-out, checked before cooldown:**

```js
preferences(userId) -> Object.assign({ nudge_sensitivity: "standard", opted_out: false },
                                     DATA.preferenceProfiles[userId] || {})
```

`client_config.json` sets `frequency_caps.respect_user_opt_out: true`. The
preference is a ceiling: a high-confidence signal is exactly the case where
overriding would be tempting, which is why it cannot. Opting out stops the prompt
to give recognition, never the ability to receive it.

### Seeded Tier 2 baselines

`DATA.preferenceProfiles` (per user) and `DATA.seedNudgeHistory` (164 rows,
back to `DATA.installedOn` = 2026-02-25) are carried-over behaviour from prior
periods. They are **read at render time and never written into `Store`** —
`nudge_history.csv` prints the seed rows above the live ones and labels the
boundary. Pushing them into `Store` would start every sender mid-cooldown and
break the cooldown evals.

Outcomes in the seed are limited to `sent` | `edited` | `dismissed`, the three
`agents.js` actually produces. `category_affinity` stays at relationship-category
level per §5.

### An installed history, not a fresh workspace

The prototype opens on a workspace where the integration has been live five
months. Everything below is derived from `DATA.seedNudgeHistory` at read time
unless marked hand-written.

```js
DATA.installedOn        // "2026-02-25" — the only hard date; everything else is relative
DATA.seedNudgeHistory   // 164 rows, ladder replayed forward so ladderStepAfter is real
DATA.programMetrics     // 5 monthly rollups, derived
DATA.seedRecognitions   // 30 published recognitions on the Achievers wall, derived
DATA.tuningEvents       // 10 rows, HAND-WRITTEN — the only things a replay cannot recover
```

`tuningEvents` exists because a sensitivity change, an opt-out, an admin pause
and a dismissed probe leave no trace in an outcome log. Threshold movements are
*not* stored: `agent_tuning_log.json` replays them through `Agents.__thresholdFor`
so the file can never drift from the function the Nudge agent actually calls.
The replay applies each sender's current sensitivity across their whole history,
so only the final bar is exact — the file says so in `replay_caveat`.

### Behaviour #1 — per-sender confidence threshold

`classify()` stays global; what moves is the bar the Nudge agent compares it to.

```js
const THRESHOLD_BASE = 0.55;          // what a static feature would ship
const THRESHOLD_TARGET_ACCEPT = 0.7;
const THRESHOLD_MIN = 0.35;
const THRESHOLD_MAX = 0.9;            // bounded both ends: 0.99 is an opt-out
const THRESHOLD_MIN_SAMPLE = 5;       //   the user never chose, 0.1 is spam
const FAST_DISMISS_SECONDS = 5;
const SENSITIVITY_OFFSET = { high: -0.1, standard: 0, low: 0.08, minimal: 0.15 };
```

```js
thresholdFor(sensitivity, decided, acceptanceRate, medianResponseSeconds)
  -> { value, basis, sample, personalized, fastDismisser }
confidenceThreshold(userId)   // the same arithmetic against a live sender

Agents.__thresholdFor  // pure, for the tuning log's replay
Agents.__threshold     // live, for the eval console
```

Both are read-only windows. An eval that infers the bar from whether a card
appeared is testing the wrong thing.

Under `THRESHOLD_MIN_SAMPLE` decisions the agent **refuses to personalize** and
returns the house default with `personalized: false` and `basis: "cold start"`.

**Signature change:** `Agents.nudge(runId, senderId, confidence)` — §6 lists it
without `confidence`. It returns
`{ ok, probe, probeReason, threshold }`.

### Behaviour #2 — tone learned from edits

New `Store.profile()` fields, all counts and averages. **No draft text is ever
persisted** — §5 Tier 1 still holds, and an eval asserts the profile JSON
contains no words from the submitted message.

```js
toneSamples, toneWords, toneEmoji, toneExclaim, lastEditWordDelta
```

This required a **new card field with a lifecycle**:

```js
draftMessage: null   // the agent's own words, set on accept, nulled on resolve
```

Set by `Agents.draft` through `Store.updateCard` — never by mutating the card
object, which `Store` re-parses on every read — and cleared on all three
resolution paths (accept-blocked, submit, dismiss) so it cannot outlive the
nudge it belongs to. Personalization diffs it against what the human submitted;
that diff is the only thing that survives.

### Behaviours #3 and #4 — probe, self-pause, opt-out, admin

```js
const PROBE_AFTER_DAYS  = DATA.clientConfig.frequency_caps.probe_after_days_at_cap;              // 14
const AUTO_PAUSE_DAYS   = DATA.clientConfig.frequency_caps.auto_pause_days_after_probe_dismissed; // 30
const DAY_MS = 86400000;
```

```js
probeSentAt, probesDismissed, pausedUntil   // Store.profile() fields
```

`probeCheck(userId)` returns `{ eligible, reason }`. A sender at the ladder
ceiling with nothing accepted for `PROBE_AFTER_DAYS` gets **exactly one** prompt
through both the bar and the cooldown — the two gates it exists to escape.
Dismissing it is an answer, not a deferral: Personalization sets
`pausedUntil = now + AUTO_PAUSE_DAYS` and the agent stops asking. Accepting it
clears the ladder.

The Nudge agent now runs **six gates in this order**, and the order is
load-bearing:

```
opted_out → admin paused → self-paused → probe (bypasses the next two) → below bar → cooldown
```

`clientConfig.enrolment` carries the admin half:

```js
{ mode: "opt-out" | "opt-in", enrolled_departments: [...],
  admin_paused_users: [{ user_id, paused_on, paused_by, reason }],
  admin_can_override_user_opt_out: false }
```

`admin_can_override_user_opt_out` is read, never written. An admin can stop the
agent nudging someone and cannot start it against their stated preference.

### Fifteenth context file

`agent_tuning_log.json` — the threshold's own history, per §2's registry. Its
`render()` runs at click time and may reference `agents.js` globals; `data.js`
itself must not, since it loads first.

### Class names — probe affordance

- `.sk-eph-probe`, `.sk-eph-probe-tag` — the probe banner on the nudge card.
  A probe ignores the cooldown on purpose, so it cannot look like an ordinary
  nudge that ignored it by accident. The secondary button relabels to
  *No, pause these for 30 days*, because that is what the click does.
