/* Offline check on the prompts. `node tools/check-prompts.js`

   Case 16 asserts that editing core_values.json changes what the Draft agent
   picks. Half of that claim lives somewhere no eval can see it without a key:
   the prompt text and the response schema the model is handed. If either one
   snapshots DATA.coreValues at load time, a client adding a value gets a model
   that has never heard of it — and case 16 would then fail live for a reason
   that has nothing to do with the agent.

   Cheap enough to run every time, needs no key, and it fails loudly. */

const { load } = require("./node-harness");
const api = load();

let failed = 0;
function check(label, ok, detail) {
  console.log((ok ? "ok    " : "FAIL  ") + label + (detail ? "  — " + detail : ""));
  if (!ok) failed++;
}

const shippedEnum = api.eval("PROMPTS.drafterSchema()").properties.coreValue.enum;
const shippedPrompt = api.eval("PROMPTS.drafter()");

check(
  "schema enum matches the shipped catalog",
  shippedEnum.length === api.DATA.coreValues.length + 1,
  shippedEnum.join(", ")
);
check(
  'enum carries "" so the model can decline',
  shippedEnum.indexOf("") !== -1,
  'without it the schema forces a guess onto a permanent award record'
);
check("prompt has no Stewardship before the edit", shippedPrompt.indexOf("Stewardship") === -1);

api.eval("case16Add()");
const editedEnum = api.eval("PROMPTS.drafterSchema()").properties.coreValue.enum;
const editedPrompt = api.eval("PROMPTS.drafter()");
const keyEdited = api.eval('LLM.draftKey("same text","u1","u2")');
api.eval("case16Remove()");
const keyShipped = api.eval('LLM.draftKey("same text","u1","u2")');

check("editing the catalog reaches the schema", editedEnum.indexOf("Stewardship") !== -1);
check("editing the catalog reaches the prompt", editedPrompt.indexOf("Stewardship") !== -1);
check(
  "the draft cache keys on the catalog",
  keyEdited !== keyShipped,
  "same text and sender, different catalog, so the second call must not be served the first answer"
);
check(
  "the catalog is restored",
  api.DATA.coreValues.indexOf("Stewardship") === -1,
  api.DATA.coreValues.join(", ")
);
check("the policy judge prompt still builds", typeof api.eval("PROMPTS.policyJudge") === "string");

/* Row 35 of the Develop PRD states a specific false positive as a known
   limitation. A limitation nobody can reproduce is a limitation nobody has to
   believe, and one that quietly stops being true makes the PRD wrong. Both
   directions matter, so both are checked. */
const hit = (t) => !!api.eval("policyHit(" + JSON.stringify(t) + ")");

check(
  "the word list blocks a real violation",
  hit("Thanks for cleaning up that idiot's code"),
  "the deterministic floor has to actually be a floor"
);
check(
  "PRD Row 35 limitation 2 is still true",
  hit("I hate that you had to stay late for this, but thank you"),
  "innocent text containing a listed word is blocked and no model verdict can lift it"
);
check(
  "ordinary praise is not blocked",
  !hit("Thanks for jumping in on the release checklist, Sam"),
  "if this ever fails the list has been widened past usefulness"
);

process.exit(failed ? 1 : 0);
