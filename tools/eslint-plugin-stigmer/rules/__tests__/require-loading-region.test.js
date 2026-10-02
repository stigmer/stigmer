"use strict";

// Pins the `require-loading-region` fence's logic: a DOM element with a fixed
// `aria-busy` true and a non-empty `aria-label` or `aria-labelledby` is
// reported when its role is status or one axe prohibits a name under, or when
// it has no role axe would use and its own role takes no name, unless a
// widget it sits in names it (stigmer#1653). Every entry of the data file the
// rule reads (sdk/react/src/internal/loading-region-markup.json) has a case
// here, so the rule applies each one; whether each entry is right is proven
// against axe itself by sdk/react's loading-region-markup.browser.test.ts.
// Each hand-written valid case differs from a reported one in one respect, so
// none passes for an unrelated reason. Run via the root `npm run
// test:scripts` (the `test:root` globs in package.json).

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
const spanIn = (open, close) => `${open}<span aria-busy="true" aria-label="Saving" />${close}`;

tester.run("require-loading-region", rule, {
  valid: [
    // Not the fenced shape: the primitive itself, a computed or false busy
    // flag, no label, an empty label, a component's props, a computed role.
    { code: '<LoadingRegion label="Loading sessions"><div /></LoadingRegion>' },
    { code: '<div aria-busy={isLoading} aria-label="Loading" />' },
    { code: '<div aria-busy="false" aria-label="Sessions" />' },
    { code: '<div aria-busy="true"><span>Loading…</span></div>' },
    { code: '<div aria-busy="true" aria-label="" />' },
    { code: '<div aria-busy="true" aria-label="  " aria-labelledby="" />' },
    { code: '<Panel role="status" aria-busy="true" aria-label="Loading" />' },
    { code: '<div role={roleFor(kind)} aria-busy="true" aria-label="Loading" />' },
    // A role that takes a name: a real landmark, document part or widget.
    { code: '<div role="region" aria-label="Plan being written" aria-busy="true"><p>Writing…</p></div>' },
    { code: '<div role="article" aria-label="Plan document" aria-busy="true" />' },
    { code: '<div role="foo region status" aria-busy="true" aria-label="Plan" />' },
    { code: '<div role="Region" aria-busy="true" aria-label="Plan" />' },
    // An element whose own role takes a name.
    { code: '<button aria-busy="true" aria-label="Saving" />' },
    { code: '<section aria-busy="true" aria-label="Plan" />' },
    { code: '<ul aria-busy="true" aria-label="Sessions" />' },
    // No role axe would use, on such an element: its own role decides.
    { code: '<section role="" aria-busy="true" aria-label="Plan" />' },
    { code: '<section role="skeleton" aria-busy="true" aria-label="Plan" />' },
    ...markup.fallbackRoles.map((role) => ({ code: busy("section", role) })),
    // Named by the widget it sits in, through role-less wrappers.
    { code: spanIn('<button type="button">', "</button>") },
    { code: spanIn('<a href="#x">', "</a>") },
    { code: spanIn('<button type="button"><p>', "</p></button>") },
    { code: spanIn("<button><div><span>", "</span></div></button>") },
    ...markup.fallbackRoles.map((role) => ({ code: spanIn(`<button><div role="${role}">`, "</div></button>") })),
    ...markup.widgetRoles.map((role) => ({ code: spanIn(`<div role="${role}">`, "</div>") })),
    // Left to axe: an element whose verdict depends on its context.
    ...Object.keys(markup.elementsLeftToAxe).map((tag) => ({ code: busy(tag) })),
  ],
  invalid: [
    { code: '<div className="stg:space-y-2" aria-busy="true" aria-label="Loading sessions" />', errors: reported },
    { code: "<div aria-busy={true} aria-label={`Loading files for ${name}`} />", errors: reported },
    { code: '<div aria-busy aria-label="Loading" />', errors: reported },
    { code: '<div aria-busy="true" aria-labelledby="loading-title" />', errors: reported },
    // The console's reserved role, however it is written, on any element.
    { code: '<div role="status" aria-busy="true" aria-label="Loading file" />', errors: reported },
    { code: '<section role="status" aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div role={"status"} aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: "<div role={`status`} aria-busy={true} aria-label=\"Loading\" />", errors: reported },
    { code: '<div role="Status" aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div role=" status alert" aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div role="foo status" aria-busy="true" aria-label="Loading" />', errors: reported },
    // No role axe would use, on an element whose own role takes no name.
    { code: '<div role="" aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div role="skeleton" aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div role={true} aria-busy="true" aria-label="Loading" />', errors: reported },
    // Not named by a widget: no widget, a non-widget role, a component, a
    // wrapper with a role of its own between them.
    { code: spanIn('<section aria-label="Plan">', "</section>"), errors: reported },
    { code: spanIn('<div role="region" aria-label="Plan">', "</div>"), errors: reported },
    { code: spanIn("<a>", "</a>"), errors: reported },
    { code: spanIn("<Button>", "</Button>"), errors: reported },
    { code: spanIn('<button><li role="listitem">', "</li></button>"), errors: reported },
    { code: spanIn("<button><ul>", "</ul></button>"), errors: reported },
    { code: spanIn("<Toolbar.Button>", "</Toolbar.Button>"), errors: reported },
    // Every entry of the data file.
    ...markup.namelessElements.map((tag) => ({ code: busy(tag), errors: reported })),
    ...markup.namelessRoles.map((role) => ({ code: busy("section", role), errors: reported })),
    ...markup.fallbackRoles.map((role) => ({ code: busy("div", role), errors: reported })),
    ...markup.consoleReservedRoles.map((role) => ({ code: busy("button", role), errors: reported })),
  ],
});
