// Dev bridge: gives the browser frontend the two things Tauri would provide natively —
//   • POST /eval {src}                     → drives a persistent `eelisp --serve` process
//   • POST /fs/tree | /fs/read | /fs/write → Node fs, confined to WORKSPACE_ROOT
// In the shipped app the Tauri commands replace this; the JSON shapes are identical.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, readdir, mkdir, rename, rm, stat, realpath } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const BIN = process.env.EELISP_BIN ?? fileURLToPath(new URL("../../eelisp-rs/target/release/eelisp", import.meta.url));
const WS = path.resolve(process.env.WORKSPACE_ROOT ?? fileURLToPath(new URL("../workspace", import.meta.url)));
const PORT = process.env.BRIDGE_PORT ? Number(process.env.BRIDGE_PORT) : 8787;
// Mirrors src-tauri's BINARY_EXT: any file is editable unless its bytes plainly aren't text.
const BINARY =
  /\.(png|jpe?g|gif|bmp|tiff?|webp|heic|heif|ico|icns|psd|ai|pdf|zip|gz|bz2|xz|7z|rar|tar|dmg|iso|docx?|xlsx?|pptx?|numbers|pages|sketch|epub|mp3|wav|aac|flac|ogg|m4a|mp4|m4v|mov|avi|mkv|webm|ttf|otf|woff2?|eot|exe|dll|so|dylib|o|a|bin|class|jar|wasm|pyc|db|sqlite3?)$/i;

// ── engine process ──
// --workspace tells the engine where it is, so (current-dir) answers the same here as it does
// in the desktop app.
const child = spawn(BIN, ["--serve", "--workspace", WS], { stdio: ["pipe", "pipe", "inherit"] });
child.on("error", (e) => (console.error(`[bridge] spawn ${BIN}: ${e.message}`), process.exit(1)));
child.on("exit", (c) => (console.error(`[bridge] engine exited (${c})`), process.exit(1)));
const rl = readline.createInterface({ input: child.stdout });
const pending = [];
rl.on("line", (line) => pending.shift()?.(line));
const evalSrc = (src) =>
  new Promise((resolve) => (pending.push(resolve), child.stdin.write(JSON.stringify({ src }) + "\n")));

// ── workspace fs (confined) ──
function safe(rel) {
  const p = path.resolve(WS, rel || ".");
  if (p !== WS && !p.startsWith(WS + path.sep)) throw new Error("path escapes workspace");
  return p;
}
// Mirrors src-tauri's `children_of`: bounded, cycle-proof, and it reports what it could not read
// instead of returning an empty folder (see the TreeWalk comments there).
const TREE_MAX_ENTRIES = 20_000;
const TREE_MAX_DEPTH = 32;

async function buildTree(absDir, relDir, depth, walk) {
  if (depth >= TREE_MAX_DEPTH) return [];
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (e) {
    walk.unreadable.push(`${relDir || "."}: ${e.message ?? e}`);
    return [];
  }
  // A symlink is not a directory as far as the dirent is concerned — resolve it once, here.
  const items = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const abs = path.join(absDir, e.name);
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) isDir = await stat(abs).then((st) => st.isDirectory(), () => false);
    items.push({ name: e.name, abs, isDir });
  }
  items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));

  const out = [];
  for (const it of items) {
    if (walk.entries >= TREE_MAX_ENTRIES) {
      walk.truncated = true;
      break;
    }
    walk.entries++;
    const rel = relDir ? `${relDir}/${it.name}` : it.name;
    if (it.isDir) {
      const canon = await realpath(it.abs).catch(() => it.abs);
      const seen = walk.seen.has(canon);
      if (!seen) walk.seen.add(canon);
      out.push({ name: it.name, path: rel, isDir: true, children: seen ? [] : await buildTree(it.abs, rel, depth + 1, walk) });
    } else if (!BINARY.test(it.name)) {
      out.push({ name: it.name, path: rel, isDir: false });
    }
  }
  return out;
}

const routes = {
  "/eval": async ({ src }) => await evalSrc(String(src ?? "")), // returns a JSON string already
  "/fs/tree": async () => {
    // An unreadable root is an error, not an empty workspace — same as the Tauri command.
    await readdir(WS).catch((e) => {
      throw new Error(`${WS} can't be read: ${e.message ?? e}`);
    });
    const walk = { entries: 0, unreadable: [], truncated: false, seen: new Set([await realpath(WS).catch(() => WS)]) };
    const children = await buildTree(WS, "", 0, walk);
    return JSON.stringify({
      name: path.basename(WS),
      path: "",
      isDir: true,
      children,
      unreadable: walk.unreadable,
      truncated: walk.truncated,
    });
  },
  "/fs/read": async ({ path: rel }) => {
    const bytes = await readFile(safe(rel));
    if (bytes.includes(0)) throw new Error(`${rel} is a binary file — EEditor edits text`);
    return JSON.stringify({ content: bytes.toString("utf8") });
  },
  // Mirrors fs_abs_path: safe() keeps the answer inside the workspace, same as every other route.
  "/fs/abspath": async ({ path: rel }) => JSON.stringify({ path: safe(rel) }),
  "/fs/write": async ({ path: rel, content }) => {
    const abs = safe(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, String(content ?? ""), "utf8");
    return JSON.stringify({ ok: true });
  },
  "/fs/create": async ({ path: rel, isDir }) => {
    const abs = safe(rel);
    if (isDir) await mkdir(abs, { recursive: true });
    else {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, "", { encoding: "utf8", flag: "wx" }); // fail if exists
    }
    return JSON.stringify({ ok: true });
  },
  "/fs/rename": async ({ from, to }) => {
    const a = safe(from);
    const b = safe(to);
    await mkdir(path.dirname(b), { recursive: true });
    await rename(a, b);
    return JSON.stringify({ ok: true });
  },
  "/fs/delete": async ({ path: rel }) => {
    const abs = safe(rel);
    const st = await stat(abs);
    await rm(abs, { recursive: st.isDirectory(), force: false });
    return JSON.stringify({ ok: true });
  },
};

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return void (res.writeHead(204), res.end());
  const handler = req.method === "POST" ? routes[req.url ?? ""] : undefined;
  if (!handler) return void (res.writeHead(404), res.end());
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const out = await handler(body ? JSON.parse(body) : {});
      res.writeHead(200, { "content-type": "application/json" });
      res.end(out);
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      // The message, not the stringified Error — the frontend shows this text as-is.
      res.end(JSON.stringify({ ok: false, error: e?.message ?? String(e) }));
    }
  });
});

server.listen(PORT, () => console.error(`[bridge] http://localhost:${PORT}  engine=${BIN}  workspace=${WS}`));
