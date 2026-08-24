/**
 * Ports storage/local_storage_test.go + disposition_test.go case-for-case:
 * the containment guard (every escaping key refused on every operation,
 * contained dot-segment keys allowed), the #285 no-implicit-segment
 * layout contract, the local signed-URL shape, and the
 * Content-Disposition builder. Adds the factory's r2/unknown refusals
 * (Go's are boot asserted; here they're the disclosed deferral).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LocalArtifactStorage,
  contentDispositionAttachment,
  newArtifactStorage,
} from "../artifact-storage.js";

// Keys that, once cleaned, resolve outside the artifact root — the
// containment guard must refuse every one of them.
const escapingKeys = [
  "../evil.txt",
  "../../evil.txt",
  "attachments/x/../../../../evil.txt",
  "attachments/../../evil.txt",
  "a/b/../../../escape",
];

// Keys that clean to a location still inside the root — the guard
// rejects escapes, not the mere presence of a `..` segment.
const containedKeys = [
  "attachments/01ABC/plan.md",
  "artifacts/exec-1/out.txt",
  "attachments/x/../y/file.txt",
  "name.with.dots.txt",
];

describe("LocalArtifactStorage", () => {
  let parent: string;
  let base: string;
  let storage: LocalArtifactStorage;

  beforeEach(() => {
    parent = mkdtempSync(path.join(tmpdir(), "artifact-test-"));
    base = path.join(parent, "store");
    storage = new LocalArtifactStorage(base, "http://localhost:7235");
  });

  afterEach(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  function assertNoEscape(name: string): void {
    expect(
      existsSync(path.join(parent, name)),
      `file escaped the artifact root to ${path.join(parent, name)}`,
    ).toBe(false);
  }

  describe("upload rejects path traversal", () => {
    for (const key of escapingKeys) {
      it(key, async () => {
        await expect(
          storage.upload(key, Buffer.from("owned"), "text/plain"),
        ).rejects.toThrow("resolves outside the artifact storage root");
        assertNoEscape("evil.txt");
        assertNoEscape("escape");
      });
    }
  });

  describe("download rejects path traversal", () => {
    for (const key of escapingKeys) {
      it(key, async () => {
        // Plant a file just outside the root that a traversal key would
        // otherwise reach.
        writeFileSync(path.join(parent, "secret.txt"), "top secret");
        await expect(storage.download(key)).rejects.toThrow(
          "resolves outside the artifact storage root",
        );
      });
    }
  });

  describe("exists and delete reject path traversal", () => {
    for (const key of escapingKeys) {
      it(`exists/${key}`, async () => {
        await expect(storage.exists(key)).rejects.toThrow(
          "resolves outside the artifact storage root",
        );
      });
      it(`delete/${key}`, async () => {
        await expect(storage.delete(key)).rejects.toThrow(
          "resolves outside the artifact storage root",
        );
      });
    }
  });

  // Pins the layout contract after unification (#285): the configured
  // base path IS the artifact root, so a key K lands at <base>/<K> with
  // no implicit "artifacts" segment — what lets the runner, whose
  // LOCAL_ARTIFACT_PATH points at the same directory, read back exactly
  // what the server wrote.
  it("stores key at root without implicit segment", async () => {
    const key = "attachments/01ABC/plan.md";
    await storage.upload(key, Buffer.from("the plan"), "text/markdown");
    expect(existsSync(path.join(base, key))).toBe(true);
    expect(existsSync(path.join(base, "artifacts", key))).toBe(false);
  });

  describe("allows contained keys with dot segments", () => {
    for (const key of containedKeys) {
      it(key, async () => {
        await storage.upload(key, Buffer.from("ok"), "text/plain");
        const data = await storage.download(key);
        expect(Buffer.from(data).toString()).toBe("ok");
      });
    }
  });

  it("signed URL: inline has no query, download carries url-encoded filename", async () => {
    const key = "artifacts/aex_1/plan.md";
    const inline = await storage.getSignedUrl(key, 3600_000, "");
    expect(inline).toBe(`http://localhost:7235/${key}`);

    const download = await storage.getSignedUrl(
      key,
      3600_000,
      "my plan.plan.md",
    );
    // Space encodes as '+' (Go url.Values.Encode).
    expect(download).toBe(
      `http://localhost:7235/${key}?download=my+plan.plan.md`,
    );
  });

  it("delete removes the artifact and prunes empty parents, never the root", async () => {
    const key = "attachments/01DEL/file.txt";
    await storage.upload(key, Buffer.from("x"), "text/plain");
    await storage.delete(key);
    expect(existsSync(path.join(base, key))).toBe(false);
    expect(existsSync(path.join(base, "attachments", "01DEL"))).toBe(false);
    expect(existsSync(base)).toBe(true);
  });

  it("health probes the root writable", async () => {
    await expect(storage.health()).resolves.toBeUndefined();
    expect(existsSync(path.join(base, ".health_check"))).toBe(false);
  });
});

describe("newArtifactStorage factory", () => {
  it("empty type defaults to local", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "artifact-factory-"));
    try {
      const s = newArtifactStorage({
        type: "",
        localBasePath: path.join(parent, "store"),
        localServeUrl: "http://localhost:7235",
      });
      expect(s).toBeInstanceOf(LocalArtifactStorage);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("r2 refuses with the deferral message", () => {
    expect(() =>
      newArtifactStorage({ type: "r2", localBasePath: "", localServeUrl: "" }),
    ).toThrow("ARTIFACT_STORAGE_TYPE=r2 is not yet supported by the TS server");
  });

  it("unknown type refuses", () => {
    expect(() =>
      newArtifactStorage({ type: "s3", localBasePath: "", localServeUrl: "" }),
    ).toThrow("unknown storage type: s3 (must be 'local' or 'r2')");
  });
});

describe("contentDispositionAttachment", () => {
  const cases = [
    {
      name: "plain ascii filename",
      filename: "plan_card_ux_cleanup.plan.md",
      want: 'attachment; filename="plan_card_ux_cleanup.plan.md"',
    },
    {
      name: "embedded quote is escaped, not broken out of",
      filename: 'evil".md',
      want: 'attachment; filename="evil\\".md"',
    },
    {
      name: "non-ascii adds an RFC 5987 filename* fallback",
      filename: "café.md",
      want: "attachment; filename=\"caf_.md\"; filename*=UTF-8''caf%C3%A9.md",
    },
  ];
  for (const tt of cases) {
    it(tt.name, () => {
      expect(contentDispositionAttachment(tt.filename)).toBe(tt.want);
    });
  }
});
