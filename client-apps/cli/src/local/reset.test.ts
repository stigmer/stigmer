import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configPath } from "../config/paths.js";
import { binDir, configDir, databasePath, dataDir, temporalDataDir } from "./paths.js";
import { reset } from "./reset.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "stigmer-reset-"));
});

function seedState(): void {
  mkdirSync(dataDir(home), { recursive: true });
  mkdirSync(temporalDataDir(home), { recursive: true });
  mkdirSync(binDir(home), { recursive: true });
  writeFileSync(databasePath(home), "db");
  writeFileSync(`${databasePath(home)}-wal`, "wal");
  writeFileSync(join(dataDir(home), "runner.pid"), "1");
  writeFileSync(configPath(home), "backend:\n  type: local\n");
}

const noopStop = vi.fn(async () => true);

describe("reset", () => {
  it("wipes state but preserves config by default", async () => {
    seedState();
    const result = await reset({}, home, noopStop);

    expect(result.servicesStopped).toBe(true);
    expect(existsSync(dataDir(home))).toBe(false);
    expect(existsSync(databasePath(home))).toBe(false);
    expect(existsSync(`${databasePath(home)}-wal`)).toBe(false);
    expect(existsSync(temporalDataDir(home))).toBe(false);
    expect(existsSync(binDir(home))).toBe(false);
    // Config is preserved.
    expect(existsSync(configPath(home))).toBe(true);
    expect(result.removedPaths).toContain(dataDir(home));
  });

  it("removes config when includeConfig is set", async () => {
    seedState();
    await reset({ includeConfig: true }, home, noopStop);
    expect(existsSync(configPath(home))).toBe(false);
  });

  it("reports services not stopped when nothing was running", async () => {
    mkdirSync(configDir(home), { recursive: true });
    const result = await reset({}, home, vi.fn(async () => false));
    expect(result.servicesStopped).toBe(false);
  });
});
