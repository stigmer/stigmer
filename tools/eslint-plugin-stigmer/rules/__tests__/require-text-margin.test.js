"use strict";

// Pins the `require-text-margin` fence: a paragraph or heading the kit draws
// carries a kit class or sits directly in a DOM element that does, because
// the kit's base reset gives margin 0 only to those (so a host's own keep
// theirs), and any other keeps the browser's margin in a host without
// Tailwind's reset. Each valid case differs from a reported one in one
// respect, so none passes for an unrelated reason. Run via the root
// `npm run test:scripts` (the `test:root` globs in package.json).

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../require-text-margin");

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

const reported = (element) => [
  { messageId: "missingTextMargin", data: { element, default: element === "p" ? "one line's height" : "most of a line" } },
];

tester.run("require-text-margin", rule, {
  valid: [
    // A kit class, in each form a className can take.
    { code: '<p className="stg:text-sm">Hi</p>' },
    { code: '<h1 className="stg:text-lg stg:font-semibold">Title</h1>' },
    { code: '<h6 className="stg:mt-2">Title</h6>' },
    { code: '<h2 className="stg:sm:mb-2">Title</h2>' },
    { code: '<p className={cn("stg:text-xs", muted && "stg:text-muted-foreground")}>Hi</p>' },
    { code: "<p className={`stg:text-sm ${size}`}>Hi</p>" },
    // A class the rule cannot read here (a constant, a prop) is taken as the kit's.
    { code: "<p className={HINT_CLASS}>Hi</p>" },
    // No class of its own, directly in a kit-classed DOM element.
    { code: '<div className="stg:space-y-2 stg:text-sm"><p>One</p><p>Two</p></div>' },
    // ... through a fragment or a conditional, or in one of the kit's components.
    { code: '<div className="stg:space-y-2"><><p>One</p><p>Two</p></></div>' },
    { code: '<div className="stg:text-sm">{busy ? <p>Loading</p> : <p>Ready</p>}</div>' },
    { code: "<RefusalBox><p>Hi</p></RefusalBox>" },
    { code: '<div className="stg:space-y-1">{items.map((item) => { return <p key={item}>{item}</p>; })}</div>' },
    // Not a text element the browser gives a margin.
    { code: '<span className="stg:text-sm">Hi</span>' },
    { code: '<div>Hi</div>' },
    { code: "<Paragraph>Hi</Paragraph>" },
  ],
  invalid: [
    { code: "<p>Hi</p>", errors: reported("p") },
    { code: "<h1>Title</h1>", errors: reported("h1") },
    // A class without the kit's prefix is a host's, which the reset leaves alone.
    { code: '<p className="text-sm">Hi</p>', errors: reported("p") },
    { code: '<h3 className="title">Title</h3>', errors: reported("h3") },
    // No class, and its parent is a host-classed element, an unclassed one, or none.
    { code: '<div className="prose"><p>Hi</p></div>', errors: reported("p") },
    { code: "<div><h2>Title</h2></div>", errors: reported("h2") },
    { code: "const body = () => <><p>One</p></>;", errors: reported("p") },
  ],
});
