/**
 * Every dialog the kit draws reads with one title, one body and one set of
 * acts: each file that renders the shell (`<DialogShell`) draws its title
 * with `DialogHeader`, and its acts with `DialogFooter` unless its acts
 * belong to a form it holds. The viewers that ride the shell with no title,
 * body or acts (a picture, a file, a turn's change, the chat popup) are
 * named here with their reason, so a new dialog cannot skip the parts
 * silently. It is the bar's CON-15, beside the lint fence's own cases.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "..");

/** Files that render the shell without the parts, and why. */
const VIEWERS: Readonly<Record<string, string>> = {
  "upload/ImageLightbox.tsx": "a picture shown whole, its only act its close button",
  "run/FilePreviewModal.tsx": "the session viewer's file preview, which passed as built",
  "session/TurnChangeDialog.tsx": "the session viewer's turn change, which passed as built",
  "agent-chat/AgentChat.tsx": "the chat popup, the session viewer's, which passed as built",
};

/** Dialogs whose acts belong to the form or the view they hold, so they draw no footer of their own. */
const ACTS_IN_THEIR_FORM: Readonly<Record<string, string>> = {
  "channel/ChannelConversationsDialog.tsx": "a read-only list of sessions; its close is the header's",
  "channel/ChannelTemplatesDialog.tsx": "a read-only list of templates; its close is the header's",
  "conversation/ConversationTemplatePickerDialog.tsx": "the chosen template's form carries Send",
  "organization/OrgSwitcher.tsx": "CreateOrganizationForm carries Create and Cancel",
  "routine/RoutineApiPanel.tsx": "CreateServiceAccountForm carries its acts",
  "plugin/MarketplaceCatalog.tsx": "PluginUploader carries its acts",
  "skill/SkillDiffDialog.tsx": "a read-only diff; its close is the header's",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

const DIALOGS = sources(SRC)
  .map((path) => ({ file: relative(SRC, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }))
  .filter(({ file, text }) => file !== "internal/DialogShell.tsx" && text.includes("<DialogShell"));

describe("CON-15 every dialog is the kit's: one title, body and footer, its acts at its end", () => {
  it("finds the dialogs it reads", () => {
    expect(DIALOGS.length).toBeGreaterThan(20);
  });

  const titled = DIALOGS.filter(({ file }) => !(file in VIEWERS));
  const withActs = titled.filter(({ file }) => !(file in ACTS_IN_THEIR_FORM));

  it.each(titled.map(({ file }) => file))("%s draws its title with DialogHeader", (file) => {
    const { text } = DIALOGS.find((dialog) => dialog.file === file)!;
    expect(text, `${file} renders a dialog without DialogHeader`).toContain("<DialogHeader");
  });

  it.each(withActs.map(({ file }) => file))("%s draws its acts with DialogFooter", (file) => {
    const { text } = DIALOGS.find((dialog) => dialog.file === file)!;
    expect(text, `${file} renders a dialog without DialogFooter`).toContain("<DialogFooter");
  });

  it("names a reason for every dialog it leaves out", () => {
    for (const reason of [...Object.values(VIEWERS), ...Object.values(ACTS_IN_THEIR_FORM)]) expect(reason.length).toBeGreaterThan(10);
    expect(withActs.length).toBeGreaterThan(10);
  });

  it("names only files that render the shell", () => {
    const files = new Set(DIALOGS.map(({ file }) => file));
    for (const file of [...Object.keys(VIEWERS), ...Object.keys(ACTS_IN_THEIR_FORM)]) expect(files, file).toContain(file);
  });
});
