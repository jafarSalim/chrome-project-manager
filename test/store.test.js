import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../src/store.js";
import { donut, stackedBars, line } from "../src/charts.js";
import { sampleState } from "../src/demo.js";

const base = () => {
  let s = S.emptyState();
  s = S.addProject(s, { id: "p1", name: "Thesis" });
  s = S.addTask(s, { id: "a", projectId: "p1", title: "A", estimateH: 2 });
  s = S.addTask(s, { id: "b", projectId: "p1", title: "B" });
  s = S.addTask(s, { id: "c", projectId: "p1", title: "C" });
  return s;
};

test("pure updates never mutate the input", () => {
  const s = base();
  const before = JSON.stringify(s);
  S.moveTask(s, "a", "done");
  S.startTimer(s, "b", 1000);
  assert.equal(JSON.stringify(s), before);
});

test("moveTask renumbers both columns and stamps doneAt", () => {
  let s = S.moveTask(base(), "c", "todo", 0);
  assert.deepEqual(S.column(s, "p1", "todo").map((t) => t.id), ["c", "a", "b"]);
  s = S.moveTask(s, "a", "done", 0, 5000);
  assert.equal(s.tasks.find((t) => t.id === "a").doneAt, 5000);
  assert.deepEqual(S.column(s, "p1", "todo").map((t) => t.order), [0, 1]);
  s = S.moveTask(s, "a", "doing");
  assert.equal(s.tasks.find((t) => t.id === "a").doneAt, null);
});

test("one timer at a time; switching logs the previous session", () => {
  let s = S.startTimer(base(), "a", 0);
  assert.equal(s.tasks.find((t) => t.id === "a").status, "doing");
  s = S.startTimer(s, "b", 30 * 60000);
  assert.deepEqual(s.tasks.find((t) => t.id === "a").log, [{ start: 0, end: 30 * 60000 }]);
  s = S.stopTimer(s, 45 * 60000);
  assert.equal(s.timer, null);
  assert.equal(S.loggedMs(s.tasks.find((t) => t.id === "b")), 15 * 60000);
});

test("loggedMs clips sessions to a window and counts the running timer", () => {
  const t = { id: "x", log: [{ start: 0, end: 100 }, { start: 200, end: 300 }] };
  assert.equal(S.loggedMs(t, 50, 250), 100);
  assert.equal(S.loggedMs(t, -Infinity, Infinity, { taskId: "x", start: 400 }, 450), 250);
});

test("dependencies refuse cycles", () => {
  let s = S.addDependency(base(), "b", "a");
  s = S.addDependency(s, "c", "b");
  assert.throws(() => S.addDependency(s, "a", "c"), /cycle/);
  assert.throws(() => S.addDependency(s, "a", "a"), /cycle/);
});

test("removing a task cleans dependencies and the timer", () => {
  let s = S.addDependency(base(), "b", "a");
  s = S.startTimer(s, "a", 0);
  s = S.removeTask(s, "a");
  assert.equal(s.timer, null);
  assert.deepEqual(s.tasks.find((t) => t.id === "b").deps, []);
});

test("due states", () => {
  const now = new Date(2026, 10, 19, 12).getTime();
  const day = 86400000;
  const mk = (due, status = "todo") => ({ due, status });
  assert.equal(S.dueState(mk(now - day)), "overdue");
  assert.equal(S.dueState(mk(now + 3600000)), "today");
  assert.equal(S.dueState(mk(now + 2 * day)), "soon");
  assert.equal(S.dueState(mk(now + 5 * day)), "later");
  assert.equal(S.dueState(mk(now - day, "done")), "none");
});

test("quick add parses project, priority, tags, estimate and due date", () => {
  const now = new Date(2026, 10, 19, 10).getTime();          // a Thursday
  const q = S.parseQuickAdd("Write chapter 4 #thesis !high @writing ~3.5h due:fri", [{ id: "p1", name: "Thesis" }], now);
  assert.equal(q.title, "Write chapter 4");
  assert.equal(q.projectId, "p1");
  assert.equal(q.priority, "high");
  assert.deepEqual(q.tags, ["writing"]);
  assert.equal(q.estimateH, 3.5);
  assert.equal(new Date(q.due).getDay(), 5);
  assert.equal(S.parseQuickAdd("x due:tomorrow", [], now).due, S.startOfDay(now) + 86400000);
});

test("weekly report adds up", () => {
  const now = new Date(2026, 10, 19, 18).getTime();
  const s = sampleState(now);
  const rep = S.weeklyReport(s, now, now);
  const sumDays = rep.perDay.reduce((a, d) => a + Object.values(d).reduce((x, y) => x + y, 0), 0);
  assert.equal(Math.round(sumDays), Math.round(rep.totalMs));
  assert.equal(rep.doneByDay.reduce((a, b) => a + b, 0), rep.done.length);
  const md = S.reportMarkdown(s, rep);
  assert.match(md, /^# Weekly report/);
  assert.match(md, /## Time per project/);
});

test("burndown decreases as tasks are done", () => {
  const now = new Date(2026, 10, 19, 18).getTime();
  const s = sampleState(now);
  const b = S.burndown(s, "p_thesis", now - 20 * 86400000, now);
  const r = b.series.map((p) => p.remaining);
  assert.equal(r[0], b.total);
  for (let i = 1; i < r.length; i++) assert.ok(r[i] <= r[i - 1]);
  assert.ok(r.at(-1) < b.total);
});

test("gantt rows are sorted and carry progress", () => {
  const s = sampleState(new Date(2026, 10, 19).getTime());
  const g = S.ganttRows(s, "p_thesis");
  assert.equal(g.rows.length, 6);
  for (let i = 1; i < g.rows.length; i++) assert.ok(g.rows[i].start >= g.rows[i - 1].start);
  assert.ok(g.rows.every((r) => r.progress >= 0 && r.progress <= 1));
});

test("workspaces keep only web tabs; import validation", () => {
  let s = base();
  s = S.saveWorkspace(s, { name: "Reading", projectId: "p1", tabs: [{ url: "https://arxiv.org/abs/1", title: "Paper" }, { url: "chrome://settings", title: "x" }] });
  assert.equal(s.workspaces[0].tabs.length, 1);
  assert.deepEqual(S.validateState(s), []);
  assert.ok(S.validateState({ projects: [], tasks: [{ id: "t", title: "x", projectId: "nope", status: "todo" }], workspaces: [] }).length);
});

test("charts render valid-looking SVG", () => {
  assert.match(donut([{ label: "a", value: 2, color: "#f00" }, { label: "b", value: 1, color: "#0f0" }], { center: "3 h" }), /^<svg[\s\S]*<path[\s\S]*<\/svg>$/);
  assert.equal((stackedBars(["M", "T"], [{ label: "p", color: "#f00", values: [1, 2] }]).match(/<rect/g) || []).length, 2);
  assert.match(line([{ x: "1", y: 3 }, { x: "2", y: 1 }], { ideal: [3, 0] }), /polyline/);
});
