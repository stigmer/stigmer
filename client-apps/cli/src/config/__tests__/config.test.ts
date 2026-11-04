// Unit tests for the CLI config file (config/config.ts): a missing file and
// standalone mode yield the local default, named backends load and save, a
// pristine local config writes no backend keys, and the opaque `backend.local`
// section survives a load/save round-trip untouched.
//
// A save replaces the file in one step, because many CLI processes write it and
// a long-running one (`stigmer mcp-server`) reads it while others save: no
// temporary file is left behind, a symlinked config stays a link and its
// target gets the content, and a write that fails part-way leaves the old file
// whole. The failing write is simulated by a node:fs mock that writes half the
// text to the temporary file and then throws, as a full disk would.

import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setStandalone } from "../../runtime.js";
import { getDefault, isCloudMode, load, save } from "../config.js";

// When set, the next write to a temporary file stops half-way and throws.
let failNextTemporaryWrite = false;

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const writeFileSync: typeof actual.writeFileSync = (file, data, options) => {
    if (failNextTemporaryWrite && String(file).endsWith(".tmp")) {
      failNextTemporaryWrite = false;
      actual.writeFileSync(file, String(data).slice(0, String(data).length / 2), options);
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    }
    actual.writeFileSync(file, data, options);
  };
  return { ...actual, writeFileSync, default: { ...actual, writeFileSync } };
});

function tempConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "stigmer-cli-config-"));
  return join(dir, "config.yaml");
}

afterEach(() => {
  setStandalone(false);
  failNextTemporaryWrite = false;
});

function cloudConfig(token: string): ReturnType<typeof getDefault> {
  const config = getDefault();
  (config.backends ??= {})["cloud"] = { type: "cloud", endpoint: "api.stigmer.ai:443", token };
  config.current_backend = "cloud";
  return config;
}

describe("load", () => {
  it("returns the local default when the file is missing", () => {
    const config = load(join(tempConfigPath(), "does-not-exist.yaml"));
    expect(config).toEqual(getDefault());
    expect(isCloudMode(config)).toBe(false);
  });

  it("returns the default in standalone mode without reading the file", () => {
    const path = tempConfigPath();
    writeFileSync(path, "backends:\n  cloud:\n    type: cloud\ncurrent_backend: cloud\n");
    setStandalone(true);
    expect(load(path)).toEqual(getDefault());
  });

  it("parses a named-model config with selfhost entries", () => {
    const path = tempConfigPath();
    writeFileSync(
      path,
      "backends:\n  staging:\n    type: selfhost\n    endpoint: stigmer.example.com:7234\n    api_key: stk_x\ncurrent_backend: staging\n",
    );
    const config = load(path);
    expect(config.current_backend).toBe("staging");
    expect(config.backends?.["staging"]?.type).toBe("selfhost");
    expect(config.backends?.["staging"]?.api_key).toBe("stk_x");
    expect(isCloudMode(config)).toBe(false);
  });
});

describe("save", () => {
  it("round-trips a config and writes a 0600 file with the doc header", () => {
    const path = tempConfigPath();
    const config = getDefault();
    (config.backends ??= {})["cloud"] = {
      type: "cloud",
      endpoint: "api.stigmer.ai:443",
      token: "t",
      org_id: "acme",
    };
    config.current_backend = "cloud";
    save(config, path);

    const text = readFileSync(path, "utf8");
    expect(text).toContain("# Stigmer CLI Configuration");
    const reloaded = load(path);
    expect(reloaded.backends).toEqual(config.backends);
    expect(reloaded.current_backend).toBe("cloud");
    expect(text).not.toContain("backend:\n");

    rmSync(path);
  });

  it("writes no backend keys for a pristine local config", () => {
    const path = tempConfigPath();
    save(getDefault(), path);
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain("backend");
    expect(load(path)).toEqual(getDefault());
  });

  it("preserves the opaque local backend section across a load/save round-trip", () => {
    const path = tempConfigPath();
    writeFileSync(
      path,
      "backend:\n  local:\n    temporal:\n      managed: true\n    execution:\n      mode: local\n",
    );

    const config = load(path);
    // Mutate an unrelated field, then save.
    (config.context ??= {}).org = "acme";
    save(config, path);

    const reloaded = readFileSync(path, "utf8");
    expect(reloaded).toContain("managed: true");
    expect(reloaded).toContain("mode: local");
    expect(reloaded).toContain("org: acme");
  });

  it("leaves no temporary file and keeps a 0600 mode across saves", () => {
    const path = tempConfigPath();
    save(cloudConfig("first"), path);
    save(cloudConfig("second"), path);

    expect(readdirSync(join(path, ".."))).toEqual(["config.yaml"]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(load(path).backends?.["cloud"]?.token).toBe("second");
  });

  it("writes a symlinked config through its link, keeping the link", () => {
    const dotfiles = mkdtempSync(join(tmpdir(), "stigmer-cli-dotfiles-"));
    const target = join(dotfiles, "stigmer.yaml");
    writeFileSync(target, "");
    const path = tempConfigPath();
    symlinkSync(target, path);

    save(cloudConfig("linked"), path);

    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(load(target).backends?.["cloud"]?.token).toBe("linked");
    expect(readdirSync(dotfiles)).toEqual(["stigmer.yaml"]);
  });

  it("writes through a link whose target does not exist yet", () => {
    const dotfiles = mkdtempSync(join(tmpdir(), "stigmer-cli-dotfiles-"));
    const target = join(dotfiles, "stigmer.yaml");
    const path = tempConfigPath();
    symlinkSync(target, path);

    save(cloudConfig("first-save"), path);

    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(load(target).backends?.["cloud"]?.token).toBe("first-save");
  });

  it("leaves the old file whole when the write fails part-way", () => {
    const path = tempConfigPath();
    save(cloudConfig("kept"), path);
    const before = readFileSync(path, "utf8");

    failNextTemporaryWrite = true;
    expect(() => save(cloudConfig("lost"), path)).toThrow(/ENOSPC/);

    expect(readFileSync(path, "utf8")).toBe(before);
    expect(readdirSync(join(path, ".."))).toEqual(["config.yaml"]);
  });
});
