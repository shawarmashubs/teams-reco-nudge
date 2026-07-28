const { load } = require("./node-harness");
const api = load();

const STRINGS = [
  "Thanks for the deck, Sam. That is exactly what Teamwork looks like here.",
  "Sam, your dedication and tireless commitment on the deck were amazing.",
  "Sam is always the best on the team, single-handedly amazing.",
  "Thanks for the $50 bonus-worthy work, Sam.",
];

for (const r of api.DATA.recognitionRulebook.avoid) {
  console.log(r.id.padEnd(18), r.pattern);
}
console.log("");

for (const s of STRINGS) {
  const g = api.guidelineCheck(s);
  console.log(JSON.stringify(s));
  console.log("  ", JSON.stringify(g, null, 0).slice(0, 400));
  console.log("");
}
