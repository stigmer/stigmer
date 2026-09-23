/**
 * The sync's decisions and renderings over fixtures, and its tree copy over
 * a temporary directory; no `git`, no network.
 *
 * Pins: an audit's `vendor` verdicts become rows at the audit's commits,
 * minus the struck and minus a folder whose licence is the repository's
 * rather than its own, with a name vendored twice refused on the second;
 * strikes carry forward and a `--strike` joins them; the tree plan copies
 * every row, deletes a row that is gone, and refuses a row that would land
 * on a folder the sync did not write; a source's commit stays where it was
 * when neither its bytes nor its rows moved; the marketplace order is by
 * name, rendered one entry per line; the notice
 * names every source, commit, folder, path and licence file; the refresh
 * pull request's body carries the decision sections in the report's order
 * and the folders that moved, never the catalogue tables; a copied tree is
 * byte-identical, executable bits included, and a re-copy is detected as
 * unchanged.
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AuditRun } from "../scripts/audit/report.js";
import type { VendorPins } from "../scripts/lib/vendor-pins.js";
import { readMarketplaceHead, renderMarketplace } from "../scripts/sync/marketplace.js";
import { renderNotice } from "../scripts/sync/notice.js";
import { marketplaceOrder, pinsFromAudit, planTree, settleCommits } from "../scripts/sync/plan.js";
import { renderRefreshBody } from "../scripts/sync/refresh-body.js";
import { copyTree, listTree, treesDiffer } from "../scripts/sync/tree.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const DIGEST = "d".repeat(64);

const CURSOR = { name: "cursor-plugins", repo: "cursor/plugins" };
const CODEX = { name: "codex-plugins", repo: "openai/plugins" };

/** An audit run reduced to what `pinsFromAudit` reads: the catalogues' commits and the verdicts' entries. */
function audit(entries: readonly { source: typeof CURSOR; name: string; dir: string; licencePath?: string; verdict: "vendor" | "exclude" }[]): AuditRun {
  const run = {
    generatedAt: "2026-09-19T00:00:00.000Z",
    catalogues: [
      { source: CURSOR, commit: SHA_A, marketplacePath: ".cursor-plugin/marketplace.json", dialect: "cursor", entries: [], dropped: [], rootLicence: { licence: "none" } },
      { source: CODEX, commit: SHA_B, marketplacePath: ".agents/plugins/marketplace.json", dialect: "codex", entries: [], dropped: [], rootLicence: { licence: "none" } },
    ],
    verdicts: {
      entries: entries.map((e) => ({
        entry: {
          source: e.source,
          commit: e.source === CURSOR ? SHA_A : SHA_B,
          name: e.name,
          dir: e.dir,
          licence: e.licencePath === undefined ? { licence: "none" } : { licence: "mit", path: e.licencePath },
          read: { ok: true, dialect: "cursor", skills: [], subAgents: [], servers: [], variables: [], ignored: [], warnings: [], digest: DIGEST, filesIncluded: 1 },
        },
        servers: [],
        verdict: e.verdict === "vendor" ? { kind: "vendor" } : { kind: "exclude", failures: [] },
        flags: { personalAccount: false, inferredVariables: [], vendorAuthHint: false },
      })),
      authoredCandidates: [],
      preRegisteredVendors: [],
    },
    probes: [],
  };
  return run as unknown as AuditRun;
}

const PREVIOUS: VendorPins = {
  sources: { "cursor-plugins": { repo: "cursor/plugins", commit: SHA_C } },
  plugins: [{ name: "thermos", source: "cursor-plugins", path: "thermos", licence: "LICENSE", digest: DIGEST }],
  struck: [{ source: "cursor-plugins", name: "orchestrate", reason: "carries a .gitignore" }],
};

describe("pinsFromAudit", () => {
  const run = audit([
    { source: CURSOR, name: "thermos", dir: "thermos", licencePath: "thermos/LICENSE", verdict: "vendor" },
    { source: CURSOR, name: "gong", dir: "third_party/gong", licencePath: "third_party/gong/LICENSE.txt", verdict: "vendor" },
    { source: CURSOR, name: "orchestrate", dir: "orchestrate", licencePath: "orchestrate/LICENSE", verdict: "vendor" },
    { source: CURSOR, name: "root-licensed", dir: "third_party/root-licensed", licencePath: "LICENSE", verdict: "vendor" },
    { source: CURSOR, name: "excluded", dir: "excluded", licencePath: "excluded/LICENSE", verdict: "exclude" },
    { source: CODEX, name: "superpowers", dir: "plugins/superpowers", licencePath: "plugins/superpowers/LICENSE", verdict: "vendor" },
    { source: CODEX, name: "thermos", dir: "plugins/thermos", licencePath: "plugins/thermos/LICENSE", verdict: "vendor" },
  ]);

  it("rows from the vendor verdicts at the audit's commits, minus the struck and the root-licensed, the second of a name refused", () => {
    const { pins, skipped } = pinsFromAudit(run, PREVIOUS);
    expect(pins.sources).toEqual({ "cursor-plugins": { repo: "cursor/plugins", commit: SHA_A }, "codex-plugins": { repo: "openai/plugins", commit: SHA_B } });
    expect(pins.plugins).toEqual([
      { name: "thermos", source: "cursor-plugins", path: "thermos", licence: "LICENSE", digest: DIGEST },
      { name: "gong", source: "cursor-plugins", path: "third_party/gong", licence: "LICENSE.txt", digest: DIGEST },
      { name: "superpowers", source: "codex-plugins", path: "plugins/superpowers", licence: "LICENSE", digest: DIGEST },
    ]);
    expect(skipped).toEqual([
      { source: "cursor-plugins", name: "orchestrate", reason: "struck" },
      { source: "cursor-plugins", name: "root-licensed", reason: "its licence is the repository's root file, not the folder's; a copy could not carry the text that permits it" },
      { source: "codex-plugins", name: "thermos", reason: "'thermos' is already vendored from cursor-plugins; strike one of the two" },
    ]);
    expect(pins.struck).toEqual(PREVIOUS.struck);
  });

  it("a --strike joins the carried strikes and removes its row, the later reason winning", () => {
    const { pins } = pinsFromAudit(run, PREVIOUS, [
      { source: "cursor-plugins", name: "gong", reason: "authored instead" },
      { source: "cursor-plugins", name: "orchestrate", reason: "a newer reason" },
    ]);
    expect(pins.plugins.map((row) => row.name)).toEqual(["thermos", "superpowers"]);
    expect(pins.struck).toEqual([
      { source: "cursor-plugins", name: "orchestrate", reason: "a newer reason" },
      { source: "cursor-plugins", name: "gong", reason: "authored instead" },
    ]);
  });
});

describe("planTree", () => {
  const next: VendorPins = {
    sources: { "cursor-plugins": { repo: "cursor/plugins", commit: SHA_A } },
    plugins: [{ name: "gong", source: "cursor-plugins", path: "third_party/gong", licence: "LICENSE", digest: DIGEST }],
    struck: [],
  };

  it("copies every next row and deletes a previous row that is gone and still on disk", () => {
    expect(planTree(PREVIOUS, next, new Set(["assistant", "thermos"]))).toEqual({ copies: next.plugins, deletions: ["thermos"] });
    expect(planTree(PREVIOUS, next, new Set(["assistant"])).deletions).toEqual([]);
  });

  it("refuses a row that would land on a folder the sync did not write", () => {
    expect(() => planTree(PREVIOUS, next, new Set(["gong"]))).toThrow(
      "'gong' from cursor-plugins would replace a folder the sync did not write (an authored plugin, or a directory added by hand); rename the authored plugin or strike the entry",
    );
  });
});

describe("settleCommits", () => {
  const next: VendorPins = { ...PREVIOUS, sources: { "cursor-plugins": { repo: "cursor/plugins", commit: SHA_A } } };

  it("keeps a source's commit when neither its bytes nor its rows moved, and moves it otherwise", () => {
    expect(settleCommits(PREVIOUS, next, new Set()).sources["cursor-plugins"]?.commit).toBe(SHA_C);
    expect(settleCommits(PREVIOUS, next, new Set(["cursor-plugins"])).sources["cursor-plugins"]?.commit).toBe(SHA_A);
    const withRow: VendorPins = { ...next, plugins: [...next.plugins, { name: "gong", source: "cursor-plugins", path: "third_party/gong", licence: "LICENSE", digest: DIGEST }] };
    expect(settleCommits(PREVIOUS, withRow, new Set()).sources["cursor-plugins"]?.commit).toBe(SHA_A);
    const fresh: VendorPins = { ...next, sources: { ...next.sources, "codex-plugins": { repo: "openai/plugins", commit: SHA_B } } };
    expect(settleCommits(PREVIOUS, fresh, new Set()).sources["codex-plugins"]?.commit).toBe(SHA_B);
  });
});

describe("the marketplace rendering", () => {
  it("orders every name by name", () => {
    expect(marketplaceOrder(new Set(["zoom", "linear", "gong"]))).toEqual(["gong", "linear", "zoom"]);
  });

  it("keeps the head a person wrote and renders one entry per line", () => {
    const head = { name: "stigmer", description: "The catalogue.", owner: { name: "Stigmer", url: "https://stigmer.ai" } };
    const text = renderMarketplace(head, new Set(["linear", "gong"]));
    expect(text).toBe(
      [
        "{",
        '  "name": "stigmer",',
        '  "description": "The catalogue.",',
        '  "owner": {"name":"Stigmer","url":"https://stigmer.ai"},',
        '  "plugins": [',
        '    { "name": "gong", "source": "./gong" },',
        '    { "name": "linear", "source": "./linear" }',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
    expect(readMarketplaceHead(text, "marketplace.json")).toEqual(head);
  });
});

describe("renderNotice", () => {
  it("names every source with its commit and every folder with its path and licence file", () => {
    const pins: VendorPins = {
      sources: { "cursor-plugins": { repo: "cursor/plugins", commit: SHA_A }, "codex-plugins": { repo: "openai/plugins", commit: SHA_B }, empty: { repo: "x/y", commit: SHA_C } },
      plugins: [
        { name: "thermos", source: "cursor-plugins", path: "thermos", licence: "LICENSE", digest: DIGEST },
        { name: "gong", source: "cursor-plugins", path: "third_party/gong", licence: "LICENSE.txt", digest: DIGEST },
        { name: "superpowers", source: "codex-plugins", path: "plugins/superpowers", licence: "LICENSE", digest: DIGEST },
      ],
      struck: [],
    };
    const notice = renderNotice(pins);
    expect(notice).toContain("Source:  https://github.com/cursor/plugins\nCommit:  " + SHA_A);
    expect(notice).toContain("  gong/     <- third_party/gong/  (LICENSE.txt)\n  thermos/  <- thermos/  (LICENSE)");
    expect(notice).toContain("Source:  https://github.com/openai/plugins\nCommit:  " + SHA_B);
    expect(notice).toContain("  superpowers/  <- plugins/superpowers/  (LICENSE)");
    expect(notice).not.toContain("x/y");
    expect(notice.endsWith("\n")).toBe(true);
  });
});

describe("renderRefreshBody", () => {
  it("carries the decision sections in the report's order and the folders that moved, and leaves the catalogue tables out", () => {
    const report = [
      "# Vendor catalogue audit",
      "",
      "## Summary",
      "",
      "| Catalogue | Vendor |",
      "",
      "## cursor-plugins: `cursor/plugins` at `abc`",
      "",
      "| a very long table |",
      "",
      "## Endpoints to author",
      "",
      "| https://mcp.linear.app/mcp | oauth | `codex-plugins/linear` |",
      "",
      "## Rule 5 flags: excluded on a word, for you to move",
      "",
      "- `cursor-plugins/gmail`",
      "",
    ].join("\n");
    const changes = " M plugins/vendor.json\n?? plugins/gong/\n M plugins/thermos/skills/thermos/SKILL.md\n";
    const body = renderRefreshBody({ report, changes, runUrl: "https://github.com/stigmer/stigmer/actions/runs/1" });
    expect(body).toContain("Run: https://github.com/stigmer/stigmer/actions/runs/1");
    expect(body).toContain("## What moved in the tree\n\n- `gong/`\n- `thermos/`\n- `vendor.json`");
    expect(body.indexOf("## Summary")).toBeLessThan(body.indexOf("## Rule 5 flags"));
    expect(body.indexOf("## Rule 5 flags")).toBeLessThan(body.indexOf("## Endpoints to author"));
    expect(body).not.toContain("a very long table");
    expect(renderRefreshBody({ report, changes: "", runUrl: "" })).toContain("Nothing: the pins and the tree already agreed.");
  });
});

describe("the tree copy", () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const temp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "stigmer-sync-test-"));
    scratch.push(dir);
    return dir;
  };

  it("copies files, bytes and executable bits, replaces what was there, and a re-copy reads as unchanged", () => {
    const source = temp();
    mkdirSync(join(source, "skills", "run"), { recursive: true });
    writeFileSync(join(source, "plugin.json"), '{"name":"x"}');
    writeFileSync(join(source, "skills", "run", "go.sh"), "#!/bin/sh\n");
    chmodSync(join(source, "skills", "run", "go.sh"), 0o755);
    const destination = join(temp(), "x");
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "stale.txt"), "from an earlier commit");

    copyTree(source, destination);
    expect(listTree(destination).map((file) => [file.path, file.executable])).toEqual([
      ["plugin.json", false],
      ["skills/run/go.sh", true],
    ]);
    expect(readFileSync(join(destination, "skills", "run", "go.sh"), "utf8")).toBe("#!/bin/sh\n");
    expect(statSync(join(destination, "skills", "run", "go.sh")).mode & 0o111).not.toBe(0);
    expect(treesDiffer(source, destination)).toBe(false);

    chmodSync(join(destination, "skills", "run", "go.sh"), 0o644);
    expect(treesDiffer(source, destination)).toBe(true);
    copyTree(source, destination);
    writeFileSync(join(destination, "plugin.json"), '{"name":"y"}');
    expect(treesDiffer(source, destination)).toBe(true);
  });
});
