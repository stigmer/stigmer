"use strict";

// Pins the `no-handrolled-dialog` fence: a JSX <dialog> outside
// internal/DialogShell.tsx is reported (stigmer#653), and so is a Base UI
// dialog or alert dialog by any import a person writes, a subpath or a name
// from the package root, because either bypasses the shell the same way
// (stigmer#2772). Each valid case differs from a reported one in one respect,
// so none passes for an unrelated reason. Run via the root
// `npm run test:scripts` (the `test:root` globs in package.json).

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
const baseUiDialog = [{ messageId: "baseUiDialog" }];

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
  ],
  invalid: [
    // A hand-rolled element, anywhere but the shell.
    { code: "<dialog open />", errors: handrolledDialog },
    { code: "<dialog open />", filename: "/repo/sdk/react/src/run/Confirm.tsx", errors: handrolledDialog },
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
