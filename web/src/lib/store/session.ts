/** Session helpers for the zustand store (Phase 2 split of lib/store.ts). */
import type { ChatEntry } from "./types";

let _id = 0;
export const nextId = () => `${Date.now().toString(36)}-${(_id++).toString(36)}`;

const BOOT_GREETING_RE =
  /^Good (morning|afternoon|evening), sir\. All systems are online and at your service\.$/;

export function isBootGreeting(entry: ChatEntry) {
  return entry.role === "assistant" && BOOT_GREETING_RE.test(entry.text.trim());
}

export function cleanupChatHistory(chat: ChatEntry[]) {
  let seenBoot = false;
  let lastOnlineIdx = -1;
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i].role === "info" && chat[i].text.includes("online —")) {
      lastOnlineIdx = i;
      break;
    }
  }
  return chat.filter((entry, idx) => {
    if (isBootGreeting(entry)) {
      if (seenBoot) return false;
      seenBoot = true;
      return true;
    }
    if (entry.role === "info" && entry.text.includes("online —")) {
      return idx === lastOnlineIdx;
    }
    return true;
  });
}

// Session archive. On a cold launch — reboot or app relaunch — the previous
// session is stashed under PREV_SESSION_KEY instead of auto-reopening. We tell
// a cold launch from an in-app reload via SESSION_ALIVE_KEY: sessionStorage is
// wiped when the renderer process dies (quit / reboot) but survives a reload.
export const PREV_SESSION_KEY = "jarvis.session.prev.v1";
export const SESSION_ALIVE_KEY = "jarvis.session.alive";
