"use strict";

// Pins the `no-handrolled-field` fence: a raw <input>, <textarea> or
// <select> is reported anywhere but the kit's form folder, in the kit and in
// an app. Each valid case differs from a reported one in one respect, so none
// passes for an unrelated reason: a hidden input carries a value, not a
// field; the form folder draws the elements; a test builds raw elements as
// fixtures; the kit's parts themselves are fine. It is the bar's CON-14
// ("Every field is the kit's"). Run via the root
// `npm run test:scripts` (the `test:root` globs in package.json).

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../no-handrolled-field");

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

const field = (element) => [{ messageId: "handrolledField", data: { element } }];

/** The three lint configs the fence must stand in: the kit's and both apps'. */
const CONFIGS = ["sdk/react/eslint.config.mjs", "client-apps/web/eslint.config.mjs", "client-apps/desktop/eslint.config.mjs"];
const REPO = join(__dirname, "..", "..", "..", "..");

describe("CON-14 every field is the kit's", () => {
  it("the field fence is an error in the kit's and both apps' lint configs, so no new raw field lands anywhere", () => {
    for (const config of CONFIGS) {
      const text = readFileSync(join(REPO, config), "utf8");
      assert.match(text, /"stigmer\/no-handrolled-field":\s*"error"/, `${config} turns the fence on as an error`);
    }
  });

  tester.run("no-handrolled-field", rule, {
    valid: [
      // The form folder draws the elements.
      { code: '<input type="text" />', filename: "/repo/sdk/react/src/internal/form/controls.tsx" },
      { code: "<select><option /></select>", filename: "/repo/sdk/react/src/internal/form/controls.tsx" },
      // A hidden input carries a value, not a field.
      { code: '<input type="hidden" name="org" value={org} />' },
      { code: '<input type={"hidden"} value={org} />' },
      // A test builds raw elements as fixtures.
      { code: "<input />", filename: "/repo/sdk/react/src/agent/__tests__/AgentPicker.test.tsx" },
      { code: "<textarea />", filename: "/repo/client-apps/web/src/Thing.test.tsx" },
      // The kit's parts themselves.
      { code: '<TextInput value={name} onChange={setName} />' },
      { code: "<TextArea rows={3} />" },
      { code: "<Select><option /></Select>" },
      { code: "<Checkbox checked={on} />" },
      // A member element named like a field is a different component.
      { code: "<Form.input />" },
    ],
    invalid: [
      { code: '<input type="text" className="stg:w-full" />', errors: field("input") },
      { code: "<input />", filename: "/repo/sdk/react/src/routine/RoutineForm.tsx", errors: field("input") },
      { code: '<input type="checkbox" checked={on} />', errors: field("input") },
      { code: '<input type="file" className="stg:hidden" />', errors: field("input") },
      { code: '<input type={kind} />', errors: field("input") },
      { code: "<textarea rows={5} />", errors: field("textarea") },
      { code: "<select value={v}><option /></select>", errors: field("select") },
      // An app's raw field is fenced too.
      { code: '<input type="url" className="w-full" />', filename: "/repo/client-apps/desktop/src/server/ChooseServer.tsx", errors: field("input") },
      // Only the kit's form folder is exempt, not any folder named form.
      { code: "<input />", filename: "/repo/client-apps/web/src/components/form/X.tsx", errors: field("input") },
    ],
  });
});
