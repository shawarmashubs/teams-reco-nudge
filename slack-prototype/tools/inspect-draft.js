/* Ad-hoc inspector: run the Draft agent's own functions over sample threads
   and print what the trace panel would show. `node tools/inspect-draft.js` */

const { load } = require("./node-harness");
const ctx = load();

const CASES = [
  ["u1", "u2", "Great job on the deck, Sam!"],
  ["u2", "u3", "Great job on the deck, Jordan!"],
  ["u1", "u3", "Great job on the deck, Jordan!"],
  ["u1", "u2", "Kudos to Sam for the migration"],
  ["u1", "u2", "Huge thanks to Sam for rebuilding the pricing model overnight."],
  ["u1", "u2", "thanks for jumping in on the release checklist"],
  ["u1", "u4", "thanks for unblocking the customer escalation"],
  ["u2", "u1", "thanks for automating the report"],
];

console.log("house_style:", JSON.stringify(ctx.DATA.houseStyle()));
console.log("rulebook avoid rules:", ctx.DATA.recognitionRulebook.avoid.length);

for (const [s, r, text] of CASES) {
  const pick = ctx.pickCoreValue(text);
  const register = ctx.registerFor(s, r);
  const tone = ctx.toneModel(s);
  const c = ctx.composeDraft(ctx.User.get(r).name, text, pick.value, tone, register);
  const g = ctx.guidelineCheck(c.text);
  console.log("\n" + s + " -> " + r + "  " + JSON.stringify(text));
  console.log("  value:  ", pick.value, "|", pick.scores.map((x) => x.value + ":" + x.score).join("  "));
  console.log("  reg:    ", register, "| shape:", c.shape, "| object:", JSON.stringify(c.workObject));
  console.log("  frame:  ", c.frameSource, "| impact:", c.impactSource);
  console.log("  draft:  ", c.text);
  console.log(
    "  check:   ok=" + g.ok,
    "words=" + g.words,
    "sentences=" + g.sentences,
    "chars=" + g.chars,
    "onTarget=" + g.onTarget,
    "rules=" + g.rulesRun,
    g.failures.length ? "FAIL " + JSON.stringify(g.failures) : ""
  );
}
