import * as S from "./store.js";
import { load, save, onChange } from "./storage.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let state = S.emptyState();

const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

function render() {
  const tb = $("#timer");
  if (state.timer) {
    const t = state.tasks.find((x) => x.id === state.timer.taskId);
    tb.className = "timer run";
    $("#tTask").textContent = t ? t.title : "";
    $("#tTime").textContent = clock(Date.now() - state.timer.start);
  } else {
    tb.className = "timer idle";
    $("#tTask").textContent = "No timer running";
    $("#tTime").textContent = "0:00:00";
  }
  const now = Date.now();
  const rank = { overdue: 0, today: 1, soon: 2 };
  const items = state.tasks.filter((t) => t.status === "doing" || ["overdue", "today", "soon"].includes(S.dueState(t, now)))
    .filter((t) => t.status !== "done")
    .sort((a, b) => (rank[S.dueState(a, now)] ?? 3) - (rank[S.dueState(b, now)] ?? 3));
  const color = (id) => state.projects.find((p) => p.id === id)?.color || "#8a96a8";
  $("#list").innerHTML = items.map((t) => {
    const ds = S.dueState(t, now);
    const label = ds === "overdue" ? `overdue · ${new Date(t.due).toLocaleDateString()}` : ds === "today" ? "due today" : t.due ? "due " + new Date(t.due).toLocaleDateString() : "in progress";
    const on = state.timer?.taskId === t.id;
    return `<div class="it" style="--c:${color(t.projectId)}"><div class="t"><div>${esc(t.title)}</div><span class="s ${ds === "overdue" ? "over" : ds}">${label} · ${S.formatDuration(S.loggedMs(t, -Infinity, Infinity, state.timer))}</span></div><button class="play ${on ? "on" : ""}" data-id="${t.id}">${on ? "■" : "▶"}</button></div>`;
  }).join("") || '<div class="empty">Nothing due. Nice.</div>';
  document.querySelectorAll(".play").forEach((b) => (b.onclick = async () => {
    state = state.timer?.taskId === b.dataset.id ? S.stopTimer(state) : S.startTimer(state, b.dataset.id);
    await save(state);
    render();
  }));
  const d0 = S.startOfDay(now);
  $("#todayTotal").textContent = "Today: " + S.formatDuration(state.tasks.reduce((a, t) => a + S.loggedMs(t, d0, d0 + S.DAY, state.timer, now), 0));
}

$("#openApp").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("app.html#board") });
$("#tStop").onclick = async () => { state = S.stopTimer(state); await save(state); render(); };
$("#quick").onkeydown = async (e) => {
  if (e.key !== "Enter" || !e.target.value.trim()) return;
  const q = S.parseQuickAdd(e.target.value, state.projects);
  const pid = q.projectId || state.projects[0]?.id;
  if (!pid || !q.title) return;
  state = S.addTask(state, { ...q, projectId: pid, status: "todo" });
  await save(state);
  e.target.value = "";
  render();
};
onChange((s) => { state = s; render(); });
(async () => { state = await load(); render(); setInterval(render, 1000); })();
