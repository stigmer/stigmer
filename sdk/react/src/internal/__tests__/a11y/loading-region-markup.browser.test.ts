// Agreement: the markup data the `stigmer/require-loading-region` lint rule
// reads (`internal/loading-region-markup.json`) is what axe-core decides, not
// a reading of it.
//
// The rule reports a busy, labelled element that axe's `aria-prohibited-attr`
// refuses (stigmer#1653) from four lists: the elements that take no name, the
// roles that take none, the roles axe sets aside for the element's own when a
// label is present, and the widget roles under which a role-less element may
// be named. This suite renders every HTML element and every ARIA role axe
// knows through that axe rule in a real Chromium, and fails, printing what axe
// measured, when a list and axe disagree in either direction. An axe upgrade
// that moves the line turns it red; the fix is to copy the printed list into
// the data file.
//
// What the rule leaves to axe's audits is listed in the data file with a
// reason, and each entry is shown here to be context-dependent: refused alone,
// accepted in the context its reason names.
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

type Outcome = "violation" | "incomplete" | "pass" | "inapplicable";

/**
 * What axe's aria-prohibited-attr says about the element `#probe`, rendered as
 * the body's only content: markup is parsed, an element is appended as built
 * (the parser would drop a `td` or a `caption` outside its table). An element
 * axe keeps out of its tree (a `slot`) is inapplicable.
 */
async function judge(content: string | Element): Promise<Outcome> {
  document.body.innerHTML = typeof content === "string" ? content : "";
  if (typeof content !== "string") document.body.appendChild(content);
  let result: axe.AxeResults;
  try {
    result = await axe.run("#probe", { runOnly: { type: "rule", values: ["aria-prohibited-attr"] } });
  } catch {
    return "inapplicable";
  }
  if (result.violations.length > 0) return "violation";
  if (result.incomplete.length > 0) return "incomplete";
  return result.passes.length > 0 ? "pass" : "inapplicable";
}

/** An empty, busy, labelled `tag`, optionally with a role: the skeleton shape the rule fences. */
function busy(tag: string, role?: string): Element {
  const element = document.createElement(tag);
  element.id = "probe";
  if (role !== undefined) element.setAttribute("role", role);
  element.setAttribute("aria-busy", "true");
  element.setAttribute("aria-label", "Loading");
  return element;
}

/** The roles axe knows, by type. */
function axeRoles(): Record<string, { type: string; prohibitedAttrs?: string[] }> {
  return (axe as unknown as { _audit: { standards: { ariaRoles: Record<string, { type: string; prohibitedAttrs?: string[] }> } } })
    ._audit.standards.ariaRoles;
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

  it("names exactly the elements axe refuses a label on, alone and empty, apart from those it leaves to axe", async () => {
    const leftToAxe = new Set(Object.keys(markup.elementsLeftToAxe));
    const refused: string[] = [];
    for (const tag of ELEMENTS) {
      const outcome = await judge(busy(tag));
      if (outcome === "violation" || (outcome === "incomplete" && !leftToAxe.has(tag))) refused.push(tag);
    }
    expect(sorted(refused.filter((tag) => !leftToAxe.has(tag))), "copy into namelessElements").toEqual(
      sorted(markup.namelessElements),
    );
  });

  it("leaves to axe only elements whose verdict depends on their context", async () => {
    for (const [tag, entry] of Object.entries(markup.elementsLeftToAxe)) {
      expect(await judge(busy(tag)), `${tag} alone`).not.toBe("pass");
      expect(await judge(entry.accepted), `${tag}: ${entry.reason}`).toBe("pass");
    }
  });

  it("knows every role axe does, abstract ones aside", () => {
    const concrete = Object.entries(axeRoles()).filter(([, spec]) => spec.type !== "abstract").map(([role]) => role);
    expect(sorted(markup.knownRoles), "copy into knownRoles").toEqual(sorted(concrete));
  });

  it("names exactly the roles axe prohibits a name under, and refuses each on any element", async () => {
    const prohibiting = Object.entries(axeRoles())
      .filter(([, spec]) => spec.prohibitedAttrs?.includes("aria-label"))
      .map(([role]) => role)
      .filter((role) => !markup.fallbackRoles.includes(role));
    expect(sorted(markup.namelessRoles), "copy into namelessRoles").toEqual(sorted(prohibiting));
    for (const role of markup.namelessRoles) {
      expect(await judge(busy("div", role)), `${role} on a div`).toBe("violation");
      expect(await judge(busy("section", role)), `${role} on a section`).toBe("violation");
    }
  });

  it("sets each fallback role aside for the element's own role", async () => {
    for (const role of markup.fallbackRoles) {
      expect(await judge(busy("div", role)), `${role} on a div`).toBe("violation");
      expect(await judge(busy("section", role)), `${role} on a section`).toBe("pass");
    }
  });

  it("sets a role axe does not know aside like a fallback role", async () => {
    for (const role of ["generic", "skeleton"]) {
      expect(markup.knownRoles).not.toContain(role);
      expect(await judge(busy("div", role)), `${role} on a div`).toBe("violation");
      expect(await judge(busy("section", role)), `${role} on a section`).toBe("pass");
    }
  });

  it("names exactly the widget roles, under which a role-less element may be named", async () => {
    const widgets = Object.entries(axeRoles()).filter(([, spec]) => spec.type === "widget").map(([role]) => role);
    expect(sorted(markup.widgetRoles), "copy into widgetRoles").toEqual(sorted(widgets));
    for (const role of markup.widgetRoles) {
      const html = `<div role="${role}"><span id="probe" aria-busy="true" aria-label="Loading"></span></div>`;
      expect(await judge(html), `a span under role ${role}`).toBe("pass");
    }
    const underButton = `<button type="button"><span id="probe" aria-busy="true" aria-label="Saving"></span></button>`;
    expect(await judge(underButton), "a span under a button").toBe("pass");
    const underLink = `<a href="#x"><span id="probe" aria-busy="true" aria-label="Loading"></span></a>`;
    expect(await judge(underLink), "a span under a link").toBe("pass");
    const throughParagraph = `<button type="button"><p><span id="probe" aria-busy="true" aria-label="Saving"></span></p></button>`;
    expect(await judge(throughParagraph), "a span under a paragraph under a button").toBe("pass");
    const underRegion = `<section aria-label="Plan"><span id="probe" aria-busy="true" aria-label="Loading"></span></section>`;
    expect(await judge(underRegion), "a span under a region").toBe("violation");
  });

  it("accepts the console's reserved roles, which the rule reports by choice, not axe's", async () => {
    for (const role of markup.consoleReservedRoles) {
      expect(await judge(busy("div", role)), role).toBe("pass");
    }
  });

  it("ignores an empty label", async () => {
    expect(await judge(`<div id="probe" aria-busy="true" aria-label=" "></div>`)).toBe("pass");
  });
});
