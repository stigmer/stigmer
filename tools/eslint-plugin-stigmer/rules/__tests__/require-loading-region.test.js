"use strict";

// Pins the `require-loading-region` fence: a DOM element with a literal
// `aria-busy` true and an `aria-label`, with no role or with role="status", is
// reported, because a skeleton's name belongs to LoadingRegion's hidden text
// (stigmer#1653). A labelled region or article that is busy while it streams
// real content, a computed busy flag, a busy element with no label, a
// component's props are left alone. Run via
// the root `npm run test:scripts` (the `test:root` globs in package.json).

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../require-loading-region");

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

tester.run("require-loading-region", rule, {
  valid: [
    { code: '<LoadingRegion label="Loading sessions"><div /></LoadingRegion>' },
    { code: "<button aria-busy={isSubmitting} aria-label=\"Save\" />" },
    { code: '<div aria-busy="false" aria-label="Sessions" />' },
    { code: '<div aria-busy="true"><span>Loading…</span></div>' },
    { code: '<div aria-label="Conversation list" />' },
    { code: '<Panel aria-busy="true" aria-label="Loading" />' },
    { code: '<div role="region" aria-label="Plan being written" aria-busy="true"><p>Writing…</p></div>' },
    { code: '<div role="article" aria-label="Plan document" aria-busy="true" />' },
    { code: '<div role={roleFor(kind)} aria-busy="true" aria-label="Loading" />' },
    { code: '<button aria-busy="true" aria-label="Saving" />' },
    { code: '<section aria-busy="true" aria-label="Plan" />' },
    { code: '<ul aria-busy="true" aria-label="Sessions" />' },
  ],
  invalid: [
    { code: '<div className="stg:space-y-2" aria-busy="true" aria-label="Loading sessions" />', errors: reported },
    { code: "<div aria-busy={true} aria-label={`Loading files for ${name}`} />", errors: reported },
    { code: '<div role="status" aria-busy="true" aria-label="Loading file" />', errors: reported },
    { code: '<span aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<p aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<section role="status" aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div aria-busy aria-label="Loading" />', errors: reported },
    { code: '<div role={"status"} aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: "<div role={`status`} aria-busy={true} aria-label=\"Loading\" />", errors: reported },
    { code: '<div role="generic" aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div role="presentation" aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div role="none" aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div aria-busy="true" aria-labelledby="loading-title" />', errors: reported },
  ],
});
