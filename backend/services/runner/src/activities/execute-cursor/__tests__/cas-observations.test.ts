/**
 * Unit tests for the Cursor cas-observations sidecar — the disk-backed observer
 * of gitignored writes.
 *
 * Two surfaces, both covered here:
 *  - the READER ({@link readCasObservations}) the runner boundary calls;
 *  - the WRITER SCRIPT ({@link buildObservationStagingScript}) the hook runs on
 *    the runner's Node binary. The writer is executed here through the SAME
 *    `node -e` invocation the hook uses (salient via stdin, workspace root + obs
 *    dir via argv), so these tests exercise the real staged bytes and the real
 *    secret classification — and the classifier is locked byte-for-byte against
 *    {@link isSecretLikePath} to prevent drift.
 *
 * Skipped automatically where bash/node semantics differ; node is always present
 * in the test runner.
 */

import { describe, it, expect, onTestFinished } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readCasObservations,
  resetCasObservations,
  casObservationsDir,
  buildObservationStagingScript,
} from "../cas-observations.js";
import { isSecretLikePath } from "../../../shared/filereview/secret-paths.js";

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => {
    // Best-effort cleanup; the OS temp dir is reclaimed regardless.
    try {
      execFileSync("rm", ["-rf", dir]);
    } catch {
      /* ignore */
    }
  });
  return dir;
}

/**
 * Run the real staging script exactly as the hook does: salient on stdin, the
 * workspace root and observations dir on argv. Returns the emitted token.
 */
function runStaging(wsRoot: string, obsDir: string, salient: string): string {
  return execFileSync(process.execPath, ["-e", buildObservationStagingScript(), wsRoot, obsDir], {
    input: salient,
  })
    .toString()
    .trim();
}

describe("cas-observations sidecar", () => {
  describe("readCasObservations", () => {
    it("returns empty for a missing directory", async () => {
      const hitl = tmp("obs-read-");
      expect(await readCasObservations(hitl)).toEqual({ captured: [], secretPaths: [] });
    });

    it("parses captured (MODIFY + ADD) and secret entries, deterministically ordered, tolerating garbage", async () => {
      const hitl = tmp("obs-read-");
      const dir = await resetCasObservations(hitl);

      // A captured MODIFY: metadata + a before blob.
      writeFileSync(join(dir, "aaa.meta.json"), JSON.stringify({ path: "logs/a.log", kind: "captured", existed: true }));
      writeFileSync(join(dir, "aaa.blob"), "ORIGINAL");
      // A captured ADD: metadata only (no blob).
      writeFileSync(join(dir, "bbb.meta.json"), JSON.stringify({ path: "logs/b.log", kind: "captured", existed: false }));
      // A secret marker (path only).
      writeFileSync(join(dir, "ccc.meta.json"), JSON.stringify({ path: ".env", kind: "secret" }));
      // Garbage marker (tolerated + skipped) and a non-meta file (ignored).
      writeFileSync(join(dir, "ddd.meta.json"), "{ not json");
      writeFileSync(join(dir, "eee.txt"), "ignored");

      const obs = await readCasObservations(hitl);
      expect(obs.secretPaths).toEqual([".env"]);
      expect(obs.captured).toHaveLength(2);
      expect(obs.captured[0].path).toBe("logs/a.log");
      expect(Buffer.from(obs.captured[0].before!).toString("utf8")).toBe("ORIGINAL");
      expect(obs.captured[1].path).toBe("logs/b.log");
      expect(obs.captured[1].before).toBeNull();
    });

    it("skips a captured MODIFY whose blob is missing (defensive, not mis-captured as ADD)", async () => {
      const hitl = tmp("obs-read-");
      const dir = await resetCasObservations(hitl);
      writeFileSync(join(dir, "aaa.meta.json"), JSON.stringify({ path: "a.log", kind: "captured", existed: true }));
      // No aaa.blob written.
      const obs = await readCasObservations(hitl);
      expect(obs.captured).toEqual([]);
      expect(obs.secretPaths).toEqual([]);
    });
  });

  describe("resetCasObservations", () => {
    it("truncates prior observations for a fresh turn", async () => {
      const hitl = tmp("obs-reset-");
      const dir = await resetCasObservations(hitl);
      writeFileSync(join(dir, "aaa.meta.json"), JSON.stringify({ path: "a.log", kind: "secret" }));
      expect((await readCasObservations(hitl)).secretPaths).toEqual(["a.log"]);
      await resetCasObservations(hitl);
      expect(await readCasObservations(hitl)).toEqual({ captured: [], secretPaths: [] });
    });
  });

  describe("staging script (the hook's real observer)", () => {
    it("stages a non-secret ADD (before absent) and emits captured", async () => {
      const ws = tmp("obs-ws-");
      const obsDir = casObservationsDir(ws);
      expect(runStaging(ws, obsDir, "build/out.js")).toBe("captured");
      const obs = await readCasObservations(ws);
      expect(obs.captured).toHaveLength(1);
      expect(obs.captured[0].path).toBe("build/out.js");
      expect(obs.captured[0].before).toBeNull();
    });

    it("stages a non-secret MODIFY with the exact pre-turn bytes", async () => {
      const ws = tmp("obs-ws-");
      writeFileSync(join(ws, "out.log"), "PREVIOUS", "utf-8");
      const obsDir = casObservationsDir(ws);
      expect(runStaging(ws, obsDir, "out.log")).toBe("captured");
      const obs = await readCasObservations(ws);
      expect(Buffer.from(obs.captured[0].before!).toString("utf8")).toBe("PREVIOUS");
    });

    it("first-touch-wins: a second stage of the same path keeps the first before", async () => {
      const ws = tmp("obs-ws-");
      writeFileSync(join(ws, "out.log"), "ORIGINAL", "utf-8");
      const obsDir = casObservationsDir(ws);
      expect(runStaging(ws, obsDir, "out.log")).toBe("captured");
      // The write applied; a later edit re-runs staging — the before must not move.
      writeFileSync(join(ws, "out.log"), "APPLIED", "utf-8");
      expect(runStaging(ws, obsDir, "out.log")).toBe("captured");
      const obs = await readCasObservations(ws);
      expect(obs.captured).toHaveLength(1);
      expect(Buffer.from(obs.captured[0].before!).toString("utf8")).toBe("ORIGINAL");
    });

    it("emits secret and records a path-only marker for a secret-like path (no blob)", async () => {
      const ws = tmp("obs-ws-");
      writeFileSync(join(ws, ".env"), "API_KEY=xyz", "utf-8");
      const obsDir = casObservationsDir(ws);
      expect(runStaging(ws, obsDir, ".env")).toBe("secret");
      const obs = await readCasObservations(ws);
      expect(obs.captured).toEqual([]);
      expect(obs.secretPaths).toEqual([".env"]);
    });

    it("emits error for a path that escapes the workspace (fail closed)", async () => {
      const ws = tmp("obs-ws-");
      const obsDir = casObservationsDir(ws);
      expect(runStaging(ws, obsDir, "../../etc/passwd")).toBe("error");
    });

    // The generated secret classifier MUST agree with isSecretLikePath for every
    // path, or a secret could ride into CAS. This locks the two together.
    it("classifies secrets byte-for-byte identically to isSecretLikePath", async () => {
      const paths = [
        ".env",
        ".env.local",
        "config/.env.production",
        "id_rsa",
        "server.pem",
        "certs/key.pfx",
        "terraform.tfstate",
        ".aws/credentials",
        "home/.ssh/known_hosts",
        ".npmrc",
        "app.log",
        "src/index.ts",
        "docs/notes.md",
        "build/out.js",
      ];
      for (const p of paths) {
        const ws = tmp("obs-cls-");
        const obsDir = casObservationsDir(ws);
        const token = runStaging(ws, obsDir, p);
        const expected = isSecretLikePath(p) ? "secret" : "captured";
        expect(token, `classification for ${p}`).toBe(expected);
      }
    });
  });
});
