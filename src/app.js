// Orbit PM — the full-page app (app.html). Rendering is plain DOM; all state changes go
// through the pure functions in store.js and are saved to chrome.storage.local.
import * as S from "./store.js";
import { donut, stackedBars, line } from "./charts.js";
import { load, save, onChange } from "./storage.js";
import { sampleState } from "./demo.js";

const $ = (sel) => document.querySelector(sel);
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (t) => t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const isoDate = (t) => { if (!t) return ""; const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fromIso = (v) => { if (!v) return null; const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
const PALETTE = ["#c6f432", "#4cc9f0", "#ff8fab", "#ffb703", "#a78bfa", "#2ee59d", "#ff6b6b"];

let state = S.emptyState();
let view = (location.hash || "#board").slice(1);
let project = null;              // selected project id, null = all
let weekOffset = 0, reportOffset = 0;

async function commit(next, msg) {
  state = next;
  await save(state);
  render();
  if (msg) toast(msg);
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), 1800);
}

const projColor = (id) => state.projects.find((p) => p.id === id)?.color || "#8a96a8";
const projName = (id) => state.projects.find((p) => p.id === id)?.name || "";
const visibleTasks = () => state.tasks.filter((t) => !project || t.projectId === project);

// ------------------------------------------------------------------- sidebar
function renderSidebar() {
  const nav = $("#projects");
  nav.innerHTML = "";
  const all = h(`<a class="${project ? "" : "on"}"><span class="dot" style="background:linear-gradient(135deg,#c6f432,#4cc9f0)"></span>All projects<span class="n">${state.tasks.filter((t) => t.status !== "done").length}</span></a>`);
  all.onclick = () => { project = null; render(); };
  nav.append(all);
  for (const p of state.projects) {
    const open = state.tasks.filter((t) => t.projectId === p.id && t.status !== "done").length;
    const a = h(`<a class="${project === p.id ? "on" : ""}" title="${esc(p.name)}"><span class="dot" style="background:${p.color}"></span><span class="pn">${esc(p.name)}</span><span class="n">${open}</span></a>`);
    a.onclick = () => { project = p.id; render(); };
    a.ondblclick = () => renameProject(p.id);
    nav.append(a);
  }
  const now = Date.now(), d0 = S.startOfDay(now);
  const ms = state.tasks.reduce((a, t) => a + S.loggedMs(t, d0, d0 + S.DAY, state.timer, now), 0);
  const goal = (state.settings.dailyGoalH || 6) * S.HOUR;
  $("#todayTotal").textContent = S.formatDuration(ms);
  $("#todayBar").style.width = Math.min(100, (ms / goal) * 100) + "%";
  $("#todayGoal").textContent = `${Math.round((ms / goal) * 100)} % of the ${state.settings.dailyGoalH || 6} h goal`;
}

async function renameProject(id) {
  const p = state.projects.find((x) => x.id === id);
  const name = prompt("Project name (empty to delete the project and its tasks)", p.name);
  if (name === null) return;
  if (!name.trim()) {
    if (confirm(`Delete "${p.name}" and its ${state.tasks.filter((t) => t.projectId === id).length} tasks?`)) {
      project = null;
      await commit(S.removeProject(state, id), "Project deleted");
    }
    return;
  }
  const s = JSON.parse(JSON.stringify(state));
  s.projects.find((x) => x.id === id).name = name.trim();
  await commit(s, "Renamed");
}

// --------------------------------------------------------------------- timer
function renderTimer() {
  const pill = $("#timerPill");
  if (!state.timer) { pill.className = "timer-pill idle"; $("#timerText").textContent = "No timer running"; return; }
  const t = state.tasks.find((x) => x.id === state.timer.taskId);
  pill.className = "timer-pill run";
  $("#timerText").textContent = `${S.formatDuration(Date.now() - state.timer.start)} · ${t ? t.title : ""}`;
}

async function toggleTimer(taskId) {
  if (state.timer && state.timer.taskId === taskId) await commit(S.stopTimer(state), "Timer stopped");
  else await commit(S.startTimer(state, taskId), "Timer started");
}

// --------------------------------------------------------------------- board
function card(t) {
  const est = t.estimateH * S.HOUR;
  const logged = S.loggedMs(t, -Infinity, Infinity, state.timer);
  const ds = S.dueState(t);
  const running = state.timer?.taskId === t.id;
  const due = t.due ? `<span class="chip ${ds}">${ds === "overdue" ? "overdue · " : ds === "today" ? "today · " : ""}${fmtDate(t.due)}</span>` : "";
  const blocked = (t.deps || []).filter((d) => state.tasks.find((x) => x.id === d && x.status !== "done")).length;
  const el = h(`<div class="tcard ${running ? "running" : ""}" draggable="true" data-id="${t.id}" style="--c:${projColor(t.projectId)}">
    <div class="t">${esc(t.title)}</div>
    <div class="meta"><span class="chip p-${t.priority}">${t.priority}</span>${due}${blocked ? `<span class="chip dep">⛓ blocked by ${blocked}</span>` : ""}${t.tags.map((x) => `<span class="chip">#${esc(x)}</span>`).join("")}</div>
    ${est ? `<div class="prog" title="${S.formatDuration(logged)} of ${t.estimateH} h"><i style="width:${Math.min(100, (logged / est) * 100)}%"></i></div>` : ""}
    <div class="foot"><span>${S.formatDuration(logged)}${est ? " / " + t.estimateH + "h" : ""}${project ? "" : " · " + esc(projName(t.projectId).split(":")[0])}</span>
      <button class="play ${running ? "on" : ""}" title="${running ? "Stop" : "Start"} timer">${running ? "■" : "▶"}</button></div></div>`);
  el.querySelector(".play").onclick = (e) => { e.stopPropagation(); toggleTimer(t.id); };
  el.onclick = () => openTask(t.id);
  el.ondragstart = (e) => { e.dataTransfer.setData("text/plain", t.id); el.classList.add("dragging"); };
  el.ondragend = () => el.classList.remove("dragging");
  return el;
}

function renderBoard() {
  const b = $("#board");
  b.innerHTML = "";
  const colors = { backlog: "#3b4656", todo: "#4cc9f0", doing: "#c6f432", review: "#a78bfa", done: "#4b5563" };
  for (const st of S.STATUSES) {
    const tasks = S.column(state, project, st);
    const col = h(`<div class="col" data-status="${st}"><div class="col-h"><div>${S.STATUS_LABEL[st]}<div class="bar" style="background:${colors[st]}"></div></div><span class="count">${tasks.length}</span></div></div>`);
    tasks.forEach((t) => col.append(card(t)));
    const add = h(`<button class="add-card">＋ Add a task</button>`);
    add.onclick = () => newTask(st);
    col.append(add);
    col.ondragover = (e) => { e.preventDefault(); col.classList.add("drop"); };
    col.ondragleave = () => col.classList.remove("drop");
    col.ondrop = async (e) => {
      e.preventDefault();
      col.classList.remove("drop");
      const id = e.dataTransfer.getData("text/plain");
      const cards = [...col.querySelectorAll(".tcard")].filter((c) => c.dataset.id !== id);
      let idx = cards.findIndex((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
      if (idx < 0) idx = cards.length;
      await commit(S.moveTask(state, id, st, idx), st === "done" ? "Done ✓" : `Moved to ${S.STATUS_LABEL[st]}`);
    };
    b.append(col);
  }
}

async function newTask(status = "todo") {
  const pid = project || state.projects[0]?.id;
  if (!pid) { toast("Create a project first"); return; }
  const s = S.addTask(state, { projectId: pid, title: "New task", status });
  await commit(s);
  openTask(s.tasks.at(-1).id);
}

// -------------------------------------------------------------------- drawer
function openTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  const d = $("#drawer");
  const others = state.tasks.filter((x) => x.id !== id && x.projectId === t.projectId);
  d.innerHTML = `<h2>Edit task</h2>
    <label>Title</label><input id="dTitle" class="inp" value="${esc(t.title)}">
    <div class="two"><div><label>Project</label><select id="dProj" class="sel">${state.projects.map((p) => `<option value="${p.id}" ${p.id === t.projectId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <div><label>Status</label><select id="dStatus" class="sel">${S.STATUSES.map((x) => `<option value="${x}" ${x === t.status ? "selected" : ""}>${S.STATUS_LABEL[x]}</option>`).join("")}</select></div></div>
    <div class="two"><div><label>Priority</label><select id="dPrio" class="sel">${S.PRIORITIES.map((x) => `<option ${x === t.priority ? "selected" : ""}>${x}</option>`).join("")}</select></div>
    <div><label>Estimate (hours)</label><input id="dEst" type="number" step="0.5" min="0" class="inp" value="${t.estimateH || ""}"></div></div>
    <div class="two"><div><label>Start</label><input id="dStart" type="date" class="inp" value="${isoDate(t.start)}"></div>
    <div><label>Due</label><input id="dDue" type="date" class="inp" value="${isoDate(t.due)}"></div></div>
    <label>Tags (comma separated)</label><input id="dTags" class="inp" value="${esc(t.tags.join(", "))}">
    <label>Depends on (finish these first)</label><select id="dDeps" class="sel" multiple size="${Math.min(6, Math.max(3, others.length))}">${others.map((o) => `<option value="${o.id}" ${(t.deps || []).includes(o.id) ? "selected" : ""}>${esc(o.title)}</option>`).join("")}</select>
    <label>Notes</label><textarea id="dNotes">${esc(t.notes)}</textarea>
    <label>Time log · ${S.formatDuration(S.loggedMs(t, -Infinity, Infinity, state.timer))} in ${t.log.length} sessions</label>
    <div class="tlist">${t.log.slice().reverse().slice(0, 8).map((e) => `<div class="it"><span>${new Date(e.start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><span class="d">${S.formatDuration(e.end - e.start)}</span></div>`).join("") || '<div class="hint">No sessions yet — press ▶ on the card.</div>'}</div>
    <div class="actions"><button id="dSave" class="btn">Save</button><button id="dClose" class="btn ghost">Close</button><span class="grow"></span><button id="dDel" class="btn danger">Delete</button></div>`;
  d.classList.add("on");
  $("#dClose").onclick = () => d.classList.remove("on");
  $("#dDel").onclick = async () => { if (confirm("Delete this task?")) { d.classList.remove("on"); await commit(S.removeTask(state, id), "Task deleted"); } };
  $("#dSave").onclick = async () => {
    const deps = [...$("#dDeps").selectedOptions].map((o) => o.value);
    let s = S.updateTask(state, id, {
      title: $("#dTitle").value.trim() || t.title, projectId: $("#dProj").value, priority: $("#dPrio").value,
      estimateH: Number($("#dEst").value) || 0, start: fromIso($("#dStart").value), due: fromIso($("#dDue").value),
      tags: $("#dTags").value.split(",").map((x) => x.trim()).filter(Boolean), notes: $("#dNotes").value, deps: [],
    });
    for (const dep of deps) {
      try { s = S.addDependency(s, id, dep); } catch { toast("Skipped a dependency that would create a cycle"); }
    }
    if ($("#dStatus").value !== t.status) s = S.moveTask(s, id, $("#dStatus").value);
    d.classList.remove("on");
    await commit(s, "Saved");
  };
}

// ------------------------------------------------------------------ timeline
function renderTimeline() {
  const { rows, min, max } = S.ganttRows(state, project);
  $("#tlTitle").textContent = project ? projName(project) : "All projects";
  const box = $("#timeline");
  if (!rows.length) { box.innerHTML = '<p class="hint" style="padding:16px">Give tasks a start or due date to see them here.</p>'; return; }
  const from = Math.min(min, S.startOfDay(Date.now())) - S.DAY, to = Math.max(max, S.startOfDay(Date.now()) + S.DAY) + 2 * S.DAY;
  const days = Math.round((to - from) / S.DAY);
  const L = 270, cw = 34, rh = 34, top = 46, W = L + days * cw + 10, H = top + rows.length * rh + 12;
  const X = (t) => L + ((t - from) / S.DAY) * cw;
  const colors = { doing: "#c6f432", todo: "#4cc9f0", done: "#4b5563", review: "#a78bfa", backlog: "#3b4656" };
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (let i = 0; i < days; i++) {
    const t = from + i * S.DAY, dt = new Date(t), x = L + i * cw;
    if (dt.getDay() === 0 || dt.getDay() === 6) svg += `<rect x="${x}" y="0" width="${cw}" height="${H}" class="wkend"/>`;
    svg += `<line x1="${x}" x2="${x}" y1="${top - 8}" y2="${H}" class="gridl"/>`;
    svg += `<text x="${x + cw / 2}" y="${top - 14}" text-anchor="middle" style="fill:${dt.getDay() === 0 || dt.getDay() === 6 ? "#5d6878" : "#8a96a8"};font-size:11px">${dt.getDate()}</text>`;
    if (dt.getDate() === 1 || i === 0) svg += `<text x="${x + 3}" y="16" style="font-weight:700;font-size:12px">${dt.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</text>`;
  }
  const pos = {};
  rows.forEach((r, i) => {
    const y = top + i * rh + 6, x0 = X(r.start), x1 = X(r.end);
    pos[r.id] = { x0, x1, y: y + 11 };
    const c = colors[r.status];
    svg += `<text x="12" y="${y + 15}" class="rowlab">${esc(r.title.length > 36 ? r.title.slice(0, 35) + "…" : r.title)}</text>`;
    svg += `<rect x="${x0 + 2}" y="${y}" width="${Math.max(8, x1 - x0 - 4)}" height="22" rx="6" fill="${c}" opacity="${r.status === "done" ? 0.55 : 0.28}"/>`;
    svg += `<rect x="${x0 + 2}" y="${y}" width="${Math.max(0, (x1 - x0 - 4) * r.progress)}" height="22" rx="6" fill="${c}"/>`;
    svg += `<text x="${x1 + 6}" y="${y + 15}" style="fill:#8a96a8;font-size:11px">${Math.round(r.progress * 100)} %</text>`;
  });
  rows.forEach((r) => r.deps.forEach((d) => {
    const a = pos[d], b = pos[r.id];
    if (!a || !b) return;
    const mx = Math.max(a.x1 + 8, b.x0 - 10);
    svg += `<path d="M${a.x1 - 2},${a.y} L${mx},${a.y} L${mx},${b.y} L${b.x0 + 2},${b.y}" class="arrow" marker-end="url(#ah)"/>`;
  }));
  const tx = X(Date.now());
  svg += `<line x1="${tx}" x2="${tx}" y1="${top - 8}" y2="${H}" class="today"/><text x="${tx + 4}" y="${top - 26}" style="fill:#ff6b6b;font-size:11px;font-weight:700">today</text>`;
  svg += `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#a78bfa"/></marker></defs></svg>`;
  box.innerHTML = svg;
}

// ---------------------------------------------------------------------- time
function weekLabel(ws) { return `${fmtDate(ws)} – ${fmtDate(ws + 6 * S.DAY)}, ${new Date(ws).getFullYear()}`; }

function renderTime() {
  const ref = Date.now() + weekOffset * 7 * S.DAY;
  const rep = S.weeklyReport(state, ref);
  $("#wkLabel").textContent = "Week of " + weekLabel(rep.weekStart);
  const labels = rep.days.map((d) => new Date(d).toLocaleDateString(undefined, { weekday: "short" }));
  const pids = state.projects.map((p) => p.id).filter((id) => !project || id === project);
  const series = pids.map((id) => ({ label: projName(id), color: projColor(id), values: rep.perDay.map((d) => (d[id] || 0) / S.HOUR) }));
  $("#timeBars").innerHTML = stackedBars(labels, series, { goal: state.settings.dailyGoalH || 6, height: 260 });
  const ws = rep.weekStart, we = ws + 7 * S.DAY;
  const items = [];
  for (const t of visibleTasks()) for (const e of t.log) if (e.end > ws && e.start < we) items.push({ t, e });
  items.sort((a, b) => b.e.start - a.e.start);
  $("#timeList").innerHTML = items.map(({ t, e }) => `<div class="it"><span class="dot" style="background:${projColor(t.projectId)}"></span><span>${esc(t.title)}</span><span class="d">${new Date(e.start).toLocaleDateString(undefined, { weekday: "short" })} ${new Date(e.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${S.formatDuration(e.end - e.start)}</span></div>`).join("") || '<p class="hint">No time tracked this week.</p>';
}

async function addManual() {
  const tasks = visibleTasks();
  if (!tasks.length) return toast("No tasks yet");
  const list = tasks.map((t, i) => `${i + 1}. ${t.title}`).join("\n");
  const k = Number(prompt("Which task?\n" + list, "1"));
  const t = tasks[k - 1];
  if (!t) return;
  const mins = Number(prompt("Minutes worked (ending now)", "60"));
  if (!(mins > 0)) return;
  await commit(S.addManualTime(state, t.id, Date.now() - mins * 60000, Date.now()), "Time added");
}

// -------------------------------------------------------------------- report
function renderReport() {
  const ref = Date.now() + reportOffset * 7 * S.DAY;
  const rep = S.weeklyReport(state, ref);
  $("#rpLabel").textContent = "Weekly report · " + weekLabel(rep.weekStart);
  const rate = rep.onTimeRate === null ? "–" : Math.round(rep.onTimeRate * 100) + " %";
  $("#kpis").innerHTML = [
    [S.formatDuration(rep.totalMs), "tracked this week"], [rep.done.length, "tasks completed"],
    [rate, "finished on or before the due date"], [rep.overdue.length, "overdue right now"]]
    .map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
  const items = Object.entries(rep.perProject).sort((a, b) => b[1] - a[1]).map(([id, ms]) => ({ label: projName(id), value: ms, color: projColor(id) }));
  $("#donut").innerHTML = donut(items, { center: (rep.totalMs / S.HOUR).toFixed(1) + " h", sub: "this week" });
  $("#donutLegend").innerHTML = items.map((it) => `<span><i style="background:${it.color}"></i>${esc(it.label)}<b>${S.formatDuration(it.value)}</b></span>`).join("");
  const labels = rep.days.map((d) => new Date(d).toLocaleDateString(undefined, { weekday: "short" }));
  $("#doneBars").innerHTML = stackedBars(labels, [{ label: "completed", color: "#c6f432", values: rep.doneByDay }], { unit: "tasks", width: 420, height: 250 });
  const sel = $("#bdProject");
  const cur = sel.value || project || state.projects[0]?.id;
  sel.innerHTML = state.projects.map((p) => `<option value="${p.id}" ${p.id === cur ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  if (cur) {
    const ts = state.tasks.filter((t) => t.projectId === cur);
    const from = Math.min(...ts.map((t) => t.start || t.createdAt), Date.now() - 14 * S.DAY);
    const to = Math.max(...ts.map((t) => t.due || 0), Date.now());
    const bd = S.burndown(state, cur, from, Math.min(to, Date.now()));
    const n = Math.round((to - S.startOfDay(from)) / S.DAY) + 1;
    const ideal = bd.series.map((_, i) => bd.total * (1 - i / Math.max(1, n - 1)));
    $("#burn").innerHTML = line(bd.series.map((p) => ({ x: new Date(p.day).getDate() + "", y: p.remaining })), { ideal, width: 440, height: 250, color: projColor(cur) });
  }
  $("#topTasks").innerHTML = rep.topTasks.map((t) => `<div class="it"><span class="dot" style="background:${projColor(t.projectId)}"></span><span>${esc(t.title)}</span><span class="barwrap"><i style="width:${(t.ms / rep.topTasks[0].ms) * 100}%;background:${projColor(t.projectId)}"></i></span><span class="d">${S.formatDuration(t.ms)}</span></div>`).join("") || '<p class="hint">Nothing tracked this week.</p>';
}

function reportMd() {
  return S.reportMarkdown(state, S.weeklyReport(state, Date.now() + reportOffset * 7 * S.DAY));
}

// ---------------------------------------------------------------- workspaces
function renderWorkspaces() {
  $("#wsProject").innerHTML = `<option value="">No project</option>` + state.projects.map((p) => `<option value="${p.id}" ${p.id === project ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  const box = $("#workspaces");
  const list = state.workspaces.filter((w) => !project || w.projectId === project);
  box.innerHTML = "";
  if (!list.length) box.innerHTML = '<p class="hint">No workspaces yet.</p>';
  for (const w of list) {
    const host = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
    const hue = (h) => `hsl(${[...h].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)} 55% 45%)`;
    const el = h(`<div class="ws" style="--c:${projColor(w.projectId)}"><h4>${esc(w.name)}</h4><div class="sub">${w.tabs.length} tabs · ${esc(projName(w.projectId) || "no project")} · saved ${fmtDate(w.savedAt)}</div>
      <ul>${w.tabs.slice(0, 7).map((t) => `<li><span class="fav" style="background:${hue(host(t.url))}">${esc((host(t.url).replace(/^www\./, "")[0] || "?").toUpperCase())}</span>${esc(t.title)}</li>`).join("")}${w.tabs.length > 7 ? `<li class="hint">+ ${w.tabs.length - 7} more</li>` : ""}</ul>
      <div class="row"><button class="btn open">Open in new window</button><button class="btn ghost del">Delete</button></div></div>`);
    el.querySelector(".open").onclick = () => chrome.runtime.sendMessage({ type: "openWorkspace", tabs: w.tabs });
    el.querySelector(".del").onclick = async () => { const s = JSON.parse(JSON.stringify(state)); s.workspaces = s.workspaces.filter((x) => x.id !== w.id); await commit(s, "Workspace deleted"); };
    box.append(el);
  }
}

async function saveWorkspace() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const keep = tabs.filter((t) => !t.url.startsWith(chrome.runtime.getURL("")));
  try {
    await commit(S.saveWorkspace(state, { name: $("#wsName").value.trim() || "Workspace " + (state.workspaces.length + 1), projectId: $("#wsProject").value || null, tabs: keep }), `Saved ${keep.length} tabs`);
    $("#wsName").value = "";
  } catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------ settings
function renderSettings() {
  $("#setWeek").value = String(state.settings.weekStart ?? 1);
  $("#setGoal").value = state.settings.dailyGoalH ?? 6;
}

// -------------------------------------------------------------------- render
function render() {
  document.querySelectorAll(".views a").forEach((a) => a.classList.toggle("on", a.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "view-" + view));
  renderSidebar();
  renderTimer();
  ({ board: renderBoard, timeline: renderTimeline, time: renderTime, report: renderReport, workspaces: renderWorkspaces, settings: renderSettings }[view] || renderBoard)();
}

function wire() {
  document.querySelectorAll(".views a").forEach((a) => (a.onclick = () => { view = a.dataset.view; location.hash = view; render(); }));
  $("#timerStop").onclick = () => commit(S.stopTimer(state), "Timer stopped");
  $("#quick").onkeydown = async (e) => {
    if (e.key !== "Enter" || !e.target.value.trim()) return;
    const q = S.parseQuickAdd(e.target.value, state.projects);
    const pid = q.projectId || project || state.projects[0]?.id;
    if (!pid) return toast("Create a project first");
    if (!q.title) return;
    await commit(S.addTask(state, { ...q, projectId: pid, status: "todo", start: q.due ? S.startOfDay(Date.now()) : null }), `Added to ${projName(pid)}`);
    e.target.value = "";
  };
  $("#addProject").onclick = async () => {
    const name = prompt("New project name");
    if (!name || !name.trim()) return;
    const s = S.addProject(state, { name, color: PALETTE[state.projects.length % PALETTE.length] });
    project = s.projects.at(-1).id;
    await commit(s, "Project created");
  };
  $("#wkPrev").onclick = () => { weekOffset--; render(); };
  $("#wkNext").onclick = () => { weekOffset++; render(); };
  $("#rpPrev").onclick = () => { reportOffset--; render(); };
  $("#rpNext").onclick = () => { reportOffset++; render(); };
  $("#addManual").onclick = addManual;
  $("#bdProject").onchange = () => renderReport();
  $("#copyMd").onclick = async () => { await navigator.clipboard.writeText(reportMd()); toast("Report copied as Markdown"); };
  $("#dlMd").onclick = () => download(`weekly-report-${new Date().toISOString().slice(0, 10)}.md`, reportMd(), "text/markdown");
  $("#wsSave").onclick = saveWorkspace;
  $("#setWeek").onchange = (e) => { const s = JSON.parse(JSON.stringify(state)); s.settings.weekStart = Number(e.target.value); commit(s, "Saved"); };
  $("#setGoal").onchange = (e) => { const s = JSON.parse(JSON.stringify(state)); s.settings.dailyGoalH = Number(e.target.value) || 6; commit(s, "Saved"); };
  $("#exportJson").onclick = () => download(`orbit-pm-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 1), "application/json");
  $("#importJson").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const x = JSON.parse(await f.text());
      const errs = S.validateState(x);
      if (errs.length) return toast("Not imported: " + errs[0]);
      if (confirm(`Replace your data with ${x.projects.length} projects and ${x.tasks.length} tasks from the file?`)) await commit({ ...S.emptyState(), ...x }, "Imported");
    } catch { toast("That file is not valid JSON"); }
  };
  $("#loadSample").onclick = async () => {
    if (state.tasks.length && !confirm("Replace your data with the sample projects?")) return;
    project = null;
    await commit(sampleState(), "Sample data loaded");
  };
  $("#clearAll").onclick = async () => { if (confirm("Delete all projects, tasks, time logs and workspaces?")) { project = null; await commit(S.emptyState(), "Everything deleted"); } };
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "n") { e.preventDefault(); newTask(); }
    if (e.key === "/") { e.preventDefault(); $("#quick").focus(); }
    if (e.key === "Escape") $("#drawer").classList.remove("on");
    const k = { 1: "board", 2: "timeline", 3: "time", 4: "report", 5: "workspaces" }[e.key];
    if (k) { view = k; location.hash = k; render(); }
  });
  setInterval(() => { if (state.timer) { renderTimer(); renderSidebar(); } }, 1000);
  onChange((s) => { state = s; render(); });
}

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

(async () => {
  state = await load();
  if (!state.projects.length && !localStorage.getItem("orbit_seen")) {
    localStorage.setItem("orbit_seen", "1");
    state = S.addProject(state, { name: "My first project", color: PALETTE[0] });
    await save(state);
  }
  wire();
  render();
})();
