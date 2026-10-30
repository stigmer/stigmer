"use strict";

// Pins the `no-fill-token-text` fence: a theme fill painted as text
// (`text-warning`, the badge amber) is reported wherever a string holds it (a
// className, a cn() argument, a template literal, an object literal's value
// such as a status-to-colour map), behind any variant, `!` or opacity suffix,
// and the report names the measured replacement (stigmer#2776). The fill
// itself, its foreground pair and the replacement stay valid, and so does a
// slug that only ends like the class. Run via the root `npm run test:scripts`
// (the `test:root` globs in package.json).

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../no-fill-token-text");

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

/** One report on `cls`, naming the at-risk text colour as its replacement. */
const fillAsText = (cls) => [
  { messageId: "fillAsText", data: { cls, replacement: "text-status-degraded" } },
];

tester.run("no-fill-token-text", rule, {
  valid: [
    // The fill as a fill, its badge foreground, and the measured text colour.
    { code: '<span className="stg:bg-warning stg:text-warning-foreground" />' },
    { code: '<p className="stg:text-xs stg:text-status-degraded" />' },
    { code: 'const STATUS_COLOR = { waiting: "stg:text-status-degraded" };' },
    // Other fills' tokens and borders are not this rule's.
    { code: '<div className="stg:border-l-warning stg:bg-warning/0" />' },
    // A slug or an id that only ends like the class.
    { code: 'const slug = "my-text-warning";' },
    { code: '<div className="stg:text-warnings" />' },
  ],
  invalid: [
    { code: '<p className="stg:text-xs stg:text-warning" />', errors: fillAsText("stg:text-warning") },
    // Behind any variant, `!` and an opacity suffix.
    { code: '<p className="stg:dark:hover:text-warning" />', errors: fillAsText("stg:dark:hover:text-warning") },
    { code: '<p className="stg:!text-warning" />', errors: fillAsText("stg:!text-warning") },
    { code: '<p className="stg:text-warning/80" />', errors: fillAsText("stg:text-warning/80") },
    { code: '<p className="text-warning" />', errors: fillAsText("text-warning") },
    // In a cn() argument, a template literal and an object literal's value.
    { code: 'cn("stg:text-xs", late && "stg:text-warning")', errors: fillAsText("stg:text-warning") },
    { code: "const c = `stg:text-xs stg:text-warning ${size}`;", errors: fillAsText("stg:text-warning") },
    {
      code: 'const STATUS_COLOR = { running: "stg:text-foreground", waiting: "stg:text-warning" };',
      errors: fillAsText("stg:text-warning"),
    },
    // Two in one string are two reports.
    {
      code: '<p className="stg:text-warning stg:md:text-warning" />',
      errors: [...fillAsText("stg:text-warning"), ...fillAsText("stg:md:text-warning")],
    },
  ],
});
