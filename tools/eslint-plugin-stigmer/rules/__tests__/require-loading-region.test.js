"use strict";

// Pins the `require-loading-region` fence: a DOM element with a fixed
// `aria-busy` true and an `aria-label` or `aria-labelledby` is reported when
// its role is status or takes no name, or when it has no role (an empty one
// included) and its own role takes none, because a skeleton's name belongs to
// LoadingRegion's hidden text (stigmer#1653). Left alone: a labelled region or
// article that is busy while it streams real content, an element whose own
// role takes a name, a computed role or busy flag, a busy element with no
// label, and a component's props. Each valid case differs from a reported one
// in that one respect, so none passes for an unrelated reason. Run via the
// root `npm run test:scripts` (the `test:root` globs in package.json).

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
    { code: "<div aria-busy={isLoading} aria-label=\"Loading\" />" },
    { code: '<div aria-busy="false" aria-label="Sessions" />' },
    { code: '<div aria-busy="true"><span>Loading…</span></div>' },
    { code: '<div aria-label="Conversation list" />' },
    { code: '<Panel role="status" aria-busy="true" aria-label="Loading" />' },
    { code: '<div role="region" aria-label="Plan being written" aria-busy="true"><p>Writing…</p></div>' },
    { code: '<div role="article" aria-label="Plan document" aria-busy="true" />' },
    { code: '<div role={roleFor(kind)} aria-busy="true" aria-label="Loading" />' },
    { code: '<button aria-busy="true" aria-label="Saving" />' },
    { code: '<section aria-busy="true" aria-label="Plan" />' },
    { code: '<ul aria-busy="true" aria-label="Sessions" />' },
    { code: '<section role="" aria-busy="true" aria-label="Plan" />' },
    { code: '<div role="region status" aria-busy="true" aria-label="Plan" />' },
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
    ...["strong", "code", "sub", "ins", "time"].map((tag) => ({
      code: `<${tag} aria-busy="true" aria-label="Loading" />`,
      errors: reported,
    })),
    { code: '<div role="" aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div role="Status" aria-busy="true" aria-label="Loading" />', errors: reported },
    { code: '<div role="status alert" aria-busy="true" aria-label="Loading" />', errors: reported },
  ],
});
