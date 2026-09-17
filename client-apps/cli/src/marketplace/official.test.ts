// Pins the official marketplace's resolution: the repo tree wins when this
// module runs from a checkout; otherwise the package is acquired once at the
// CLI's version into the runtimes root, reused on the next call, and refused
// for a non-release build that has nothing installed.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireOfficialMarketplace,
  resolveOfficialMarketplace,
} from "./official.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "stigmer-official-marketplace-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function fakeInstall(installDir: string): void {
  const pkg = join(installDir, "node_modules", "@stigmer", "plugins");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, "marketplace.json"),
    JSON.stringify({ name: "stigmer", plugins: [] }),
  );
}

describe("resolveOfficialMarketplace", () => {
  it("uses the repo tree when running from a checkout", () => {
    const resolved = resolveOfficialMarketplace({ home });
    expect(resolved.source).toBe("repo");
    expect(resolved.dir.endsWith(join("", "plugins"))).toBe(true);
  });

  it("acquires the package when there is no checkout, once, and reuses it", () => {
    let installs = 0;
    const install = (installDir: string): void => {
      installs += 1;
      fakeInstall(installDir);
    };
    const first = resolveOfficialMarketplace({
      home,
      version: "1.2.3",
      install,
      repoDir: () => null,
    });
    const second = resolveOfficialMarketplace({
      home,
      version: "1.2.3",
      install,
      repoDir: () => null,
    });
    expect(first.source).toBe("package");
    expect(first.dir).toBe(
      join(
        home,
        ".stigmer",
        "runtimes",
        "1.2.3",
        "node_modules",
        "@stigmer",
        "plugins",
      ),
    );
    expect(second.dir).toBe(first.dir);
    expect(installs).toBe(1);
  });
});

describe("acquireOfficialMarketplace", () => {
  it("refuses to acquire for a non-release build with nothing installed", () => {
    expect(() =>
      acquireOfficialMarketplace({
        home,
        version: "0.0.0-dev",
        install: () => {},
      }),
    ).toThrow(/cannot acquire @stigmer\/plugins for a non-release build/);
  });

  it("uses already-installed content even for a non-release build", () => {
    const installDir = join(home, ".stigmer", "runtimes", "0.0.0-dev");
    fakeInstall(installDir);
    let installs = 0;
    const dir = acquireOfficialMarketplace({
      home,
      version: "0.0.0-dev",
      install: () => {
        installs += 1;
      },
    });
    expect(dir).toBe(join(installDir, "node_modules", "@stigmer", "plugins"));
    expect(installs).toBe(0);
  });

  it("refuses when the install did not produce the marketplace file", () => {
    expect(() =>
      acquireOfficialMarketplace({ home, version: "1.2.3", install: () => {} }),
    ).toThrow(/install did not produce/);
  });
});
