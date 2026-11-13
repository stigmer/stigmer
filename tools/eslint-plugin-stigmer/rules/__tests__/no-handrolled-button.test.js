"use strict";

// Pins the `no-handrolled-button` fence: a <button>, <a> or framework Link
// carrying the primary or destructive fill is reported anywhere but the
// button folder, in the kit's prefixed classes and an app's plain ones,
// through cn() and conditionals. Each valid case differs from a reported one
// in one respect, so none passes for an unrelated reason. The fill is also
// found past an opacity suffix or the important mark, on a member element
// (`motion.button`) and through a constant declared in the same file; only
// the kit's own button folder is exempt, not any folder named `button`. It is the bar's
// CON-09 ("Every action button is the kit's Button, IconButton or LinkButton"). Run via the root
// `npm run test:scripts` (the `test:root` globs in package.json).

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../no-handrolled-button");

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

const primary = [{ messageId: "handrolledButton", data: { fill: "primary" } }];
const destructive = [{ messageId: "handrolledButton", data: { fill: "destructive" } }];

/** The three lint configs the fence must stand in: the kit's and both apps'. */
const CONFIGS = ["sdk/react/eslint.config.mjs", "client-apps/web/eslint.config.mjs", "client-apps/desktop/eslint.config.mjs"];
const REPO = join(__dirname, "..", "..", "..", "..");

describe("CON-09 every action button is the kit's Button, IconButton or LinkButton", () => {
  it("the fence is an error in the kit's and both apps' lint configs, so no new copy lands anywhere", () => {
    for (const config of CONFIGS) {
      const text = readFileSync(join(REPO, config), "utf8");
      assert.match(text, /"stigmer\/no-handrolled-button":\s*"error"/, `${config} turns the fence on as an error`);
    }
  });

  tester.run("no-handrolled-button", rule, {
    valid: [
      // The button folder draws the fills.
      { code: '<button className="stg:bg-primary stg:text-primary-foreground" />', filename: "/repo/sdk/react/src/button/Button.tsx" },
      // The same fill on an element nobody presses: a badge, an avatar.
      { code: '<span className="stg:bg-primary stg:text-primary-foreground" />' },
      { code: '<div className="bg-destructive" />' },
      // A pressable element with a quiet look: a row, a tab, a menu item.
      { code: '<button className="stg:hover:bg-accent-hover stg:text-foreground" />' },
      // A tint that only starts like a fill.
      { code: '<button className="stg:bg-primary-subtle" />' },
      { code: '<a className="stg:hover:bg-primary-hover" />' },
      // A control showing a chosen state: a switch that is on, a selected tab, a pressed toggle.
      { code: '<button role="switch" aria-checked="true" className="stg:bg-primary" />' },
      { code: '<button role="tab" aria-selected="true" className="stg:bg-primary" />' },
      { code: '<button aria-pressed={on} className={cn(on && "stg:bg-primary")} />' },
      // A constant that holds no fill, and one that is never a class.
      { code: 'const QUIET = "stg:hover:bg-accent"; <button className={QUIET} />' },
      { code: 'let PRIMARY = "stg:bg-primary"; PRIMARY = "stg:bg-muted"; <button className={PRIMARY} />' },
      // The kit's parts themselves.
      { code: '<Button variant="primary">Save</Button>' },
      { code: '<LinkButton href="/new">Create agent</LinkButton>' },
    ],
    invalid: [
      { code: '<button className="stg:bg-primary stg:text-primary-foreground" />', errors: primary },
      { code: '<button className="stg:bg-primary" />', filename: "/repo/sdk/react/src/run/FileApplyButton.tsx", errors: primary },
      { code: '<a className="inline-flex bg-primary px-3 py-1.5 text-sm" />', errors: primary },
      { code: '<Link href="/new" className="rounded-md bg-primary text-primary-foreground" />', errors: primary },
      { code: '<button className="stg:bg-destructive stg:text-destructive-foreground" />', errors: destructive },
      // Through cn() and a conditional, as the kit writes its classes.
      { code: '<button className={cn("stg:rounded-md", active && "stg:bg-primary")} />', errors: primary },
      { code: '<button className={on ? "stg:bg-destructive" : "stg:bg-muted"} />', errors: destructive },
      // A role that is not a choice does not exempt it.
      { code: '<button role="button" className="stg:bg-primary" />', errors: primary },
      // A variant does not hide the fill.
      { code: '<button className="stg:data-[on]:bg-primary" />', errors: primary },
      // An opacity suffix or the important mark does not hide the fill.
      { code: '<button className="stg:bg-primary/90" />', errors: primary },
      { code: '<button className="stg:bg-destructive!" />', errors: destructive },
      // A member element is still a button.
      { code: '<motion.button className="stg:bg-primary" />', errors: primary },
      // A same-file constant, alone or through cn().
      { code: 'const PRIMARY = "stg:inline-flex stg:bg-primary stg:px-3"; <button className={PRIMARY} />', errors: primary },
      { code: 'const DANGER = `stg:bg-destructive stg:text-destructive-foreground`; <a className={cn(DANGER, "stg:px-2")} />', errors: destructive },
      // Only the kit's button folder is exempt, not any folder named button.
      { code: '<button className="stg:bg-primary" />', filename: "/repo/client-apps/web/src/components/button/X.tsx", errors: primary },
    ],
  });
});
