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

  it("parses a cloud config", () => {
    const path = tempConfigPath();
    writeFileSync(
      path,
      "backend:\n  type: cloud\n  cloud:\n    endpoint: api.stigmer.ai:443\n    org_id: acme\ncontext:\n  organization: acme\n",
    );
    const config = load(path);
    expect(config.backend.type).toBe("cloud");
    expect(config.backend.cloud?.org_id).toBe("acme");
    expect(config.context?.organization).toBe("acme");
  });
});

describe("save", () => {
  it("round-trips a config and writes a 0600 file with the doc header", () => {
    const path = tempConfigPath();
    const config = getDefault();
    config.backend.type = "cloud";
    config.backend.cloud = { endpoint: "api.stigmer.ai:443", token: "t", org_id: "acme" };
    save(config, path);

    const text = readFileSync(path, "utf8");
    expect(text).toContain("# Stigmer CLI Configuration");
    expect(load(path)).toEqual(config);

    rmSync(path);
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
