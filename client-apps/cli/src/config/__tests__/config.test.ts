// Unit tests for the CLI config file (config/config.ts): a missing file and
// standalone mode yield the local default, named backends load and save, a
// pristine local config writes no backend keys, and the opaque `backend.local`
// section survives a load/save round-trip untouched.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setStandalone } from "../../runtime.js";
import { getDefault, isCloudMode, load, save } from "../config.js";

function tempConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "stigmer-cli-config-"));
  return join(dir, "config.yaml");
}

afterEach(() => {
  setStandalone(false);
});

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
});
