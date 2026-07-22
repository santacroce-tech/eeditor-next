// Tags panel — a workspace tag cloud from the unit-tested `tags.ts` extractor. Reads each file's
// content and aggregates #hashtag counts. Clicking a tag runs a search callback.

import type { WorkspaceClient } from "../engine/workspace";
import type { FileEntry } from "../core/fuzzy";
import { tagCounts } from "../core/tags";

export interface TagsPanel {
  refresh(): Promise<void>;
}

export function createTagsPanel(
  parent: HTMLElement,
  ws: WorkspaceClient,
  getFiles: () => FileEntry[],
  onSelect?: (tag: string) => void,
): TagsPanel {
  const root = document.createElement("div");
  root.className = "tags-panel";
  parent.appendChild(root);

  async function refresh(): Promise<void> {
    const files = getFiles();
    const contents = await Promise.all(
      files.map((f) => ws.read(f.path).then((content) => ({ content })).catch(() => ({ content: "" }))),
    );
    const counts = tagCounts(contents);
    root.innerHTML = "";
    if (counts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tags-empty";
      empty.textContent = "(no tags)";
      root.appendChild(empty);
      return;
    }
    for (const { tag, count } of counts) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = "#" + tag;
      const c = document.createElement("span");
      c.className = "tag-count";
      c.textContent = String(count);
      chip.appendChild(c);
      if (onSelect) chip.addEventListener("click", () => onSelect(tag));
      root.appendChild(chip);
    }
  }

  return { refresh };
}
