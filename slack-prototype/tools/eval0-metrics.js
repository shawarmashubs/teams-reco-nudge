/* Print eval 0's exact metrics. `node tools/eval0-metrics.js`
   run-evals.js prints correct/total only; the PRD quotes four figures and a
   pass bar, and a figure nobody can regenerate is a figure nobody can check. */

const { load } = require("./node-harness");
const e = load().runEval0();

const pct = (n) => (n * 100).toFixed(1) + "%";
console.log("total              " + e.total);
console.log("correct            " + e.correct);
console.log("accuracy           " + pct(e.accuracy) + "   bar >= 90%");
console.log("false positive     " + pct(e.falsePositiveRate) + "   bar <= 5%");
console.log("false negative     " + pct(e.falseNegativeRate));
console.log("recall             " + pct(e.recall) + "   bar > 50%");
console.log("pass               " + e.pass);
(e.misclassified || []).forEach((m) =>
  console.log("MISS  " + JSON.stringify(m.text) + "  expected " + m.expected + ", got " + m.got)
);
