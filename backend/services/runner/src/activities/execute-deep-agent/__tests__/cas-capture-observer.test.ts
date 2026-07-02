import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import { CasCaptureFilesystemBackend } from "../cas-capture-backend.js";

/**
 * The observer is the single, shared owner of one turn's CAS-capture state. It
 * records the PRE-TURN bytes of first-touched gitignored paths (gate-independently,
 * at the mutation point) and the gitignored paths the gate hard-blocked as
 * secret-like. These tests assert the recording contract — only gitignored paths,
 * only the first touch, never a post-write baseline — AND the cross-instance
 * guarantee that makes sub-agent capture safe: the parent and every sub-agent
 * backend share ONE observer, so first-touch-wins holds even when concurrent
 * graphs touch the same path (Session 26, DD-19).
 */
describe("CasCaptureObserver", () => {
  let root: string;

  /** Paths under `ignored/` are gitignored; everything else is git-tracked. */
  const ignoredPredicate = (relPath: string): boolean => relPath.startsWith("ignored/");

  function makeObserver(isIgnored = async (p: string) => ignoredPredicate(p)): CasCaptureObserver {
    return new CasCaptureObserver({ rootDir: root, isIgnored });
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cas-observer-"));
    await mkdir(join(root, "ignored"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("recordBefore", () => {
    it("records before=null for a not-yet-existing gitignored path (an ADD)", async () => {
      const observer = makeObserver();

      await observer.recordBefore("ignored/new.txt");

      expect(observer.before.has("ignored/new.txt")).toBe(true);
      expect(observer.before.get("ignored/new.txt")).toBeNull();
    });

    it("records the pre-turn bytes for an existing gitignored file (a MODIFY)", async () => {
      await writeFile(join(root, "ignored/cfg.txt"), "v0");
      const observer = makeObserver();

      await observer.recordBefore("ignored/cfg.txt");

      const before = observer.before.get("ignored/cfg.txt");
      expect(before).not.toBeNull();
      expect(Buffer.from(before!).toString("utf8")).toBe("v0");
    });

    it("first-touch-wins: a later touch does not overwrite the recorded baseline", async () => {
      await writeFile(join(root, "ignored/log.txt"), "a");
      const observer = makeObserver();

      await observer.recordBefore("ignored/log.txt");
      // Simulate the file changing mid-turn, then a second mutation touches it.
      await writeFile(join(root, "ignored/log.txt"), "b");
      await observer.recordBefore("ignored/log.txt");

      expect(Buffer.from(observer.before.get("ignored/log.txt")!).toString("utf8")).toBe("a");
    });

    it("does NOT record git-tracked paths (the boundary git diff owns those)", async () => {
      const observer = makeObserver();

      await observer.recordBefore("src/app.ts");

      expect(observer.before.has("src/app.ts")).toBe(false);
      expect(observer.before.size).toBe(0);
    });

    it("normalizes virtual-root ('/'-prefixed) paths to workspace-relative keys", async () => {
      const observer = makeObserver();

      await observer.recordBefore("/ignored/rooted.txt");

      expect(observer.before.has("ignored/rooted.txt")).toBe(true);
    });

    it("memoizes the gitignore classification (one check per distinct path)", async () => {
      const isIgnored = vi.fn(async (p: string) => ignoredPredicate(p));
      const observer = makeObserver(isIgnored);

      await observer.recordBefore("ignored/a.txt");
      await observer.recordBefore("ignored/a.txt");
      await observer.recordBefore("ignored/b.txt");

      expect(isIgnored).toHaveBeenCalledTimes(2); // a.txt once, b.txt once
    });
  });

  describe("recordBlockedSecret", () => {
    it("resolves the raw path to a workspace-relative key and dedupes", () => {
      const observer = makeObserver();

      observer.recordBlockedSecret("/ignored/.env");
      observer.recordBlockedSecret("ignored/.env");

      expect([...observer.blockedSecretPaths]).toEqual(["ignored/.env"]);
    });

    it("blockedSecretPaths is empty until something is recorded", () => {
      expect([...makeObserver().blockedSecretPaths]).toEqual([]);
    });
  });

  describe("shared across backends (cross-instance first-touch)", () => {
    /** Two backends on the SAME observer — the parent + sub-agent shape. */
    function twoBackends(observer: CasCaptureObserver): [CasCaptureFilesystemBackend, CasCaptureFilesystemBackend] {
      return [
        new CasCaptureFilesystemBackend({ rootDir: root }, { observer }),
        new CasCaptureFilesystemBackend({ rootDir: root }, { observer }),
      ];
    }

    it("a write through either backend feeds the one shared before-map", async () => {
      const observer = makeObserver();
      const [parent, sub] = twoBackends(observer);

      await parent.write("ignored/from-parent.txt", "p");
      await sub.write("ignored/from-sub.txt", "s");

      expect(observer.before.get("ignored/from-parent.txt")).toBeNull();
      expect(observer.before.get("ignored/from-sub.txt")).toBeNull();
    });

    it("keeps the first backend's pre-turn baseline when a second backend touches the same path", async () => {
      await writeFile(join(root, "ignored/shared.txt"), "orig");
      const observer = makeObserver();
      const [parent, sub] = twoBackends(observer);

      await parent.edit("ignored/shared.txt", "orig", "parent");
      await sub.edit("ignored/shared.txt", "parent", "sub");

      expect(Buffer.from(observer.before.get("ignored/shared.txt")!).toString("utf8")).toBe("orig");
    });

    it("under CONCURRENT writes from two backends to one path, records the pre-turn baseline exactly once", async () => {
      await writeFile(join(root, "ignored/race.txt"), "orig");
      const observer = makeObserver();
      const [a, b] = twoBackends(observer);

      // The synchronous shared reservation must ensure only the pre-turn bytes
      // are recorded — never a post-write value — even across backend instances
      // with separate identities (the sub-agent concurrency case).
      await Promise.allSettled([
        a.edit("ignored/race.txt", "orig", "A"),
        b.edit("ignored/race.txt", "orig", "B"),
      ]);

      expect(observer.before.size).toBe(1);
      expect(Buffer.from(observer.before.get("ignored/race.txt")!).toString("utf8")).toBe("orig");
    });
  });
});
