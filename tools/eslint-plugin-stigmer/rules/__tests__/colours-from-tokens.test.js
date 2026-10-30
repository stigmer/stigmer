"use strict";

// Pins the `colours-from-tokens` fence: a fallback on a --stgm-* token and a
// Tailwind arbitrary colour are reported wherever a string holds them (a
// className, a cn() argument, a style object, a template literal, a module
// constant), because the SDK's colours live in all of those (stigmer#1473).
// Each valid case differs from a reported one in one respect, so none passes
// for an unrelated reason. Run via the root `npm run test:scripts` (the
// `test:root` globs in package.json).

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../colours-from-tokens");

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

const fallback = [{ messageId: "fallback" }];
const arbitraryColour = [{ messageId: "arbitraryColour" }];

tester.run("colours-from-tokens", rule, {
  valid: [
    // A token read alone, as a style value and inside an arbitrary value.
    { code: 'const style = { color: "var(--stgm-syntax-tag)" };' },
    { code: '<div className="stg:bg-[var(--stgm-border)]" />' },
    { code: 'const s = { boxShadow: "0 0 0 4px color-mix(in srgb, var(--stgm-primary) 20%, transparent)" };' },
    // A fallback on a variable that is not a theme token: a host hook.
    { code: 'const font = "var(--font-geist-sans, system-ui, sans-serif)";' },
    { code: 'const x = "var(--stgmx-border, #e5e5e5)";' },
    // Semantic utilities, and arbitrary values that are not colours.
    { code: '<div className="stg:bg-border stg:hover:bg-primary stg:text-muted-foreground" />' },
    { code: '<div className="stg:ml-[18px] stg:w-[calc(100%-2rem)]" />' },
    { code: '<div className="stg:text-[length:13px]" />' },
    // A colour-shaped selector inside a variant, not the utility.
    { code: '<div className="stg:has-[#panel]:bg-muted" />' },
    // A colour in prose or a non-class string is not a class token.
    { code: 'const hint = "Use #6366f1 for nothing";' },
  ],
  invalid: [
    // Fallbacks, wherever the string sits.
    { code: '<div className="stg:bg-[var(--stgm-border,#e5e5e5)]" />', errors: fallback },
    { code: 'cn("stg:group", "stg:hover:bg-[var(--stgm-primary,#6366f1)]")', errors: fallback },
    { code: 'const style = { color: "var(--stgm-syntax-tag, #cf222e)" };', errors: fallback },
    { code: "const s = `1px solid var(--stgm-border, #e5e5e5)`;", errors: fallback },
    { code: 'const s = { color: "var( --stgm-accent , oklch(0.9 0.05 270))" };', errors: fallback },
    // Every fallback, not only a colour: a keyword, a font stack, an easing.
    { code: 'const s = { borderColor: "var(--stgm-border, currentColor)" };', errors: fallback },
    { code: 'const s = { fontFamily: "var(--stgm-font-mono, ui-monospace, monospace)" };', errors: fallback },
    { code: 'const s = { transitionTimingFunction: "var(--stgm-transition-timing, ease-out)" };', errors: fallback },
    // Two in one string are two reports.
    {
      code: 'const s = "color-mix(in srgb, var(--stgm-primary, #6366f1) 20%, var(--stgm-border, #e5e5e5))";',
      errors: [...fallback, ...fallback],
    },
    // Arbitrary colours, behind any prefix or variant, in any string.
    { code: 'const COLORS = ["stg:bg-[#6366f1]"];', errors: arbitraryColour },
    { code: '<div className="stg:hover:text-[oklch(0.6_0.2_270)]" />', errors: arbitraryColour },
    { code: '<div className="bg-[#fff]/50" />', errors: arbitraryColour },
    { code: '<div className="stg:border-[rgb(0,0,0)] stg:ring-[hsl(0_0%_0%)]" />', errors: [...arbitraryColour, ...arbitraryColour] },
    { code: '<div className="stg:bg-[color:#fff]" />', errors: arbitraryColour },
    { code: '<div className="stg:[color:#fff]" />', errors: arbitraryColour },
    { code: '<div className="stg:!bg-[#000]" />', errors: arbitraryColour },
    { code: "const c = `stg:rounded stg:fill-[#22c55e] ${size}`;", errors: arbitraryColour },
  ],
});
