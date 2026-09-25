// A screen control in a window of its own (screen.html): the picture fills the window and scales
// with it, ⛶ takes the display, ⌨ opens the keyboard. It talks to the same engine as the app that
// opened it, so the machine is the same one — the form keeps it; this page only shows it.

import { createEngineClient } from "./engine/client";
import { createScreenView } from "./ui/screenview";
import "./styles.css";

const q = new URLSearchParams(location.search);
const expr = q.get("expr") ?? "";
document.title = q.get("title") || "Spectrum";

const engine = createEngineClient();
const host = document.getElementById("app")!;
const problem = document.createElement("div");
problem.className = "screen-window-problem";
problem.hidden = true;

const view = createScreenView(host, {
  expr,
  running: true,
  fill: true,
  frame: async (src) => {
    const env = await engine.evalSrc(src);
    if (!env.ok) throw new Error(env.error);
    return env.result;
  },
  onError: (message) => {
    problem.textContent = message;
    problem.hidden = false;
  },
});
host.append(problem);
view.focus();
