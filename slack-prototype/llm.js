/* llm.js — the one place this prototype talks to a model.

   Raw fetch, not the official @anthropic-ai/sdk, for one reason: the prototype
   opens from file:// with no build step and no server (README line 3), so there
   is no module loader to import an npm package with. Everything here is a plain
   <script> global like the rest of the codebase.

   THE API KEY LIVES IN THE BROWSER. It goes in localStorage and every request
   carries anthropic-dangerous-direct-browser-access: true. That is fine for a
   faculty demo over entirely synthetic data (README line 5) and is not fine for
   anything else. A real deployment puts a server between the browser and the
   API and the key never leaves it.

   Set a key from the console:  LLM.setKey("sk-ant-...")
   Clear it:                    LLM.clearKey()
   With no key set, every call is a no-op and the loop runs on the deterministic
   classifier. Nothing breaks; the trace just says which path decided.

   Why "warm" calls rather than calls inside the agents: evals.js drives the
   Pipeline synchronously and ~11 scenario cases read the result straight after
   the call. Making an agent async would ripple through all of them. So the
   caller awaits the model before it starts the pipeline, the answer lands in a
   cache, and the agent reads the cache first and falls back to its
   deterministic path. The agents stay synchronous.

   Three warm calls, three caches, one rule each:

     warmListener  — the verdict replaces the regex classifier outright.
     warmDrafter   — the draft replaces composeDraft()'s text. The core value it
                     proposes does NOT replace pickCoreValue(); agents.js gates
                     the proposal against core_values.json and blanks it when no
                     signal supports the claim. Model proposes, file disposes.
     warmPolicy    — an ADDITIONAL check, never a replacement. policyHit() runs
                     first and its blocks are final, so this path can only ever
                     add a block. A model that fails open cannot unblock text
                     the word list already caught.

   Eval runs used to be uniformly deterministic. They are not any more: the four
   draft-stage cases warm the model first and are sampled over five runs, because
   a test of generated prose that never sees generated prose is not a test of it.
   The other eighteen never reach a draft and stay keyless and instant. */

const LLM = (function () {
  const STORAGE_KEY = "slackNudge.apiKey";
  const ENDPOINT = "https://api.anthropic.com/v1/messages";
  const MODEL = "claude-opus-5";

  /* Opus 5 counts thinking and response text against the same max_tokens, so a
     classification that needs 60 tokens of output still needs real headroom or
     it truncates mid-JSON. */
  const MAX_TOKENS = 2048;

  /* Verdicts keyed by normalized message text. Working memory only — same tier
     as the message text itself, cleared on demand, never written to storage.
     Same tier, same rules, for drafts and policy verdicts. */
  const verdicts = new Map();
  const drafts = new Map();
  const policies = new Map();

  let lastError = null;
  let draftHits = 0;
  let draftMisses = 0;

  function normalize(text) {
    return String(text == null ? "" : text).trim().toLowerCase();
  }

  /* The catalog is part of the prompt, so it is part of the input. A client
     that edits core_values.json and re-runs the same message must not be
     served the draft written against the old file. Eval case 16 does exactly
     that — same sentence, same sender, catalog changed between the two calls —
     and a key without this segment hands it the first answer twice. */
  function catalogStamp() {
    try {
      return (DATA.coreValues || []).join(",");
    } catch (e) {
      return "";
    }
  }

  function draftKey(sourceText, senderId, recipientId) {
    return (
      normalize(sourceText) + "|" + (senderId || "") + "|" + (recipientId || "") + "|" + catalogStamp()
    );
  }

  function getKey() {
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  /* One model call. Returns the parsed object, or null on anything at all going
     wrong — no key, network failure, refusal, malformed JSON. Callers treat
     null as "use the deterministic path", so failure is never fatal. */
  async function call(system, userText, schema) {
    const key = getKey();
    if (!key) return null;

    const body = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        { type: "text", text: PROMPTS.shared },
        /* cache_control goes on the last stable system block. The minimum
           cacheable prefix on Opus 5 is 512 tokens, so short prompts will not
           actually cache — harmless, and it means longer prompts do. */
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userText }],
      /* output_config.format, not the deprecated top-level output_format. The
         old prefill-the-assistant-turn-with-{" trick returns 400 on Opus 5. */
      output_config: { format: { type: "json_schema", schema: schema } },
    };

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastError = "network: " + e.message;
      return null;
    }

    if (!res.ok) {
      lastError = "http " + res.status + ": " + (await res.text()).slice(0, 300);
      return null;
    }

    const data = await res.json();

    /* Check refusal before touching content. When a classifier declines, the
       content array is not the shape you expect and content[0] throws. */
    if (data.stop_reason === "refusal") {
      lastError = "model refused the request";
      return null;
    }

    /* content is an array of typed blocks and thinking blocks come first, so
       narrow on type rather than reaching for content[0]. */
    const block = (data.content || []).filter(function (b) {
      return b.type === "text";
    })[0];
    if (!block) {
      lastError = "no text block in response (stop_reason: " + data.stop_reason + ")";
      return null;
    }

    try {
      lastError = null;
      return JSON.parse(block.text);
    } catch (e) {
      lastError = "unparseable JSON: " + block.text.slice(0, 200);
      return null;
    }
  }

  return {
    enabled: function () {
      return !!getKey();
    },

    setKey: function (k) {
      localStorage.setItem(STORAGE_KEY, String(k || "").trim());
      console.log("[LLM] key set — the Listener will call " + MODEL + " on the next message.");
    },

    clearKey: function () {
      localStorage.removeItem(STORAGE_KEY);
      verdicts.clear();
      drafts.clear();
      policies.clear();
      console.log("[LLM] key cleared — back to the deterministic classifier and composeDraft().");
    },

    lastError: function () {
      return lastError;
    },

    /* Called by ui.js before the pipeline starts, so the async work happens
       outside the synchronous agent chain. */
    warmListener: async function (text, channelName) {
      if (!getKey()) return null;
      const verdict = await call(
        PROMPTS.listener,
        PROMPTS.listenerTurn(text, channelName || "unknown"),
        PROMPTS.listenerSchema
      );
      if (!verdict) {
        console.warn("[LLM] listener call failed, falling back to the classifier —", lastError);
        return null;
      }
      /* Shape-match the deterministic classifier exactly. The trace renders
         these four fields and must not know which path produced them. */
      const shaped = {
        fire: !!verdict.fire,
        confidence: Number(verdict.confidence),
        reason: String(verdict.reason || ""),
        matched: String(verdict.matched || ""),
        source: MODEL,
      };
      verdicts.set(normalize(text), shaped);
      return shaped;
    },

    /* Read by classify() in evals.js. Returns null when there is nothing
       cached, which is every eval run and every message sent without a key. */
    cachedVerdict: function (text) {
      return verdicts.get(normalize(text)) || null;
    },

    /* Keyed on sender and recipient as well as source text, not source text
       alone. Case 13 posts one identical sentence as two senders and asserts
       the drafts differ; a text-only key would hand the second sender the
       first one's draft and the case would pass for the wrong reason. */
    draftKey: draftKey,

    /* Called before Pipeline.accept(). The draft lands in the cache and the
       synchronous Draft agent reads it there. */
    warmDrafter: async function (sourceText, recipientName, senderName, senderId, recipientId) {
      if (!getKey()) return null;
      /* Built per call, not read as a constant: both close over DATA.coreValues
         and the client can edit it between two sends. */
      const out = await call(
        PROMPTS.drafter(),
        PROMPTS.drafterTurn(recipientName, sourceText, senderName),
        PROMPTS.drafterSchema()
      );
      if (!out || typeof out.message !== "string" || !out.message.trim()) {
        console.warn("[LLM] drafter call failed, falling back to composeDraft() —", lastError);
        return null;
      }
      const shaped = {
        message: out.message.trim(),
        /* A proposal, not a decision. agents.js checks it against
           core_values.json before it reaches the field. */
        proposedValue: String(out.coreValue || ""),
        rationale: String(out.rationale || ""),
        addedNothing: !!out.addedNothing,
        source: MODEL,
      };
      drafts.set(draftKey(sourceText, senderId, recipientId), shaped);
      return shaped;
    },

    cachedDraft: function (sourceText, senderId, recipientId) {
      const hit = drafts.get(draftKey(sourceText, senderId, recipientId)) || null;
      if (hit) draftHits++;
      else draftMisses++;
      return hit;
    },

    /* Read by the eval runner. A sampled case that warms the model and then
       records zero cache hits has quietly tested composeDraft() instead — the
       key is built from sender and recipient, so one wrong id turns a real
       test into a green one that proves nothing. Counting the hits is how that
       surfaces as an error rather than as a pass. */
    stats: function () {
      return { draftHits: draftHits, draftMisses: draftMisses };
    },

    resetStats: function () {
      draftHits = 0;
      draftMisses = 0;
    },

    /* The second policy pass. policyHit() has already cleared this text — that
       is the only reason we are here — so a null return leaves it cleared and
       the deterministic floor still stands. */
    warmPolicy: async function (text, stage) {
      if (!getKey()) return null;
      const out = await call(
        PROMPTS.policyJudge,
        PROMPTS.policyJudgeTurn(stage || "submission-final", text),
        PROMPTS.policyJudgeSchema
      );
      if (!out || typeof out.allowed !== "boolean") {
        console.warn("[LLM] policy judge call failed, the word list stands alone —", lastError);
        return null;
      }
      const shaped = {
        allowed: out.allowed,
        violation: String(out.violation || ""),
        quote: String(out.quote || ""),
        explanation: String(out.explanation || ""),
        source: MODEL,
      };
      policies.set(normalize(text), shaped);
      return shaped;
    },

    cachedPolicy: function (text) {
      return policies.get(normalize(text)) || null;
    },

    /* Tier 1 memory is cleared when a nudge resolves. Same rule applies here. */
    forget: function (text) {
      const n = normalize(text);
      verdicts.delete(n);
      policies.delete(n);
      /* Draft keys carry sender and recipient, so drop every key whose source
         text half matches rather than trying to reconstruct the full key. */
      Array.from(drafts.keys()).forEach(function (k) {
        if (k.indexOf(n + "|") === 0) drafts.delete(k);
      });
    },

    clearCache: function () {
      verdicts.clear();
      drafts.clear();
      policies.clear();
    },
  };
})();

if (!LLM.enabled()) {
  console.log(
    "[LLM] No API key. The Listener is running on the deterministic classifier, the Draft " +
      "agent on composeDraft(), and the policy check on the word list alone. The four " +
      'draft-stage eval cases will report "skipped — needs a key" rather than failing. ' +
      'To use claude-opus-5 instead: LLM.setKey("sk-ant-...")'
  );
}
