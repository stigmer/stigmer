"use strict";

// Pins the `require-loading-region` fence: a DOM element with a fixed
// `aria-busy` true and a non-empty `aria-label` or `aria-labelledby` is
// reported in exactly two cases, no role written (or a fixed empty one) on a
// tag axe refuses a name on, and role="status" written exactly, because a
// skeleton's name belongs to LoadingRegion's hidden text (stigmer#1653).
// Every element the data file lists has a case, reported or left to axe;
// whether the list is right is proven against axe itself by sdk/react's
// loading-region-markup.browser.test.ts. Each valid case differs from a
// reported one in one respect, so none passes for an unrelated reason. Run
// via the root `npm run test:scripts` (the `test:root` globs in package.json).

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../require-loading-region");
const markup = require("../../../../sdk/react/src/internal/loading-region-markup.json");

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const reported = [{ messageId: "busyLabelledElement" }];
const busy = (tag, role) => `<${tag}${role === undefined ? "" : ` role="${role}"`} aria-busy="true" aria-label="Loading" />`;

tester.run("require-loading-region", rule, {
  valid: [
    // Not the fenced shape: the primitive itself, a computed or false busy
    // flag, no label, an empty label, a component's props.
    { code: '<LoadingRegion label="Loading sessions"><div /></LoadingRegion>' },
    { code: '<div aria-busy={isLoading} aria-label="Loading" />' },
    { code: '<div aria-busy="false" aria-label="Sessions" />' },
    { code: '<div aria-busy="true"><span>Loading…</span></div>' },
    { code: '<div aria-busy="true" aria-label="" />' },
    { code: '<div aria-busy="true" aria-label="  " aria-labelledby="" />' },
    { code: '<Panel aria-busy="true" aria-label="Loading" />' },
    { code: '<Panel role="status" aria-busy="true" aria-label="Loading" />' },
    // A tag axe accepts a name on.
    { code: busy("button") },
    { code: busy("section") },
    { code: busy("ul") },
    // Any written role other than exactly "status", fixed or computed, is
    // left to axe, including ones axe refuses.
    { code: busy("div", "region") },
    { code: busy("div", "paragraph") },
    { code: busy("div", "none") },
    { code: busy("div", "Status") },
    { code: busy("div", "status alert") },
    { code: busy("section", "") },
    { code: '<div role={roleFor(kind)} aria-busy="true" aria-label="Loading" />' },
    // Not judged by axe: hidden by the element's own attribute.
    { code: '<div hidden aria-busy="true" aria-label="Loading" />' },
    { code: '<div aria-hidden="true" aria-busy="true" aria-label="Loading" />' },
    { code: '<div aria-hidden={true} aria-busy="true" aria-label="Loading" />' },
    // A label React does not render.
    { code: '<div aria-busy="true" aria-label={null} />' },
    // Elements whose verdict depends on context, and elements axe skips.
    ...Object.keys(markup.elementsLeftToAxe).map((tag) => ({ code: busy(tag) })),
    ...Object.keys(markup.elementsAxeSkips).map((tag) => ({ code: busy(tag) })),
  ],
  invalid: [
    { code: '<div className="stg:space-y-2" aria-busy="true" aria-label="Loading sessions" />', errors: reported },
    { code: "<div aria-busy={true} aria-label={`Loading files for ${name}`} />", errors: reported },
    { code: '<div aria-busy aria-label="Loading" />', errors: reported },
    { code: '<div aria-busy="true" aria-labelledby="loading-title" />', errors: reported },
    // No role written: a fixed empty one is none.
    { code: busy("div", ""), errors: reported },
    { code: busy("span", "  "), errors: reported },
    { code: '<div role={""} aria-busy="true" aria-label="Loading" />', errors: reported },
    // No role rendered: React drops a null or boolean role.
    { code: '<div role={null} aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div role={false} aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div role={true} aria-busy="true" aria-label="Loading" />', errors: reported },
    // Not hidden: a hidden React drops, or aria-hidden false.
    { code: '<div hidden={false} aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div aria-hidden="false" aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div aria-busy="true" aria-label={null} aria-labelledby="loading-title" />', errors: reported },
    // The console's reserved role, written exactly, on any element.
    { code: busy("div", "status"), errors: reported },
    { code: busy("section", "status"), errors: reported },
    { code: '<div role={"status"} aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: "<div role={`status`} aria-busy={true} aria-label=\"Loading\" />", errors: reported },
    // Reported although axe accepts it: the widget names the span.
    { code: '<button type="button"><span aria-busy="true" aria-label="Saving" /></button>', errors: reported },
    // Every element the data file lists as refused.
    ...markup.namelessElements.map((tag) => ({ code: busy(tag), errors: reported })),
  ],
});
