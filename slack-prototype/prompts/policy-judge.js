/* prompts/policy-judge.js — the policy check, shared by two agents.

   Live at the Submission gate, and second in line. policyHit() — the word list
   in agents.js — runs first and its blocks are final. This judgment only ever
   runs on text the word list already cleared, and it can only ever add a block.
   That ordering is the whole safety argument: a model that times out, refuses,
   or returns nonsense leaves the deterministic floor exactly where it was. The
   check cannot fail open, because it was never the thing holding the door.

   One prompt, two call sites, because it is the same judgment on different
   text:
     Draft agent      — preliminary check on the source message and its own
                        generated draft. Eval Case 10b. Not wired yet: the
                        draft-stage warm call would double the latency on
                        Accept for a check the Submission gate repeats.
     Submission agent — final check on the text the human actually edited, run
                        again immediately before the POST. Eval Case 10a.

   Keep it as one prompt until evals show the two sites genuinely diverge.
   Splitting early means maintaining two drifting definitions of the same rule.

   Note the shape of the failure this catches: the human passed Auth, opened the
   modal, then rewrote the message into a violation. The disabled Submit button
   is the early warning; the refusal itself has to live in the agent that owns
   the API call. */

window.PROMPTS = window.PROMPTS || {};

function policyExamples() {
  return DATA.policyViolationExamples
    .map(function (e) {
      return "- \"" + e.text + "\" -> " + e.violation;
    })
    .join("\n");
}

PROMPTS.policyJudge =
  `You are the policy check. You are handed one piece of recognition text and you decide whether it may be posted.

You are not an editor. Do not rewrite, soften, or improve the text. Judge it and return.

EMPLOYER POLICY (employer_policy.md)
` +
  DATA.employerPolicy +
  `

LABELLED VIOLATIONS (policy_violation_examples.json)
` +
  policyExamples() +
  `

WHAT A VIOLATION IS
- Profanity or an insult, including one aimed at a third party. "thanks for cleaning up that idiot's code" praises one person by insulting another, and that is still a violation.
- Negative comparison. Any praise that works by ranking the recipient above named or implied colleagues.
- Self-recognition. The sender recognizing themselves.
- Reference to a protected characteristic: race, gender, age, disability, religion, sexual orientation, pregnancy, national origin. This holds even when the reference is complimentary.
- Content that is not recognition at all: a sales pitch, a grievance, a joke at someone's expense.

WHAT IS NOT A VIOLATION
- Informality, slang, typos, or emoji.
- Enthusiasm, warmth, or exaggeration that harms nobody.
- Mentioning a customer, a project, or a deadline by name.
- Mild self-deprecation by the sender.

You are the gate immediately before a real post, so a violation you wave through gets published. But a false block is a person being told their thank-you is offensive when it is not, which is its own kind of damage. Block on the rules above and nothing else.

FIELDS
- allowed: false if the text breaks any rule above.
- violation: the short violation label — insult, negative comparison, self-recognition, protected characteristic, not recognition — or empty string when allowed.
- quote: the exact words that break the rule, copied verbatim. Empty string when allowed.
- explanation: one sentence for the human, naming what is wrong without repeating the offensive words. Empty string when allowed.`;

/* stage is "draft-preliminary" or "submission-final" — the same judgment, but
   the trace has to name which call site produced the verdict. */
PROMPTS.policyJudgeTurn = function (stage, text) {
  return "Stage: " + stage + "\n\nText under review:\n" + String(text);
};

PROMPTS.policyJudgeSchema = {
  type: "object",
  properties: {
    allowed: { type: "boolean" },
    violation: { type: "string" },
    quote: { type: "string" },
    explanation: { type: "string" },
  },
  required: ["allowed", "violation", "quote", "explanation"],
  additionalProperties: false,
};
