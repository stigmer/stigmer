"use strict";

// Pins the `no-handrolled-code-block` fence: a <pre> whose own classes set
// the mono face is reported anywhere but the kit's code block, in the kit and
// in an app. Each valid case differs from a reported one in one respect, so
// none passes for an unrelated reason: the code block's own file draws the
// element; a test builds raw elements as fixtures; a <pre> without the mono
// face is prose kept as typed; a <pre> whose classes come from a shared
// constant is that constant's to keep; the part itself is fine. Run via the
// root `npm run test:scripts` (the `test:root` globs in package.json).

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../no-handrolled-code-block");

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

const handrolled = [{ messageId: "handrolledCodeBlock" }];

/** The three lint configs the fence must stand in: the kit's and both apps'. */
const CONFIGS = ["sdk/react/eslint.config.mjs", "client-apps/web/eslint.config.mjs", "client-apps/desktop/eslint.config.mjs"];
const REPO = join(__dirname, "..", "..", "..", "..");

describe("every code block is the kit's", () => {
  it("the code block fence is an error in the kit's and both apps' lint configs, so no new hand-drawn block lands anywhere", () => {
    for (const config of CONFIGS) {
      const text = readFileSync(join(REPO, config), "utf8");
      assert.match(text, /"stigmer\/no-handrolled-code-block":\s*"error"/, `${config} turns the fence on as an error`);
    }
  });

  tester.run("no-handrolled-code-block", rule, {
    valid: [
      // The code block's own file draws the element.
      { code: '<pre className="stg:font-mono stg:text-xs stg:leading-4" />', filename: "/repo/sdk/react/src/internal/CodeBlock.tsx" },
      // A test builds raw elements as fixtures.
      { code: '<pre className="stg:font-mono" />', filename: "/repo/sdk/react/src/run/__tests__/TextContentRenderer.test.tsx" },
      { code: '<pre className="font-mono" />', filename: "/repo/client-apps/web/src/Thing.test.tsx" },
      // Prose kept as typed, in the sans face.
      { code: '<pre className="stg:whitespace-pre-wrap stg:font-sans stg:text-sm" />' },
      // Classes from a shared constant are that constant's to keep on the scale.
      { code: "<pre className={cn(STEP_INSET, SCROLL_REGION_FOCUS)} />" },
      // A bare <pre> sets no face of its own.
      { code: "<pre>{text}</pre>" },
      // The part itself.
      { code: '<CodeBlock size="xs">{yaml}</CodeBlock>' },
      // A class that only names the face in passing is not the face.
      { code: '<pre className="stg:font-mono-numbers" />' },
    ],
    invalid: [
      { code: '<pre className="stg:p-4 stg:font-mono stg:text-xs stg:leading-relaxed stg:text-foreground" />', errors: handrolled },
      { code: '<pre className={cn("stg:overflow-auto", "stg:font-mono stg:text-2xs")} />', errors: handrolled },
      { code: '<pre className={cn("stg:text-sm", mono && "stg:font-mono")} />', errors: handrolled },
      { code: "<pre className={`stg:font-mono ${extra}`} />", errors: handrolled },
      // An app's hand-drawn block is fenced too.
      { code: '<pre className="font-mono text-xs" />', filename: "/repo/client-apps/desktop/src/server/Log.tsx", errors: handrolled },
      // Only the kit's code block file is exempt, not any file of that name.
      { code: '<pre className="font-mono" />', filename: "/repo/client-apps/web/src/components/CodeBlock.tsx", errors: handrolled },
    ],
  });
});
