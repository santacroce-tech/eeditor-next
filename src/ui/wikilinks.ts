// Turn [[Target]] occurrences in rendered Markdown into clickable links.
// Walks text nodes only, skipping code/pre/existing anchors, so link syntax inside code stays literal.

import { WIKILINK_RE } from "../core/wikilink";

export function linkifyWikiLinks(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p || p.closest("code, pre, a")) return NodeFilter.FILTER_REJECT;
      return WIKILINK_RE.test(node.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode()) !== null) nodes.push(n as Text);

  for (const textNode of nodes) {
    const text = textNode.nodeValue ?? "";
    const frag = document.createDocumentFragment();
    const re = new RegExp(WIKILINK_RE.source, "g");
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const name = m[1].trim();
      const a = document.createElement("a");
      a.className = "wikilink";
      a.dataset.target = name;
      a.textContent = name;
      frag.appendChild(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}
