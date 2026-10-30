"use strict";

// Pins the `no-token-opacity-modifiers` fence: an opacity modifier on a theme
// colour utility is reported behind any variant, because a faded token is a
// colour no preset controls and the contrast contract never measures. The
// warning family joined the list once the kit's warning boxes moved onto the
// caution notice (stigmer#2772). Each valid case differs from a reported one
// in one respect, so none passes for an unrelated reason. Run via the root
// `npm run test:scripts` (the `test:root` globs in package.json).

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../no-token-opacity-modifiers");

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

const opacityOnToken = [{ messageId: "opacityOnToken" }];

tester.run("no-token-opacity-modifiers", rule, {
  valid: [
    // The same tokens without a modifier.
    { code: '<div className="stg:bg-warning stg:text-warning-foreground stg:border-warning" />' },
    { code: '<div className="stg:bg-muted stg:hover:bg-muted" />' },
    // The caution notice's own tokens, faded by nothing.
    { code: '<div className="stg:bg-status-degraded-subtle stg:text-status-degraded" />' },
    // Opacity as its own utility, not a colour modifier.
    { code: '<div className="stg:opacity-50 stg:bg-warning" />' },
    // A modifier on a utility that is not a listed token.
    { code: '<div className="stg:w-1/2" />' },
  ],
  invalid: [
    // The warning family, behind the prefix and variants.
    { code: '<div className="stg:bg-warning/10" />', errors: opacityOnToken },
    { code: '<div className="stg:hover:bg-warning/20" />', errors: opacityOnToken },
    { code: '<div className="border-warning/30" />', errors: opacityOnToken },
    { code: '<div className="stg:text-warning/80" />', errors: opacityOnToken },
    { code: '<div className="stg:ring-warning/40" />', errors: opacityOnToken },
    { code: '<div className="stg:text-warning-foreground/80" />', errors: opacityOnToken },
    { code: '<div className="stg:bg-warning-foreground/10" />', errors: opacityOnToken },
    // The families listed before, and inside cn().
    { code: '<div className="stg:bg-muted/50" />', errors: opacityOnToken },
    {
      code: '<div className={cn("stg:rounded", active && "stg:text-sidebar-foreground/60")} />',
      errors: opacityOnToken,
    },
    // Two in one className are two reports.
    {
      code: '<div className="stg:border-warning/30 stg:bg-warning/5" />',
      errors: [...opacityOnToken, ...opacityOnToken],
    },
  ],
});
