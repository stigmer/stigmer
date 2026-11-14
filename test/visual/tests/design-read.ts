// What a picture says, read from its page: each block's own words with
// their type, each button's name and height, and what breaks the kit's
// layout rules. The design facts test (design.spec.ts) reads a built scene
// with these; the session design page's exporter reads each drawing with
// the same rules (`test/visual/design/README.md`), so a drawn fact and a
// built fact are read alike.
//
// Each reader runs inside the page (`page.evaluate`), so it is one
// self-contained function: it closes over nothing and calls only what it
// declares within itself.

/** One block's own words: the text of every text node whose nearest non-inline ancestor is the block, with the block's type. */
export interface Block {
  readonly text: string;
  /** Font size, line height and weight, in CSS pixels and the weight's number. */
  readonly type: readonly [size: number, leading: number, weight: number];
}

/** One button: its accessible text and its drawn height in CSS pixels. */
export interface Button {
  readonly name: string;
  readonly height: number;
}

/** What a page says, as the facts test compares it. */
export interface Reading {
  readonly blocks: readonly Block[];
  readonly buttons: readonly Button[];
}

/**
 * Reads every block's own words and every button under `selector` (the
 * page's body when none matches). Hidden text (not rendered, transparent
 * until a hover reveals it, or visually hidden one pixel square for a
 * screen reader) is skipped: the facts are what a reader sees. Whitespace is collapsed, so a line break in the
 * source never differs from a space.
 */
export function readPage(selector: string): Reading {
  const root = document.querySelector(selector) ?? document.body;
  const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();
  const shown = (element: Element): boolean => {
    for (let at: Element | null = element; at !== null && at !== root.parentElement; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      const box = at.getBoundingClientRect();
      if (box.width <= 1 && box.height <= 1 && style.position === "absolute") return false;
    }
    return true;
  };
  // An inline element flows in its parent's line, and so does an item of a
  // flex or grid box that itself sits in a line, however deep (a file's
  // name inside its button inside an inline-flex control).
  const inLine = (element: Element): boolean => {
    for (let at: Element = element; at !== root; ) {
      if (getComputedStyle(at).display.startsWith("inline")) return true;
      const parent = at.parentElement;
      if (parent === null || !/flex|grid/.test(getComputedStyle(parent).display)) return false;
      at = parent;
    }
    return false;
  };
  const blockOf = (element: Element): Element => {
    let at = element;
    while (at !== root && at.parentElement !== null && inLine(at)) at = at.parentElement;
    return at;
  };
  // The flex or grid item a text sits in, inside its block: two texts in
  // different items read with a space between, as the gap draws them.
  const itemOf = (element: Element, block: Element): Element => {
    for (let at: Element = element; at !== block && at.parentElement !== null; at = at.parentElement) {
      const display = getComputedStyle(at.parentElement).display;
      if (display.includes("flex") || display.includes("grid")) return at;
    }
    return block;
  };
  const own = new Map<Element, { text: string; item: Element }[]>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent === null || (node.textContent ?? "").trim() === "") continue;
    if (parent.closest("script, style, svg, [aria-hidden='true']") !== null || !shown(parent)) continue;
    const block = blockOf(parent);
    own.set(block, [...(own.get(block) ?? []), { text: node.textContent ?? "", item: itemOf(parent, block) }]);
  }
  // A field's placeholder is words a reader sees where nothing is typed.
  for (const field of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[placeholder], textarea[placeholder]")) {
    if (field.value === "" && shown(field)) own.set(field, [{ text: field.placeholder, item: field }]);
  }
  const blocks: Block[] = [];
  for (const [block, parts] of own) {
    const text = collapse(parts.map((part, i) => (i > 0 && part.item !== parts[i - 1]!.item ? ` ${part.text}` : part.text)).join(""));
    if (!/\p{L}/u.test(text)) continue;
    const style = getComputedStyle(block);
    const size = Number.parseFloat(style.fontSize);
    const leading = style.lineHeight === "normal" ? Math.round(size * 1.2) : Number.parseFloat(style.lineHeight);
    blocks.push({ text, type: [size, Math.round(leading * 100) / 100, Number.parseInt(style.fontWeight, 10)] });
  }
  const buttons: Button[] = [];
  // A link drawn as the kit's button (`LinkButton`: an anchor with the
  // button's classes) is a button to the reader, as the drawing draws it.
  const kitButtonLink = 'a[class~="stg:inline-flex"][class~="stg:rounded-lg"][class~="stg:border"][class~="stg:font-medium"]';
  for (const button of root.querySelectorAll(`button, [role='button'], a[data-button], .btn, ${kitButtonLink}`)) {
    if (!shown(button)) continue;
    const name = collapse(button.getAttribute("aria-label") ?? (button as HTMLElement).innerText ?? "");
    if (name === "") continue;
    buttons.push({ name, height: Math.round(button.getBoundingClientRect().height) });
  }
  return { blocks, buttons };
}

/** One break of the kit's layout rules: what broke, and the element's text or tag to find it by. */
export interface LayoutBreak {
  readonly rule: "type-off-scale" | "browser-margin" | "spacing-off-scale";
  readonly where: string;
  readonly detail: string;
}

/**
 * Audits every rendered element under `selector` against the kit's layout
 * rules (stigmer `sdk/theme/src/tokens.css`):
 * - `type-off-scale`: a block's text size with a line height its step does
 *   not pair with, or a size no step has;
 * - `browser-margin`: a paragraph or heading keeping the browser's own
 *   margin (the host page's, where no kit class set one);
 * - `spacing-off-scale`: a padding or a gap that is not a whole number of
 *   half spacing units (2px), the steps the kit's classes take, or the
 *   one-pixel hairline.
 *
 * Each break is reported once per rule and text, so a list of a hundred
 * rows with one fault reads as one break.
 */
export function auditLayout(selector: string): LayoutBreak[] {
  const root = document.querySelector(selector) ?? document.body;
  // The scale: each step's size with its paired line height (tokens.css).
  const pairs: Readonly<Record<string, number>> = { 11: 16, 12: 16, 14: 20, 16: 24, 18: 28, 20: 28, 24: 32, 30: 36 };
  // What a browser gives each element when nothing else does, in ems of its font size.
  const browserMargin: Readonly<Record<string, number>> = { P: 1, H1: 0.67, H2: 0.83, H3: 1, H4: 1.33, H5: 1.67, H6: 2.33 };
  const breaks = new Map<string, { rule: LayoutBreak["rule"]; where: string; detail: string }>();
  const note = (rule: LayoutBreak["rule"], element: Element, detail: string): void => {
    const text = (element as HTMLElement).innerText?.replace(/\s+/g, " ").trim().slice(0, 60) ?? "";
    const where = text === "" ? element.tagName.toLowerCase() : `${element.tagName.toLowerCase()} "${text}"`;
    const key = `${rule} ${where} ${detail}`;
    if (!breaks.has(key)) breaks.set(key, { rule, where, detail });
  };
  const px = (value: string): number => Number.parseFloat(value) || 0;
  for (const element of root.querySelectorAll("*")) {
    if (element.closest("svg") !== null || element.closest("[data-layout-audit='skip']") !== null) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
    if (ownText && !style.display.startsWith("inline")) {
      const size = px(style.fontSize);
      const leading = style.lineHeight === "normal" ? undefined : px(style.lineHeight);
      const paired = pairs[String(size)];
      if (paired === undefined) note("type-off-scale", element, `${size}px is no step's size`);
      else if (leading !== undefined && Math.abs(leading - paired) > 0.5) note("type-off-scale", element, `${size}px on ${leading}px lines, its step pairs ${paired}px`);
    }
    // A paragraph's or heading's margin is the browser's when it measures
    // the browser's default and no kit class names a margin on it.
    const em = browserMargin[element.tagName];
    const kitMargin = /(^|\s)stg:(?:[\w-]+:)*-?m[ytb]?-/.test(typeof element.className === "string" ? element.className : "");
    if (em !== undefined && !kitMargin) {
      const expected = Math.round(px(style.fontSize) * em * 100) / 100;
      for (const side of ["marginTop", "marginBottom"] as const) {
        const value = px(style[side]);
        if (value > 0 && Math.abs(value - expected) < 0.5) {
          note("browser-margin", element, `${side === "marginTop" ? "top" : "bottom"} margin ${value}px is the browser's own`);
        }
      }
    }
    // Margins are left out: an `auto` one (a centred column, a pushed act,
    // a placeholder centred in a flex box) resolves to whatever room is
    // left, which no scale holds, and reads the same as a set one. A
    // paragraph's or heading's margin is the rule above's. A hairline (one
    // pixel) is the scale's own `px` step.
    for (const side of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "rowGap", "columnGap"] as const) {
      const value = px(style[side]);
      if (value === 0 || Number.isNaN(value) || Math.abs(value) === 1) continue;
      if (Math.abs(value / 2 - Math.round(value / 2)) > 0.01) note("spacing-off-scale", element, `${side} ${value}px`);
    }
  }
  return [...breaks.values()];
}
