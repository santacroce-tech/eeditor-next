// Hosting running forms: who each one is, what `(ui-open …)` opens and where, and how a public
// variable written in one reaches the others. The app (main.ts) and a form exported as a page
// (runtime.ts) both run forms through this; what differs between them — where a form's text comes
// from, what a window is, how a message is shown — they pass in.

import { FORM_EXT, isFormPath, readFormSpec, type FormSpec, type StateValue } from "../core/form";
import { identityState, newFormId, type FormClient, type FormIdentity } from "../engine/form";
import { createFormRunner, type FormRunner, type FormRunnerOptions } from "../ui/formrun";

const parentDir = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
const basename = (p: string): string => p.split("/").pop() ?? p;

export interface FormHostOptions {
  forms: FormClient;
  /** A form's text by its path. Rejects when it can't be read. */
  read(path: string): Promise<string>;
  /** Whether there is a form at `path` — how a name is found beside the form that asks for it. */
  exists(path: string): boolean;
  /** What a runner of the form at `path` needs besides the forms: images, sheets, messages, output. */
  runnerOptions(path: string): Pick<FormRunnerOptions, "imageUrl" | "sheetView" | "onMessage" | "onError" | "note">;
  /** Tell the person why something didn't happen. */
  say(message: string): void;
  /** A form's file didn't load; the engine's message. (The app also notes it in the REPL.) */
  loadFailed?(path: string, message: string): void;
  /** `(ui-open "X")` with no frame: the host shows X somewhere of its own — a window. */
  openWindow(path: string, opener: FormIdentity): void;
}

export interface FormHost {
  /** Read, check and load a form, so its handlers exist; null — having said why — when it can't run. */
  prepare(path: string): Promise<{ spec: FormSpec } | null>;
  /**
   * Who a form about to run is. Opened by another form, it joins that form's main and shares its
   * public variables; otherwise it is a main of its own, and its title names the app.
   */
  identity(key: string, title: string, opener?: FormIdentity): FormIdentity;
  /** What every hosted form's runner shares: its identity on each call, ui-open, public variables, clean-up. */
  wire(id: FormIdentity): Pick<FormRunnerOptions, "call" | "check" | "onOpen" | "onPublic" | "onDestroy">;
  /** A form is running: remember it, for public variables and frames. */
  track(id: FormIdentity, runner: FormRunner): void;
  /** `(ui-open "Orders" :in "frmBody")`: run Orders inside that frame, as one more form of the same main. */
  openInFrame(path: string, frame: string, opener: FormIdentity, copy: boolean): Promise<void>;
  /**
   * The file `(ui-open "Orders")` means: beside the form that asked, when there is one there — so an
   * app's forms name each other wherever its folder is — else from the top.
   */
  resolve(ref: string, opener: FormIdentity): string;
}

export function createFormHost(o: FormHostOptions): FormHost {
  /** Every form running now, by its id. */
  const running = new Map<string, { runner: FormRunner; id: FormIdentity }>();

  async function prepare(p: string): Promise<{ spec: FormSpec } | null> {
    let src: string;
    try {
      src = await o.read(p);
    } catch (e) {
      o.say(`Could not open ${p}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    const r = readFormSpec(src);
    if ("error" in r) {
      o.say(`${basename(p)} can't run: ${r.error}`);
      return null;
    }
    try {
      await o.forms.load(src, p);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      o.loadFailed?.(p, m);
      o.say(`${basename(p)} can't run: ${m}`);
      return null;
    }
    return { spec: r.spec };
  }

  function identity(key: string, title: string, opener?: FormIdentity): FormIdentity {
    const form = newFormId();
    return opener ? { form, main: opener.main, key, app: opener.app } : { form, main: form, key, app: title };
  }

  function resolve(ref: string, opener: FormIdentity): string {
    const name = isFormPath(ref) ? ref : ref + FORM_EXT;
    const near = joinPath(parentDir(opener.key), name);
    return o.exists(near) || !o.exists(name) ? near : name;
  }

  function wire(id: FormIdentity): Pick<FormRunnerOptions, "call" | "check" | "onOpen" | "onPublic" | "onDestroy"> {
    const who = identityState(id);
    return {
      call: (handler: string, state: Record<string, StateValue>) => o.forms.call(handler, { ...state, ...who }),
      check: (handler: string, state: Record<string, StateValue>) => o.forms.check(handler, { ...state, ...who }),
      onOpen: (other, how) => {
        const p = resolve(other, id);
        if (how?.into) void openInFrame(p, how.into, id, how.copy === true);
        else o.openWindow(p, id);
      },
      // A public variable written here: every other form of the same main hears of it.
      onPublic: (name) => {
        for (const [other, r] of running) if (other !== id.form && r.id.main === id.main) r.runner.publicChanged(name);
      },
      onDestroy: () => {
        running.delete(id.form);
        void o.forms.forget(id.form).catch(() => {});
      },
    };
  }

  /**
   * The frame called `name` a form means by `(ui-open … :in name)`: its own, else its main form's, else
   * any form's under the same main — so a form shown in the frame can open another beside it.
   */
  function frameHost(name: string, opener: FormIdentity): FormRunner | undefined {
    const candidates = [running.get(opener.form), running.get(opener.main), ...running.values()];
    return candidates.find((r) => r && r.id.main === opener.main && r.runner.hasFrame(name))?.runner;
  }

  async function openInFrame(path: string, frame: string, opener: FormIdentity, copy: boolean): Promise<void> {
    const p = isFormPath(path) ? path : path + FORM_EXT;
    const host = frameHost(frame, opener);
    if (!host) return o.say(`There is no frame called "${frame}" to open ${basename(p)} in`);
    if (!copy && host.bringForward(frame, p)) return;
    const r = await prepare(p);
    if (!r) return;
    const id = identity(p, r.spec.title, opener);
    const close = () => {
      host.unmount(id.form);
      runner.destroy();
    };
    const runner: FormRunner = createFormRunner({ ...wire(id), ...o.runnerOptions(p), onClose: close, windowed: true });
    running.set(id.form, { runner, id });
    host.mount(frame, {
      id: id.form,
      key: p,
      label: r.spec.title,
      el: runner.el,
      handle: runner.handle,
      focus: () => runner.focus(),
      close,
      destroy: () => runner.destroy(),
      menus: () => runner.menus(),
    });
    await runner.start(r.spec);
    host.refreshMenu(); // its menus exist now, to merge into the main form's bar
    runner.focus();
  }

  return {
    prepare,
    identity,
    wire,
    track: (id, runner) => void running.set(id.form, { runner, id }),
    openInFrame,
    resolve,
  };
}
