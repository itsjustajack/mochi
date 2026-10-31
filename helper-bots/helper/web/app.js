// Helper web app. No framework, no build step. Every piece of text from the server is set with
// textContent (never innerHTML), because task results can contain text from files or the web.
"use strict";

const KEY_STORE = "helper.key";
const QUICK = {
  organizer: ["List what is in my work folder", "Tidy the work folder into subfolders by file type"],
  notes: ["Summarise the notes in my work folder"],
  storyteller: ["Start a short family-friendly adventure", "Roll a d20 for me"],
};

const state = { key: "", agents: [], current: "", tasks: [], status: null, lastRender: "" };
const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function face(agent, size) {
  const f = el("span", "face" + (size ? " " + size : ""));
  f.style.setProperty("--c", agent.color || "#7cc4a4");
  if (agent.avatar) {
    f.classList.add("emoji");
    f.textContent = agent.avatar;
  } else {
    f.append(el("i"), el("i"));
  }
  return f;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { Authorization: "Bearer " + state.key, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    signOut("That key did not work.");
    throw new Error("unauthorised");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}

// ---------------------------------------------------------------- sign in

function signOut(msg) {
  localStorage.removeItem(KEY_STORE);
  state.key = "";
  $("app").hidden = true;
  $("signin").hidden = false;
  $("signin-error").textContent = msg || "";
}

async function boot() {
  // The key arrives once in the URL fragment (never sent to the server), then is cleared from the address bar.
  const m = location.hash.match(/key=([A-Za-z0-9_\-]+)/);
  // Text shared to the phone app arrives the same way. It only fills the message box; you still press Send.
  const sh = location.hash.match(/share=([^&]*)/);
  if (sh) {
    try { state.share = decodeURIComponent(sh[1].replace(/\+/g, " ")).slice(0, 4000); } catch (e) { state.share = ""; }
  }
  if (m) localStorage.setItem(KEY_STORE, m[1]);
  if (m || sh) history.replaceState(null, "", location.pathname);
  state.key = localStorage.getItem(KEY_STORE) || "";
  if (!state.key) return signOut("");
  try {
    const data = await api("GET", "/v1/agents");
    state.agents = data.agents;
    state.current = data.default && data.agents.some((a) => a.key === data.default) ? data.default : (data.agents[0] || {}).key;
  } catch (e) {
    if (state.key) $("signin-error").textContent = "Could not reach helperd. Is `helper serve` running?";
    return;
  }
  $("signin").hidden = true;
  $("app").hidden = false;
  renderRail();
  selectAgent(state.current);
  poll();
  if (!state.timer) state.timer = setInterval(poll, 1200);
  if (state.share) {
    $("input").value = state.share;
    state.share = "";
    autosize();
    $("input").focus();
  }
}

// The phone app calls this after its fingerprint/PIN check, or when you come back to the app.
window.helperRefresh = () => { state.lastRender = ""; poll(); };

$("signin-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const k = $("signin-key").value.trim();
  if (!k) return;
  localStorage.setItem(KEY_STORE, k);
  $("signin-key").value = "";
  boot();
});

// ---------------------------------------------------------------- rail and header

function currentAgent() {
  return state.agents.find((a) => a.key === state.current) || { name: "Helper", color: "#7cc4a4", key: "" };
}

function renderRail() {
  const box = $("agents");
  box.replaceChildren();
  const waiting = new Set(state.tasks.filter((t) => t.status === "waiting").map((t) => t.agent));
  for (const a of state.agents) {
    const b = el("button", "agent-btn");
    b.type = "button";
    b.title = a.name;
    b.setAttribute("aria-label", a.name);
    b.setAttribute("aria-current", String(a.key === state.current));
    b.append(face(a));
    if (waiting.has(a.key)) b.append(el("span", "badge"));
    b.addEventListener("click", () => selectAgent(a.key));
    box.append(b);
  }
}

function selectAgent(key) {
  state.current = key;
  const a = currentAgent();
  $("pill-face").replaceWith(Object.assign(face(a), { id: "pill-face" }));
  $("pill-name").textContent = a.name;
  $("empty-name").textContent = a.name;
  $("input").placeholder = "Message " + a.name + "…";
  const chips = $("chips");
  chips.replaceChildren();
  for (const q of QUICK[a.key] || []) {
    const c = el("button", "chip", q);
    c.type = "button";
    c.addEventListener("click", () => send(q));
    chips.append(c);
  }
  state.lastRender = "";
  renderRail();
  renderChat();
}

function renderStatus() {
  const s = state.status;
  const box = $("status");
  const banner = $("banner");
  if (!s) return;
  let cls = "ok";
  let text = "Ready";
  if (s.stopped) { cls = "bad"; text = "Stopped"; }
  else if (!s.model.ok) { cls = "warn"; text = "Model not ready"; }
  else if (s.pending) { cls = "warn"; text = s.pending + " waiting on you"; }
  box.className = "status " + cls;
  $("status-text").textContent = text;
  const notes = [];
  if (s.stopped) notes.push("All tasks are stopped. Press the red button again to allow new tasks.");
  if (!s.policy_ok) notes.push("Policy files changed since you approved them, so changing actions are blocked. Run `helper policy approve`.");
  if (!s.model.ok) notes.push(s.model.message);
  banner.hidden = notes.length === 0;
  banner.textContent = notes.join(" ");
  $("stop-all").classList.toggle("on", !!s.stopped);
  $("stop-all").title = s.stopped ? "Allow tasks again" : "Stop all tasks";
}

// ---------------------------------------------------------------- conversation

const ICON = { step: "›", denied: "✕", system: "!", result: "·" };

function describeStep(e) {
  const args = Object.entries(e.args || {}).map(([k, v]) => k + "=" + v).join("  ");
  return [e.tool, args];
}

function approvalCard(task, ev) {
  const a = ev.approval;
  const card = el("div", "card");
  const head = el("div", "card-head");
  const live = a.status === "pending" && task.status === "waiting";
  const decided = task.events.find((x) => x.kind === "denied" && x.tool === a.tool && x.ts >= ev.ts);
  let tag = el("span", "tag draft", "Draft");
  if (!live) tag = decided ? el("span", "tag no", "Not done") : el("span", "tag done", "Approved");
  head.append(tag, el("span", "card-title", a.tool.replace(/_/g, " ")));
  card.append(head);
  const args = Object.entries(a.args).map(([k, v]) => k + ": " + v).join("\n");
  card.append(el("pre", "card-args", args || "(no arguments)"));
  if (a.tainted) card.append(el("div", "card-warn", "This task read web or untrusted content. Check carefully."));
  const why = a.reason.replace(/^tier \d+:\s*/i, "");
  card.append(el("div", "card-note", "Tier " + a.tier + " · " + why + (live ? ". Nothing happens until you approve." : ".")));
  if (live) {
    const row = el("div", "card-actions");
    const yes = el("button", "btn primary", "Approve once");
    const no = el("button", "btn quiet", "Discard");
    const stop = el("button", "btn link", "Stop task");
    for (const [b, v] of [[yes, "approve"], [no, "deny"], [stop, "stop"]]) {
      b.type = "button";
      b.addEventListener("click", async () => {
        row.querySelectorAll("button").forEach((x) => (x.disabled = true));
        // In the phone app, Approve goes through Android's fingerprint/PIN check, which shows the
        // action as helperd reports it. Deny and Stop are the safe direction and need no check.
        if (v === "approve" && window.HelperApp && HelperApp.isApp()) { HelperApp.approve(a.id); return; }
        try { await api("POST", "/v1/approvals/" + encodeURIComponent(a.id), { verdict: v }); } catch (e) { showError(e.message); }
        poll();
      });
    }
    row.append(yes, no, stop);
    card.append(row);
  }
  return card;
}

function renderChat() {
  const tasks = state.tasks.filter((t) => t.agent === state.current);
  const sig = state.current + JSON.stringify(tasks.map((t) => [t.id, t.status, t.events.length]));
  if (sig === state.lastRender) return;
  state.lastRender = sig;
  const chat = $("chat");
  const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
  const empty = $("empty");
  chat.replaceChildren(empty);
  empty.hidden = tasks.length > 0;
  for (const t of tasks) {
    for (const e of t.events) {
      if (e.kind === "user") chat.append(el("div", "bubble user", e.text));
      else if (e.kind === "step") {
        const [tool, args] = describeStep(e);
        const ln = el("div", "line step");
        ln.append(el("span", "ico", ICON.step), el("span", "", tool), el("code", "", args));
        chat.append(ln);
      } else if (e.kind === "result") {
        if (!e.ok) chat.append(lineOf("denied", e.text));
      } else if (e.kind === "denied") {
        if (!/you said no|you stopped/.test(e.reason)) chat.append(lineOf("denied", "Refused: " + e.reason));
      } else if (e.kind === "system") chat.append(lineOf("system", e.text));
      else if (e.kind === "approval") chat.append(approvalCard(t, e));
      else if (e.kind === "end") {
        if (e.status === "stopped" && e.text === "Stopped by you.") chat.append(lineOf("system", "Stopped by you"));
        else chat.append(el("div", "bubble agent" + (e.status === "done" ? "" : " failed"), e.text));
      }
    }
    if (t.status === "running" || t.status === "queued") {
      const w = el("div", "working");
      w.append(el("span", "pulse"), el("span", "", t.agent_name + " is working…"));
      chat.append(w);
    }
  }
  if (atBottom || tasks.length) chat.scrollTop = chat.scrollHeight;
}

function showError(msg) {
  $("banner").hidden = false;
  $("banner").textContent = msg;
}

function lineOf(kind, text) {
  const ln = el("div", "line " + kind);
  ln.append(el("span", "ico", ICON[kind] || "·"), el("span", "", text));
  return ln;
}

// ---------------------------------------------------------------- actions

async function send(text) {
  const goal = (text || "").trim();
  if (!goal) return;
  try {
    const r = await api("POST", "/v1/tasks", { goal, agent: state.current });
    if (r.agent !== state.current) selectAgent(r.agent);
    $("input").value = "";
    autosize();
    poll();
  } catch (e) {
    $("banner").hidden = false;
    $("banner").textContent = e.message;
  }
}

$("composer").addEventListener("submit", (ev) => {
  ev.preventDefault();
  send($("input").value);
});
$("input").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    send($("input").value);
  }
});
function autosize() {
  const t = $("input");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 160) + "px";
}
$("input").addEventListener("input", autosize);

$("stop-all").addEventListener("click", async () => {
  const stopped = state.status && state.status.stopped;
  try { await api("POST", stopped ? "/v1/start" : "/v1/stop", {}); } catch (e) { /* shown by status */ }
  poll();
});

let polling = false;
async function poll() {
  if (polling || !state.key) return;
  polling = true;
  try {
    const [tasks, status] = await Promise.all([api("GET", "/v1/tasks"), api("GET", "/v1/status")]);
    state.tasks = tasks.tasks;
    state.status = status;
    renderStatus();
    renderRail();
    renderChat();
  } catch (e) {
    $("status").className = "status bad";
    $("status-text").textContent = "helperd unreachable";
  } finally {
    polling = false;
  }
}

window.addEventListener("hashchange", () => { if (!state.key || /key=/.test(location.hash)) boot(); });
boot();
