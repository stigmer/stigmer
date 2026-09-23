/**
 * The marketplace reader's suite: one accepted fixture per dialect pinning
 * the normalised shape, the verbatim `cursor/plugins` catalogue read over a
 * partial tree (the six vendored plugins at their source paths, the other
 * seventy-three reported as directories the tree does not hold), and the
 * adversarial contract: one fixture per finding kind, asserting the complete
 * sorted list of kinds and the sentence of the kind under test. The two
 * adversarial tables are `Record`s over the kind unions, so a kind added to
 * `marketplace/outcome.ts` without a case here does not compile.
 */

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { inMemoryPluginFiles, PLUGIN_DOCUMENT_LIMITS, type PluginFileEntry, type PluginFiles } from "../files.js";
import type { Marketplace, MarketplaceErrorKind, MarketplaceFinding, MarketplaceReadOutcome, MarketplaceWarningKind } from "../marketplace/outcome.js";
import { hasMarketplaceFile, readMarketplace, readMarketplaceFile } from "../marketplace/read-marketplace.js";
import { cursorPlugin, openPlugin, type PluginFixture } from "../testing.js";
import { directoryPluginFiles } from "../__test-utils__/directory-files.js";
import { findingOf, type Kinds } from "../__test-utils__/read.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/cursor-plugins/", import.meta.url));

/** A marketplace tree from a map, with plugin fixtures mounted under their directories. */
function tree(marketplaceFile: string, content: unknown, plugins: Readonly<Record<string, PluginFixture>> = {}): PluginFiles {
  const files = new Map<string, string | Uint8Array>();
  files.set(marketplaceFile, typeof content === "string" ? content : JSON.stringify(content));
  for (const [dir, fixture] of Object.entries(plugins)) {
    for (const [path, bytes] of fixture) files.set(dir === "" ? path : `${dir}/${path}`, bytes);
  }
  return inMemoryPluginFiles(files);
}

function kindsOf(outcome: MarketplaceReadOutcome): Kinds {
  const sorted = (findings: readonly MarketplaceFinding[]): string[] => findings.map((f) => f.kind).sort();
  return outcome.ok
    ? { errors: [], warnings: sorted(outcome.warnings) }
    : { errors: sorted(outcome.errors), warnings: sorted(outcome.warnings) };
}

function accepted(outcome: MarketplaceReadOutcome): Marketplace {
  if (!outcome.ok) {
    expect.fail(`expected an accepted marketplace, got refusals:\n${outcome.errors.map((f) => `  ${f.kind}: ${f.message}`).join("\n")}`);
  }
  return outcome.marketplace;
}

function refused(outcome: MarketplaceReadOutcome): readonly MarketplaceFinding[] {
  if (outcome.ok) {
    expect.fail(`expected a refusal, got an accepted marketplace '${outcome.marketplace.name}'`);
  }
  return outcome.errors;
}

const errors = (...kinds: MarketplaceErrorKind[]): Kinds => ({ errors: [...kinds].sort(), warnings: [] });
const warnings = (...kinds: MarketplaceWarningKind[]): Kinds => ({ errors: [], warnings: [...kinds].sort() });

const STIGMER_FILE = "marketplace.json";
const alpha = openPlugin({ name: "alpha" });
const beta = openPlugin({ name: "beta" });

describe("hasMarketplaceFile", () => {
  it("routes on any of the four locations and nothing else", () => {
    expect(hasMarketplaceFile(["marketplace.json"])).toBe(true);
    expect(hasMarketplaceFile([".claude-plugin/marketplace.json"])).toBe(true);
    expect(hasMarketplaceFile([".cursor-plugin/marketplace.json"])).toBe(true);
    expect(hasMarketplaceFile([".agents/plugins/marketplace.json"])).toBe(true);
    expect(hasMarketplaceFile(["plugin.json", "thermos/marketplace.json"])).toBe(false);
  });
});

describe("the Stigmer file (root marketplace.json)", () => {
  const outcome = readMarketplace(
    tree(
      STIGMER_FILE,
      {
        name: "stigmer",
        description: "The official catalogue.",
        owner: { name: "Stigmer", url: "https://stigmer.ai" },
        plugins: [
          { name: "alpha", source: "./alpha" },
          { name: "beta", source: "beta/", description: "Beta, described by the catalogue." },
        ],
      },
      { alpha, beta },
    ),
  );

  it("is accepted with no warnings", () => {
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: [] });
  });

  it("carries identity, dialect, path and entries in file order", () => {
    const marketplace = accepted(outcome);
    expect(marketplace.name).toBe("stigmer");
    expect(marketplace.description).toBe("The official catalogue.");
    expect(marketplace.owner).toEqual({ name: "Stigmer", url: "https://stigmer.ai" });
    expect(marketplace.dialect).toBe("stigmer");
    expect(marketplace.path).toBe(STIGMER_FILE);
    expect(marketplace.plugins).toEqual([
      { name: "alpha", dir: "alpha" },
      { name: "beta", dir: "beta", description: "Beta, described by the catalogue." },
    ]);
  });

  it("ignores a `defaults` list, the retired install-unasked field, whatever it holds", () => {
    for (const defaults of [["alpha"], ["gamma"], 7]) {
      const read = readMarketplace(tree(STIGMER_FILE, { name: "acme", plugins: [{ name: "alpha", source: "./alpha" }], defaults }, { alpha }));
      expect(kindsOf(read)).toEqual({ errors: [], warnings: [] });
      expect(accepted(read).plugins).toEqual([{ name: "alpha", dir: "alpha" }]);
      expect(Object.keys(accepted(read))).not.toContain("defaults");
    }
  });

  it("offers the tree root itself when the source is '.' (a single-plugin marketplace)", () => {
    const single = readMarketplace(tree(STIGMER_FILE, { name: "solo", plugins: [{ name: "alpha", source: "." }] }, { "": alpha }));
    expect(accepted(single).plugins).toEqual([{ name: "alpha", dir: "" }]);
  });

  it("takes precedence over a vendor file in the same tree", () => {
    const files = tree(STIGMER_FILE, { name: "ours", plugins: [] });
    const both = inMemoryPluginFiles(
      new Map<string, string>([
        ...files.entries.map((e: PluginFileEntry) => [e.path, new TextDecoder().decode(files.read(e.path))] as const),
        [".cursor-plugin/marketplace.json", JSON.stringify({ name: "theirs", plugins: [] })],
      ]),
    );
    expect(accepted(readMarketplace(both)).name).toBe("ours");
  });
});

describe("the Claude Code file (.claude-plugin/marketplace.json)", () => {
  const outcome = readMarketplace(
    tree(
      ".claude-plugin/marketplace.json",
      {
        name: "acme-tools",
        owner: { name: "Acme", email: "plugins@acme.example" },
        metadata: { description: "Acme's plugins", version: "3", pluginRoot: "./plugins" },
        plugins: [
          { name: "alpha", source: "./alpha", description: "Alpha." },
          { name: "remote", source: { source: "github", repo: "acme/remote" } },
          { name: "subdir", source: { source: "git-subdir", url: "acme/mono", path: "plugins/x" } },
        ],
      },
      { "plugins/alpha": alpha },
    ),
  );

  it("reads metadata.description and metadata.pluginRoot, drops remote sources with one warning each", () => {
    expect(kindsOf(outcome)).toEqual(warnings("entry-source-unsupported", "entry-source-unsupported"));
    const marketplace = accepted(outcome);
    expect(marketplace.dialect).toBe("claude");
    expect(marketplace.description).toBe("Acme's plugins");
    expect(marketplace.owner).toEqual({ name: "Acme", email: "plugins@acme.example" });
    expect(marketplace.plugins).toEqual([{ name: "alpha", dir: "plugins/alpha", description: "Alpha." }]);
    const messages = outcome.warnings.map((w) => w.message);
    expect(messages).toContain(
      "plugin 'remote' in '.claude-plugin/marketplace.json' has source 'github', a form Stigmer does not fetch (only a directory inside the marketplace); not offered",
    );
    expect(messages).toContain(
      "plugin 'subdir' in '.claude-plugin/marketplace.json' has source 'git-subdir', a form Stigmer does not fetch (only a directory inside the marketplace); not offered",
    );
  });
});

describe("the Codex file (.agents/plugins/marketplace.json)", () => {
  const outcome = readMarketplace(
    tree(
      ".agents/plugins/marketplace.json",
      {
        name: "local",
        interface: { displayName: "Local Plugins" },
        plugins: [
          { name: "alpha", source: { source: "local", path: "./plugins/alpha" }, policy: { installation: "INSTALLED_BY_DEFAULT", authentication: "ON_INSTALL" }, category: "Productivity" },
          { name: "beta", source: { source: "local", path: "./plugins/beta" }, policy: { installation: "AVAILABLE", authentication: "ON_USE" } },
        ],
      },
      { "plugins/alpha": alpha, "plugins/beta": beta },
    ),
  );

  it("reads local sources and offers an INSTALLED_BY_DEFAULT entry like any other; the display name is not a description", () => {
    expect(kindsOf(outcome)).toEqual({ errors: [], warnings: [] });
    const marketplace = accepted(outcome);
    expect(marketplace.dialect).toBe("codex");
    expect(marketplace.description).toBeUndefined();
    expect(marketplace.plugins.map((p) => p.dir)).toEqual(["plugins/alpha", "plugins/beta"]);
  });
});

describe("the Cursor file, verbatim from cursor/plugins at c1c0a32, over a partial tree", () => {
  // The six vendored plugin directories mounted where the catalogue names
  // them; the marketplace file byte-for-byte. Cursor writes sources without
  // a `./` prefix and nests third-party plugins under `third_party/`.
  const mounts: Readonly<Record<string, string>> = {
    thermos: "thermos",
    advisor: "advisor",
    "third_party/github": "github",
    "third_party/xero": "xero",
    "third_party/playwright": "playwright",
    "third_party/salesforce": "salesforce",
  };
  const catalogue = directoryPluginFiles(`${FIXTURES}.cursor-plugin`);
  const files = new Map<string, Uint8Array>();
  files.set(".cursor-plugin/marketplace.json", catalogue.read("marketplace.json"));
  for (const [dir, fixture] of Object.entries(mounts)) {
    const plugin = directoryPluginFiles(`${FIXTURES}${fixture}`);
    for (const entry of plugin.entries) files.set(`${dir}/${entry.path}`, plugin.read(entry.path));
  }
  const outcome = readMarketplace(inMemoryPluginFiles(files));

  it("offers the six the tree holds and reports the seventy-three it does not, one warning each", () => {
    const marketplace = accepted(outcome);
    expect(marketplace.name).toBe("cursor-plugins");
    expect(marketplace.dialect).toBe("cursor");
    expect(marketplace.owner).toEqual({ name: "Cursor", email: "plugins@cursor.com" });
    expect(marketplace.description).toBe("Official Cursor plugin marketplace: developer tools, framework rules, MCP integrations, and agent skills");
    expect(marketplace.plugins.map((p) => p.name).sort()).toEqual(["advisor", "github", "playwright", "salesforce", "thermos", "xero"]);
    expect(marketplace.plugins.find((p) => p.name === "github")).toEqual({
      name: "github",
      dir: "third_party/github",
      description: "Manage repos, issues, pull requests, and Actions.",
    });
    expect(outcome.warnings).toHaveLength(73);
    expect(new Set(outcome.warnings.map((w) => w.kind))).toEqual(new Set(["entry-directory-missing"]));
  });

  it("read as a file alone, declares all seventy-nine with no directory warnings: the CLI's bare-name peek", () => {
    const fileOnly = readMarketplaceFile(
      inMemoryPluginFiles(new Map([[".cursor-plugin/marketplace.json", files.get(".cursor-plugin/marketplace.json")!]])),
    );
    const declared = accepted(fileOnly);
    expect(declared.plugins).toHaveLength(79);
    expect(declared.plugins.map((p) => p.name)).toContain("thermos");
    expect(fileOnly.warnings.filter((w) => w.kind === "entry-directory-missing")).toEqual([]);
    // Still refused for what the file itself gets wrong, exactly as the tree read is.
    expect(readMarketplaceFile(inMemoryPluginFiles(new Map([["README.md", "x"]]))).ok).toBe(false);
  });

  it("offers every entry when the whole catalogue is present (the sources all resolve inside the root)", () => {
    // Every source directory given one manifest, so the file's own shape is
    // proven independently of which plugins the fixtures vendor.
    const complete = new Map<string, Uint8Array | string>([[".cursor-plugin/marketplace.json", catalogue.read("marketplace.json")]]);
    const parsed = JSON.parse(new TextDecoder().decode(catalogue.read("marketplace.json"))) as { plugins: { name: string; source: string }[] };
    for (const entry of parsed.plugins) {
      for (const [path, bytes] of cursorPlugin({ name: entry.name })) complete.set(`${entry.source}/${path}`, bytes);
    }
    const whole = readMarketplace(inMemoryPluginFiles(complete));
    expect(kindsOf(whole)).toEqual({ errors: [], warnings: [] });
    expect(accepted(whole).plugins).toHaveLength(79);
  });
});

interface Case {
  readonly files: PluginFiles;
  /** Every kind the read produces, sorted. */
  readonly kinds: Kinds;
  /** The sentence of the kind under test (a string, or a regex source for a parser's own text). */
  readonly message: string;
}

const ERROR_CASES: Record<MarketplaceErrorKind, Case> = {
  "marketplace-not-found": {
    files: inMemoryPluginFiles(new Map([["README.md", "no marketplace here"]])),
    kinds: errors("marketplace-not-found"),
    message:
      "no marketplace file found: expected one of 'marketplace.json', '.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json', '.agents/plugins/marketplace.json'",
  },
  "marketplace-too-large": {
    files: inMemoryPluginFiles(new Map([[STIGMER_FILE, new Uint8Array(PLUGIN_DOCUMENT_LIMITS.marketplace + 1)]])),
    kinds: errors("marketplace-too-large"),
    message: `'marketplace.json' is ${PLUGIN_DOCUMENT_LIMITS.marketplace + 1} bytes, above the ${PLUGIN_DOCUMENT_LIMITS.marketplace} byte cap for a marketplace file`,
  },
  "marketplace-unreadable": {
    files: tree(STIGMER_FILE, "{ oops"),
    kinds: errors("marketplace-unreadable"),
    message: /^'marketplace.json' is not a readable marketplace file: /.source,
  },
  "marketplace-field-type": {
    files: tree(STIGMER_FILE, { name: 7, plugins: [] }),
    kinds: errors("marketplace-field-type"),
    message: "'marketplace.json' field 'name' must be a string",
  },
  "marketplace-name-missing": {
    files: tree(STIGMER_FILE, { plugins: [] }),
    kinds: errors("marketplace-name-missing"),
    message: "'marketplace.json' has no 'name'; a marketplace needs one so its plugins can be addressed as '<marketplace>/<plugin>'",
  },
  "marketplace-name-invalid": {
    files: tree(STIGMER_FILE, { name: "Acme Tools", plugins: [] }),
    kinds: errors("marketplace-name-invalid"),
    message: "'marketplace.json' name 'Acme Tools' is invalid: 1 to 64 characters of a-z, 0-9, '-' and '.', starting and ending alphanumeric, no '--' or '..'",
  },
  "marketplace-plugins-missing": {
    files: tree(STIGMER_FILE, { name: "acme" }),
    kinds: errors("marketplace-plugins-missing"),
    message: "'marketplace.json' has no 'plugins' list",
  },
  "entry-shape": {
    files: tree(STIGMER_FILE, { name: "acme", plugins: ["alpha"] }),
    kinds: errors("entry-shape"),
    message: "'marketplace.json' plugins[0] must be an object with 'name' and 'source'",
  },
  "entry-name-missing": {
    files: tree(STIGMER_FILE, { name: "acme", plugins: [{ source: "./alpha" }] }),
    kinds: errors("entry-name-missing"),
    message: "'marketplace.json' plugins[0] has no 'name'",
  },
  "entry-name-invalid": {
    files: tree(STIGMER_FILE, { name: "acme", plugins: [{ name: "Alpha!", source: "./alpha" }] }),
    kinds: errors("entry-name-invalid"),
    message: "'marketplace.json' plugin 'Alpha!' has an invalid name: 1 to 64 characters of a-z, 0-9, '-' and '.', starting and ending alphanumeric, no '--' or '..'",
  },
  "entry-name-duplicate": {
    files: tree(
      STIGMER_FILE,
      { name: "acme", plugins: [{ name: "alpha", source: "./alpha" }, { name: "alpha", source: "./beta" }] },
      { alpha, beta },
    ),
    kinds: errors("entry-name-duplicate"),
    message: "'marketplace.json' lists plugin 'alpha' more than once; 'install alpha' would be ambiguous",
  },
  "entry-source-missing": {
    files: tree(STIGMER_FILE, { name: "acme", plugins: [{ name: "alpha" }] }),
    kinds: errors("entry-source-missing"),
    message: "'marketplace.json' plugin 'alpha' has no 'source'",
  },
  "entry-source-escapes-root": {
    files: tree(STIGMER_FILE, { name: "acme", plugins: [{ name: "alpha", source: "../alpha" }] }),
    kinds: errors("entry-source-escapes-root"),
    message: "'marketplace.json' plugin 'alpha' has source '../alpha' outside the marketplace root; a source is a directory inside the marketplace",
  },
};

const WARNING_CASES: Record<MarketplaceWarningKind, Case> = {
  "entry-source-unsupported": {
    files: tree(STIGMER_FILE, { name: "acme", plugins: [{ name: "alpha", source: "https://example.com/alpha.zip" }] }),
    kinds: warnings("entry-source-unsupported"),
    message:
      "plugin 'alpha' in 'marketplace.json' has source 'https://example.com/alpha.zip', a form Stigmer does not fetch (only a directory inside the marketplace); not offered",
  },
  "entry-directory-missing": {
    files: tree(STIGMER_FILE, { name: "acme", plugins: [{ name: "alpha", source: "./alpha" }] }),
    kinds: warnings("entry-directory-missing"),
    message: "plugin 'alpha' in 'marketplace.json' names directory 'alpha', which the marketplace does not contain; not offered",
  },
  "entry-not-a-plugin": {
    files: tree(STIGMER_FILE, { name: "acme", plugins: [{ name: "alpha", source: "./alpha" }] }, { alpha: new Map([["README.md", "not a plugin"]]) }),
    kinds: warnings("entry-not-a-plugin"),
    message: "plugin 'alpha' in 'marketplace.json' names directory 'alpha', which holds no plugin manifest; not offered",
  },
};

describe("adversarial marketplaces: one fixture per error kind", () => {
  for (const [kind, testCase] of Object.entries(ERROR_CASES) as [MarketplaceErrorKind, Case][]) {
    it(`${kind}: refused with its sentence and nothing else`, () => {
      const outcome = readMarketplace(testCase.files);
      expect(kindsOf(outcome)).toEqual(testCase.kinds);
      const finding = findingOf(refused(outcome), kind);
      if (testCase.message.startsWith("^")) expect(finding.message).toMatch(new RegExp(testCase.message));
      else expect(finding.message).toBe(testCase.message);
    });
  }
});

describe("adversarial marketplaces: one fixture per warning kind", () => {
  for (const [kind, testCase] of Object.entries(WARNING_CASES) as [MarketplaceWarningKind, Case][]) {
    it(`${kind}: the entry is dropped with its sentence and the marketplace is still offered`, () => {
      const outcome = readMarketplace(testCase.files);
      expect(kindsOf(outcome)).toEqual(testCase.kinds);
      const marketplace = accepted(outcome);
      expect(marketplace.plugins).toEqual([]);
      expect(findingOf(outcome.warnings, kind).message).toBe(testCase.message);
    });
  }
});
