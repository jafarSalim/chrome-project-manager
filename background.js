// Service worker: deadline reminders (chrome.alarms + notifications), the toolbar badge that
// shows the running timer, the keyboard shortcut, and restoring tab workspaces.
import { load, save } from "./src/storage.js";
import { remindersDue, startTimer, stopTimer, loggedMs, updateTask, HOUR } from "./src/store.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("deadlines", { periodInMinutes: 30 });
  chrome.alarms.create("badge", { periodInMinutes: 1 });
  refreshBadge();
});
chrome.runtime.onStartup.addListener(refreshBadge);

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === "badge") return refreshBadge();
  if (a.name === "deadlines") return checkDeadlines();
});

async function checkDeadlines() {
  let s = await load();
  const due = remindersDue(s, Date.now(), 24 * HOUR);
  for (const t of due) {
    const p = s.projects.find((x) => x.id === t.projectId);
    const late = t.due < Date.now();
    chrome.notifications.create("due_" + t.id, {
      type: "basic", iconUrl: "icons/icon128.png", priority: 2,
      title: late ? "Overdue: " + t.title : "Due within 24 h: " + t.title,
      message: `${p ? p.name : ""} · due ${new Date(t.due).toLocaleDateString()}`,
    });
    s = updateTask(s, t.id, { remindedAt: Date.now() });
  }
  if (due.length) await save(s);
}

chrome.notifications.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("app.html#board") }));

async function refreshBadge() {
  const s = await load();
  if (!s.timer) { chrome.action.setBadgeText({ text: "" }); return; }
  const t = s.tasks.find((x) => x.id === s.timer.taskId);
  const min = Math.floor((Date.now() - s.timer.start) / 60000);
  chrome.action.setBadgeBackgroundColor({ color: "#c6f432" });
  chrome.action.setBadgeTextColor?.({ color: "#0e1116" });
  chrome.action.setBadgeText({ text: min < 60 ? `${min}m` : `${Math.floor(min / 60)}h` });
  chrome.action.setTitle({ title: `Orbit PM — tracking: ${t ? t.title : ""}` });
}

chrome.storage.onChanged.addListener(() => refreshBadge());

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "toggle-timer") return;
  let s = await load();
  if (s.timer) s = stopTimer(s);
  else {
    const last = s.tasks.filter((t) => t.log.length).sort((a, b) => b.log.at(-1).end - a.log.at(-1).end)[0];
    if (last) s = startTimer(s, last.id);
  }
  await save(s);
});

// Messages from the pages: open a workspace in a new window.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "openWorkspace") {
    chrome.windows.create({ url: msg.tabs.map((t) => t.url) }, (w) => {
      msg.tabs.forEach((t, i) => { if (t.pinned && w.tabs[i]) chrome.tabs.update(w.tabs[i].id, { pinned: true }); });
      reply({ ok: true, windowId: w.id });
    });
    return true;
  }
  return false;
});

export { loggedMs };
