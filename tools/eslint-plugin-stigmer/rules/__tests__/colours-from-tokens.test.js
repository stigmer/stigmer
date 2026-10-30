"use strict";

// Pins the `colours-from-tokens` fence: a fallback on a --stgm-* token, a
// Tailwind arbitrary colour and a Tailwind palette colour are reported
// wherever a string holds them (a className, a cn() argument, a style object,
// a template literal, a module constant), because the SDK's colours live in
// all of those (stigmer#1473, stigmer#2763).
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
const paletteColour = [{ messageId: "paletteColour" }];

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
    // Palette near-misses: a token utility, a keyword, a hue with no shade or
    // an off-scale shade, a utility that only starts like a colour one, prose,
    // and a slug that ends like a palette class.
    { code: '<div className="stg:bg-warning stg:text-status-degraded stg:bg-status-degraded-subtle" />' },
    { code: '<div className="stg:bg-transparent stg:text-current stg:border-inherit" />' },
    { code: '<div className="stg:bg-blue stg:bg-blue-450 stg:text-red-1000" />' },
    { code: '<div className="stg:whitespace-nowrap stg:text-2xs stg:ring-2 stg:shadow-md stg:border-x-2" />' },
    { code: 'const hint = "the blue-500 swatch";' },
    { code: 'const slug = "team-red-500";' },
    { code: 'const id = "go-to-white";' },
    { code: '<div className="stg:bg-[var(--stgm-x)]" />' },
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
    // Palette colours, one prefix family each.
    { code: '<div className="stg:bg-blue-500" />', errors: paletteColour },
    { code: '<div className="stg:text-amber-800" />', errors: paletteColour },
    { code: '<div className="stg:border-x-violet-200" />', errors: paletteColour },
    { code: '<div className="stg:border-bs-slate-50" />', errors: paletteColour },
    { code: '<div className="stg:ring-offset-zinc-950" />', errors: paletteColour },
    { code: '<div className="stg:text-shadow-taupe-300" />', errors: paletteColour },
    { code: '<div className="stg:mask-linear-from-mauve-400" />', errors: paletteColour },
    { code: '<div className="stg:fill-emerald-600" />', errors: paletteColour },
    {
      code: '<div className="stg:from-sky-400 stg:via-indigo-500 stg:to-pink-600" />',
      errors: [...paletteColour, ...paletteColour, ...paletteColour],
    },
    // Behind variants and `!`, with any opacity, and white or black.
    { code: '<div className="stg:dark:hover:bg-red-900" />', errors: paletteColour },
    { code: '<div className="stg:!text-green-700" />', errors: paletteColour },
    { code: '<div className="stg:bg-amber-900/15 stg:border-blue-800/[0.3]" />', errors: [...paletteColour, ...paletteColour] },
    { code: '<div className="stg:text-white stg:bg-black/50" />', errors: [...paletteColour, ...paletteColour] },
    // In a cn() argument, a template literal and a module constant.
    { code: 'cn("stg:rounded", active && "stg:bg-violet-100")', errors: paletteColour },
    { code: "const c = `stg:rounded stg:text-rose-500 ${size}`;", errors: paletteColour },
    { code: 'const AVATAR_COLORS = ["stg:bg-teal-500"];', errors: paletteColour },
  ],
});
