/* Browser-only: what the agent should know about the page Kevin is on.
   Uncaught errors are kept in a small ring buffer from the moment the chat
   widget mounts, so "this page is broken" arrives with the actual error. */
import type { PageContext } from "./protocol";

const MAX_ERRORS = 10;
const PHONE_MAX_WIDTH = 768;

const recentErrors: string[] = [];
let listening = false;

function remember(message: string): void {
  recentErrors.push(`${new Date().toLocaleTimeString()} ${message}`);
  if (recentErrors.length > MAX_ERRORS) recentErrors.shift();
}

function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Idempotent: safe to call from every mount. */
export function listenForPageErrors(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("error", (e) => remember(`${e.message} (${e.filename?.split("/").pop() ?? "?"}:${e.lineno})`));
  window.addEventListener("unhandledrejection", (e) => remember(`Unhandled rejection: ${reasonText(e.reason)}`));
}

export function collectPageContext(): PageContext {
  return {
    path: window.location.pathname,
    search: window.location.search,
    title: document.title,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    colorScheme: window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark",
    device: window.innerWidth < PHONE_MAX_WIDTH ? "phone" : "desktop",
    consoleErrors: [...recentErrors],
  };
}
