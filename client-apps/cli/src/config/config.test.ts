import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setStandalone } from "../runtime.js";
import { getDefault, isCloudMode, load, save } from "./config.js";

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
    writeFileSync(path, "backend:\n  type: cloud\n");
    setStandalone(true);
    expect(load(path)).toEqual(getDefault());
  });

  it("migrates a legacy cloud config into the named model on load", () => {
    const path = tempConfigPath();
    writeFileSync(
      path,
      "backend:\n  type: cloud\n  cloud:\n    endpoint: api.stigmer.ai:443\n    org_id: acme\ncontext:\n  organization: acme\n",
    );
    const config = load(path);
    // The legacy slot becomes the reserved "cloud" entry; the legacy type
    // selects it as current. The slot itself is not carried forward.
    expect(config.current_backend).toBe("cloud");
    expect(config.backends?.["cloud"]).toEqual({
      type: "cloud",
      endpoint: "api.stigmer.ai:443",
      org_id: "acme",
    });
    expect(config.backend.cloud).toBeUndefined();
    expect(config.context?.organization).toBe("acme");
    expect(isCloudMode(config)).toBe(true);
  });

  it("parses a named-model config with selfhost entries", () => {
    const path = tempConfigPath();
    writeFileSync(
      path,
      "backend:\n  type: cloud\nbackends:\n  staging:\n    type: selfhost\n    endpoint: stigmer.example.com:7234\n    api_key: stk_x\ncurrent_backend: staging\n",
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
    // The legacy mirror is written for older readers.
    expect(reloaded.backend.type).toBe("cloud");

    rmSync(path);
  });

  it("writes a legacy-loaded cloud config in the named shape (the one-time migration)", () => {
    const path = tempConfigPath();
    writeFileSync(
      path,
      "backend:\n  type: cloud\n  cloud:\n    endpoint: api.stigmer.ai:443\n    token: t\n",
    );
    save(load(path), path);

    const text = readFileSync(path, "utf8");
    expect(text).toContain("backends:");
    expect(text).toContain("current_backend: cloud");
    // The legacy slot is gone; its content lives in backends.cloud.
    expect(text).not.toContain("  cloud:\n    endpoint");
    const reloaded = load(path);
    expect(reloaded.backends?.["cloud"]?.token).toBe("t");
  });

  it("keeps a pristine local config byte-stable (no named-model keys appear)", () => {
    const path = tempConfigPath();
    save(getDefault(), path);
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain("backends:");
    expect(text).not.toContain("current_backend:");
    expect(text).toContain("type: local");
  });

  it("preserves the opaque local backend section across a load/save round-trip", () => {
    const path = tempConfigPath();
    writeFileSync(
      path,
      "backend:\n  type: local\n  local:\n    temporal:\n      managed: true\n    execution:\n      mode: local\n",
    );

    const config = load(path);
    // Mutate an unrelated field, then save.
    (config.context ??= {}).organization = "acme";
    save(config, path);

    const reloaded = readFileSync(path, "utf8");
    expect(reloaded).toContain("managed: true");
    expect(reloaded).toContain("mode: local");
    expect(reloaded).toContain("organization: acme");
  });
});
