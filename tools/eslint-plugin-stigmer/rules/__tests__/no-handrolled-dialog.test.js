"use strict";

// Pins the `no-handrolled-dialog` fence: a JSX <dialog> outside
// internal/DialogShell.tsx is reported (stigmer#653), and so is a Base UI
// dialog or alert dialog by any import a person writes, a subpath or a name
// from the package root, because either bypasses the shell the same way
// (stigmer#2772). Each valid case differs from a reported one in one respect,
// so none passes for an unrelated reason. An element that only says it is a
// dialog (`role="dialog"` or `role="alertdialog"`) is reported too. It is the
// bar's CON-15 (every dialog is the kit's), held here with a static case that
// the fence is an error in the kit's and both apps' lint configs. Run via the
// root `npm run test:scripts` (the `test:root` globs in package.json).

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");

const rule = require("../no-handrolled-dialog");

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

const handrolledDialog = [{ messageId: "handrolledDialog" }];
const role = (name) => [{ messageId: "handrolledRole", data: { role: name } }];

/** The three lint configs the fence must stand in: the kit's and both apps'. */
const CONFIGS = ["sdk/react/eslint.config.mjs", "client-apps/web/eslint.config.mjs", "client-apps/desktop/eslint.config.mjs"];
const REPO = join(__dirname, "..", "..", "..", "..");
const baseUiDialog = [{ messageId: "baseUiDialog" }];

describe("CON-15 every dialog is the kit's", () => {
  it("the dialog fence is an error in the kit's and both apps' lint configs, so no new hand-rolled dialog lands anywhere", () => {
    for (const config of CONFIGS) {
      const text = readFileSync(join(REPO, config), "utf8");
      assert.match(text, /"stigmer\/no-handrolled-dialog":\s*"error"/, `${config} turns the fence on as an error`);
    }
  });

tester.run("no-handrolled-dialog", rule, {
  valid: [
    // The shell itself owns the element.
    { code: "<dialog open />", filename: "/repo/sdk/react/src/internal/DialogShell.tsx" },
    // Other Base UI primitives, by subpath and from the root.
    { code: 'import { Popover } from "@base-ui/react/popover";' },
    { code: 'import { Menu } from "@base-ui/react/menu";' },
    { code: 'import { Popover, Tooltip } from "@base-ui/react";' },
    // A local name that only looks like a dialog import.
    { code: 'import { Dialog } from "./Dialog";' },
    { code: 'import { DialogShell } from "../internal/DialogShell.js";' },
    // A lowercase JSX element that is not <dialog>.
    { code: "<details open />" },
    // A role that is not a dialog's, and a dialog role inside the shell.
    { code: '<div role="region" />' },
    { code: '<div role="dialog" />', filename: "/repo/sdk/react/src/internal/DialogShell.tsx" },
    // A role the code computes is not read.
    { code: "<div role={kind} />" },
    // A component that sets its own role (a Base UI popover's popup).
    { code: '<Popover.Popup role="dialog" aria-label="Model selector" />' },
    { code: '<Panel role="dialog" />' },
  ],
  invalid: [
    // A hand-rolled element, anywhere but the shell.
    { code: "<dialog open />", errors: handrolledDialog },
    { code: "<dialog open />", filename: "/repo/sdk/react/src/run/Confirm.tsx", errors: handrolledDialog },
    // An element that says it is a dialog, as a string or a constant expression.
    { code: '<div role="dialog" aria-modal="true" />', errors: role("dialog") },
    { code: '<section role="alertdialog" />', errors: role("alertdialog") },
    { code: '<div role={"dialog"} />', errors: role("dialog") },
    { code: "<div role={`dialog`} />", errors: role("dialog") },
    // Base UI's dialogs by subpath, named, aliased or as a namespace.
    { code: 'import { Dialog } from "@base-ui/react/dialog";', errors: baseUiDialog },
    { code: 'import { AlertDialog } from "@base-ui/react/alert-dialog";', errors: baseUiDialog },
    { code: 'import * as D from "@base-ui/react/dialog";', errors: baseUiDialog },
    { code: 'import { Dialog as BaseDialog } from "@base-ui/react/dialog";', errors: baseUiDialog },
    // By name from the package root, each name its own report.
    { code: 'import { Dialog } from "@base-ui/react";', errors: baseUiDialog },
    { code: 'import { Popover, AlertDialog as Confirm } from "@base-ui/react";', errors: baseUiDialog },
    {
      code: 'import { Dialog, AlertDialog } from "@base-ui/react";',
      errors: [...baseUiDialog, ...baseUiDialog],
    },
    // The subpath is refused in the shell's file too: the shell is a <dialog>.
    {
      code: 'import { Dialog } from "@base-ui/react/dialog";',
      filename: "/repo/sdk/react/src/internal/DialogShell.tsx",
      errors: baseUiDialog,
    },
  ],
});
});
