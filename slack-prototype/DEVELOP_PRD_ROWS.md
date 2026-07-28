# Develop PRD — Rows 29–36

Paste each block into column F of the matching row in
`Shubhi Sharma - Agentic AI PRD - R&R Nudge (Product Faculty)-latest.xlsx`,
sheet **Agentic AI PRD**.

All eight are self-contained. No links, no "see the video", no "see the repo".

> **Row 33 is not finished.** It needs the live eval run:
> `ANTHROPIC_API_KEY=sk-ant-... node tools/run-evals.js --live`
> Everything marked ⚠ below is a placeholder. Do not paste Row 33 until they are real.

---

## Row 29 · Prototype scope — one end-to-end loop

**Q: What single end-to-end loop will the prototype prove?**

One loop, from an ordinary Slack message to a published recognition, with the human holding
the only irreversible click.

1. **INPUT** — a sender posts a message in a monitored public channel (`#product-launch`,
   `#design-crit`, `#general`). Nothing is uploaded and nothing is pasted into a form. The
   input is the work conversation itself.
2. **CONTEXT** — the Listener classifies the message for genuine recognition and predicts the
   recipient from the thread. Auth + Validation re-derives enrollment, budget, HRIS
   receivability, self-recognition and employer policy from the context files. The Nudge agent
   reads this sender's own accept history to compute the confidence bar they have to clear and
   their cooldown state.
3. **DECISION** — fire, discard, or block, with a confidence score and a named reason. Every
   stop is a decision the prototype shows: a nudge that never appears is still rendered in the
   Agent Trace panel, even though the channel stays silent.
4. **OUTPUT** — on acceptance the Draft agent calls `claude-opus-5` to write the recognition in
   the sender's voice and to propose the core value. The proposal is checked against
   `core_values.json` before it reaches the field and blanked if no signal in the source
   message supports it. Four labeled fields result: recipient, core value, message, and the
   award amount fixed by the client program and rendered read-only.
5. **REVIEW** — the sender edits any field freely and clicks **Submit**, or dismisses via *Not
   now*, the ✕, or clicking away. On Submit the Submission agent re-runs the policy check on
   the text the human actually wrote, then posts to the mock Achievers API. The Personalization
   agent updates the sender's threshold, cooldown and voice counts from the outcome.

Scope decision, taken against faculty feedback on the Design phase. The design describes six
agents as a production system. Develop builds one loop end to end, detect → nudge →
draft-in-voice → confirm → publish, with authentication as a simulated background beat rather
than a real OAuth exchange. All six agents exist as real, separately traced code, but only the
loop above is claimed as working.

---

## Row 30 · User interaction — what the user does

**Q: What will the user type, upload, click, or review in the prototype?**

The reviewer drives the prototype as an employee inside a Slack workspace. They never see an
admin screen or a settings form.

**Types:** a message into the Slack composer, as one of eight seeded senders picked from the
workspace switcher. Nothing else is typed to start the loop. Switching sender is the whole
demo control surface, because the same sentence has to produce different behavior for
different people.

**Sees:** an ephemeral nudge card rendered the way Slack actually renders one, a plain message
row from *Recognition Nudge* with an `APP` badge and an *Only visible to you* footer, no tint
and no border. On acceptance, a Block Kit modal with four labeled fields. On the right, the
**Agent Trace** panel: one numbered card per agent turn, showing which context files that agent
read, what it decided, and what it produced, including the stages that stopped the chain. Any
file chip in the trace opens the actual context file the agent used.

**Clicks, the three that matter:**

- **Yes, recognize** — accepts the nudge and opens the draft modal. Where the sender's identity
  is unverified, this routes through a simulated login first and the draft survives it.
- **Not now** — declines. Recorded as a distinct human action, and advances that sender's
  cooldown ladder one step (2h → 5h → 24h → 72h).
- **Submit** — the only irreversible action in the product. Runs the Submission agent's final
  policy check on the human's edited text, posts to the mock Achievers API, deducts the award
  from the sender's budget and credits the recipient.

Also available: the ✕ and click-away dismissal paths, both logged separately from *Not now*;
inline editing of recipient, core value and message inside the modal, with the award read-only
because the client program fixes it; **View in Achievers** to see the published recognition on
the mock platform's wall, stamped *Sent from Slack — never opened this platform*; **Eval
Console** for the classifier gate and the 22 scenario cases; **Reset demo** to clear all state
and reseed.

Nothing is ever sent automatically. The Submission agent runs only on an explicit Submit click.

---

## Row 31 · Synthetic data used — demo-safe inputs

**Q: List the fake data files, sample records, policies, or examples used in the prototype.**

Everything below is synthetic. No real employee, no real customer, no real Slack workspace, no
real Achievers tenant, no production API. The fictional client is **Northwind Collective**, a
professional services firm running a program called *Applause*. Fifteen context files, all
readable in the app by clicking a file chip in the Agent Trace.

**Roster and identity**
- `employees.csv` — 8 senders with department, manager, recognition budget balance and
  enrollment status. Liam Chen sits at budget 0 on purpose.
- `hris_directory.csv` — 8 rows, the system of record, carrying `recognition_eligible` and
  `achievers_enrolled` separately from the roster. Alex Rowe (contractor) is deliberately
  absent, so recipient resolution has something real to fail on.
- `auth_mock.json` — identity verification state per sender. Noor Haidari is unverified.

**Program configuration and policy**
- `client_config.json` — recognition rules (peer-to-peer, no self-recognition, core value
  required, 20–300 character message), a fixed $25 default award the sender cannot change, a
  $200 monthly per-user budget, frequency caps, the 2/5/24/72-hour cooldown ladder, opt-out vs
  opt-in enrollment mode, enrolled departments, and one admin-paused user.
- `employer_policy.md` — the client's written recognition policy.
- `recognition_guidelines.md` — Achievers' own guidance on what a good recognition says.
- `policy_violation_examples.json` — 13 labeled examples of text that must never be published.
- `core_values.json` — 5 client-configured values (Teamwork, Customer Focus, Innovation,
  Excellence, Going Above & Beyond), each with a signal list. Catalog order is load-bearing and
  the file says so.

**Classifier corpora**
- `nudge_trigger_examples.json` — 129 labeled messages, each with a written reason, covering
  genuine recognition and the near-misses that break naive keyword matching: sarcasm, negated
  praise, self-praise, relayed thanks, forward-looking thanks, "appreciate" meaning
  *understand*, receipt acknowledgements, praise aimed at a thing rather than a person.
- A separate 200-item scored holdout inside `evals.js`, disjoint from the training corpus apart
  from ten strings shared on purpose and documented in the file.
- 4 multi-turn transcripts kept as the reference set for a known limitation. The Listener is
  deliberately per-message and cannot see them.

**Behavioral history, the part that makes it an agent rather than a feature**
- `personalization_profiles.json` — 8 seeded profiles: per-sender confidence bar, sensitivity
  dial, opt-out state, tone counts, recipient affinity at relationship-category level only.
- `nudge_history.csv` — 164 prior nudge outcomes across 8 senders, spanning five months from
  install on 2026-02-26. Ladder state is replayed forward through the same function the Nudge
  agent calls, so the history is real rather than asserted.
- `agent_tuning_log.json` — every threshold movement per sender, replayed through that same
  function, interleaved with 10 hand-written events a replay cannot recover: sensitivity
  changes, the opt-out, the admin pause, and one sender's probe-and-auto-pause.
- 31 previously published recognitions on the mock Achievers wall and 5 monthly program
  rollups, all derived from the one history at read time.

**Mocked platforms**
- `slack_api_mock.json` — the Events API shape the Listener subscribes to.
- `achievers_api_mock.json` — accepts a recognition payload and returns a confirmation, with a
  declared retryable platform error fired on roughly 1 submit in 4, so the failure path is
  demonstrable rather than theoretical.
- `recognition_samples.json` — house frames per core value, used to set the register of the
  draft.

The workspace deliberately opens five months after install rather than empty. A personalized
confidence bar, a cooldown ladder, a learned voice and a self-pause mean nothing without a
history to have learned them from.

---

## Row 32 · Eval cases — test set

**Q: List at least five test cases, including happy path, edge case, and boundary case.**

**The five.**

| # | Case | Type | Expected behavior |
|---|---|---|---|
| 1 | **Happy path** | happy path | Priya posts *"Great job on the deck, Sam!"* in a monitored channel. The Listener fires at 0.92, resolves Sam Okafor as recipient, and an ephemeral card appears for Priya only. |
| 2 | **Personalized confidence bar** | edge | One identical 0.72 signal, two senders, two answers. Ava accepts most of her nudges so her bar has fallen to 0.38 and she gets the card. Jordan has dismissed almost everything for months so his bar sits at the 0.90 ceiling and he gets silence. Same input, different output, and the trace prints the arithmetic. |
| 3 | **Session expiry mid-draft** | edge | The auth token expires while the human is editing. The edits survive, reconnect is offered, and nothing is lost or sent. |
| 4 | **Generated drafts obey the rulebook** | edge | Every draft the model writes is checked against `recognition_guidelines.md`. Two known-bad control strings must fail that check: a retired template the agent used to produce, and invented character praise ("your dedication and tireless commitment"). A self-check that only ever passes is decoration. |
| 5 | **No core value the source supports** | boundary — refuse and escalate | The sender writes praise with no behavioral signal. The agent must not guess. The core value field arrives blank with a stated reason, Submit is disabled, and the Submission agent independently refuses to call the platform on a missing required field. The decision goes back to the human. |

**Behind those five: a classifier gate and seventeen more scenario cases**, all runnable from
the in-app **Eval Console**.

**Eval 0 — the classifier gate, runs first and gates everything else.** 200 held-out messages
scored against the Listener's classifier. Never trained on, never rendered into a prompt. Pass
bar: ≥90% accuracy, ≤5% false-positive rate, >50% recall. This runs before any scenario case
because every other agent fires off this one judgment, and a Listener that over-fires turns the
product into noise no downstream gate can rescue.

**The other seventeen scenario cases**, each driving the real pipeline end to end:

*Suppression, the agent choosing silence* — cooldown suppression discards rather than queues;
zero budget produces no nudge UI at all; opt-out outranks a high-confidence signal; an
admin-paused sender is silent and cannot undo it; opt-in mode gates an unenrolled department on
a workspace setting alone.

*Boundaries the agent must refuse* — self-recognition stops before a draft exists; source text
matching `policy_violation_examples.json` never reaches a draft; a human who edits a clean draft
into a violation is blocked at Submission with the violation named inline and the platform never
called.

*Data and identity edges* — recipient absent from HRIS; recipient present but not receivable,
traced as a distinct failure because those need different fixes; unverified identity routes to
login; a forced retryable platform error preserves the draft.

*Draft quality* — adding a value to `core_values.json` changes what the agent picks with no code
change; the same source message drafts tersely for one sender and warmly for another, with the
human's rewrite stored as five numbers and no text retained.

*Personalization* — cold start refuses to personalize under the minimum sample and says so;
consecutive dismissals walk the 2/5/24/72-hour ladder and a successful send resets it; a sender
pinned at the 72-hour ceiling gets exactly one labeled probe through, and dismissing it pauses
the agent for 30 days.

**Two tiers, on purpose.** Eighteen cases never reach a draft. They run offline, instantly, with
no API key, and give the same answer every time, so they can gate a change. Four of them judge
text the model wrote, which means they cannot be reproducible. Those four run five times each
and report a rate rather than a verdict. Case 4 above produces five drafts per run, so its
result rests on twenty-five judged drafts. Without a key they report *skipped*, in grey, not
*failed*, in red.

**On numbering.** The Design-phase eval plan in this PRD lists Eval 0 and Cases 1–10. The built
suite uses its own IDs because several design cases split into more than one test once they met
real code, and Develop surfaced eight the design never anticipated. The five above are case-1,
case-12, case-5, case-18 and case-17 in the console.

---

## Row 33 · Eval results — what passed and failed

**Q: What happened when you tested the agent? Where did it pass, fail, or need a human?**

**Eval 0 — PASS, with one deliberate miss.** 199 of 200 correct. Accuracy 99.5%, false-positive
rate 0.0%, recall 98.9%, false-negative rate 1.1%. Against the bar of ≥90% / ≤5% / >50%, all
three clear.

The miss is *"Mei that migration doc is chef's kiss"*, and it is left failing on purpose. It is
a pure idiom with no structural tell: no roster subject, no verb, no praise word a matcher can
reach. The honest fix is the model path, not another entry in a word list, so the case stays red
as a marker of a real classifier boundary. If it ever goes green because someone added "chef's
kiss" to the keyword list, the classifier got worse at the thing this case exists to measure.

One caveat stated in the file: ten strings are shared between the holdout and the training
corpus, kept in both places on purpose because they are guarded in both.

**Scenario cases — 18 deterministic, all passing. 4 sampled against live model output.**

*The eighteen deterministic cases:*

| Case | Expected | Actual | Verdict |
|---|---|---|---|
| Happy path | Fires, resolves recipient | Fires at 0.92, recipient Sam Okafor, card rendered | Pass |
| Cooldown suppression | No nudge, trace explains | No card, stop step present | Pass |
| Zero budget is silent | No nudge UI at all | No card, trace outcome `silent` | Pass |
| Opt-out outranks signal | Nothing, however strong | No card, stop step names the opt-out | Pass |
| Recipient not receivable | Silent, distinct from missing row | No card, silent, reason named separately | Pass |
| Identity unverified | Lands on login stage | Card opens at login, not draft | Pass |
| Session expiry mid-draft | Edits survive | Session flagged expired, edited text preserved | Pass |
| Platform error on submit | Error surfaced, draft preserved | `platform_error`, draft intact, retry offered | Pass (was Fail) |
| Self-recognition blocked | Chain stops | No card, outcome `silent` | Pass |
| Cooldown ladder | 2/5/24/72, send resets | Ladder walked in order, reset to baseline on send | Pass |
| Recipient not in HRIS | Validation stops | No card, stop names the HRIS miss | Pass |
| Policy violation in source | Never reaches a draft | No card, outcome `blocked` | Pass |
| Human edits into violation | Blocked, held, clears on fix | Nothing published, modal held open, block cleared on correction | Pass |
| Personalized bar | Same signal, two answers | Ava fired at bar 0.38 (84% accept over 45), Jordan silent at 0.90 (17% over 24) | Pass |
| Cold start | House default, says so | Bar 0.55, sample 0, trace reads *cold start* | Pass |
| Probe escapes ceiling | One probe, then self-pause | One probe through, second signal stopped, agent paused 30 days | Pass |
| Admin pause | Silent, sender cannot undo | No card, stop names the admin pause | Pass |
| Opt-in gating | Unenrolled department stopped | No card, stop names opt-in mode | Pass |

*The four sampled cases, five runs each, judged against real `claude-opus-5` output:*

| Case | Expected | Actual | Verdict |
|---|---|---|---|
| ⚠ Generated drafts obey the rulebook | 25/25 drafts clean, both controls rejected | ⚠ *pending live run* | ⚠ |
| ⚠ No core value the source supports | Blank field, Submit refused, clears on human pick | ⚠ *pending live run* | ⚠ |
| ⚠ Values are configuration, not code | Adding a value changes the pick, no code change | ⚠ *pending live run* | ⚠ |
| ⚠ Tone learned from edits | Terse for one sender, warm for another, stored as counts | ⚠ *pending live run* | ⚠ |

⚠ **Also pending:** the summary line, and the honest account of whichever of the four came back
short. Write it after the run, not before.

**The two that failed, and why they matter more than the ones that did not.** The platform-error
case and the tone-learning case both came back red on the first full run, with
`submissionError=missing_required`, never reaching the paths they were written to test. The
cause was shared, and it was in the tests rather than the agent: both accept a nudge and submit
immediately without ever choosing a core value. The client program sets `core_value_required:
true`, so the Submission agent correctly refused. On the tone case the refusal cascaded, because
submission never completed, so the Personalization agent never ran and the tone counts stayed at
zero. One symptom, one root cause, two red rows. Both cases now set a core value before
submitting and both pass, with the agent's behavior unchanged.

**Where the human is genuinely needed:** the core value. The agent leaves it blank whenever
nothing in `core_values.json` matches the source message, and Submit stays disabled until a
person fills it. That is the intended division of labor, and it is exactly what those two tests
walked into.

---

## Row 34 · Improvement made — what changed after testing

**Q: What did you change after testing, and why?**

**Before,** the Draft agent picked a core value from a keyword map written inline in the agent
code, with a fallthrough that returned "Teamwork" for anything the map missed, which in testing
turned out to be every message in the demo script: a claim about a colleague's work that no
evidence in the thread supported, arriving pre-selected and one click from a permanent award
record, with nothing on screen to show it was a guess. **The change** was to compile the signal
lists from `core_values.json` on every call and delete the fallthrough, so an unmatched message
returns blank with a stated basis in the trace and the Submission agent refuses to call the
platform on a missing required field. **After,** that immediately broke two eval cases that had
been submitting without ever picking a value, which was the fix working, and it produced three
new cases to prove the new behavior. All three passed on the first run, and that clean sweep was
the actual finding: they were passing against `generateDraftText()`, a template function whose
output cannot vary, so a test of generated prose had never once seen generated prose. So the
Draft agent was wired to `claude-opus-5` for real, with the model's core value treated as a
proposal that is checked against `core_values.json` and blanked when no signal supports it, and
those four cases now warm the model and sample it five times rather than asserting one
deterministic answer. ⚠ *One sentence on the sampled result goes here after the live run.*

---

## Row 35 · Known limitations — what it cannot do yet

**Q: What does the prototype not do yet? Be honest and specific.**

1. **The Listener is per-message and has no thread window.** Recognition that lands two turns
   after the work it refers to is invisible to it, and sarcasm that is lexically identical to
   praise reads as praise. Four multi-turn transcripts are held in the data as the reference set
   for exactly this gap. Adding a window is a design decision with a false-positive cost, not an
   oversight.

2. **The deterministic policy word list over-blocks.** It runs first and its blocks are final,
   which is what makes the safety argument work: a model that times out or returns nonsense
   cannot unblock text the list already caught. The cost of that ordering is false positives. The
   list matches on words including *hate*, *terrible* and *useless*, so "I hate that you had to
   stay late for this" is blocked as an insult, and no model verdict can lift it. A person is
   told their thank-you is offensive when it is not. Deliberate for a demo where a missed
   violation is the worse failure, and the wrong trade for production, where the fix is to narrow
   the list to unambiguous terms and let the model judge the rest under a human appeal path.

3. **Model output is real but never load-bearing.** The Listener, the Draft agent and the second
   policy pass all call `claude-opus-5`, and every one of them falls back silently to a
   deterministic path on a missing key, a network failure, a refusal or malformed JSON. That
   makes the prototype demonstrable without a key, and it means a reviewer cannot tell from the
   channel which path answered. Only the trace says. The draft-stage evals report *skipped*
   rather than *passed* without a key for the same reason.

4. **Every platform is mocked.** No real Slack Events API, no real Achievers API, no real OAuth.
   Authentication is a simulated background beat returning a thumbs-up or thumbs-down on seeded
   state. The identity-failure, session-expiry and platform-error paths are real control flow
   driven by fake responses. Recipient resolution reads the thread parent author against a flat
   8-row HRIS; name variants, display names and post-marriage changes are specified in the design
   and stubbed here, and a real directory would break it.

5. **The API key sits in the browser, and the scope is narrow.** The key lives in `localStorage`
   and every request carries `anthropic-dangerous-direct-browser-access: true`. Acceptable for a
   faculty demo over entirely synthetic data and acceptable nowhere else; a real deployment puts
   a server in between and the key never leaves it. Scope is Slack only, public channels only,
   English only, one recognition at a time. No Teams, no DMs, no private channels, no batching, no
   queue. Ephemeral persistence is Slack's behavior and not the agent's: the card survives until
   the sender acts or their client reloads, and the agent cannot extend, update or delete it, so
   there is no retry and no reminder by design.

---

## Row 36 · Prototype evidence — working demo summary

**Q: Describe what the working prototype shows. A reviewer should understand the demo loop from
this text.**

The screen is a Slack workspace for a fictional client, five months after install. Left,
channels. Middle, a transcript and a composer. Right, the **Agent Trace** panel, one numbered
card per agent turn, naming the files that agent read, what it decided, and what it produced.

As Priya I post *"Great job on the deck, Sam!"* The Listener classifies it at 0.92 and predicts
Sam. Auth + Validation checks enrollment, budget, HRIS receivability and self-recognition, and
returns a thumbs-up and only a thumbs-up to the Listener, releasing the full package solely to
the Draft agent. The Nudge agent compares 0.92 against Priya's own bar, computed from her accept
history, and posts an ephemeral card nobody else can see.

I click **Yes, recognize**. The modal opens immediately with the message field shimmering while
the Draft agent writes, then fills in with a recognition in Priya's voice. The core value is
blank, because the model proposed one and `core_values.json` had no signal for it in what Priya
actually wrote. The trace shows the proposal and the reason it was refused. The $25 award is
read-only and I cannot change it.

Then the refusal that matters. I rewrite the message into an insult. Submit disables, a banner
names the violation, and the trace shows the agent stopping before any publish step exists. The
Draft agent already vetted its own text; this is the agent re-checking what the human wrote,
because the human is allowed to rewrite it after every earlier gate has passed. I correct it,
pick a core value, and click Submit. **View in Achievers** shows it published, stamped *Sent from
Slack, never opened this platform*.

The quieter refusal argues the product. I post the same sentence as Jordan and as Ava. One
verdict, 0.72, two answers: Ava's bar has fallen to 0.38 and she gets the card, Jordan sits at
the 0.90 ceiling and gets silence. Post again as Jordan and the agent spends its one **probe**,
labeled as such, with *Not now* replaced by *No, pause these for 30 days*. Dismiss it and the
agent pauses itself for a month. It asked once, got its answer, and stopped.

Every stop is on screen even when the channel is silent: no budget, opted out, admin-paused, or
posted in a private channel. Each is a reasoned decision in the trace and nothing in the channel,
because telling someone *you cannot recognize this person* hands them a fact about a colleague's
employment record they were never entitled to.

Nothing in this demo sends without a human clicking Submit.
