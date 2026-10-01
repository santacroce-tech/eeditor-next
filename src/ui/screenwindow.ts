// Open a form's screen control in a window of its own (screen.html), over the same engine: a
// native window in the app, a browser window otherwise. The form's screen waits while it's open.

import { inTauri } from "../engine/workspace";
import type { ScreenWindow } from "./screenview";

let opened = 0;

export function openScreenWindow(expr: string, title: string): ScreenWindow {
  const url = `screen.html?${new URLSearchParams({ expr, title })}`;
  if (inTauri()) return nativeWindow(url, title);
  const w = window.open(url, `screen-${++opened}`, "popup,width=820,height=660");
  if (!w) return { closed: Promise.resolve(), close: () => {}, focus: () => {} };
  const closed = new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      if (!w.closed) return;
      clearInterval(poll);
      resolve();
    }, 400);
  });
  return { closed, close: () => w.close(), focus: () => w.focus() };
}

function nativeWindow(url: string, title: string): ScreenWindow {
  let resolveClosed = () => {};
  const closed = new Promise<void>((r) => (resolveClosed = r));
  const made = import("@tauri-apps/api/webviewWindow").then(({ WebviewWindow }) => {
    const w = new WebviewWindow(`screen-${Date.now()}-${++opened}`, {
      url,
      title,
      width: 820,
      height: 660,
      minWidth: 320,
      minHeight: 260,
      resizable: true,
    });
    void w.once("tauri://destroyed", () => resolveClosed());
    void w.once("tauri://error", () => resolveClosed()); // it never opened
    return w;
  });
  made.catch(() => resolveClosed());
  return {
    closed,
    close: () => void made.then((w) => w.close()).catch(() => resolveClosed()),
    focus: () => void made.then((w) => w.setFocus()).catch(() => {}),
  };
}
