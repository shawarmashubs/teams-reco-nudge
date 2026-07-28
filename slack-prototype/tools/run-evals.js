/* Run the whole eval suite headlessly. `node tools/run-evals.js`
   Exits non-zero if any scenario case fails, so it can gate a commit.
   The browser console runs the same runAllEvals(); this just prints it.

   Offline by default: the four draft-stage cases report SKIP, everything else
   is deterministic. `--live` sets ANTHROPIC_API_KEY on the sandbox and runs
   those four against the model, five samples each. Live mode is slow, costs
   money, and is not reproducible, so it is not what gates a commit. */

const { load } = require("./node-harness");

const LIVE = process.argv.indexOf("--live") !== -1;
let api;
try {
  api = load({ live: LIVE });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

if (typeof api.runAllEvals !== "function") {
  console.error("runAllEvals not found. Exports seen:", Object.keys(api).join(", "));
  process.exit(2);
}

async function main() {
  /* CONTRACT.md §7: "A green suite after running it twice in a row is the
     correctness bar." Every case snapshots and restores what it touches, so a
     second pass in the same session must be identical. A case that leaks state
     shows up here and nowhere else.

     Skipped in live mode: the double pass would double the model calls, and
     the four sampled cases are not expected to be identical run to run — that
     is the point of sampling them. State leaks are still caught by the offline
     pass, which is where they would show up anyway. */
  if (process.argv.indexOf("--once") === -1 && !LIVE) {
    const first = await api.runAllEvals();
    const leaked = first.cases.filter((c) => !c.pass && !c.skipped).map((c) => c.id);
    console.log("warm-up pass: " + (first.cases.length - leaked.length) + "/" + first.cases.length + (leaked.length ? "  (" + leaked.join(", ") + ")" : ""));
  }

  const out = await api.runAllEvals(
    LIVE ? (id, i, n) => process.stderr.write("\r  " + id + " (" + (i + 1) + "/" + n + ")          ") : null
  );
  if (LIVE) process.stderr.write("\r" + " ".repeat(40) + "\r");

  const e0 = out.eval0;
  if (e0) {
    const n = e0.total != null ? e0.total : (e0.rows || []).length;
    console.log("eval-0 (listener): " + (e0.correct != null ? e0.correct + "/" + n : JSON.stringify(e0).slice(0, 200)));
    for (const r of e0.rows || []) {
      if (r.ok === false) console.log("  MISS  " + JSON.stringify(r.text) + " -> " + r.got + " (want " + r.want + ")");
    }
  }

  let failed = 0;
  let skipped = 0;
  for (const r of out.cases) {
    if (r.skipped) skipped++;
    else if (!r.pass) failed++;
    const tag = r.skipped ? "SKIP  " : r.pass ? "PASS  " : "FAIL  ";
    console.log(tag + r.id.padEnd(9) + r.title + (r.runs > 1 ? "  [" + r.runs + " runs]" : ""));
    /* Model-backed cases print their result even when green. A pass rate is
       the finding; hiding it behind PASS is how "22/22" ends up in a document
       with nothing behind it. */
    if (!r.pass || r.modelBacked) console.log("        " + r.actual);
    if (!r.pass && !r.skipped) console.log("        expected: " + r.expectation);
  }
  const ran = out.cases.length - skipped;
  console.log(
    "\n" + (ran - failed) + "/" + ran + " scenario cases passing" +
      (skipped ? "  ·  " + skipped + " skipped (no API key — run with --live)" : "")
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
