# Design notes — Recognition Nudge

Why the prototype behaves the way it does, plus the full demo walkthrough.
Start with [README.md](README.md) if you just want to run it.

---

## The loop this demo makes visible

```
[input]                 a message posted in a monitored public channel
  ↓
agent reads             the context files named in the trace panel
  ↓
decides                 fire / discard / block, with confidence
  ↓
drafts                  recipient · core value · message · award
  ↓
human                   Submit (approve) · edit fields · dismiss (✕ or click away)
```

The right-hand **Agent Trace** panel is the point of the prototype. Each numbered
card is one agent's turn: what it read, what it decided, and what it produced.
Stages that *stop* the chain are shown too — a nudge that never appears is a
decision, and the demo has to show it.

---

## Five-minute demo script

| # | Do this | Watch for |
|---|---|---|
| 1 | As **Priya**, post `Great job on the deck, Sam!` in `#product-launch` | Listener fires at high confidence; Auth passes; the nudge appears as an ordinary message row from **Recognition Nudge** with an `APP` badge and an *Only visible to you* footer — exactly how Slack renders an ephemeral |
| 2 | Click **Yes, recognize** | Draft composes from `recognition_samples.json` frames and the `recognition_guidelines.md` register table, then checks its own output against the rulebook. The Decide step prints the per-value scores it read out of `core_values.json` |
| 2a | Look at **Core value** | **Blank**, and Submit is disabled. "Great job on the deck" is praise with no behavioural signal, so nothing in `core_values.json` matched — the agent says so instead of defaulting. Pick one and Submit unlocks |
| 3 | Try to change **Award** | You can't. The amount is fixed by the client's program in `client_config.json` and rendered read-only — it's there to be confirmed, not chosen |
| 4 | Edit the message text | A `Human — Edited draft fields` step lands in the trace |
| 5 | Rewrite the message to `thanks for cleaning up that idiot's code` | Submission's final check fires **while you type**: Submit disables, an inline banner names the violation, and the trace shows the agent stopping *before* any POST step exists. Correct the text and the block clears — visibly, as its own trace step |
| 6 | Click **Submit** | Submission agent posts to the mock API. ~1 in 4 attempts returns a platform error that preserves the draft — hit **Try again** |
| 7 | Click **View in Achievers** on the resolved card | The mock platform's recognition wall, with the recognition published and stamped *Sent from Slack — never opened this platform*. Also reachable any time from the **Achievers** button in the channel header |
| 8 | Post another recognition immediately | Nudge agent stops the chain: still in cooldown. The signal is **discarded, not queued** |
| 9 | Switch to **Liam Chen**, post recognition | Auth stops on zero budget. No nudge renders at all — silence, visible only in the trace |
| 10 | Switch to **Noor Haidari**, post recognition | Identity unverified → card opens at the login stage instead of the draft |
| 11 | Open a draft and wait 45s | Session expires; the banner offers reconnect and your edits survive |
| 12 | Trigger a nudge, then click anywhere in the channel | Dismissed by click-away; cooldown ladder advances one step |
| 13 | Post in `#leadership-private` | Listener isn't subscribed — logged as info, chain never starts |
| 14 | Switch to **Mei Tanaka**, post recognition | Mei has opted out in `personalization_profiles.json`. Nudge stops the chain before cooldown is even consulted — a high-confidence signal does not override the preference |
| 15 | Post `Thanks for the migration, Sam` as **Ava Torres**, then the same text as **Jordan Lee** | One classifier verdict, 0.72, and two different answers. Ava accepts most of her nudges so her bar has fallen to 0.38 and she gets the card; Jordan has dismissed almost everything for months so his bar sits at the 0.90 ceiling and he gets silence. The trace prints the arithmetic and the sample size it came from |
| 16 | Stay as **Jordan**, post recognition again | He's been at the 72h cap with nothing accepted for weeks, so the agent spends its one **probe** through the cooldown. The card says so, and *Not now* becomes *No, pause these for 30 days* — a dismissal here is an answer, not a deferral |
| 17 | Dismiss the probe, then post another high-confidence recognition | Nothing. The agent paused itself for a month. It asked once, got its answer, and stopped |
| 18 | Switch to **Diego Ramirez**, post recognition | Admin-paused in `client_config.json` — a new starter, paused pending training. Outranks confidence, cooldown and the sender's own preference, and the sender can't undo it |
| 19 | Open `agent_tuning_log.json` from the file list in any trace | Five months of threshold movements per sender, replayed through the same function the Nudge agent calls, interleaved with the sensitivity changes, opt-outs and pauses a replay can't recover. It's a rendered view of the agent's history, not an input it reads |
| 20 | Post `Thanks for jumping in on the release checklist, Sam` | Same modal, but **Core value: Teamwork**, pre-filled. The Decide step shows which words in the source matched which signal, and the draft opens on the Teamwork frame rather than the house one |
| 21 | Open **Eval Console** | Eval 0 classifier gate plus 22 scenario cases. Cases 16–18 are the ones that make the Draft agent's file list falsifiable. With a key set, 13/16/17/18 run against real model output five times each and report a rate; without one they read SKIP |

Click any file chip in the trace to read the actual context file the agent used.

---

## Architecture

Six agents in a bounded Observe → Decide → Act → Check loop. **No orchestrator
above the chain** — each agent hands off to the next, and any one of them can
stop the loop.

| Agent | Reads | Can stop the chain on |
|---|---|---|
| Listener | `slack_api_mock.json`, `nudge_trigger_examples.json`, `employees.csv` | no recognition signal, unmonitored channel |
| Auth + Validation | `hris_directory.csv`, `client_config.json`, `employer_policy.md`, `policy_violation_examples.json`, `auth_mock.json` | policy violation, recipient not in HRIS, recipient in HRIS but not receivable (inactive, not enrolled, not eligible), self-recognition, zero budget |
| Nudge | `personalization_profiles.json`, `nudge_history.csv`, `client_config.json` | sender opted out, admin paused, agent self-paused, confidence below **this sender's** bar, active cooldown |
| Draft | `core_values.json`, `recognition_guidelines.md`, `recognition_samples.json`, `client_config.json`, `personalization_profiles.json` | failed output check (its own draft breaks a rule in the guidelines) |
| Submission | `employer_policy.md`, `policy_violation_examples.json`, `achievers_api_mock.json` | policy violation in the human's edited text, platform error (retryable) |
| Personalization | `personalization_profiles.json`, `nudge_history.csv` | — |

Every Auth stop except a policy violation is **silent to the sender**. Telling
someone "you can't recognize this person" hands them a fact about a colleague's
employment record they were never entitled to, so the reason lives in the trace
and nowhere else. The trace still distinguishes *no HRIS row* from *HRIS row, not
receivable* — different failures, different fixes.

### Least privilege between agents

Auth returns only a **thumbs-up/down verdict** to the Listener and Nudge agents.
The **full validation package** — budget, HRIS record, policy result — is released
only to the Draft agent. The trace labels both steps with their scope, because the
boundary is a design claim worth showing rather than asserting.

### What makes this an agent rather than a feature

A static feature has one confidence threshold, one cooldown ladder and one voice.
Four behaviours here are per-person and move on their own.

**1. The confidence bar is personal.** The classifier is global — the same message
scores 0.72 for everyone. What changes is the bar it has to clear, computed from
that sender's own accept rate, sample size, decision speed and sensitivity dial.
Ava sits at 0.38 and Jordan at 0.90, so one identical signal produces a card for
one of them and silence for the other. The bar is clamped to `[0.35, 0.90]`:
an agent that can tune itself to 0.99 has invented an opt-out the user never
chose, and one that can reach 0.1 has invented spam. Under five decisions it
**refuses to personalize** and says *cold start* in the trace.

**2. Voice is learned from edits.** When a human rewrites a draft, Personalization
diffs the agent's words against theirs and stores the shape of the difference —
length, emoji rate, exclamation rate, direction of the word-count change. Never
the text. Draft reads those counts back and writes terser or warmer accordingly.

**3. The ladder has an escape hatch.** Four dismissals pin a sender at the 72h cap
forever, and every further dismissal renews it — indistinguishable from an opt-out
they never chose. After 14 days at the ceiling with nothing accepted, the agent
spends exactly one **probe** through both the bar and the cooldown, labelled as
what it is. Dismiss it and the agent pauses itself for 30 days. Asking once is a
question; asking forever is harassment.

**4. Opt-out and admin enrolment are real gates.** The sender's opt-out is a
ceiling nothing overrides. The workspace admin can pause a sender or run the whole
program opt-in by department — and `admin_can_override_user_opt_out` is `false`
and not configurable. An admin can stop the agent nudging someone; they cannot
start it against a stated preference.

The gates run in this order, and the order is the argument:

```
opted out → admin paused → self-paused → probe (bypasses the next two) → below this sender's bar → cooldown
```

### Two-tier memory

- **Tier 1 — working memory only.** Message text lives for the duration of one
  nudge and is discarded when the card resolves. That includes the agent's own
  draft: `card.draftMessage` exists only so Personalization can diff it against
  what the human submitted, and it is cleared on every resolution path.
- **Tier 2 — persistent, non-PII, behavioural only.** Cooldown and ladder state,
  accept/dismiss/edit counts, probe and pause state, the derived tone counts
  above, and recipient affinity at **relationship category level**
  (`direct-teammate` / `manager` / `cross-department`) — never a named individual,
  never a line of message text. An eval asserts the stored profile contains no
  words from the message that produced it.
  Each sender starts from a seeded baseline in `personalization_profiles.json`
  carried over from prior periods; this session's activity is the delta on top,
  and `nudge_history.csv` shows both, separated.

### The workspace has a history

The demo opens five months after install (`2026-02-25`), not on an empty
workspace — none of the four behaviours above mean anything without one. 164
prior nudges across eight senders, ladder state replayed forward so it is real
rather than asserted, 30 published recognitions on the Achievers wall, and five
monthly rollups. All of it is derived from the one history at read time.

`agent_tuning_log.json` is the exception worth reading: it replays every
threshold movement through the *same function the Nudge agent calls*, so the file
cannot drift from the behaviour. The only hand-written rows are the ten things a
replay can't recover — sensitivity changes, the opt-out, the admin pause, and
Jordan's probe-and-auto-pause from six weeks ago.

### Human-in-the-loop gate

Nothing is ever sent automatically. The Submission agent runs only on an explicit
Submit click. Dismissal has three paths — `✕`, click-away, and *Not now* — all of
which are recorded as distinct human actions in the trace.

The gate runs both ways. Auth vets the source message and Draft vets its own
output, but the human can rewrite the draft after both have passed, so
**Submission re-checks the text that is actually about to be posted** and refuses
to call the platform if it breaks employer policy. The disabled Submit button is
only the early warning; the refusal itself lives in the agent that owns the call.

---

## Prompts

Six agents, three prompts. Only three of them decide anything a rule can't:

| Agent | Prompt | Why |
|---|---|---|
| Listener | `prompts/listener.js` | Is this recognition? Judgment, and the one the whole product rests on |
| Auth + Validation | — | HRIS lookup, budget arithmetic, identity check. Its one judgment call is policy, below |
| Nudge | — | Cooldown is date maths |
| Draft | `prompts/drafter.js` | Write in the sender's voice without inventing praise |
| Submission | `prompts/policy-judge.js` | Same judgment as Draft's check, run on the human's edited text |
| Personalization | — | Ladder arithmetic and counters |

`prompts/_shared.js` is the preamble all three get: the shape of the loop, the
no-orchestrator rule, and that message text is working memory. The layering
matters — the shared preamble and the agent's own prompt go in `system` and never
change; anything that varies per message goes in the `user` turn. Mixing them
breaks prompt caching and makes eval diffs meaningless.

They're `.js` rather than `.md` because the app runs from `file://` with no build
step, so `fetch()` of a local `.md` is blocked by CORS. Template literals in a
plain `<script>` are the only way to keep one prompt per file here.

**Only the Listener is wired.** The drafter and policy-judge prompts are written
and correct, but nothing calls them yet — `agents.js` uses `composeDraft()` and
`policyHit()`. Both stubs say so at the top of the file.

That stays true, and it is not the same claim as "the Draft agent doesn't read
its files". The deterministic drafter reads all three, and has to: every eval
runs synchronously with no API key, so anything load-bearing that only works
behind a model call is untested. See below.

### What the Draft agent actually reads

The trace lists three files under Draft's Observe step. Each is load-bearing in
a different way, and each has an eval that breaks if you unwire it.

| File | How it is consumed | Breaks case |
|---|---|---|
| `core_values.json` | Every value carries a `signals` array. The Decide step scores the source text against all of them and prints the per-value tally. First match wins ties, so catalogue order is meaningful | 16 |
| `recognition_samples.json` | Each value's good samples, with the specifics stripped, are the `frames` the draft is built from. The file also reports `house_style` — median length, exclamation rate, emoji rate — **measured from the samples**, not asserted | 18 |
| `recognition_guidelines.md` | Rendered from `DATA.recognitionRulebook`. The register table decides the draft's shape by relationship; the avoid-list is compiled to regexes and run against the agent's own output in the Check step | 18 |

Two consequences worth stating plainly:

**No match means blank.** If nothing in `core_values.json` matches, the field is
empty, Submit is disabled, and the human picks. A default would put a wrong value
on a permanent award record with nothing in the UI admitting it was a guess —
the same reasoning as PRD Case 4 for an unresolvable recipient.

**The rules are checked, not just cited.** The Check step runs the avoid-list
against the draft the agent just wrote. The previous template ended every draft
with *"that is exactly what Teamwork looks like here"* — which
`recognition_samples.json` already listed as a weak example, because restating
the value label says nothing. The file was cited in the trace and contradicted in
the code. That string is now case-18's control: it must fail the check.

### Running the evals outside the browser

`tools/` holds a small Node harness that loads the same scripts `index.html`
loads, in the same order, with `localStorage` and `document` shimmed:

```
node tools/run-evals.js          # eval 0 + 18 offline cases; 4 draft cases report SKIP
node tools/run-evals.js --live   # adds the 4, 5 samples each, needs ANTHROPIC_API_KEY
node tools/inspect-draft.js      # what Draft picks and composes across sample threads
```

Nothing in the app imports it, and the browser console still runs the same
`runAllEvals()`. It exists so the suite can gate a change without a click.

Eighteen cases never reach a draft, so they stay offline, instant and exactly
reproducible — those are the ones that gate a commit. Cases 13, 16, 17 and 18
judge text the model wrote, which means they need a key and cannot be
reproducible. They run five times and report a rate. Without a key they report
`SKIP` in grey rather than `FAIL` in red: not having pasted a key is not the
agent being broken, and a suite that cries wolf about its own setup teaches you
to stop reading it.

### Running the Listener on the model

By default there is no API key and the Listener uses the deterministic classifier
in `evals.js`. To use `claude-opus-5` instead, from the browser console:

```js
LLM.setKey("sk-ant-...")   // LLM.clearKey() to go back
```

Post a message and the Listener trace gains a **Decided by** row naming which path
produced the verdict. On any failure — no key, network, refusal, bad JSON — it
falls back to the classifier silently. The model path is never load-bearing.

**The key sits in the browser.** It goes in `localStorage` and every request
carries `anthropic-dangerous-direct-browser-access: true`. That is acceptable for
a faculty demo over entirely synthetic data and acceptable nowhere else — a real
deployment puts a server in between and the key never leaves it.

The call is `await`ed in `ui.js send()`, before the pipeline starts, not inside
the Listener. `evals.js` drives `Pipeline` synchronously and every scenario case
reads the result on the next line, so the agents have to stay synchronous. The
verdict lands in a cache, `classify()` reads that cache first, and the eval
harness calls `classifyDeterministic()` so a warmed verdict can never leak into
Eval 0.

---

## Files

| File | Contains |
|---|---|
| `index.html` | Shell and script order |
| `data.js` | Synthetic roster and budget ledger, HRIS, the 15 context files, five months of seeded behavioural history and preference profiles, localStorage store |
| `prompts/` | One system prompt per agent that has to exercise judgment |
| `llm.js` | The only place this app calls a model |
| `evals.js` | Classifier, Eval 0 dataset and gate, 22 scenario cases |
| `agents.js` | Trace bus, six agents, pipeline |
| `tools/` | Node harness to run the suite headlessly. Not loaded by `index.html` |
| `ui.js` | Slack chrome, message rendering, ephemeral nudge, draft modal, mock Achievers view, trace panel |
| `styles.css` | Slack design tokens and layout |
| `CONTRACT.md` | Frozen interface between the above |

### Slack fidelity notes

The chrome is rebuilt against the shipped desktop client, not the marketing site.
A few choices are deliberate and easy to undo by accident:

- **Aubergine is `#3F0E40`, not `#4A154B`.** The second one is the logo colour.
  Using it for the sidebar is the most common tell in a Slack replica.
- **The ephemeral has no tint, border, or rounding.** Slack renders it as a plain
  message row; the `APP` badge and the *Only visible to you* footer are the entire
  difference. Emphasis comes from a Block Kit attachment bar on the message body.
- **The send button is never disabled** — Slack keeps it clickable and just drops
  the green fill when the box is empty.
- **Date dividers are sticky per day group**, so the next day's pill pushes the
  previous one out instead of both pinning to the top.
- **The transcript is bottom-anchored.** A short channel rests on the composer
  rather than leaving white space above the first message.
- **The Achievers view is deliberately not Slack.** Different type, different
  colour, different vocabulary — the argument of the product is that the human
  never had to go there, which only lands if it looks like somewhere else.

`localStorage` keys are prefixed `slackNudge.`. **Reset demo** in the channel
header clears all state and reseeds.
