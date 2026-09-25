# VB6 theme: a portable spec

A theme that makes a web UI look like **Visual Basic 6 on Windows 98**. It is written to be handed
to a person or an LLM working on another project, together with `vb6-theme.css` from this folder.

- **`vb6-theme.css`**: the drop-in kit. Tokens, global rules, reusable recipes (`.vb6-raised`,
  `.vb6-sunken`, `.vb6-window`, `.vb6-caption`, …), native-element styling and classic scrollbars.
  Everything is scoped under `:root[data-theme="vb6"]`.
- **EEditor's own implementation** is in `src/styles.css`, in the section headed
  *"Theme: Visual Basic 6"*, and in `src/ui/editor.ts` (`vb6` for the CodeMirror theme,
  `THEMES`/`isThemeName` for switching). Use it as the worked example: it applies these recipes
  to a real app shell, dialogs, a form designer, a data grid and a REPL.

---

## Instructions for the implementing agent

1. **Copy `vb6-theme.css`** into the project and load it **after** the project's own stylesheet,
   so that at equal specificity the theme wins.
2. **Switch themes with an attribute on `<html>`**: `document.documentElement.dataset.theme = "vb6"`.
   If the project already has a theme mechanism (a class, a context, a `data-theme`), plug
   `"vb6"` into it. Persist the choice the way the other themes are persisted.
3. **If the project uses CSS variables for colours**, map its tokens to VB6 values in a
   `:root[data-theme="vb6"]` block first (see *Token mapping*). That alone gets you most of the way.
4. **Then go component by component** and give each one its VB6 role: raised, sunken, window,
   caption, toolbar, selection, tab, group box (see *Recipes*). Either add the `.vb6-*` class to
   the markup or copy the recipe's declarations into a `:root[data-theme="vb6"] .your-class` rule.
   Prefer the second: it keeps markup unchanged and the theme fully removable.
5. **Specificity**: `:root[data-theme="vb6"] .x` is (0,3,0), which beats the usual `.x:hover` and
   `.x:focus` (0,2,0). That is intentional: hover and focus must **not** recolour a bevel's border.
   A state that should look different (pressed, latched) needs its own rule at (0,4,0) or more.
6. **Never change a control's size.** Bevels are a 1px `border` plus a 1px inset `box-shadow`.
   If the original control had a 1px border, the box stays the same size. Don't switch to `border: 2px`.
7. **Code editors** get the VB6 code-window theme (see *Code window*).
8. **Verify by screenshot** in both the VB6 theme and the project's existing themes. The existing
   ones must be pixel-identical to before.

## The look in one paragraph

Everything that isn't a field is **ButtonFace grey `#c0c0c0`**. Fields (text boxes, lists, the code
window, tree views) are **white and sunken**. Buttons are **raised** and sink while pressed.
Windows and dialogs have a **navy-to-blue gradient title bar** with white bold text. Selection is
**navy with white text**, and there is **no hover tint** anywhere. The only exception is a menu bar
item, which gets a thin raised outline. **No rounded corners, no soft shadows, no transparency, no
animation.** UI text is **MS Sans Serif** (Tahoma on a Mac) at about 11–12px, and code is **Courier New**.
A running window sits on the **teal desktop `#008080`**. A designer or MDI area is **dark grey `#808080`**.

## Tokens

| Token | Value | Windows name | Use |
|---|---|---|---|
| `--vb-face` | `#c0c0c0` | ButtonFace | every non-field surface |
| `--vb-light` | `#dfdfdf` | ButtonLight | inner highlight of a bevel |
| `--vb-hilite` | `#ffffff` | ButtonHilight | outer highlight of a bevel |
| `--vb-shadow` | `#808080` | ButtonShadow / GrayText | inner shadow, disabled text, etched lines |
| `--vb-dark` | `#000000` | ButtonDkShadow | outer shadow |
| `--vb-window` | `#ffffff` | Window | field background |
| `--vb-highlight` | `#000080` | Highlight | selection, menu hover, handles |
| `--vb-caption` | `linear-gradient(90deg,#000080,#1084d0)` | ActiveCaption | title bars |
| `--vb-caption-inactive` | `linear-gradient(90deg,#808080,#b5b5b5)` | InactiveCaption | unfocused title bars |
| `--vb-desktop` | `#008080` | Desktop | behind a running window |
| `--vb-workspace` | `#808080` | AppWorkspace | designer / MDI background |
| `--vb-link` | `#0000ff` | | links, always underlined |
| `--vb-ok` / `--vb-err` | `#008000` / `#c00000` | | status text |
| `--vb-ui` | MS Sans Serif → Tahoma → Geneva → Verdana | | all chrome |
| `--vb-code` | Courier New → Courier | | code, REPL / Immediate window |

## Token mapping (for a project with its own palette)

What EEditor did, which maps onto most dark/light token sets:

```css
:root[data-theme="vb6"] {
  --bg: #ffffff;      /* fields and the editor */
  --bg-2: #c0c0c0;    /* panels, heads, toolbars */
  --bg-3: #c0c0c0;    /* sidebar */
  --fg: #000000;
  --muted: #808080;
  --accent: #000080;  /* focus / selection / active */
  --border: #808080;
  --ok: #008000;
  --err: #c00000;
  --mono: var(--vb-ui); /* only if the project uses its mono font for chrome labels; code then gets --vb-code explicitly */
}
```

Look for hard-coded colours the tokens miss, such as an error box background or a `color: #fff` on an
active row, and override them.

## Recipes

A bevel has two rings. The **outer ring** is `border-color` (top, right, bottom, left). The **inner
ring** is an inset `box-shadow`.

| Role | Outer ring (border-color) | Inner ring (box-shadow) | Background |
|---|---|---|---|
| **raised** (button, thumb) | `#fff #000 #000 #fff` | `inset 1px 1px #dfdfdf, inset -1px -1px #808080` | `#c0c0c0` |
| **pressed / sunken** (button down, field) | `#808080 #fff #fff #808080` | `inset 1px 1px #000, inset -1px -1px #dfdfdf` | field `#fff`, button `#c0c0c0` |
| **latched** (toggle that stays down) | as sunken | as sunken | dither: `repeating-conic-gradient(#c0c0c0 0 25%, #fff 0 50%) 0 0/2px 2px` |
| **window** (dialog, menu, floating form) | `#dfdfdf #000 #000 #dfdfdf` | `inset 1px 1px #fff, inset -1px -1px #808080` | `#c0c0c0`, padding 2px |
| **etched line / group box** | `1px solid #808080` | `1px 1px #fff` (outset) + `inset 1px 1px #fff` | — |
| **toolbar** | bottom `1px solid #808080` | `0 1px #fff` | `#c0c0c0` |

And the details that sell it:

- **Pressed buttons** move their label down by 1px (`padding-top: 1px` while `:active`).
- **Disabled text** is etched: `color: #808080; text-shadow: 1px 1px #fff`.
- **The default button** in a dialog has an extra black frame: `outline: 1px solid #000`.
- **Focus** is a dotted rectangle inside the control: `outline: 1px dotted #000; outline-offset: -4px`.
  Focus never recolours the border.
- **Dialog title bar**: turn the dialog's existing title element into a caption. With a panel
  padding of `P`, give it `margin: calc(2px - P) calc(2px - P) 12px`, so it reaches the 2px frame.
- **Docked tool windows** (sidebar sections) get a caption bar as their header. Their small header
  buttons stay raised grey, which looks like caption buttons.
- **Tabs**: raised on top/left/right with no bottom edge. The active tab is bold and 1px taller.
  The tab strip has a white bottom line that the active tab covers.
- **Menus**: a popup is a *window*. Items are highlighted navy/white on hover. The separator is a
  grey line over a white line. On the menu bar, a hovered item gets a thin raised outline, and an
  open one goes navy.
- **Column headers** in grids and list views are raised buttons.
- **Form designer**: the canvas is `#c0c0c0` with black dots every 8px, on a `#808080`
  workspace. Selection handles are 6×6 filled navy squares, not hollow boxes. A dragged or
  rubber-band rectangle is `1px dotted #000` with no fill. The designer's form title bar shows
  min/max/close buttons (`.vb6-caption-buttons`, decorative).
- **Scrollbars** are 16px with bevelled arrow buttons and thumb on a dithered track. This only works
  in WebKit/Blink. Firefox ignores it, which is fine.
- **Calendar "today"** and badges/counters use navy with white text.
- **Links** are pure blue `#0000ff`, underlined.

## Code window (CodeMirror 6)

EEditor's editor theme, from `src/ui/editor.ts`. Load it through a `Compartment` so it can be
switched at runtime. It needs `@codemirror/language` and `@lezer/highlight`.

```ts
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const vb6 = [
  EditorView.theme(
    {
      "&": { backgroundColor: "#ffffff", color: "#000000" },
      ".cm-scroller": { fontFamily: '"Courier New", Courier, monospace', fontSize: "13px" },
      ".cm-content": { caretColor: "#000000" },
      ".cm-gutters": { backgroundColor: "#c0c0c0", color: "#404040", borderRight: "1px solid #808080" },
      ".cm-activeLine": { backgroundColor: "transparent" },          // VB6 had no current-line tint
      ".cm-activeLineGutter": { backgroundColor: "transparent" },
      // Sky blue from the Windows palette: CodeMirror draws the selection *under* the text,
      // so navy would hide black letters.
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "#a6caf0",
      },
      ".cm-cursor": { borderLeftColor: "#000000", borderLeftWidth: "2px" },
      ".cm-matchingBracket": { backgroundColor: "#c0c0c0", outline: "none" },
      ".cm-tooltip": { backgroundColor: "#ffffe1", color: "#000", border: "1px solid #000", borderRadius: "0" },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "#000080", color: "#fff" },
      ".cm-panels": { backgroundColor: "#c0c0c0", color: "#000" },
    },
    { dark: false },
  ),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.modifier, t.operatorKeyword], color: "#000080" },
      { tag: [t.comment, t.lineComment, t.blockComment], color: "#008000" },
      { tag: t.heading, color: "#000080", fontWeight: "bold" },
      { tag: t.strong, fontWeight: "bold" },
      { tag: t.emphasis, fontStyle: "italic" },
      { tag: t.strikethrough, textDecoration: "line-through" },
      { tag: [t.link, t.url], color: "#0000ff", textDecoration: "underline" },
      { tag: [t.monospace, t.quote], color: "#800000" },
      { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "#808080" },
      { tag: t.invalid, color: "#ff0000" },
    ]),
  ),
];
```

Other editors (Monaco, Ace, a plain `<textarea>`) should follow the same rules: white page,
Courier New, a grey `#c0c0c0` gutter with a `#808080` right edge, navy keywords, green comments,
everything else black (VB6 did not colour strings), no current-line highlight, a sky-blue
`#a6caf0` selection when the text can't turn white, and pale-yellow `#ffffe1` tooltips.

## Theme switching (as EEditor does it)

- The themes are a list, `["dark", "light", "vb6"]`. The theme button walks it and shows the name
  of the *next* theme. The stored value is validated against the list (`isThemeName`), so an
  unknown value falls back to the default.
- There are commands to pick each one directly (`theme-dark`, `theme-light`, `theme-vb6`) as well
  as `toggle-theme`.
- Anything drawn from a theme (diagrams, charts) should treat `vb6` as a **light** theme.

## Known limits

- MS Sans Serif isn't installed on macOS, so the stack falls back to Tahoma. It's close, but not
  bitmap-identical.
- `border-radius: 0 !important` on everything is a deliberate shortcut. It saves restyling every
  rounded element one by one. It is scoped to the theme.
- Native `<select>` dropdown lists and date pickers are drawn by the OS and stay native.
