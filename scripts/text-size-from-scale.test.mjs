// Holds CON-05 on the UX bar (beside the other root suites, which read the
// whole repository by design): every face's text sizes and spacing come
// from tokens, and no text is smaller than the scale allows. Three readings,
// each from the files themselves:
// - the `text-size-from-scale` rule, which refuses a hand-picked size where
//   it is written (each valid case differs from a reported one in one
//   respect, so none passes for an unrelated reason);
// - the scale: every step and its leading declared in tokens.css, rising,
//   no preset below the 11px floor, the spacing unit declared, and the one
//   shared Tailwind mapping that the kit, the console and the desktop app
//   import in place of a theme block of their own;
// - the sweep: every source file of the three faces through the rule's own
//   matcher, so a file a lint config misses is still read.
// Spacing is held as a token (the unit and its mapping), not by refusing
// arbitrary spacing: three icon-alignment offsets stay hand-picked because
// they match an icon's geometry, not the rhythm
// (`sdk/react/src/dependency-graph/DependencyTreeNode.tsx`, `ml-[11px]` and
// `top-[14px]`; `sdk/react/src/resource-creation/StepIndicator.tsx`,
// `ml-[18px]`). A number in an inline style (`fontSize: 14`) is not read: pages
// drawn without the stylesheet, such as the console's global error page, use it.
// Run via the root `npm run test:root`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { RuleTester } = require("eslint");
const rule = require("../tools/eslint-plugin-stigmer/rules/text-size-from-scale");
const { findHandPickedSizes } = require("../tools/eslint-plugin-stigmer/src/text-size");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** The scale's steps, smallest first. */
const STEPS = ["2xs", "xs", "sm", "base", "lg", "xl", "2xl", "3xl"];
/** The smallest text any preset may draw: the 2xs step, 11px. */
const FLOOR_PX = 11;
/** The stylesheets of the three faces that build Tailwind utilities. */
const FACE_STYLESHEETS = ["sdk/react/src/styles.css", "client-apps/web/src/app/globals.css", "client-apps/desktop/src/globals.css"];
/** The source trees the sweep reads. */
const FACE_SOURCES = ["sdk/react/src", "client-apps/web/src", "client-apps/desktop/src"];

/** A length in px, from the rem or px values the tokens use (1rem = 16px). */
function px(value) {
  const match = /^\s*(-?\d*\.?\d+)(px|rem)\s*$/.exec(value);
  assert.ok(match, `"${value}" is not a px or rem length`);
  return Number(match[1]) * (match[2] === "rem" ? 16 : 1);
}

/** The declarations of one --stgm-* family in a stylesheet: name suffix to value. */
function declarations(css, family) {
  const found = new Map();
  for (const match of css.matchAll(new RegExp(String.raw`--stgm-${family}-([\w-]+)\s*:\s*([^;]+);`, "g"))) {
    found.set(match[1], match[2].trim());
  }
  return found;
}

/** Every non-test .ts or .tsx file under a directory. */
function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules") files.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files;
}

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

describe("CON-05 the type scale and the spacing unit are tokens, and no face picks a text size by hand", () => {
  describe("the rule refuses a hand-picked text size", () => {
    tester.run("text-size-from-scale", rule, {
      valid: [
        // A scale step, in every spelling a reported case uses.
        { code: '<p className="stg:text-2xs" />' },
        { code: '<p className="stg:md:text-xs" />' },
        { code: "const BADGE = 'text-sm font-medium';" },
        { code: "cn('stg:text-2xs', active && 'stg:text-foreground')" },
        { code: "const row = `stg:text-xs ${tone}`;" },
        // A colour, and arbitrary values that are not a length.
        { code: '<p className="stg:text-muted-foreground" />' },
        { code: '<p className="stg:text-[var(--stgm-text-sm)]" />' },
        { code: '<p className="stg:text-[#333]" />' },
        { code: '<p className="stg:text-[rgb(10%,20%,30%)]" />' },
        { code: '<p className="stg:text-xs/5" />' },
        // Arbitrary lengths on other utilities.
        { code: '<p className="stg:leading-[1.6] stg:ml-[11px]" />' },
        // A style that reads a token, a number, or a non-size key.
        { code: '<p style={{ fontSize: "var(--stgm-text-sm)" }} />' },
        { code: "<p style={{ fontSize: 14 }} />" },
        { code: '<p style={{ lineHeight: "13px" }} />' },
        { code: '<p style={{ "fontSize": "var(--stgm-text-xs)" }} />' },
      ],
      invalid: [
        { code: '<p className="stg:text-[10px]" />', errors: [{ messageId: "arbitraryClass" }] },
        { code: '<p className="stg:md:text-[10px]" />', errors: [{ messageId: "arbitraryClass" }] },
        { code: '<p className="text-[0.65rem]" />', errors: [{ messageId: "arbitraryClass" }] },
        { code: '<p className="stg:text-[length:1em]" />', errors: [{ messageId: "arbitraryClass" }] },
        { code: "const BADGE = 'text-[11px] font-medium';", errors: [{ messageId: "arbitraryClass" }] },
        { code: "cn('stg:text-[0.6rem]', active && 'stg:text-foreground')", errors: [{ messageId: "arbitraryClass" }] },
        { code: "const row = `stg:text-[9px] ${tone}`;", errors: [{ messageId: "arbitraryClass" }] },
        { code: '<p style={{ fontSize: "13px" }} />', errors: [{ messageId: "lengthFontSize" }] },
        { code: "<p style={{ fontSize: `0.8rem` }} />", errors: [{ messageId: "lengthFontSize" }] },
        { code: '<p style={{ "fontSize": "11px" }} />', errors: [{ messageId: "lengthFontSize" }] },
        { code: '<p style={{ fontSize: "clamp(9px, 1vw, 12px)" }} />', errors: [{ messageId: "lengthFontSize" }] },
        // Any CSS unit, a percentage, a function holding a length, any case.
        ...["8pt", "0.6vw", "60%", "1ch", "calc(10px)", "clamp(9px,1vw,12px)", "10PX"].map((value) => ({
          code: `<p className="text-[${value}]" />`,
          errors: [{ messageId: "arbitraryClass" }],
        })),
        // A line-height modifier after the size.
        { code: '<p className="stg:text-[13px]/5" />', errors: [{ messageId: "arbitraryClass" }] },
        { code: '<p className="stg:text-[10px]/[14px]" />', errors: [{ messageId: "arbitraryClass" }] },
      ],
    });
  });

  describe("the scale", () => {
    const tokens = read("sdk/theme/src/tokens.css");
    const sizes = declarations(tokens, "text");
    const leading = declarations(tokens, "leading");

    it("declares every step with its leading, each step larger than the one before", () => {
      for (const step of STEPS) {
        assert.ok(sizes.has(step), `tokens.css declares no --stgm-text-${step}`);
        assert.ok(leading.has(step), `tokens.css declares no --stgm-leading-${step}`);
      }
      STEPS.slice(1).forEach((step, index) => {
        const below = STEPS[index];
        assert.ok(px(sizes.get(step)) > px(sizes.get(below)), `--stgm-text-${step} is not larger than --stgm-text-${below}`);
      });
    });

    it(`draws no text under ${FLOOR_PX}px, in the defaults or any preset`, () => {
      const sheets = [["tokens.css", tokens]];
      for (const name of readdirSync(join(ROOT, "sdk/theme/src/presets")).filter((n) => n.endsWith(".css"))) {
        sheets.push([`presets/${name}`, read(`sdk/theme/src/presets/${name}`)]);
      }
      for (const [name, css] of sheets) {
        for (const [step, value] of declarations(css, "text")) {
          assert.ok(px(value) >= FLOOR_PX, `${name} sets --stgm-text-${step} to ${value}, under the ${FLOOR_PX}px floor`);
        }
      }
    });

    it("declares the spacing unit", () => {
      assert.match(tokens, /--stgm-spacing\s*:\s*[^;]+;/);
    });

    it("maps every step, its leading and the spacing unit into Tailwind's theme, once", () => {
      const mapping = read("sdk/theme/src/tailwind-theme.css");
      for (const step of STEPS) {
        assert.ok(mapping.includes(`--text-${step}: var(--stgm-text-${step});`), `tailwind-theme.css does not map --text-${step}`);
        assert.ok(
          mapping.includes(`--text-${step}--line-height: var(--stgm-leading-${step});`),
          `tailwind-theme.css does not map --text-${step}--line-height`,
        );
      }
      assert.ok(mapping.includes("--spacing: var(--stgm-spacing);"), "tailwind-theme.css does not map --spacing");
    });

    it("is the one mapping every face imports, with no theme block of its own", () => {
      for (const sheet of FACE_STYLESHEETS) {
        const css = read(sheet);
        assert.ok(css.includes('@import "@stigmer/design-tokens/tailwind-theme.css";'), `${sheet} does not import the shared mapping`);
        assert.ok(!/^\s*@theme\b/m.test(css), `${sheet} keeps a @theme block of its own`);
      }
    });
  });

  it("the sweep finds no hand-picked size in any face's source", () => {
    const findings = [];
    for (const dir of FACE_SOURCES) {
      for (const file of sourceFiles(dir)) {
        for (const { line, text } of findHandPickedSizes(read(file))) {
          findings.push(`${relative(ROOT, join(ROOT, file))}:${line} ${text}`);
        }
      }
    }
    assert.deepEqual(findings, []);
  });
});
