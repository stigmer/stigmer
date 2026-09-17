// Pins the marketplace list over the real config file (HOME redirected):
// the official one is always first and never stored; add and remove round-
// trip through the file's own dialect (`type`); a hand-edited entry the CLI
// cannot read is listed with its reason, kept on save, and named when a
// command asks for it; the reserved name and --standalone refuse.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configPath, load } from "../config/index.js";
import { setStandalone } from "../runtime.js";
import {
  OFFICIAL_MARKETPLACE_NAME,
  addMarketplace,
  describeSource,
  findMarketplace,
  isOwnerRepo,
  listMarketplaces,
  narrowEntry,
  removeMarketplace,
} from "./config.js";

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "stigmer-marketplace-config-"));
  process.env.HOME = home;
});

afterEach(() => {
  setStandalone(false);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

function writeConfig(yaml: string): void {
  mkdirSync(join(home, ".stigmer"), { recursive: true });
  writeFileSync(configPath(), yaml);
}

describe("listMarketplaces", () => {
  it("is the official marketplace alone on a fresh machine", () => {
    const listing = listMarketplaces();
    expect(listing.known.map((m) => m.name)).toEqual([
      OFFICIAL_MARKETPLACE_NAME,
    ]);
    expect(listing.known[0]?.source).toEqual({ type: "official" });
    expect(listing.unreadable).toEqual([]);
  });

  it("lists configured entries after the official one, in file order, and names the unreadable ones", () => {
    writeConfig(
      [
        "backend:",
        "  type: local",
        "marketplaces:",
        "  cursor-plugins:",
        "    type: github",
        "    repo: cursor/plugins",
        "  pinned:",
        "    type: github",
        "    repo: anthropics/claude-code",
        "    ref: v1.2.3",
        "  team:",
        "    type: local",
        "    path: /srv/plugins",
        "  broken:",
        "    type: gitlab",
        "    repo: a/b",
        "  typeless:",
        "    repo: a/b",
        "",
      ].join("\n"),
    );
    const listing = listMarketplaces();
    expect(listing.known.map((m) => m.name)).toEqual([
      "stigmer",
      "cursor-plugins",
      "pinned",
      "team",
    ]);
    expect(listing.known[1]?.source).toEqual({
      type: "github",
      repo: "cursor/plugins",
    });
    expect(listing.known[2]?.source).toEqual({
      type: "github",
      repo: "anthropics/claude-code",
      ref: "v1.2.3",
    });
    expect(listing.known[3]?.source).toEqual({
      type: "local",
      path: "/srv/plugins",
    });
    expect(listing.unreadable).toEqual([
      {
        name: "broken",
        reason: "unknown type 'gitlab' (expected 'github' or 'local')",
      },
      { name: "typeless", reason: "no 'type' (expected 'github' or 'local')" },
    ]);
  });
});

describe("addMarketplace and removeMarketplace", () => {
  it("round-trips a github source and a local source through the file", () => {
    addMarketplace("cursor-plugins", {
      type: "github",
      repo: "cursor/plugins",
    });
    addMarketplace("team", { type: "local", path: "/srv/plugins" });
    const text = readFileSync(configPath(), "utf8");
    expect(text).toContain("marketplaces:");
    expect(text).toContain("type: github");
    expect(text).toContain("repo: cursor/plugins");
    expect(text).not.toContain("ref:");
    expect(text).toContain("path: /srv/plugins");
    expect(listMarketplaces().known.map((m) => m.name)).toEqual([
      "stigmer",
      "cursor-plugins",
      "team",
    ]);

    removeMarketplace("cursor-plugins");
    expect(listMarketplaces().known.map((m) => m.name)).toEqual([
      "stigmer",
      "team",
    ]);
    removeMarketplace("team");
    expect(load().marketplaces).toBeUndefined();
    expect(readFileSync(configPath(), "utf8")).not.toContain("marketplaces");
  });

  it("keeps the rest of the config and an unreadable entry across a save", () => {
    writeConfig(
      "backend:\n  type: cloud\nbackends:\n  cloud:\n    type: cloud\n    token: t\ncurrent_backend: cloud\nmarketplaces:\n  broken:\n    type: gitlab\n",
    );
    addMarketplace("team", { type: "local", path: "/srv/plugins" });
    const after = load();
    expect(after.current_backend).toBe("cloud");
    expect(after.backends?.["cloud"]?.token).toBe("t");
    expect(after.marketplaces?.["broken"]).toEqual({ type: "gitlab" });
    expect(after.marketplaces?.["team"]).toEqual({
      type: "local",
      path: "/srv/plugins",
    });
  });

  it("refuses the reserved name, a duplicate, an unknown removal, and the reserved removal", () => {
    expect(() =>
      addMarketplace("stigmer", { type: "local", path: "/x" }),
    ).toThrow(/built-in marketplace/);
    addMarketplace("team", { type: "local", path: "/srv/plugins" });
    expect(() =>
      addMarketplace("team", { type: "local", path: "/other" }),
    ).toThrow(/already configured/);
    expect(() => removeMarketplace("nope")).toThrow(
      /no marketplace named 'nope'/,
    );
    expect(() => removeMarketplace("stigmer")).toThrow(/cannot be removed/);
  });

  it("refuses under --standalone instead of writing a default file over the user's", () => {
    writeConfig(
      "backend:\n  type: cloud\nbackends:\n  cloud:\n    type: cloud\n    token: t\ncurrent_backend: cloud\n",
    );
    setStandalone(true);
    expect(() => addMarketplace("team", { type: "local", path: "/x" })).toThrow(
      /--standalone/,
    );
    expect(() => removeMarketplace("team")).toThrow(/--standalone/);
    setStandalone(false);
    expect(load().backends?.["cloud"]?.token).toBe("t");
  });
});

describe("findMarketplace", () => {
  it("finds the official and configured ones, returns undefined for an unknown name, and names an unreadable entry", () => {
    writeConfig(
      "backend:\n  type: local\nmarketplaces:\n  team:\n    type: local\n    path: /srv\n  broken:\n    type: gitlab\n",
    );
    expect(findMarketplace("stigmer")?.source).toEqual({ type: "official" });
    expect(findMarketplace("team")?.source).toEqual({
      type: "local",
      path: "/srv",
    });
    expect(findMarketplace("nope")).toBeUndefined();
    expect(() => findMarketplace("broken")).toThrow(
      /configured but cannot be read: unknown type 'gitlab'/,
    );
  });
});

describe("narrowEntry, describeSource, isOwnerRepo", () => {
  it("refuses a github entry without a repo and a local entry without a path", () => {
    expect(narrowEntry({ type: "github" })).toEqual({
      ok: false,
      reason: "type 'github' needs 'repo: owner/repo'",
    });
    expect(narrowEntry({ type: "github", repo: "not-a-repo" })).toEqual({
      ok: false,
      reason: "type 'github' needs 'repo: owner/repo'",
    });
    expect(narrowEntry({ type: "github", repo: "a/b", ref: "" })).toEqual({
      ok: false,
      reason: "'ref' must be a non-empty branch, tag or commit",
    });
    expect(narrowEntry({ type: "local" })).toEqual({
      ok: false,
      reason: "type 'local' needs 'path: <directory>'",
    });
  });

  it("describes each source in one phrase", () => {
    expect(describeSource({ type: "official" })).toBe("built in");
    expect(describeSource({ type: "github", repo: "cursor/plugins" })).toBe(
      "github.com/cursor/plugins",
    );
    expect(
      describeSource({ type: "github", repo: "cursor/plugins", ref: "main" }),
    ).toBe("github.com/cursor/plugins@main");
    expect(describeSource({ type: "local", path: "/srv/plugins" })).toBe(
      "/srv/plugins",
    );
  });

  it("accepts owner/repo as GitHub spells it and nothing else", () => {
    expect(isOwnerRepo("cursor/plugins")).toBe(true);
    expect(isOwnerRepo("my-org/my.repo_1")).toBe(true);
    expect(isOwnerRepo("cursor")).toBe(false);
    expect(isOwnerRepo("a/b/c")).toBe(false);
    expect(isOwnerRepo("../x")).toBe(false);
    expect(isOwnerRepo("a/")).toBe(false);
  });
});
