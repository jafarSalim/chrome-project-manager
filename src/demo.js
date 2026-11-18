// A sample project so a new user sees every view filled in ("Load sample data" in Settings).
// Dates are relative to the moment it is loaded.
import { addProject, addTask, DAY, HOUR, emptyState, startOfDay, updateTask } from "./store.js";

export function sampleState(now = Date.now()) {
  const d0 = startOfDay(now);
  const day = (k, h = 0) => d0 + k * DAY + h * HOUR;
  let s = emptyState();
  s = addProject(s, { id: "p_thesis", name: "MSc thesis: VLC channel estimation", color: "#c6f432" });
  s = addProject(s, { id: "p_paper", name: "IEEE Access paper", color: "#4cc9f0" });
  s = addProject(s, { id: "p_lab", name: "Lab & teaching", color: "#ff8fab" });
  const T = [
    ["t1", "p_thesis", "Literature search: Scopus + IEEE Xplore", "done", "high", -16, -12, 10, ["research"]],
    ["t2", "p_thesis", "Build the VLC-OFDM simulator in MATLAB", "done", "high", -12, -6, 16, ["matlab"]],
    ["t3", "p_thesis", "Train CNN channel estimator", "doing", "urgent", -5, 2, 14, ["python", "dl"]],
    ["t4", "p_thesis", "Compare with LS / LMMSE baselines", "todo", "high", 2, 6, 8, ["matlab"]],
    ["t5", "p_thesis", "Write chapter 3: system model", "review", "medium", -6, -1, 9, ["writing"]],
    ["t6", "p_thesis", "Write chapter 4: results", "backlog", "medium", 6, 13, 12, ["writing"]],
    ["t7", "p_paper", "Draft abstract and introduction", "doing", "high", -3, 1, 5, ["writing"]],
    ["t8", "p_paper", "Make figures (BER, MSE, complexity)", "todo", "medium", 0, 4, 6, ["figures"]],
    ["t9", "p_paper", "Internal review with supervisor", "todo", "medium", 5, 7, 2, ["meeting"]],
    ["t10", "p_paper", "Submit to IEEE Access", "backlog", "urgent", 9, 9, 1, ["deadline"]],
    ["t11", "p_lab", "Grade lab reports, week 6", "done", "low", -4, -2, 3, ["teaching"]],
    ["t12", "p_lab", "Prepare MATLAB tutorial slides", "todo", "low", 1, 3, 3, ["teaching"]],
    ["t13", "p_lab", "Order photodiodes for the VLC testbed", "backlog", "medium", -2, -1, 0.5, ["lab"]],
  ];
  T.forEach(([id, p, title, status, priority, a, b, est, tags]) => {
    s = addTask(s, { id, projectId: p, title, status, priority, start: day(a), due: day(b), estimateH: est, tags });
  });
  s = updateTask(s, "t2", { deps: ["t1"] });
  s = updateTask(s, "t3", { deps: ["t2"] });
  s = updateTask(s, "t4", { deps: ["t3"] });
  s = updateTask(s, "t6", { deps: ["t4", "t5"] });
  s = updateTask(s, "t8", { deps: ["t4"] });
  s = updateTask(s, "t9", { deps: ["t7", "t8"] });
  s = updateTask(s, "t10", { deps: ["t9"] });
  // done dates and time logs (work sessions of 45–150 minutes over the last two weeks)
  const doneAt = { t1: day(-12, 17), t2: day(-5, 18), t11: day(-2, 15) };
  for (const [id, t] of Object.entries(doneAt)) s = updateTask(s, id, { doneAt: t });
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sessions = { t1: [-16, -12, 6], t2: [-12, -5, 9], t3: [-5, 0, 7], t5: [-6, -1, 5], t7: [-3, 0, 4], t11: [-4, -2, 2], t8: [0, 0, 1] };
  for (const [id, [a, b, n]] of Object.entries(sessions)) {
    const log = [];
    for (let k = 0; k < n; k++) {
      const dd = a + Math.floor(rnd() * (b - a + 1));
      const start = day(dd, 9 + Math.floor(rnd() * 8));
      const end = Math.min(start + (45 + Math.floor(rnd() * 105)) * 60000, now - 60000);
      if (end > start) log.push({ start, end });
    }
    s = updateTask(s, id, { log });
  }
  return s;
}
