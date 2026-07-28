/* =============================================================================
   tools/node-harness.js — load the browser prototype inside Node

   The prototype has no build step and no module system: index.html loads eight
   plain <script> files in order and they share one global scope. That is great
   for a file:// demo and useless for automated checking, because there is no
   export to require().

   This harness reproduces index.html's script order inside a vm context and
   hands the whole global scope back. Two shims are all that is needed:

     localStorage — data.js seeds and reads everything through it
     document     — only touched by ui.js, which we deliberately do not load

   Nothing in the prototype imports this file. It exists so `node tools/...`
   can exercise the same code the browser runs, without a headless browser.
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

/* index.html's script order, minus ui.js (DOM-bound, not needed for logic). */
const SCRIPTS = [
  "data.js",
  "prompts/_shared.js",
  "prompts/listener.js",
  "prompts/drafter.js",
  "prompts/policy-judge.js",
  "llm.js",
  "evals.js",
  "agents.js",
];

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => void map.set(String(k), String(v)),
    removeItem: (k) => void map.delete(String(k)),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i],
    get length() {
      return map.size;
    },
  };
}

/* A DOM stub that swallows everything. Only reached if a loaded file touches
   document at parse time; agents.js and data.js do not. */
function makeDocument() {
  const node = new Proxy(
    {},
    {
      get: (t, k) => (k in t ? t[k] : () => node),
      set: () => true,
    }
  );
  return {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => node,
    addEventListener: () => {},
    body: node,
  };
}

/* Top-level `const`/`let` in a script live in the context's global *lexical*
   scope, not on the global object — so ctx.DATA is undefined even though DATA
   exists. Later runInContext calls share that lexical scope, so one synthetic
   script at the end can copy the bindings somewhere reachable. */
const EXPORTS = [
  "DATA",
  "Store",
  "User",
  "Trace",
  "Agents",
  "Pipeline",
  "Evals",
  "LLM",
  "Prompts",
  "pickCoreValue",
  "composeDraft",
  "guidelineCheck",
  "registerFor",
  "toneModel",
  "valueMatchers",
  "classify",
  "classifyDeterministic",
  "MAX_DRAFT_CHARS",
  "EVAL_CASES",
  "runAllEvals",
  "runEval0",
];

function bridge() {
  const pairs = EXPORTS.map(
    (n) => '  if (typeof ' + n + ' !== "undefined") __api.' + n + " = " + n + ";"
  );
  return "globalThis.__api = {};\n" + pairs.join("\n") + "\n";
}

/* Default is hermetic: fetch rejects, no key, so the four draft-stage cases
   report "skipped — needs a key" and the run is deterministic and offline.

   load({ live: true }) opts into real model calls. The key comes from
   ANTHROPIC_API_KEY in the environment and is written into the localStorage
   shim, which is in-memory and dies with the process — it is never persisted
   and never written to a file. The browser path stores it in real
   localStorage; that is the same trade-off documented at the top of llm.js and
   it is a demo-only posture either way. */
function load(opts) {
  const live = !!(opts && opts.live);
  const storage = makeLocalStorage();
  if (live) {
    const key = process.env.ANTHROPIC_API_KEY || "";
    if (!key) throw new Error("live mode needs ANTHROPIC_API_KEY in the environment");
    storage.setItem("slackNudge.apiKey", key);
  }
  const sandbox = {
    localStorage: storage,
    document: makeDocument(),
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: live ? (...a) => fetch(...a) : () => Promise.reject(new Error("no network in harness")),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  for (const rel of SCRIPTS) {
    const file = path.join(ROOT, rel);
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: rel });
  }
  vm.runInContext(bridge(), ctx, { filename: "__bridge" });

  const api = ctx.__api;
  api.ctx = ctx;
  api.eval = (code) => vm.runInContext(code, ctx, { filename: "__eval" });
  return api;
}

module.exports = { load, SCRIPTS, ROOT };
