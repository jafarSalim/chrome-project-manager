// Persistence: chrome.storage.local in the extension, localStorage when the page is opened
// outside the extension (for development). One key holds the whole state.
import { emptyState } from "./store.js";

const KEY = "orbit_state_v1";
const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

export async function load() {
  if (hasChrome) {
    const r = await chrome.storage.local.get(KEY);
    return r[KEY] || emptyState();
  }
  try { return JSON.parse(localStorage.getItem(KEY)) || emptyState(); } catch { return emptyState(); }
}

export async function save(state) {
  if (hasChrome) return chrome.storage.local.set({ [KEY]: state });
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

export function onChange(fn) {
  if (hasChrome) chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch[KEY]) fn(ch[KEY].newValue); });
}

export const STORAGE_KEY = KEY;
