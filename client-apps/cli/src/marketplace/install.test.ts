// Pins how a ref becomes a prepared push: an offered entry prepares through
// the same walker `push plugin` uses (one digest for one tree); a version
// pin is an assertion; a bare name is searched across the known sources and
// must land in exactly one; a GitHub source is asked through its marketplace
// file alone and its zipball fetched only when the file declares the name (a
// repository with no file declares nothing; a declared entry the tree does
// not hold is not a holder); every temp tree a search opened is disposed,
// whatever the outcome.

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { preparePluginPush } from "../resources/plugin.js";
import { writeCursorMarketplace } from "./__fixtures__/cursor-marketplace.js";
import { type MarketplaceListing, OFFICIAL_MARKETPLACE } from "./config.js";
import { assertVersion, locateEntry, prepareEntry } from "./install.js";
import { readMarketplaceTree } from "./read.js";
import { parseInstallRef } from "./ref.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "stigmer-marketplace-install-"));
  writeCursorMarketplace(root);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("prepareEntry", () => {
  it("prepares an offered entry exactly as push plugin would prepare its directory", async () => {
    const tree = readMarketplaceTree(root);
    const viaMarketplace = await prepareEntry(tree, "github");
    const viaFolder = await preparePluginPush(join(root, "third_party", "github"));
    expect(viaMarketplace.plugin.name).toBe("github");
    expect(viaMarketplace.digest).toBe(viaFolder.digest);
    expect(
      Buffer.from(viaMarketplace.archive).equals(
        Buffer.from(viaFolder.archive),
      ),
    ).toBe(true);
  });

  it("refuses an entry the marketplace does not offer, quoting the drop sentence when there is one", async () => {
    const tree = readMarketplaceTree(root);
    await expect(prepareEntry(tree, "ghost")).rejects.toThrow(
      /does not offer a plugin named 'ghost'\n\n.*ghost.*\n\nRun 'stigmer marketplace show acme-plugins' to see the 2 it offers/s,
    );
    await expect(prepareEntry(tree, "nope")).rejects.toThrow(
      /does not offer a plugin named 'nope'\n\nRun 'stigmer marketplace show/,
    );
  });
});

describe("assertVersion", () => {
  it("passes without a pin or with the offered version, refuses another naming the offered one", async () => {
    const prepared = await prepareEntry(readMarketplaceTree(root), "thermos");
    expect(() => assertVersion(prepared, undefined, "thermos")).not.toThrow();
    expect(() =>
      assertVersion(prepared, "1.0.0", "thermos@1.0.0"),
    ).not.toThrow();
    expect(() =>
      assertVersion(prepared, "9.9.9", "acme-plugins/thermos@9.9.9"),
    ).toThrow(
      /pins version 9\.9\.9, but the marketplace offers 'thermos' at 1\.0\.0\n\nInstall it as 'acme-plugins\/thermos@1\.0\.0'/,
    );
  });
});

describe("locateEntry", () => {
  const encoder = new TextEncoder();

  /**
   * A GitHub source served from memory: raw.githubusercontent.com answers a
   * single file from the map (404 when absent), codeload answers the tree
   * zipped under one top directory. `requests` records every URL asked.
   */
  function servingZipOf(
    files: Record<string, string>,
    top = "r-HEAD",
    requests: string[] = [],
  ): typeof globalThis.fetch {
    const tree: Record<string, Uint8Array> = {};
    for (const [path, content] of Object.entries(files))
      tree[`${top}/${path}`] = encoder.encode(content);
    const bytes = zipSync(tree);
    return async (input) => {
      const url = String(input);
      requests.push(url);
      const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/);
      if (raw !== null) {
        const content = files[raw[1] ?? ""];
        return content === undefined
          ? new Response("Not Found", { status: 404 })
          : new Response(content, { status: 200 });
      }
      return new Response(bytes, { status: 200 });
    };
  }

  const remoteFiles = {
    "marketplace.json": JSON.stringify({
      name: "remote",
      plugins: [{ name: "thermos", source: "./thermos" }],
    }),
    "thermos/plugin.json": JSON.stringify({
      name: "thermos",
      version: "3.0.0",
    }),
  };

  function listing(...extra: MarketplaceListing["known"]): MarketplaceListing {
    return { known: [OFFICIAL_MARKETPLACE, ...extra], unreadable: [] };
  }

  it("opens the marketplace a prefixed ref names and refuses an unknown prefix", async () => {
    const local = {
      name: "acme-plugins",
      source: { type: "local", path: root } as const,
    };
    const located = await locateEntry(
      parseInstallRef("acme-plugins/thermos"),
      listing(local),
    );
    try {
      expect(located.marketplace.name).toBe("acme-plugins");
      expect(located.tree.root).toBe(root);
    } finally {
      located.open.dispose();
    }
    await expect(
      locateEntry(parseInstallRef("nowhere/thermos"), listing(local)),
    ).rejects.toThrow(/no marketplace named 'nowhere' is configured/);
  });

  it("searches a bare name across every marketplace and lands in the one holder, disposing the rest", async () => {
    const local = {
      name: "acme-plugins",
      source: { type: "local", path: root } as const,
    };
    const located = await locateEntry(
      parseInstallRef("github"),
      listing(local),
    );
    try {
      expect(located.marketplace.name).toBe("acme-plugins");
    } finally {
      located.open.dispose();
    }
  });

  it("refuses a bare name nobody offers, naming what was searched and what could not be read", async () => {
    const local = {
      name: "acme-plugins",
      source: { type: "local", path: root } as const,
    };
    await expect(
      locateEntry(parseInstallRef("nope"), {
        known: [OFFICIAL_MARKETPLACE, local],
        unreadable: [{ name: "broken", reason: "x" }],
      }),
    ).rejects.toThrow(
      /no configured marketplace offers a plugin named 'nope'\n\nSearched: stigmer, acme-plugins\. Not searched.*broken/,
    );
  });

  it("refuses a bare name two marketplaces offer, naming each qualified ref, and leaves no temp tree behind", async () => {
    const local = {
      name: "acme-plugins",
      source: { type: "local", path: root } as const,
    };
    const remote = {
      name: "remote",
      source: { type: "github", repo: "a/b" } as const,
    };
    const before = countTempTrees();
    await expect(
      locateEntry(parseInstallRef("thermos"), listing(local, remote), {
        fetchImpl: servingZipOf(remoteFiles),
      }),
    ).rejects.toThrow(
      /offered by more than one marketplace: acme-plugins, remote\n\nName the one you mean: acme-plugins\/thermos or remote\/thermos/,
    );
    expect(countTempTrees()).toBe(before);
  });

  it("asks a GitHub source through its marketplace file alone and downloads the zipball only for a holder", async () => {
    const local = {
      name: "acme-plugins",
      source: { type: "local", path: root } as const,
    };
    const remote = {
      name: "remote",
      source: { type: "github", repo: "a/b" } as const,
    };
    const requests: string[] = [];
    // `github` is offered by the local fixture alone: the remote is peeked, not downloaded.
    const located = await locateEntry(parseInstallRef("github"), listing(local, remote), {
      fetchImpl: servingZipOf(remoteFiles, "r-HEAD", requests),
    });
    located.open.dispose();
    expect(requests.some((url) => url.startsWith("https://raw.githubusercontent.com/a/b/"))).toBe(true);
    expect(requests.some((url) => url.startsWith("https://codeload.github.com/"))).toBe(false);
  });

  it("treats a GitHub repository with no marketplace file as declaring nothing, and a declared entry the tree lacks as not held", async () => {
    const empty = {
      name: "empty",
      source: { type: "github", repo: "a/b" } as const,
    };
    await expect(
      locateEntry(parseInstallRef("nope"), listing(empty), {
        fetchImpl: servingZipOf({}),
      }),
    ).rejects.toThrow(/no configured marketplace offers a plugin named 'nope'\n\nSearched: stigmer, empty\./);

    const phantom = {
      name: "phantom",
      source: { type: "github", repo: "a/b" } as const,
    };
    const before = countTempTrees();
    await expect(
      locateEntry(parseInstallRef("ghost"), listing(phantom), {
        fetchImpl: servingZipOf({
          "marketplace.json": JSON.stringify({
            name: "phantom",
            plugins: [{ name: "ghost", source: "./ghost" }],
          }),
        }),
      }),
    ).rejects.toThrow(/no configured marketplace offers a plugin named 'ghost'/);
    expect(countTempTrees()).toBe(before);
  });

  it("disposes a fetched tree when the located entry is released", async () => {
    const remote = {
      name: "remote",
      source: { type: "github", repo: "a/b" } as const,
    };
    const located = await locateEntry(
      parseInstallRef("remote/thermos"),
      listing(remote),
      {
        fetchImpl: servingZipOf(remoteFiles),
      },
    );
    expect(existsSync(located.tree.root)).toBe(true);
    located.open.dispose();
    expect(existsSync(located.tree.root)).toBe(false);
  });
});

/** The temp trees `openMarketplace` creates (`stigmer-marketplace-` plus mkdtemp's suffix and nothing else). */
function countTempTrees(): number {
  return readdirSync(tmpdir()).filter((name) =>
    /^stigmer-marketplace-[A-Za-z0-9]+$/.test(name),
  ).length;
}
