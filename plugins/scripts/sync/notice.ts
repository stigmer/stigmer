/**
 * `plugins/NOTICE`, rendered from the pins; pure.
 *
 * One notice for the whole catalogue, in the shape of the plugin reader's
 * fixture notice (`backend/libs/ts/plugin-package/src/__tests__/fixtures/cursor-plugins/NOTICE`):
 * per source its URL and commit, per folder its path in the source and the
 * licence file it carries. Nothing generated lives inside a vendored
 * folder, so that the folder stays identical to its source and an install
 * from either place computes one digest; the attribution therefore stands
 * beside the folders, and ships with them (`stage-content.mjs` copies it).
 *
 * The text is derived: `vendor.json` is the fact, this file is the reading
 * of it a person opens first. The static suite pins that the two agree.
 */

import { comparePaths } from "@stigmer/plugin-package";

import { repositoryUrl } from "../lib/git-tree.js";
import type { VendorPins } from "../lib/vendor-pins.js";

export function renderNotice(pins: VendorPins): string {
  const lines: string[] = [
    "Vendored plugins in Stigmer's official catalogue.",
    "",
    "Every folder named below is a byte-for-byte copy of a directory in a",
    "vendor's public repository at the commit named, file modes included, with",
    "nothing of Stigmer's inside it: the licence beside each plugin is the",
    "vendor's own, and what Stigmer adds (the pins in vendor.json, this notice,",
    "the marketplace file) lives outside the folders. That is what lets the same",
    "plugin, installed from this catalogue or from the vendor's repository,",
    "carry one digest.",
    "",
    "Nothing under a vendored folder is formatted, linted or edited; a change",
    "there is a re-sync at a new commit (`npm run sync -w @stigmer/plugins`),",
    "which rewrites this notice from vendor.json.",
  ];
  for (const [name, pin] of Object.entries(pins.sources)) {
    const rows = pins.plugins.filter((row) => row.source === name).sort((a, b) => comparePaths(a.name, b.name));
    if (rows.length === 0) continue;
    lines.push("", `Source:  ${repositoryUrl(pin.repo).replace(/\.git$/, "")}`, `Commit:  ${pin.commit}`, `License: each folder carries its own licence file, vendored unchanged.`, "");
    lines.push("Directories and their paths in the source repository:", "");
    const width = Math.max(...rows.map((row) => row.name.length)) + 1;
    for (const row of rows) lines.push(`  ${`${row.name}/`.padEnd(width + 1)} <- ${row.path}/  (${row.licence})`);
  }
  return `${lines.join("\n")}\n`;
}
