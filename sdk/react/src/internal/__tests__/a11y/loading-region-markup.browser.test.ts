// Agreement: the element list the `stigmer/require-loading-region` lint rule
// reads (`internal/loading-region-markup.json`) is what axe-core decides, not
// a reading of it.
//
// The rule reports a busy, labelled element with no role written when its
// tag is one axe's `aria-prohibited-attr` refuses a name on (stigmer#1653).
// This suite renders every HTML element that way, empty and alone, through
// that axe rule in a real Chromium, and fails, printing what axe measured,
// when the list and axe disagree in either direction. An axe upgrade that
// moves the line turns it red; the fix is to copy the printed list into the
// data file. Every element is accounted for: refused (the rule's list),
// refused alone but accepted in a context the rule cannot see (left to axe,
// each shown accepted in its context), not judged by axe at all (skipped,
// each with its reason), or accepted.
// Domain: SDK accessibility (lint fence).

import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import markup from "../../loading-region-markup.json";

/** Every HTML element that can render in a document body (WHATWG HTML; scripting, metadata and obsolete elements left out). */
const ELEMENTS = [
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "bdi", "bdo", "blockquote", "br",
  "button", "canvas", "caption", "cite", "code", "col", "colgroup", "data", "datalist", "dd", "del",
  "details", "dfn", "dialog", "div", "dl", "dt", "em", "embed", "fieldset", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "i", "iframe", "img",
  "input", "ins", "kbd", "label", "legend", "li", "main", "map", "mark", "menu", "meter", "nav",
  "noscript", "object", "ol", "optgroup", "option", "output", "p", "picture", "pre", "progress", "q",
  "rp", "rt", "ruby", "s", "samp", "search", "section", "select", "slot", "small", "span", "strong",
  "sub", "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead",
  "time", "tr", "u", "ul", "var", "video", "wbr",
];

type Outcome = "violation" | "incomplete" | "pass" | "skipped";

/**
 * What axe's aria-prohibited-attr says about the element `#probe`, rendered as
 * the body's only content: markup is parsed, an element is appended as built
 * (the parser would drop a `td` or a `caption` outside its table). "skipped"
 * is axe judging nothing: an element it keeps out of its tree, or one hidden.
 * Any other axe error fails the test.
 */
async function judge(content: string | Element): Promise<Outcome> {
  document.body.innerHTML = typeof content === "string" ? content : "";
  if (typeof content !== "string") document.body.appendChild(content);
  let result: axe.AxeResults;
  try {
    result = await axe.run("#probe", { runOnly: { type: "rule", values: ["aria-prohibited-attr"] } });
  } catch (error) {
    if (error instanceof Error && error.message.includes("No elements found")) return "skipped";
    throw error;
  }
  if (result.violations.length > 0) return "violation";
  if (result.incomplete.length > 0) return "incomplete";
  return result.passes.length > 0 ? "pass" : "skipped";
}

/** An empty, busy, labelled `tag`, optionally with a role attribute: the skeleton shape the rule fences. */
function busy(tag: string, role?: string): Element {
  const element = document.createElement(tag);
  element.id = "probe";
  if (role !== undefined) element.setAttribute("role", role);
  element.setAttribute("aria-busy", "true");
  element.setAttribute("aria-label", "Loading");
  return element;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("loading-region-markup.json agrees with axe-core", () => {
  it("is measured against the axe-core the SDK installs", () => {
    expect(axe.version).toBe(markup.axeCore);
  });

  it("accounts for every element exactly as axe judges it", async () => {
    const leftToAxe = new Set(Object.keys(markup.elementsLeftToAxe));
    const refused: string[] = [];
    const skipped: string[] = [];
    for (const tag of ELEMENTS) {
      const outcome = await judge(busy(tag));
      if (outcome === "skipped") skipped.push(tag);
      else if (outcome !== "pass" && !leftToAxe.has(tag)) refused.push(tag);
      if (leftToAxe.has(tag)) expect(["violation", "incomplete"], `${tag} alone, left to axe`).toContain(outcome);
    }
    expect(sorted(refused), "copy into namelessElements").toEqual(sorted(markup.namelessElements));
    expect(sorted(skipped), "copy into elementsAxeSkips").toEqual(sorted(Object.keys(markup.elementsAxeSkips)));
  });

  it("leaves to axe only elements it accepts in a context the rule cannot see", async () => {
    for (const [tag, entry] of Object.entries(markup.elementsLeftToAxe)) {
      expect(await judge(entry.accepted), `${tag}: ${entry.reason}`).toBe("pass");
    }
  });

  it("refuses an empty role as no role", async () => {
    for (const tag of ["div", "span"]) {
      expect(await judge(busy(tag, "")), `${tag} with role=""`).toBe("violation");
      expect(await judge(busy(tag, "  ")), `${tag} with a blank role`).toBe("violation");
    }
  });

  it("judges no element hidden by its own attribute, and refuses one aria-hidden false", async () => {
    expect(await judge(`<div id="probe" hidden aria-busy="true" aria-label="Loading"></div>`)).toBe("skipped");
    expect(await judge(`<div id="probe" aria-hidden="true" aria-busy="true" aria-label="Loading"></div>`)).toBe("skipped");
    expect(await judge(`<div id="probe" aria-hidden="false" aria-busy="true" aria-label="Loading"></div>`)).toBe("violation");
  });

  it("ignores an empty label", async () => {
    expect(await judge(`<div id="probe" aria-busy="true" aria-label=" "></div>`)).toBe("pass");
  });
});
