// Orbit PM — data model. Pure functions only: every function takes a state object and
// returns a new one (or a derived value). No DOM, no chrome.* — so it runs in Node tests.
//
// state = { version, projects: [], tasks: [], workspaces: [], timer: null | {taskId, start},
//           settings: { weekStart: 1, dailyGoalH: 6 } }

export const STATUSES = ["backlog", "todo", "doing", "review", "done"];
export const STATUS_LABEL = { backlog: "Backlog", todo: "To do", doing: "In progress", review: "Review", done: "Done" };
export const PRIORITIES = ["low", "medium", "high", "urgent"];
export const DAY = 86400000;
export const HOUR = 3600000;

export function emptyState() {
  return { version: 1, projects: [], tasks: [], workspaces: [], timer: null,
           settings: { weekStart: 1, dailyGoalH: 6 } };
}

export function uid(prefix = "id") {
  return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

const clone = (s) => JSON.parse(JSON.stringify(s));

// ------------------------------------------------------------------ projects
export function addProject(state, { name, color = "#c6f432", id = uid("p") }) {
  if (!name || !name.trim()) throw new Error("project name is required");
  const s = clone(state);
  s.projects.push({ id, name: name.trim(), color, createdAt: Date.now(), archived: false });
  return s;
}

export function removeProject(state, projectId) {
  const s = clone(state);
  s.projects = s.projects.filter((p) => p.id !== projectId);
  const gone = new Set(s.tasks.filter((t) => t.projectId === projectId).map((t) => t.id));
  s.tasks = s.tasks.filter((t) => t.projectId !== projectId)
    .map((t) => ({ ...t, deps: (t.deps || []).filter((d) => !gone.has(d)) }));
  s.workspaces = s.workspaces.filter((w) => w.projectId !== projectId);
  if (s.timer && gone.has(s.timer.taskId)) s.timer = null;
  return s;
}

// --------------------------------------------------------------------- tasks
export function addTask(state, t) {
  if (!t.title || !t.title.trim()) throw new Error("task title is required");
  if (!state.projects.some((p) => p.id === t.projectId)) throw new Error("unknown project");
  const s = clone(state);
  const task = {
    id: t.id || uid("t"), projectId: t.projectId, title: t.title.trim(), notes: t.notes || "",
    status: STATUSES.includes(t.status) ? t.status : "todo",
    priority: PRIORITIES.includes(t.priority) ? t.priority : "medium",
    tags: t.tags || [], start: t.start || null, due: t.due || null,
    estimateH: Number(t.estimateH) || 0, deps: t.deps || [], log: t.log || [],
    order: t.order ?? s.tasks.filter((x) => x.status === (t.status || "todo")).length,
    createdAt: t.createdAt || Date.now(), doneAt: t.status === "done" ? (t.doneAt || Date.now()) : null,
  };
  s.tasks.push(task);
  return s;
}

export function updateTask(state, id, patch) {
  const s = clone(state);
  const t = s.tasks.find((x) => x.id === id);
  if (!t) throw new Error("unknown task " + id);
  Object.assign(t, patch);
  if (patch.status === "done" && !t.doneAt) t.doneAt = Date.now();
  if (patch.status && patch.status !== "done") t.doneAt = null;
  return s;
}

export function removeTask(state, id) {
  const s = clone(state);
  s.tasks = s.tasks.filter((t) => t.id !== id).map((t) => ({ ...t, deps: (t.deps || []).filter((d) => d !== id) }));
  if (s.timer && s.timer.taskId === id) s.timer = null;
  return s;
}

// Move a card to a column at a position; renumbers the order of both columns.
export function moveTask(state, id, status, index = Infinity, now = Date.now()) {
  if (!STATUSES.includes(status)) throw new Error("unknown status " + status);
  let s = clone(state);
  const t = s.tasks.find((x) => x.id === id);
  if (!t) throw new Error("unknown task " + id);
  const from = t.status;
  t.status = status;
  t.doneAt = status === "done" ? (from === "done" ? t.doneAt : now) : null;
  const col = s.tasks.filter((x) => x.status === status && x.id !== id && x.projectId === t.projectId)
    .sort((a, b) => a.order - b.order);
  col.splice(Math.max(0, Math.min(index, col.length)), 0, t);
  col.forEach((x, i) => (x.order = i));
  s.tasks.filter((x) => x.status === from && x.projectId === t.projectId && from !== status)
    .sort((a, b) => a.order - b.order).forEach((x, i) => (x.order = i));
  return s;
}

export function column(state, projectId, status) {
  return state.tasks.filter((t) => t.status === status && (!projectId || t.projectId === projectId))
    .sort((a, b) => a.order - b.order);
}

// Dependencies: is `blocker` (transitively) required by `task`? Used to refuse cycles.
export function wouldCycle(state, taskId, depId) {
  const byId = Object.fromEntries(state.tasks.map((t) => [t.id, t]));
  const stack = [depId];
  const seen = new Set();
  while (stack.length) {
    const x = stack.pop();
    if (x === taskId) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    (byId[x]?.deps || []).forEach((d) => stack.push(d));
  }
  return false;
}

export function addDependency(state, taskId, depId) {
  if (taskId === depId || wouldCycle(state, taskId, depId)) throw new Error("dependency would create a cycle");
  const t = state.tasks.find((x) => x.id === taskId);
  return updateTask(state, taskId, { deps: [...new Set([...(t.deps || []), depId])] });
}

// ---------------------------------------------------------------- time tracking
// One timer at a time. Starting a timer stops the running one and logs it.
export function startTimer(state, taskId, now = Date.now()) {
  let s = state.timer ? stopTimer(state, now) : clone(state);
  if (!s.tasks.some((t) => t.id === taskId)) throw new Error("unknown task " + taskId);
  s.timer = { taskId, start: now };
  const t = s.tasks.find((x) => x.id === taskId);
  if (t.status === "todo" || t.status === "backlog") s = moveTask(s, taskId, "doing", Infinity, now);
  return s;
}

export function stopTimer(state, now = Date.now()) {
  const s = clone(state);
  if (!s.timer) return s;
  const t = s.tasks.find((x) => x.id === s.timer.taskId);
  if (t && now > s.timer.start) t.log.push({ start: s.timer.start, end: now });
  s.timer = null;
  return s;
}

export function addManualTime(state, taskId, start, end) {
  if (!(end > start)) throw new Error("end must be after start");
  const s = clone(state);
  s.tasks.find((t) => t.id === taskId).log.push({ start, end });
  return s;
}

// Milliseconds logged on a task within [from, to) (running timer included).
export function loggedMs(task, from = -Infinity, to = Infinity, timer = null, now = Date.now()) {
  let ms = 0;
  const entries = [...(task.log || [])];
  if (timer && timer.taskId === task.id) entries.push({ start: timer.start, end: now });
  for (const e of entries) {
    const a = Math.max(e.start, from), b = Math.min(e.end, to);
    if (b > a) ms += b - a;
  }
  return ms;
}

export function formatDuration(ms) {
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

// ------------------------------------------------------------------ deadlines
export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dueState(task, now = Date.now()) {
  if (!task.due || task.status === "done") return "none";
  const d = startOfDay(task.due), today = startOfDay(now);
  if (d < today) return "overdue";
  if (d === today) return "today";
  if (d - today <= 2 * DAY) return "soon";
  return "later";
}

// Tasks whose deadline reminder is due: due within `withinMs` and not yet reminded.
export function remindersDue(state, now = Date.now(), withinMs = DAY) {
  return state.tasks.filter((t) => t.due && t.status !== "done" && !t.remindedAt &&
    t.due - now <= withinMs);
}

// ------------------------------------------------------------------ weeks
export function weekStart(t, weekStartDay = 1) {
  const d = new Date(startOfDay(t));
  const diff = (d.getDay() - weekStartDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

// Weekly report: hours per project and per day, tasks done, on-time rate, overdue.
export function weeklyReport(state, anyTimeInWeek = Date.now(), now = Date.now()) {
  const ws = weekStart(anyTimeInWeek, state.settings?.weekStart ?? 1);
  const we = ws + 7 * DAY;
  const days = Array.from({ length: 7 }, (_, i) => ws + i * DAY);
  const perProject = {};
  const perDay = days.map(() => ({}));
  for (const t of state.tasks) {
    for (let i = 0; i < 7; i++) {
      const ms = loggedMs(t, days[i], days[i] + DAY, state.timer, now);
      if (ms > 0) {
        perDay[i][t.projectId] = (perDay[i][t.projectId] || 0) + ms;
        perProject[t.projectId] = (perProject[t.projectId] || 0) + ms;
      }
    }
  }
  const done = state.tasks.filter((t) => t.doneAt && t.doneAt >= ws && t.doneAt < we);
  const withDue = done.filter((t) => t.due);
  const onTime = withDue.filter((t) => startOfDay(t.doneAt) <= startOfDay(t.due)).length;
  const doneByDay = days.map((d) => done.filter((t) => t.doneAt >= d && t.doneAt < d + DAY).length);
  const overdue = state.tasks.filter((t) => dueState(t, now) === "overdue");
  const totalMs = Object.values(perProject).reduce((a, b) => a + b, 0);
  const topTasks = state.tasks.map((t) => ({ id: t.id, title: t.title, projectId: t.projectId,
    ms: loggedMs(t, ws, we, state.timer, now) })).filter((x) => x.ms >= 60000).sort((a, b) => b.ms - a.ms).slice(0, 5);
  return { weekStart: ws, days, perProject, perDay, done, doneByDay, totalMs,
           onTimeRate: withDue.length ? onTime / withDue.length : null, overdue, topTasks };
}

// Remaining estimated hours per day of a project (burndown) from `from` to `to`.
export function burndown(state, projectId, from, to) {
  const tasks = state.tasks.filter((t) => t.projectId === projectId);
  const total = tasks.reduce((a, t) => a + (t.estimateH || 0), 0);
  const out = [];
  for (let d = startOfDay(from); d <= to; d += DAY) {
    const doneH = tasks.filter((t) => t.doneAt && t.doneAt < d + DAY).reduce((a, t) => a + (t.estimateH || 0), 0);
    out.push({ day: d, remaining: total - doneH });
  }
  return { total, series: out };
}

export function reportMarkdown(state, rep) {
  const name = (id) => state.projects.find((p) => p.id === id)?.name || "?";
  const d = (t) => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  const lines = [`# Weekly report ${d(rep.weekStart)} – ${d(rep.weekStart + 6 * DAY)}`, "",
    `**Tracked:** ${formatDuration(rep.totalMs)} · **Completed:** ${rep.done.length} task${rep.done.length === 1 ? "" : "s"} · ` +
    `**On time:** ${rep.onTimeRate === null ? "–" : Math.round(rep.onTimeRate * 100) + " %"} · **Overdue:** ${rep.overdue.length}`, "",
    "## Time per project", ""];
  for (const [p, ms] of Object.entries(rep.perProject).sort((a, b) => b[1] - a[1])) lines.push(`- ${name(p)}: ${formatDuration(ms)}`);
  lines.push("", "## Completed", "");
  for (const t of rep.done) lines.push(`- [x] ${t.title} (${name(t.projectId)})`);
  if (rep.overdue.length) {
    lines.push("", "## Overdue", "");
    for (const t of rep.overdue) lines.push(`- [ ] ${t.title}, due ${d(t.due)} (${name(t.projectId)})`);
  }
  return lines.join("\n") + "\n";
}

// ------------------------------------------------------------------ timeline
// Gantt layout: one row per task that has dates, sorted by start; bars in day units.
export function ganttRows(state, projectId) {
  const tasks = state.tasks.filter((t) => (!projectId || t.projectId === projectId) && (t.start || t.due));
  const rows = tasks.map((t) => {
    const start = startOfDay(t.start || t.due);
    const end = startOfDay(t.due || t.start) + DAY;
    const est = (t.estimateH || 0) * HOUR;
    const progress = t.status === "done" ? 1 : est ? Math.min(1, loggedMs(t, -Infinity, Infinity, state.timer) / est) : 0;
    return { id: t.id, title: t.title, status: t.status, start, end, progress, deps: t.deps || [], priority: t.priority };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const min = rows.length ? Math.min(...rows.map((r) => r.start)) : startOfDay(Date.now());
  const max = rows.length ? Math.max(...rows.map((r) => r.end)) : min + 14 * DAY;
  return { rows, min, max };
}

// --------------------------------------------------------------- workspaces
export function saveWorkspace(state, { name, projectId, tabs }) {
  if (!tabs || !tabs.length) throw new Error("no tabs to save");
  const s = clone(state);
  s.workspaces.push({ id: uid("w"), name: name || "Workspace", projectId: projectId || null,
    tabs: tabs.filter((t) => /^https?:|^file:/.test(t.url)).map((t) => ({ url: t.url, title: t.title || t.url, pinned: !!t.pinned })),
    savedAt: Date.now() });
  return s;
}

// ---------------------------------------------------------------- quick add
// "Write chapter 3 #thesis !high due:2026-11-25 ~4h @writing"
export function parseQuickAdd(text, projects, now = Date.now()) {
  let title = text;
  const out = { priority: "medium", tags: [], projectId: null, due: null, estimateH: 0 };
  title = title.replace(/#([\w-]+)/g, (_, p) => {
    const m = projects.find((x) => x.name.toLowerCase().replace(/\s+/g, "-").startsWith(p.toLowerCase()));
    if (m) out.projectId = m.id;
    return "";
  });
  title = title.replace(/!(low|medium|high|urgent)\b/i, (_, p) => { out.priority = p.toLowerCase(); return ""; });
  title = title.replace(/@([\w-]+)/g, (_, t) => { out.tags.push(t); return ""; });
  title = title.replace(/~(\d+(?:\.\d+)?)h\b/i, (_, h) => { out.estimateH = Number(h); return ""; });
  title = title.replace(/due:(\S+)/i, (_, d) => {
    const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const k = d.toLowerCase();
    if (k === "today") out.due = startOfDay(now);
    else if (k === "tomorrow") out.due = startOfDay(now) + DAY;
    else if (days.includes(k.slice(0, 3))) {
      const want = days.indexOf(k.slice(0, 3)), cur = new Date(now).getDay();
      out.due = startOfDay(now) + (((want - cur + 7) % 7) || 7) * DAY;
    } else {
      const t = Date.parse(d);
      if (!isNaN(t)) out.due = startOfDay(t + new Date(t).getTimezoneOffset() * 60000);
    }
    return "";
  });
  out.title = title.replace(/\s+/g, " ").trim();
  return out;
}

// ------------------------------------------------------------- import/export
export function validateState(x) {
  const errs = [];
  if (!x || typeof x !== "object") return ["not an object"];
  for (const k of ["projects", "tasks", "workspaces"]) if (!Array.isArray(x[k])) errs.push(`${k} must be a list`);
  if (errs.length) return errs;
  const pids = new Set(x.projects.map((p) => p.id));
  x.tasks.forEach((t, i) => {
    if (!t.id || !t.title) errs.push(`task ${i}: id and title required`);
    if (!pids.has(t.projectId)) errs.push(`task ${i}: unknown project`);
    if (!STATUSES.includes(t.status)) errs.push(`task ${i}: bad status`);
  });
  return errs;
}
