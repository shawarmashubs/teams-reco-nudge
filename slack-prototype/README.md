# Recognition Nudge — Slack prototype

An agent that watches public Slack channels for moments of recognition, decides
whether to interrupt the sender, and drafts an Achievers recognition for them to
approve. Nothing sends without a human click.

**Run it:** open `index.html` in a browser. No build, no server, no dependencies.

All data is synthetic. No real people, no Slack workspace, no Achievers API.

---

## What you're looking at

Post a message in a monitored channel and a chain of six agents runs:

```
read → decide → draft → human approves, edits, or dismisses
```

The **Agent Trace** panel on the right is the point of the prototype. Each card
is one agent's turn: the files it read, the decision it made, the output it
produced. Agents that stop the chain are shown too, because a nudge that never
appears is also a decision. Click any file chip to read the context file itself.

---

## Try these

| As | Post in `#product-launch` | You get |
|---|---|---|
| Priya | `Great job on the deck, Sam!` | A nudge. Core value is blank and Submit is locked: nothing in `core_values.json` matched, so the agent won't guess |
| Priya | `Thanks for jumping in on the release checklist, Sam` | Same nudge, core value pre-filled to Teamwork, with the matched words shown in the trace |
| Priya | Anything, right after submitting | Silence. Cooldown |
| Ava, then Jordan | `Thanks for the migration, Sam` | Same 0.72 classifier score, opposite outcomes. Ava's bar has fallen to 0.38 from accepting nudges; Jordan's sits at the 0.90 ceiling from dismissing them |
| Liam | Anything | Silence. Zero budget, visible only in the trace |
| Mei | Anything | Silence. Opted out |
| Diego | Anything | Silence. Admin-paused |

In an open draft, rewrite the message to something that breaks policy. Submit
disables as you type and the Submission agent refuses the call. Edit the text at
all and the trace records it, which is how the agent learns your voice.

The full 21-step walkthrough is in [DESIGN.md](DESIGN.md).

---

## Architecture

Six agents in a bounded loop. No orchestrator: each hands off to the next, and
any one of them can stop the chain.

| Agent | Stops on |
|---|---|
| Listener | No recognition signal, unmonitored channel |
| Auth + Validation | Policy violation, recipient not in HRIS or not receivable, self-recognition, zero budget |
| Nudge | Opted out, admin paused, self-paused, below this sender's bar, cooldown |
| Draft | Its own draft breaks a rule in the guidelines |
| Submission | Policy violation in the human's edited text, platform error |
| Personalization | — |

Nudge gates run in this order, and the order is the argument:

```
opted out → admin paused → self-paused → probe → below sender's bar → cooldown
```

Every Auth stop except a policy violation is silent to the sender. Telling
someone "you can't recognize this person" leaks a colleague's employment record,
so the reason lives in the trace and nowhere else.

Four behaviours are per-person and move on their own: the confidence bar, the
tone the draft is written in, the cooldown ladder's escape hatch, and opt-out.
[DESIGN.md](DESIGN.md) covers how each one is derived and why it's bounded.

---

## Files

Loaded in order by `index.html`, communicating through globals.

| File | Contains |
|---|---|
| `data.js` | Synthetic roster, HRIS, budgets, 15 context files, five months of seeded history |
| `prompts/` | One system prompt per agent that exercises judgment |
| `llm.js` | The only place this app calls a model |
| `evals.js` | Classifier, Eval 0 gate, 22 scenario cases |
| `agents.js` | Trace bus, six agents, pipeline |
| `ui.js` | Slack chrome, nudge, draft modal, Achievers view, trace panel |
| `styles.css` | Slack design tokens and layout |
| `tools/` | Node harness for running evals headlessly |
| `CONTRACT.md` | Frozen interface between the above |
| `DESIGN.md` | Why it behaves the way it does |

The demo opens five months after install, on a workspace with 164 prior nudges
across eight senders. The personalization has nothing to show on an empty one.

`localStorage` keys are prefixed `slackNudge.`. **Reset demo** in the channel
header clears and reseeds.

---

## Evals

```
node tools/run-evals.js          # eval 0 + 18 offline cases
node tools/run-evals.js --live   # adds 4 model-judged cases, needs ANTHROPIC_API_KEY
node tools/inspect-draft.js      # what Draft picks across sample threads
```

Eighteen cases run offline and are exactly reproducible; those gate a commit.
Four judge text a model wrote, so they run five times and report a rate. Without
a key they report SKIP, not FAIL. `runAllEvals()` in the browser console runs the
same suite.

## Running the Listener on a real model

The Listener uses a deterministic classifier by default. To use `claude-opus-5`:

```js
LLM.setKey("sk-ant-...")   // LLM.clearKey() to revert
```

The trace then names which path produced the verdict. Any failure falls back to
the classifier, so the model path is never load-bearing.

The key sits in `localStorage` and requests carry
`anthropic-dangerous-direct-browser-access`. Fine for a demo over synthetic data,
wrong everywhere else.
