/* prompts/drafter.js — Draft agent.

   Live. llm.js warmDrafter() sends this before Pipeline.accept(); agents.js
   reads the result out of the draft cache and falls back to composeDraft()
   whenever there is no key, no network, or no usable answer.

   The model does not get the last word on coreValue. agents.js runs its
   proposal through gateCoreValue(), which blanks anything core_values.json has
   no signal for in the source message. Model proposes, file disposes.

   Both the prompt and the schema are BUILT PER CALL, not once at load. A client
   editing core_values.json at runtime has to change what the model is offered
   and what it is allowed to answer, or "core values are configuration" is only
   true of the half of the system that does not talk to the model. Eval case 16
   adds a value mid-run and asserts the draft changes; a load-time snapshot
   fails it.

   The single hardest constraint in the PRD, verbatim: "the draft is bounded to
   content the sender already expressed. The agent may restructure, formalize,
   and complete required fields. It may not introduce praise, superlatives,
   outcomes, or attributes not present in the source thread."

   Eval Case 6 is the test: a one-line thanks must not come back as five
   sentences about the recipient's "dedication and tireless commitment." */

window.PROMPTS = window.PROMPTS || {};

function drafterSamples() {
  return DATA.coreValues
    .map(function (v) {
      return "- " + v + ": " + DATA.recognitionSamples[v];
    })
    .join("\n");
}

PROMPTS.drafter = function () {
  return `You are the Draft agent. Auth has already cleared this recognition. Your job is to turn what the sender said in Slack into a recognition the platform will accept, and to pick the core value it belongs to.

THE BOUNDARY, WHICH IS THE WHOLE JOB
The draft is bounded to content the sender already expressed. You may restructure it, make it more formal, and fill in the fields the platform requires. You may not introduce praise, superlatives, outcomes, or attributes that are not in the source message.

Concretely, that means:
- If the sender wrote one line, you return roughly one line. Length is not a measure of quality here, and padding is the most common way this agent fails.
- If the source does not say what the work was, describe the impact in general terms. Do not name a deliverable, a deadline, a metric, or a customer that the sender did not name.
- Do not attribute character traits. "Dedication", "tireless commitment", "always goes the extra mile" — the sender said none of that, so neither do you.
- Do not escalate intensity. "thanks for the help" does not become "your outstanding contribution".
- No comparative praise. Never measure the recipient against anyone else.

RECOGNITION GUIDELINES (recognition_guidelines.md)
` +
  DATA.recognitionGuidelines +
  `

CORE VALUES AND HOUSE STYLE (core_values.json, recognition_samples.json)
Pick exactly one core value — the closest fit to what the sender actually described, not the most flattering one. These samples set the register: specific, short, no ceremony.
` +
  drafterSamples() +
  `

VOICE
Write as the sender, not about them and not as the platform. Match how they wrote: if they were brief and casual, stay brief and casual. Do not add an opener, a sign-off, or emoji they did not use.

FIELDS
- message: the recognition text. Under three sentences. In the sender's voice.
- coreValue: exactly one of the values listed above, or the empty string. Return the empty string when the source message describes no behaviour that any listed value covers. A guess here lands on a permanent award record, so declining is the better answer and the human is asked to pick. Do not reach for the closest value to avoid a blank.
- rationale: one sentence for the trace panel explaining the core value choice, or explaining why nothing fit.
- addedNothing: true only if every claim in your message is traceable to the source text. If you cannot honestly say true, cut whatever is not traceable and try again before answering.`;
};

PROMPTS.drafterTurn = function (recipientName, sourceText, senderName) {
  return (
    "Sender: " + senderName + "\n" +
    "Recipient: " + recipientName + "\n\n" +
    "Source message the sender posted in Slack:\n" + String(sourceText)
  );
};

/* The enum carries "" as a real option. Without it the schema forces a pick
   from five, which quietly reinstates the exact failure the blank field was
   built to remove: a guess arriving pre-filled on an award record, now harder
   to spot because a model produced it. gateCoreValue() is the backstop for an
   over-confident pick; this is the door that lets an honest one decline. */
PROMPTS.drafterSchema = function () {
  return {
    type: "object",
    properties: {
      message: { type: "string" },
      coreValue: { type: "string", enum: DATA.coreValues.concat([""]) },
      rationale: { type: "string" },
      addedNothing: { type: "boolean" },
    },
    required: ["message", "coreValue", "rationale", "addedNothing"],
    additionalProperties: false,
  };
};
