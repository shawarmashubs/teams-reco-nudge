/* ui.js — rendering + event wiring. Consumes Store/User/DATA (data.js),
   Pipeline (agents.js), Trace (agents.js), runAllEvals (evals.js).
   Every one of those is guarded: the shell still runs if a file fails to load.
   Wrapped so generic helper names can't collide with the other scripts. */

(function () {
"use strict";

/* The textarea's maxlength and the Draft agent's Check step have to be the same
   number, or the UI silently truncates text the agent then measures as passing.
   Both read `hard_char_ceiling`; agents.js exposes it as MAX_DRAFT_CHARS. The
   fallback only matters if data.js failed to load, in which case nothing here
   renders anyway. */
const MSG_LIMIT = (typeof DATA !== "undefined" && DATA.recognitionRulebook && DATA.recognitionRulebook.hard_char_ceiling) || 300;

/* Slack groups consecutive messages from the same person inside a short window:
   no repeated avatar or name, and the timestamp only appears on hover. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/* Presence is cosmetic, so it is fixed rather than random — a dot that flickered
   on every re-render would be the most distracting thing on screen. */
const PRESENCE = {
  u1: "active", u2: "active", u3: "away", u4: "active",
  u5: "away", u6: "active", u7: "active", u8: "away",
};

/* Who appears under Direct messages. Display only. */
const DM_LIST = ["u2", "u3", "u4", "u8"];

const refs = {
  railUser: document.getElementById("railUser"),
  sidebar: document.getElementById("sidebar"),
  chanHeader: document.getElementById("chanHeader"),
  messages: document.getElementById("messages"),
  input: document.getElementById("composerInput"),
  sendBtn: document.getElementById("sendBtn"),
  traceBody: document.getElementById("traceBody"),
  modalRoot: document.getElementById("modalRoot"),
  searchLabel: document.getElementById("searchLabel"),
};

/* ------------------------------------------------------------- utilities */

const SVG_NS = "http://www.w3.org/2000/svg";

/* Pulls a symbol out of the sprite in index.html. Slack's chrome is icons
   almost all the way down; text glyphs are the fastest way to look fake. */
function icon(name, cls) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "sk-icon" + (cls ? " " + cls : ""));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "#i-" + name);
  svg.appendChild(use);
  return svg;
}

function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    Object.keys(props).forEach((k) => {
      const v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") node.textContent = String(v);
      else if (k === "className") node.className = v;
      else if (k === "style") Object.assign(node.style, v);
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, String(v));
    });
  }
  const kids = Array.isArray(children) ? children : children === undefined || children === null ? [] : [children];
  kids.forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    node.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  });
  return node;
}

function empty(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function pct(n) {
  return Math.round((Number(n) || 0) * 100) + "%";
}

function stringify(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function callPipeline(name) {
  if (typeof Pipeline === "undefined" || typeof Pipeline[name] !== "function") return false;
  Pipeline[name].apply(Pipeline, Array.prototype.slice.call(arguments, 1));
  return true;
}

function getMsg(channelId, id) {
  return Store.messages(channelId).find((m) => m.id === id) || null;
}

function avatarNode(user, extra) {
  const u = user || { name: "Unknown", color: "#616061" };
  return el("span", {
    className: "sk-msg-avatar" + (extra ? " " + extra : ""),
    style: { background: u.color || "#616061" },
    "aria-hidden": "true",
    text: User.initials(u),
  });
}

function presenceDot(userId) {
  return el("span", {
    className: "sk-presence" + (PRESENCE[userId] === "active" ? " is-active" : ""),
    "aria-hidden": "true",
  });
}

const DAY_MS = 86400000;

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* "Today" / "Yesterday" / "Friday, July 25th" — Slack's date-divider wording. */
function fmtDay(ts) {
  const day = startOfDay(ts);
  const today = startOfDay(Date.now());
  if (day === today) return "Today";
  if (day === today - DAY_MS) return "Yesterday";
  const d = new Date(ts);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
  const month = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"][d.getMonth()];
  const n = d.getDate();
  const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return weekday + ", " + month + " " + n + suffix;
}

/* Bare hour:minute for the hover timestamp in a grouped message's gutter. */
function fmtShortTime(ts) {
  const d = new Date(ts);
  const h = d.getHours() % 12 || 12;
  return h + ":" + String(d.getMinutes()).padStart(2, "0");
}

/* The newest unresolved ephemeral card in the active channel, if any. */
function liveCard() {
  const channelId = Store.activeChannelId();
  const list = Store.messages(channelId);
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m.ephemeral && m.card && m.card.stage !== "resolved") return { channelId: channelId, message: m };
  }
  return null;
}

/* ----------------------------------------------------------------- modals */

const modals = [];

function pushModal(m) {
  m.returnFocus = document.activeElement;
  refs.modalRoot.appendChild(m.node);
  modals.push(m);
  const first = m.node.querySelector("select, textarea, input, button");
  if (first) first.focus();
  syncClickAway();
}

function closeModal(m) {
  const i = modals.indexOf(m);
  if (i === -1) return;
  modals.splice(i, 1);
  if (m.timer) clearInterval(m.timer);
  if (m.node.parentNode) m.node.parentNode.removeChild(m.node);
  if (m.returnFocus && document.contains(m.returnFocus)) m.returnFocus.focus();
  syncClickAway();
}

function closeAllModals() {
  modals.slice().forEach(closeModal);
}

function findModal(type) {
  return modals.find((m) => m.type === type) || null;
}

/* Shared scrim + frame. onClose fires for scrim click and the ✕ button. */
function modalFrame(opts) {
  const body = el("div", { className: "sk-modal-body" });
  const foot = el("div", { className: "sk-modal-foot" });
  const box = el(
    "div",
    { className: opts.modalClass || "sk-modal", role: "dialog", "aria-modal": "true", "aria-label": opts.title },
    [
      el("div", { className: "sk-modal-head" }, [
        el("div", { className: "sk-modal-title", text: opts.title }),
        el("button", {
          className: "sk-modal-x",
          type: "button",
          "aria-label": "Close dialog",
          onClick: opts.onClose,
        }, icon("x")),
      ]),
      body,
      foot,
    ],
  );
  const scrim = el("div", {
    className: "sk-modal-scrim",
    onClick: (ev) => {
      if (ev.target === scrim) opts.onClose();
    },
  }, box);
  return { scrim: scrim, box: box, body: body, foot: foot };
}

function trapTab(ev, root) {
  const items = Array.prototype.filter.call(
    root.querySelectorAll("button, select, textarea, input, a[href]"),
    (n) => !n.disabled && n.offsetParent !== null,
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
}

/* -------------------------------------------------------------- rail */

function renderRail() {
  const me = User.current();
  empty(refs.railUser);
  refs.railUser.appendChild(
    el(
      "button",
      {
        className: "sk-rail-avatar",
        type: "button",
        "aria-label": "Switch user — currently " + me.name,
        title: "Switch user — currently " + me.name,
        onClick: openUserModal,
      },
      [avatarNode(me), presenceDot(me.id)],
    ),
  );
}

function userHint(u) {
  const bits = [u.title];
  bits.push(u.verified ? "verified" : "unverified — login path");
  bits.push(u.budget === 0 ? "$0 budget — silent path" : "$" + u.budget + " budget");
  return bits.join(" · ");
}

function openUserModal() {
  if (findModal("user")) return;
  const m = { type: "user" };
  const f = modalFrame({ title: "Switch user", onClose: () => closeModal(m) });
  const meId = Store.currentUserId();
  f.body.appendChild(
    el("div", { className: "sk-field-hint", text: "Posting as this user drives which path the pipeline takes." }),
  );
  const list = el("div", { className: "sk-userlist" });
  User.all().forEach((u) => {
    list.appendChild(
      el(
        "button",
        {
          className: "sk-userrow" + (u.id === meId ? " is-active" : ""),
          type: "button",
          onClick: () => {
            Store.setCurrentUserId(u.id);
            closeModal(m);
          },
        },
        [
          avatarNode(u),
          el("span", { className: "sk-userrow-main" }, [
            el("span", { className: "sk-userrow-name", text: u.name }),
            el("span", { className: "sk-userrow-hint", text: userHint(u) }),
          ]),
          u.id === meId ? icon("check", "sk-userrow-check") : null,
        ],
      ),
    );
  });
  f.body.appendChild(list);
  f.foot.appendChild(
    el("button", { className: "sk-btn sk-btn-ghost", type: "button", text: "Close", onClick: () => closeModal(m) }),
  );
  m.node = f.scrim;
  pushModal(m);
}

/* ----------------------------------------------------------------- sidebar */

function sidebarSection(title, items, opts) {
  const o = opts || {};
  const wrap = el("div", { className: "sk-section" });
  wrap.appendChild(
    el("button", { className: "sk-section-title", type: "button", "aria-expanded": "true" }, [
      icon("caret", "sk-twisty"),
      el("span", { text: title }),
    ]),
  );
  items.forEach((n) => n && wrap.appendChild(n));
  if (o.add) {
    wrap.appendChild(
      el("button", { className: "sk-sb-add", type: "button" }, [
        el("span", { className: "sk-sb-add-glyph" }, icon("plus")),
        el("span", { text: o.add }),
      ]),
    );
  }
  return wrap;
}

function renderSidebar() {
  empty(refs.sidebar);
  const me = User.current();

  refs.sidebar.appendChild(
    el("div", { className: "sk-workspace" }, [
      el("button", { className: "sk-ws-btn", type: "button" }, [
        el("span", { className: "sk-ws-name", text: DATA.clientConfig.client }),
        icon("caret", "sk-ws-caret"),
      ]),
      el("button", { className: "sk-ws-compose", type: "button", "aria-label": "New message", title: "New message" },
        icon("edit")),
    ]),
  );

  const scroll = el("div", { className: "sk-sidebar-scroll" });

  /* Slack's utility rows sit above the channel list. Deliberately not
     .sk-channel — the channel count is asserted by the test harness. */
  const quick = el("div", { className: "sk-sb-quick" });
  [["reply", "Threads"], ["headphones", "Huddles"], ["send", "Drafts & sent"]].forEach((q) => {
    quick.appendChild(
      el("button", { className: "sk-sb-item", type: "button" }, [
        el("span", { className: "sk-sb-glyph" }, icon(q[0])),
        el("span", { text: q[1] }),
      ]),
    );
  });
  scroll.appendChild(quick);

  const active = Store.activeChannelId();
  const rows = Store.channels().map((c) => {
    const monitored = DATA.clientConfig.enabled_channels.indexOf(c.id) !== -1;
    const isActive = c.id === active;
    return el(
      "button",
      {
        className: "sk-channel" + (isActive ? " is-active" : "") + (c.private ? " is-private" : ""),
        type: "button",
        "aria-current": isActive ? "true" : false,
        title: monitored ? "Monitored by the Listener" : "Private — the Listener is not subscribed here",
        onClick: () => Store.setActiveChannelId(c.id),
      },
      [
        c.private
          ? el("span", { className: "sk-ch-glyph" }, icon("lock"))
          : el("span", { className: "sk-ch-glyph", "aria-hidden": "true", text: "#" }),
        el("span", { className: "sk-ch-name", text: c.name }),
        !monitored ? el("span", { className: "sk-ch-note", text: "not monitored" }) : null,
      ],
    );
  });
  scroll.appendChild(sidebarSection("Channels", rows, { add: "Add channels" }));

  const dms = DM_LIST.map((id) => User.get(id)).filter(Boolean).map((u) =>
    el("button", { className: "sk-sb-item sk-dm", type: "button", title: u.name }, [
      el("span", { className: "sk-dm-avatar" }, [avatarNode(u, "is-small"), presenceDot(u.id)]),
      el("span", { className: "sk-ch-name", text: u.name }),
      u.id === me.id ? el("span", { className: "sk-ch-note", text: "you" }) : null,
    ]),
  );
  scroll.appendChild(sidebarSection("Direct messages", dms, { add: "Invite people" }));

  scroll.appendChild(
    el("div", { className: "sk-sidebar-note" }, [
      el("span", { className: "sk-sidebar-note-dot" }),
      "Listener is subscribed to public channels only.",
    ]),
  );

  refs.sidebar.appendChild(scroll);
}

/* ----------------------------------------------------------- channel header */

function activeChannel() {
  return Store.channels().find((c) => c.id === Store.activeChannelId()) || Store.channels()[0];
}

function facepile(ids) {
  const wrap = el("div", { className: "sk-facepile" });
  ids.forEach((id) => {
    const u = User.get(id);
    if (u) wrap.appendChild(avatarNode(u, "is-face"));
  });
  return wrap;
}

function renderChannelHeader() {
  const ch = activeChannel();
  empty(refs.chanHeader);

  refs.chanHeader.appendChild(
    el("div", { className: "sk-chan-left" }, [
      el("button", { className: "sk-chan-name", type: "button" }, [
        ch.private
          ? el("span", { className: "sk-chan-glyph" }, icon("lock"))
          : el("span", { className: "sk-chan-glyph", "aria-hidden": "true", text: "#" }),
        el("span", { text: ch.name }),
        icon("caret", "sk-chan-caret"),
      ]),
      el("button", { className: "sk-chan-members", type: "button", "aria-label": "View members" }, [
        facepile(["u1", "u2", "u3", "u4"]),
        el("span", { className: "sk-chan-count", text: String(User.all().length) }),
      ]),
      el("button", { className: "sk-chan-topic", type: "button", text: ch.topic }),
    ]),
  );

  refs.chanHeader.appendChild(
    el("div", { className: "sk-chan-actions" }, [
      el("button", { className: "sk-chan-icon", type: "button", "aria-label": "Huddle", title: "Huddle" }, icon("headphones")),
      el("button", { className: "sk-chan-icon", type: "button", "aria-label": "Pinned", title: "Pinned" }, icon("pin")),
      el("button", { className: "sk-chan-icon", type: "button", "aria-label": "Channel details", title: "Channel details" }, icon("info")),
      el("span", { className: "sk-chan-sep" }),
      el("button", { className: "sk-btn sk-btn-outline", type: "button", text: "Achievers", onClick: openAchieversModal }),
      el("button", { className: "sk-btn sk-btn-outline", type: "button", text: "Eval Console", onClick: openEvalModal }),
      el("button", { className: "sk-btn sk-btn-outline", type: "button", text: "Reset demo", onClick: resetDemo }),
    ]),
  );
}

function resetDemo() {
  closeAllModals();
  autoOpened = {};
  disarmClickAway();
  if (typeof Trace !== "undefined" && typeof Trace.clear === "function") Trace.clear();
  Store.reset();
  refs.input.value = "";
  renderAll();
}

/* ---------------------------------------------------------------- messages */

/* Slack opens a channel at the newest message, not the oldest. Track the last
   channel painted so a switch always lands at the bottom, and after that only
   follow along if the reader was already there. */
let lastPainted = null;

function renderMessages() {
  const box = refs.messages;
  const channelId = Store.activeChannelId();
  const stick =
    channelId !== lastPainted || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  lastPainted = channelId;
  empty(box);

  const list = Store.messages(channelId);
  let prev = null;

  box.appendChild(channelIntro());

  /* Each day gets its own wrapper. The date pill sticks to the top of the
     transcript, and scoping it to the day means the next day's pill pushes the
     old one out instead of both piling up at top: 0. */
  let day = box;

  list.forEach((m) => {
    if (!prev || startOfDay(m.ts) !== startOfDay(prev.ts)) {
      day = el("div", { className: "sk-day-group" }, [dayDivider(m.ts)]);
      box.appendChild(day);
      prev = null;
    }
    if (m.ephemeral && m.card) {
      day.appendChild(ephemeralNode(channelId, m));
      prev = null;
      return;
    }
    const grouped = !!prev && prev.userId === m.userId && m.ts - prev.ts < GROUP_WINDOW_MS;
    day.appendChild(messageNode(m, grouped));
    prev = m;
  });

  if (stick) box.scrollTop = box.scrollHeight;
}

/* Slack caps every transcript with a "this is the very beginning" block. Without
   it a short channel just floats, which is the giveaway that this isn't Slack. */
function channelIntro() {
  const ch = activeChannel();
  const monitored = DATA.clientConfig.enabled_channels.indexOf(ch.id) !== -1;
  return el("div", { className: "sk-intro" }, [
    el("div", { className: "sk-intro-glyph" }, ch.private ? icon("lock") : el("span", { text: "#" })),
    el("h1", { className: "sk-intro-title", text: (ch.private ? "" : "#") + ch.name }),
    el("p", { className: "sk-intro-text" }, [
      "This is the very beginning of the ",
      el("strong", { text: (ch.private ? "" : "#") + ch.name }),
      " channel. " + ch.topic + ".",
    ]),
    el("div", { className: "sk-intro-actions" }, [
      el("button", { className: "sk-btn sk-btn-outline", type: "button" }, [icon("edit"), "Add description"]),
      el("button", { className: "sk-btn sk-btn-outline", type: "button" }, [icon("plus"), "Add people"]),
    ]),
    el("div", { className: "sk-intro-note" }, [
      el("span", { className: "sk-sidebar-note-dot" + (monitored ? "" : " is-off") }),
      monitored
        ? "The Listener agent is subscribed to this channel."
        : "The Listener agent is not subscribed here. Nothing posted here starts the loop.",
    ]),
  ]);
}

function dayDivider(ts) {
  return el("div", { className: "sk-day" }, [
    el("button", { className: "sk-day-pill", type: "button" }, [
      el("span", { text: fmtDay(ts) }),
      icon("caret", "sk-day-caret"),
    ]),
  ]);
}

/* Slack's hover toolbar, pinned to the top-right of the row. Decorative here —
   none of these are wired, and none of them can send anything. */
function hoverTools() {
  const wrap = el("div", { className: "sk-msg-tools", "aria-hidden": "true" });
  [["emoji", "React"], ["reply", "Reply in thread"], ["share", "Share"], ["bookmark", "Save"], ["dots", "More"]]
    .forEach((t) => {
      wrap.appendChild(el("button", { className: "sk-msg-tool", type: "button", tabindex: "-1", title: t[1] }, icon(t[0])));
    });
  return wrap;
}

function reactionsNode(m) {
  if (!m.reactions || !m.reactions.length) return null;
  const wrap = el("div", { className: "sk-reactions" });
  m.reactions.forEach((r) => {
    wrap.appendChild(
      el("button", { className: "sk-reaction" + (r.mine ? " is-mine" : ""), type: "button" }, [
        el("span", { className: "sk-reaction-emoji", text: r.emoji }),
        el("span", { className: "sk-reaction-count", text: String(r.count) }),
      ]),
    );
  });
  wrap.appendChild(
    el("button", { className: "sk-reaction sk-reaction-add", type: "button", "aria-label": "Add reaction" }, icon("emoji")),
  );
  return wrap;
}

function threadBar(m) {
  if (!m.replyCount) return null;
  const ids = (m.replyUsers || []).slice(0, 3);
  return el("button", { className: "sk-msg-thread", type: "button" }, [
    facepile(ids),
    el("span", { className: "sk-thread-count", text: m.replyCount + (m.replyCount === 1 ? " reply" : " replies") }),
    el("span", { className: "sk-thread-last", text: "Last reply " + fmtShortTime(m.ts + 1800000) }),
    icon("caret-right", "sk-thread-caret"),
  ]);
}

function messageNode(m, grouped) {
  const u = User.get(m.userId) || { name: "Unknown", color: "#616061" };
  const body = el("div", { className: "sk-msg-body" });

  if (!grouped) {
    body.appendChild(
      el("div", { className: "sk-msg-head" }, [
        el("span", { className: "sk-msg-author", text: u.name }),
        el("span", { className: "sk-msg-time", text: fmtTime(m.ts) }),
      ]),
    );
  }
  body.appendChild(el("div", { className: "sk-msg-text", text: m.text }));

  const reacts = reactionsNode(m);
  if (reacts) body.appendChild(reacts);
  const thread = threadBar(m);
  if (thread) body.appendChild(thread);

  return el("div", { className: "sk-msg" + (grouped ? " is-grouped" : "") }, [
    grouped
      ? el("span", { className: "sk-msg-gutter", "aria-hidden": "true", text: fmtShortTime(m.ts) })
      : avatarNode(u),
    body,
    hoverTools(),
  ]);
}

/* ------------------------------------------------- ephemeral nudge card */

const RESOLUTION_TEXT = {
  sent: "Recognition sent. This nudge is closed.",
  dismissed: "Dismissed. No recognition was sent.",
  cancelled: "Draft cancelled. No recognition was sent.",
  abandoned: "Draft abandoned. No recognition was sent.",
  blocked: "Blocked by employer policy. Nothing was drafted.",
  /* No "expired" entry. A nudge is a Slack ephemeral — it never times out on
     the app's side, so no card can resolve that way. */
};

/* Block Kit primitives, rendered the way Slack lays them out in a message. */
function bkSection(text) {
  return el("div", { className: "sk-bk-section", text: text });
}

function bkContext(children) {
  return el("div", { className: "sk-bk-context" }, children);
}

function bkActions(buttons) {
  /* .sk-eph-actions is the frozen contract name; .sk-bk-actions carries the
     Block Kit spacing. Same element, both hats. */
  return el("div", { className: "sk-eph-actions sk-bk-actions" }, buttons);
}

function ephemeralNode(channelId, m) {
  const card = m.card;
  const body = el("div", { className: "sk-eph-body" });

  const head = el("div", { className: "sk-eph-head" }, [
    el("span", { className: "sk-eph-bot", text: BOT.name }),
    el("span", { className: "sk-pill", text: "APP" }),
    el("span", { className: "sk-msg-time", text: fmtTime(m.ts) }),
  ]);

  const node = el("div", { className: "sk-ephemeral" }, [
    avatarNode(BOT, "is-app"),
    el("div", { className: "sk-eph-main" }, [
      head,
      body,
      el("div", { className: "sk-eph-only-you" }, [icon("info", "sk-eph-eye"), "Only visible to you"]),
    ]),
    card.stage === "resolved"
      ? null
      : el("div", { className: "sk-msg-tools is-eph" },
          el("button", {
            className: "sk-eph-x sk-msg-tool",
            type: "button",
            "aria-label": "Dismiss recognition nudge",
            title: "Dismiss",
            onClick: () => callPipeline("dismiss", channelId, m.id, "x"),
          }, icon("x"))),
  ]);

  if (card.stage === "nudge") {
    const me = User.get(card.senderId) || User.current();
    /* A probe arrives after weeks of silence and deliberately ignores the
       cooldown that produced that silence. Rendering it as an ordinary nudge
       would read as the agent malfunctioning, and it would hide the thing the
       sender is actually being asked — whether to keep getting these at all. */
    if (card.probe) {
      body.appendChild(
        el("div", { className: "sk-eph-probe" }, [
          el("span", { className: "sk-eph-probe-tag", text: "Checking in" }),
          el("span", {
            text: "You've turned down every nudge for a while — " +
              (card.probeReason || "nothing accepted at the cooldown ceiling") +
              ". This is one prompt through the cooldown to ask whether these are still wanted.",
          }),
        ]),
      );
    }
    body.appendChild(
      bkSection(me.name.split(" ")[0] + ", you recognized " + card.recipientName +
        ". Want to send this as real recognition?"),
    );
    if (card.sourceText) {
      body.appendChild(el("div", { className: "sk-eph-quote", text: card.sourceText }));
    }
    body.appendChild(
      bkContext([
        el("span", { className: "sk-bk-tag", text: "Core value" }),
        el("span", { text: (card.fields && card.fields.coreValue) || "drafted on approval" }),
        el("span", { className: "sk-bk-dot", text: "·" }),
        el("span", { className: "sk-bk-tag", text: "Confidence" }),
        el("span", { text: pct(card.confidence) }),
      ]),
    );
    body.appendChild(
      bkActions([
        el("button", {
          className: "sk-btn sk-btn-primary",
          type: "button",
          text: "Yes, recognize",
          onClick: () => acceptNudge(channelId, m.id),
        }),
        el("button", {
          className: "sk-btn",
          type: "button",
          /* Dismissing a probe is not "not now" — Personalization reads it as an
             answer and stops for a month. The label has to say so before the
             click, not after. */
          text: card.probe ? "No, pause these for " + AUTO_PAUSE_DAYS + " days" : "Not now",
          onClick: () => callPipeline("dismiss", channelId, m.id, "button"),
        }),
      ]),
    );
  } else if (card.stage === "login") {
    body.appendChild(bkSection("Slack couldn't verify your identity with the recognition platform."));
    body.appendChild(
      bkContext([
        el("span", {
          text: "One-time login links your Slack account to your employee record. Nothing is sent until you approve.",
        }),
      ]),
    );
    body.appendChild(
      bkActions([
        el("button", {
          className: "sk-btn sk-btn-primary",
          type: "button",
          text: "Log in to continue",
          onClick: () => callPipeline("login", channelId, m.id),
        }),
        el("button", {
          className: "sk-btn",
          type: "button",
          text: "Not now",
          onClick: () => callPipeline("dismiss", channelId, m.id, "button"),
        }),
      ]),
    );
  } else if (card.stage === "draft") {
    body.appendChild(bkSection("Draft ready — review and send."));
    body.appendChild(
      bkActions([
        el("button", {
          className: "sk-btn sk-btn-primary",
          type: "button",
          text: "Review draft",
          onClick: () => openDraftModal(channelId, m.id),
        }),
        el("button", {
          className: "sk-btn",
          type: "button",
          text: "Not now",
          onClick: () => callPipeline("dismiss", channelId, m.id, "button"),
        }),
      ]),
    );
  } else {
    body.appendChild(
      el("div", {
        className: "sk-bk-section is-resolved",
        text: RESOLUTION_TEXT[card.resolution] || "Closed.",
      }),
    );
    /* The only place the demo shows the other side of the API call. Offered
       here rather than opened automatically — the point is that the human
       never had to leave Slack. */
    if (card.resolution === "sent") {
      body.appendChild(
        bkActions([
          el("button", {
            className: "sk-btn",
            type: "button",
            text: "View in Achievers",
            onClick: () => openAchieversModal(),
          }),
        ]),
      );
    }
  }

  return node;
}

/* ------------------------------------------------------- click-away path */

let clickAway = null;

function armClickAway(channelId, messageId) {
  const handler = (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;
    /* card, modal and composer are excluded by contract; the trace panel is
       excluded too so inspecting a context file can't kill the live card. */
    if (t.closest(".sk-ephemeral") || t.closest(".sk-modal-scrim") || t.closest(".sk-composer") || t.closest(".sk-trace")) return;
    disarmClickAway();
    callPipeline("dismiss", channelId, messageId, "clickaway");
  };
  /* next tick: the click that produced the card must not dismiss it */
  const timer = setTimeout(() => document.addEventListener("click", handler, true), 0);
  clickAway = { channelId: channelId, messageId: messageId, handler: handler, timer: timer };
}

function disarmClickAway() {
  if (!clickAway) return;
  clearTimeout(clickAway.timer);
  document.removeEventListener("click", clickAway.handler, true);
  clickAway = null;
}

function syncClickAway() {
  const live = liveCard();
  const want = live && !modals.length ? live.message.id : null;
  if (clickAway && clickAway.messageId !== want) disarmClickAway();
  if (want && !clickAway) armClickAway(live.channelId, want);
}

/* ------------------------------------------------------------ draft modal */

let autoOpened = {};

function maybeAutoOpenDraft() {
  const live = liveCard();
  if (!live || live.message.card.stage !== "draft") return;
  if (autoOpened[live.message.id]) return;
  autoOpened[live.message.id] = true;
  openDraftModal(live.channelId, live.message.id);
}

function field(labelText, control, hint) {
  return el("div", { className: "sk-field" }, [
    el("label", { className: "sk-field-label", for: control.id, text: labelText }),
    control,
    hint || null,
  ]);
}

function openDraftModal(channelId, messageId) {
  if (findModal("draft")) return;
  const msg = getMsg(channelId, messageId);
  if (!msg || !msg.card) return;
  const card = msg.card;
  const f0 = card.fields || {};

  const m = { type: "draft", channelId: channelId, messageId: messageId };
  const f = modalFrame({ title: "Send recognition", onClose: () => closeModal(m) });

  /* Announced, because a banner that appears while the human is typing in the
     textarea is otherwise silent to a screen reader. */
  const banners = el("div", { role: "status", "aria-live": "polite" });
  f.body.appendChild(banners);

  const recipient = el("select", { className: "sk-select", id: "fRecipient" });
  User.all().forEach((u) => recipient.appendChild(el("option", { value: u.id, text: u.name + " · " + u.dept })));
  recipient.value = f0.recipientId || card.recipientId || "";

  /* The placeholder is disabled, not just unselected: the agent may leave this
     blank when no signal in core_values.json matched, and the human's job then
     is to choose — not to be able to choose "nothing" back. */
  const value = el("select", { className: "sk-select", id: "fCoreValue" });
  value.appendChild(el("option", { value: "", text: "— choose a core value —", disabled: "disabled" }));
  DATA.coreValues.forEach((v) => value.appendChild(el("option", { value: v, text: v })));
  value.value = f0.coreValue || "";
  const valueHint = el("div", { className: "sk-field-hint" });

  const message = el("textarea", { className: "sk-textarea", id: "fMessage", rows: 4, maxlength: MSG_LIMIT });
  message.value = f0.message || "";
  const counter = el("div", { className: "sk-field-hint sk-counter" });

  /* Read-only by contract, not by convenience: the award is fixed per client
     program in client_config.json and shown here only so the human can confirm
     what they are approving. */
  const amount = el("input", {
    className: "sk-input is-locked",
    id: "fAmount",
    type: "text",
    readonly: "readonly",
    "aria-readonly": "true",
    tabindex: "-1",
  });
  amount.value = "$" + (f0.amount === undefined ? DATA.clientConfig.default_award : f0.amount);

  f.body.appendChild(field("Recipient", recipient));
  f.body.appendChild(field("Core value", value, valueHint));
  f.body.appendChild(field("Message", message, counter));
  f.body.appendChild(field("Award", amount, el("div", { className: "sk-field-hint", text: "Fixed by the " + DATA.clientConfig.program + " program in client_config.json. Shown for confirmation — not adjustable." })));

  const countdown = el("span", { className: "sk-field-hint sk-countdown" });
  const cancel = el("button", {
    className: "sk-btn",
    type: "button",
    text: "Cancel",
    onClick: () => callPipeline("dismiss", channelId, messageId, "button"),
  });
  const submit = el("button", {
    className: "sk-btn sk-btn-primary",
    type: "button",
    text: "Submit",
    onClick: () => submitDraft(m),
  });
  f.foot.appendChild(countdown);
  f.foot.appendChild(cancel);
  f.foot.appendChild(submit);

  function edit(name, val) {
    callPipeline("editField", channelId, messageId, name, val);
  }
  recipient.addEventListener("change", () => edit("recipientId", recipient.value));
  value.addEventListener("change", () => edit("coreValue", value.value));
  message.addEventListener("change", () => edit("message", message.value));
  /* Flushed on every keystroke, not just on blur, so Submission's policy check
     runs against what is on screen. The store stays the source of truth — the
     block survives a re-render instead of living only in the textarea. */
  message.addEventListener("input", () => edit("message", message.value));

  function updateCounter() {
    const n = message.value.length;
    counter.textContent = n + "/" + MSG_LIMIT + (n > MSG_LIMIT ? " — too long" : "");
  }
  updateCounter();

  m.node = f.scrim;
  m.banners = banners;
  m.controls = { recipient: recipient, coreValue: value, message: message, amount: amount };
  m.valueHint = valueHint;
  m.counter = updateCounter;
  m.submit = submit;
  m.countdown = countdown;
  m.swept = false;
  m.timer = setInterval(() => tickSession(m), 1000);

  pushModal(m);
  recipient.focus();
  syncDraftModal(m);
}

/* The second async seam. Same shape as send(): the model call happens out here,
   the agents stay synchronous.

   Why the modal opens before the draft exists rather than after: waiting for the
   model means ~2s of nothing after a click, which in a screen recording reads as
   a broken app. So accept() opens the form on the recipient and the award, which
   are known immediately, and the message field carries a drafting state until
   redraft() lands the real text. With no key both calls are instant and this is
   the old single-step behaviour with an extra tick in it. */
async function acceptNudge(channelId, messageId) {
  const msg = getMsg(channelId, messageId);
  const card = msg && msg.card;
  if (!card) return;

  if (!LLM.enabled()) {
    callPipeline("accept", channelId, messageId);
    return;
  }

  const recipient = User.get(card.recipientId);
  const sender = User.get(card.senderId);
  callPipeline("accept", channelId, messageId, { deferDraft: true });

  await LLM.warmDrafter(
    card.sourceText,
    recipient ? recipient.name : card.recipientId,
    sender ? sender.name : card.senderId,
    card.senderId,
    card.recipientId,
  );

  callPipeline("redraft", channelId, messageId);
}

/* The policy judge's second pass runs here, on the click, not on every
   keystroke. While the human types, the word list alone decides whether Submit
   is enabled — instant, free, and unchanged. The model gets one look at the
   final text, immediately before the only irreversible action in the product. */
async function submitDraft(m) {
  const card = cardOf(m);
  if (!card) return;
  const c = m.controls;
  const f0 = card.fields || {};
  /* flush any control the browser hasn't fired change for yet */
  if (c.recipient.value !== f0.recipientId) callPipeline("editField", m.channelId, m.messageId, "recipientId", c.recipient.value);
  if (c.coreValue.value !== f0.coreValue) callPipeline("editField", m.channelId, m.messageId, "coreValue", c.coreValue.value);
  if (c.message.value !== f0.message) callPipeline("editField", m.channelId, m.messageId, "message", c.message.value);
  /* No amount flush — the award is fixed per program and has no control to read. */

  const finalText = (cardOf(m) || {}).fields;
  if (LLM.enabled() && finalText && finalText.message) {
    m.submit.disabled = true;
    m.submit.textContent = "Checking…";
    await LLM.warmPolicy(finalText.message, "submission-final");
    m.submit.disabled = false;
    m.submit.textContent = "Submit";
  }

  callPipeline("submit", m.channelId, m.messageId);
}

function cardOf(m) {
  const msg = getMsg(m.channelId, m.messageId);
  return msg && msg.card ? msg.card : null;
}

function tickSession(m) {
  const card = cardOf(m);
  if (!card) return;
  const left = Math.max(0, Math.ceil((card.sessionExpiresAt - Date.now()) / 1000));
  m.countdown.textContent = card.sessionExpired
    ? "Session expired"
    : "Session expires in " + left + "s";
  if (left === 0 && !card.sessionExpired && !m.swept) {
    m.swept = true;
    callPipeline("sweep");
  }
}

/* Called on every store mutation — patch in place so typing and focus survive. */
function syncDraftModal(m) {
  const card = cardOf(m);
  if (!card || card.stage === "resolved") {
    closeModal(m);
    return;
  }

  empty(m.banners);
  if (card.sessionExpired) {
    m.banners.appendChild(
      el("div", { className: "sk-banner sk-banner-warn" }, [
        el("span", { text: "Your session expired. Your edits are preserved — reconnect to submit." }),
        el("button", {
          className: "sk-btn",
          type: "button",
          text: "Reconnect",
          onClick: () => callPipeline("reconnect", m.channelId, m.messageId),
        }),
      ]),
    );
  }
  if (card.submissionError === "platform_error") {
    m.banners.appendChild(
      el("div", { className: "sk-banner sk-banner-error" }, [
        el("span", { text: "Couldn't reach the recognition platform. Your draft is preserved." }),
        el("button", {
          className: "sk-btn",
          type: "button",
          text: "Try again",
          onClick: () => submitDraft(m),
        }),
      ]),
    );
  }

  const f0 = card.fields || {};
  const c = m.controls;
  if (document.activeElement !== c.recipient && f0.recipientId) c.recipient.value = f0.recipientId;
  if (document.activeElement !== c.coreValue) c.coreValue.value = f0.coreValue || "";

  /* While the model is writing, the fields are empty because there is no answer
     yet, not because the agent decided on one. Those are different states and
     the hints have to say which is which — a "no value matched" note shown
     before the value has been chosen is a lie the human would act on. */
  const drafting = !!card.drafting;
  const needsValue = !String(f0.coreValue || "").trim();
  m.valueHint.textContent = drafting
    ? "Choosing a core value…"
    : needsValue
      ? "The message carried no signal for any value in core_values.json, so the agent left this blank rather than guessing. Pick the one that fits."
      : "";

  c.message.disabled = drafting;
  c.message.placeholder = drafting ? "The Draft agent is writing this…" : "";
  c.message.classList.toggle("is-drafting", drafting);

  if (document.activeElement !== c.message && typeof f0.message === "string" && c.message.value !== f0.message) {
    c.message.value = f0.message;
  }
  if (f0.amount !== undefined) c.amount.value = "$" + f0.amount;
  m.counter();

  /* Mirror of the Submission agent's final check. The verdict comes from the
     card, which Pipeline.editField refreshes on every keystroke; Agents.submission
     is what actually refuses to post. This only surfaces the refusal early. */
  const violation = card.policyViolation || null;

  if (violation) {
    m.banners.appendChild(
      el("div", { className: "sk-banner sk-banner-error" }, [
        el("span", { text: "Blocked by employer policy — " + violation + ". Edit the message to re-enable Submit. Nothing is sent to the recognition platform." }),
      ]),
    );
  }

  if (card.submissionError === "missing_required") {
    m.banners.appendChild(
      el("div", { className: "sk-banner sk-banner-error" }, [
        el("span", {
          text:
            "Submission refused — " + (card.missingRequired || ["a required field"]).join(", ") +
            " is required by the " + DATA.clientConfig.program + " program. Nothing was sent.",
        }),
      ]),
    );
  }

  /* drafting sits alongside the other three because "there is no draft yet" is
     as good a reason to refuse a submit as an expired session is. */
  m.submit.disabled = drafting || !!card.sessionExpired || !!violation || needsValue;
  tickSession(m);
}

function syncModals() {
  modals.slice().forEach((m) => {
    if (m.type === "draft") syncDraftModal(m);
    else if (m.type === "achievers") renderAchievers(m.wall);
  });
}

/* ------------------------------------------------- mock Achievers platform */

/* The other side of POST /v1/recognitions. Deliberately a different surface —
   different chrome, different vocabulary — because the whole argument of the
   product is that the human never had to come here. */

function achCard(r) {
  const from = User.get(r.senderId);
  const to = User.get(r.recipientId);
  return el("div", { className: "sk-ach-card" }, [
    el("div", { className: "sk-ach-card-head" }, [
      to ? avatarNode(to, "is-ach") : null,
      el("div", { className: "sk-ach-who" }, [
        el("div", { className: "sk-ach-line" }, [
          el("strong", { text: (from && from.name) || "Someone" }),
          el("span", { text: " recognized " }),
          el("strong", { text: (to && to.name) || "someone" }),
        ]),
        el("div", { className: "sk-ach-meta", text: fmtDay(r.ts) + " at " + fmtTime(r.ts) + (to && to.dept ? " · " + to.dept : "") }),
      ]),
      el("div", { className: "sk-ach-points", text: r.amount + " pts" }),
    ]),
    el("div", { className: "sk-ach-value", text: r.coreValue }),
    el("div", { className: "sk-ach-msg", text: r.message }),
    el("div", { className: "sk-ach-source" }, [
      icon("info", "sk-ach-source-icon"),
      el("span", {
        text:
          r.source === "platform"
            ? "Awarded here, in the platform"
            : "Sent from Slack — never opened this platform",
      }),
    ]),
  ]);
}

function renderAchievers(wall) {
  /* Seeded history first, then this session's. The workspace has been running
     the integration since February; an empty wall would say otherwise. */
  const seed = typeof DATA !== "undefined" ? DATA.seedRecognitions || [] : [];
  const live = typeof Store !== "undefined" ? Store.recognitions() : [];
  const all = seed.concat(live).sort((a, b) => b.ts - a.ts);
  empty(wall);

  if (!all.length) {
    wall.appendChild(
      el("div", { className: "sk-empty" }, [
        el("div", { className: "sk-empty-icon" }, icon("search")),
        el("div", { text: "No recognitions published yet. Send one from #product-launch and it lands here." }),
      ]),
    );
    return;
  }

  const me = User.current().id;
  const spent = all.filter((r) => r.senderId === me).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const fromSlack = all.filter((r) => r.source !== "platform").length;

  wall.appendChild(
    el("div", { className: "sk-ach-stats" }, [
      el("div", { className: "sk-ach-stat" }, [
        el("div", { className: "sk-ach-stat-n", text: String(all.length) }),
        el("div", { className: "sk-ach-stat-l", text: "this month" }),
      ]),
      el("div", { className: "sk-ach-stat" }, [
        el("div", { className: "sk-ach-stat-n", text: Math.round((fromSlack / all.length) * 100) + "%" }),
        el("div", { className: "sk-ach-stat-l", text: "sent from Slack" }),
      ]),
      el("div", { className: "sk-ach-stat" }, [
        el("div", { className: "sk-ach-stat-n", text: "$" + spent }),
        el("div", { className: "sk-ach-stat-l", text: "of your budget used" }),
      ]),
    ]),
  );

  all.forEach((r) => wall.appendChild(achCard(r)));
}

function openAchieversModal() {
  const open = findModal("achievers");
  if (open) return;
  const m = { type: "achievers" };
  const cfg = DATA.clientConfig;
  const frame = modalFrame({
    title: cfg.program + " · " + cfg.client,
    modalClass: "sk-modal sk-ach-modal",
    onClose: () => closeModal(m),
  });

  frame.body.appendChild(
    el("div", { className: "sk-ach-head" }, [
      el("div", { className: "sk-ach-brand", text: "Recognition wall" }),
      el("div", { className: "sk-ach-sub", text: "Mock Achievers platform — what the recognition looks like once published." }),
    ]),
  );

  const wall = el("div", { className: "sk-ach-wall" });
  frame.body.appendChild(wall);
  renderAchievers(wall);

  frame.foot.appendChild(
    el("button", { className: "sk-btn", type: "button", text: "Close", onClick: () => closeModal(m) }),
  );

  m.node = frame.scrim;
  m.wall = wall;
  pushModal(m);
}

/* ------------------------------------------------------------ file viewer */

function openFileModal(name) {
  const f = getFile(name);
  if (!f) return;
  const m = { type: "file" };
  const frame = modalFrame({ title: name, onClose: () => closeModal(m) });
  frame.body.appendChild(el("div", { className: "sk-file-purpose", text: f.purpose }));
  frame.body.appendChild(el("pre", { className: "sk-file-body", text: f.render() }));
  frame.foot.appendChild(
    el("button", { className: "sk-btn", type: "button", text: "Close", onClick: () => closeModal(m) }),
  );
  m.node = frame.scrim;
  pushModal(m);
}

/* ------------------------------------------------------------ trace panel */

const STATUS_CLASS = { pass: "is-pass", stop: "is-stop", wait: "is-wait", info: "is-info" };

function renderTrace() {
  const body = refs.traceBody;
  empty(body);

  const run = typeof Trace !== "undefined" && typeof Trace.current === "function" ? Trace.current() : null;
  if (!run) {
    body.appendChild(traceEmpty());
    return;
  }

  body.appendChild(traceInput(run.input));

  (run.steps || []).forEach((step, i) => body.appendChild(stageNode(step, i + 1)));

  if (run.outcome) {
    body.appendChild(
      el("div", { className: "sk-stage " + (run.outcome === "sent" ? "is-pass" : "is-info") }, [
        el("div", { className: "sk-stage-head" }, [
          el("span", { className: "sk-stage-num", text: "✓" }),
          el("span", { className: "sk-stage-agent", text: "outcome" }),
        ]),
        el("div", { className: "sk-decision", text: "Run ended — " + run.outcome }),
      ]),
    );
  }
}

function traceEmpty() {
  const examples = DATA.nudgeTriggerExamples.filter((e) => e.label === "trigger").slice(0, 3);
  const wrap = el("div", { className: "sk-empty" }, [
    el("div", { className: "sk-empty-icon" }, icon("search")),
    el("div", { text: "No agent run yet. Post a recognition message in #product-launch to start the loop." }),
    el("div", { className: "sk-field-label", text: "Try one of these" }),
  ]);
  examples.forEach((e) => wrap.appendChild(el("div", { className: "sk-eval-note", text: "“" + e.text + "”" })));
  return wrap;
}

function traceInput(input) {
  const author = input && input.userId ? User.get(input.userId) : null;
  return el("div", { className: "sk-stage is-info" }, [
    el("div", { className: "sk-stage-head" }, [
      el("span", { className: "sk-stage-num", text: "▸" }),
      el("span", { className: "sk-stage-agent", text: "[input]" }),
      el("span", { className: "sk-stage-phase", text: "Trigger" }),
    ]),
    el("div", { className: "sk-decision", text: "“" + ((input && input.text) || "") + "”" }),
    el("div", { className: "sk-detail" }, [
      detailRow("author", author ? author.name : "—"),
      detailRow("channel", "#" + channelName(input && input.channelId)),
    ]),
  ]);
}

function channelName(id) {
  const c = Store.channels().find((x) => x.id === id);
  return c ? c.name : String(id || "—");
}

function detailRow(label, value) {
  return el("div", { className: "sk-detail-row" }, [
    el("span", { text: label }),
    el("span", { text: stringify(value) }),
  ]);
}

function stageNode(step, n) {
  const node = el("div", { className: "sk-stage " + (STATUS_CLASS[step.status] || "is-info") });

  node.appendChild(
    el("div", { className: "sk-stage-head" }, [
      el("span", { className: "sk-stage-num", text: String(n) }),
      el("span", { className: "sk-stage-agent", text: step.agent }),
      el("span", { className: "sk-stage-phase", text: step.phase }),
      el("span", { className: "sk-stage-status", text: step.status }),
    ]),
  );

  if (step.reads && step.reads.length) {
    node.appendChild(el("div", { className: "sk-field-label", text: "Reads" }));
    const reads = el("div", { className: "sk-reads" });
    step.reads.forEach((name) => {
      reads.appendChild(
        el("button", {
          className: "sk-file-chip",
          type: "button",
          text: name,
          title: "Open " + name,
          onClick: () => openFileModal(name),
        }),
      );
    });
    node.appendChild(reads);
  }

  if (step.decision) node.appendChild(el("div", { className: "sk-decision", text: step.decision }));

  const rows = [];
  if (typeof step.confidence === "number") {
    node.appendChild(
      el(
        "div",
        { className: "sk-conf", role: "img", "aria-label": "confidence " + pct(step.confidence) },
        el("div", { className: "sk-conf-bar" }, el("div", { className: "sk-conf-fill", style: { width: pct(step.confidence) } })),
      ),
    );
    rows.push(["confidence", pct(step.confidence)]);
  }
  (step.detail || []).forEach((d) => rows.push(d));

  if (rows.length) {
    const detail = el("div", { className: "sk-detail" });
    rows.forEach((d) => detail.appendChild(detailRow(d[0], d[1])));
    node.appendChild(detail);
  }

  if (step.output && Object.keys(step.output).length) {
    node.appendChild(el("div", { className: "sk-field-label", text: "Drafted output" }));
    const out = el("div", { className: "sk-output" });
    Object.keys(step.output).forEach((k) => {
      out.appendChild(
        el("div", { className: "sk-output-row" }, [
          el("span", { text: k }),
          el("span", { text: stringify(step.output[k]) }),
        ]),
      );
    });
    node.appendChild(out);
  }

  return node;
}

/* ----------------------------------------------------------- eval console */

function pill(ok, skipped) {
  if (skipped) return el("span", { className: "sk-pill sk-pill-skip", text: "SKIP" });
  return el("span", { className: "sk-pill " + (ok ? "sk-pill-pass" : "sk-pill-fail"), text: ok ? "PASS" : "FAIL" });
}

/* Async since the four draft-stage cases warm the model five times each. The
   modal opens on the synchronous frame and fills in when the suite returns —
   the alternative is a click that appears to do nothing for half a minute. */
async function openEvalModal() {
  if (findModal("eval")) return;
  const m = { type: "eval" };
  const f = modalFrame({ title: "Eval console", modalClass: "sk-modal sk-eval-modal", onClose: () => closeModal(m) });

  if (typeof runAllEvals !== "function") {
    f.body.appendChild(
      el("div", { className: "sk-banner sk-banner-warn", text: "evals.js did not load — runAllEvals() is unavailable." }),
    );
    m.node = f.scrim;
    pushModal(m);
    return;
  }

  const total = typeof EVAL_CASES !== "undefined" ? EVAL_CASES.length : 0;
  const status = el("div", {
    className: "sk-banner",
    text: LLM.enabled()
      ? "Running " + total + " cases. Four of them call the model five times each, so this takes a moment…"
      : "Running " + total + " cases…",
  });
  f.body.appendChild(status);
  f.foot.appendChild(
    el("span", { className: "sk-field-hint", text: "Scenarios snapshot and restore any state they touch." }),
  );
  f.foot.appendChild(
    el("button", { className: "sk-btn", type: "button", text: "Close", onClick: () => closeModal(m) }),
  );
  m.node = f.scrim;
  pushModal(m);

  let res;
  try {
    res = await runAllEvals(function (id, i, total) {
      status.textContent = "Running " + id + " (" + (i + 1) + "/" + total + ")…";
    });
  } catch (e) {
    status.className = "sk-banner sk-banner-warn";
    status.textContent = "The suite threw: " + (e && e.message ? e.message : String(e));
    return;
  }
  /* The user may have closed the modal while the model calls were in flight. */
  if (!f.body.isConnected) return;
  f.body.removeChild(status);

  {
    const e0 = res.eval0 || {};

    const s0 = el("div", { className: "sk-eval-section" }, [
      el("div", { className: "sk-field-label" }, ["Eval 0 — trigger classifier ", pill(!!e0.pass)]),
      evalRow("accuracy", pct(e0.accuracy) + " (" + e0.correct + "/" + e0.total + ")", "threshold ≥ 90%"),
      evalRow("false-positive rate", pct(e0.falsePositiveRate), "threshold ≤ 5%"),
      evalRow("recall", pct(e0.recall), "threshold > 50%"),
    ]);
    if (e0.misclassified && e0.misclassified.length) {
      const miss = el("div", { className: "sk-eval-miss" }, el("div", { className: "sk-field-label", text: "Misclassified" }));
      e0.misclassified.forEach((x) => {
        miss.appendChild(
          el("div", { className: "sk-eval-note", text: "“" + x.text + "” — expected " + x.expected + ", got " + x.got }),
        );
      });
      s0.appendChild(miss);
    }
    f.body.appendChild(s0);

    const cases = res.cases || [];
    const skipped = cases.filter((c) => c.skipped).length;
    const ran = cases.length - skipped;
    const passed = cases.filter((c) => c.pass).length;
    const s1 = el("div", { className: "sk-eval-section" }, [
      el("div", {
        className: "sk-field-label",
        text:
          "Scenarios — " + passed + "/" + ran + " passing" +
          (skipped ? " · " + skipped + " skipped, no API key" : ""),
      }),
    ]);
    cases.forEach((c) => {
      s1.appendChild(
        el("div", { className: "sk-eval-row" }, [
          el("div", {}, [
            el("div", { text: c.id + ". " + c.title + (c.runs > 1 ? " · " + c.runs + " runs" : "") }),
            el("div", { className: "sk-eval-note", text: c.expectation }),
            /* The measured result, which this panel used to compute and throw
               away. It is the only line here that changes when the code does,
               and it is the line the PRD quotes. */
            c.actual ? el("div", { className: "sk-eval-note", text: "→ " + c.actual }) : null,
            c.note ? el("div", { className: "sk-eval-note", text: c.note }) : null,
          ]),
          pill(!!c.pass, !!c.skipped),
        ]),
      );
    });
    f.body.appendChild(s1);
  }
}

function evalRow(label, valueText, note) {
  return el("div", { className: "sk-eval-row" }, [
    el("div", {}, [el("div", { text: label }), note ? el("div", { className: "sk-eval-note", text: note }) : null]),
    el("span", { text: valueText }),
  ]);
}

/* -------------------------------------------------------------- composer */

const AUTO_REPLIES = [
  "Ack, picking that up after standup.",
  "Makes sense to me.",
  "I'll add it to the checklist.",
  "Following — ping me if it slips.",
  "Noted, updating the doc now.",
  "Same read here.",
];

function maybeAutoReply(channelId) {
  if (Math.random() > 0.55) return;
  const meId = Store.currentUserId();
  const pool = User.all().filter((u) => u.id !== meId);
  const who = pool[Math.floor(Math.random() * pool.length)];
  const text = AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)];
  setTimeout(() => {
    /* channel chatter only — never routed through Pipeline, and never while a
       nudge card is live so the card stays the focus of the demo. */
    if (Store.activeChannelId() !== channelId || liveCard()) return;
    Store.addMessage(channelId, { userId: who.id, text: text });
  }, 900 + Math.random() * 1800);
}

function autosize() {
  refs.input.style.height = "auto";
  refs.input.style.height = Math.min(160, refs.input.scrollHeight) + "px";
  refs.sendBtn.classList.toggle("is-ready", refs.input.value.trim().length > 0);
}

/* The one async seam in the app. If an API key is set, the Listener's model call
   happens here — before the pipeline, not inside it — so the six agents and the
   eval harness that drives them stay synchronous. warmListener puts its verdict
   in a cache that classify() reads first; with no key it returns immediately and
   the loop runs on the deterministic classifier. See llm.js. */
async function send() {
  const text = refs.input.value.trim();
  if (!text) return;
  refs.input.value = "";
  autosize();
  const channelId = Store.activeChannelId();
  const channel = Store.channels().find((c) => c.id === channelId);
  const msg = Store.addMessage(channelId, { userId: Store.currentUserId(), text: text });
  await LLM.warmListener(text, channel ? channel.name : channelId);
  callPipeline("onMessage", channelId, msg);
  maybeAutoReply(channelId);
}

refs.sendBtn.addEventListener("click", send);
refs.input.addEventListener("input", autosize);
refs.input.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    send();
  }
});

/* ------------------------------------------------------------- keyboard */

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    if (modals.length) {
      ev.preventDefault();
      closeModal(modals[modals.length - 1]);
      return;
    }
    const live = liveCard();
    if (live) {
      ev.preventDefault();
      callPipeline("dismiss", live.channelId, live.message.id, "x");
    }
    return;
  }
  if (ev.key === "Tab" && modals.length) trapTab(ev, modals[modals.length - 1].node);
});

/* ------------------------------------------------------------------ boot */

function renderChrome() {
  if (refs.searchLabel) refs.searchLabel.textContent = "Search " + DATA.clientConfig.client;
  const composer = refs.input;
  if (composer) composer.setAttribute("placeholder", "Message #" + activeChannel().name);
}

function renderAll() {
  renderChrome();
  renderRail();
  renderSidebar();
  renderChannelHeader();
  renderMessages();
  renderTrace();
  syncModals();
  syncClickAway();
  maybeAutoOpenDraft();
}

Store.subscribe(renderAll);
if (typeof Trace !== "undefined" && typeof Trace.subscribe === "function") Trace.subscribe(renderTrace);

renderAll();
autosize();
setInterval(() => callPipeline("sweep"), 30000);

})();
