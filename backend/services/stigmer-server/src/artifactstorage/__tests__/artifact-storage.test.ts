/**
 * Ports storage/local_storage_test.go + disposition_test.go case-for-case:
 * the containment guard (every escaping key refused on every operation,
 * contained dot-segment keys allowed), the #285 no-implicit-segment
 * layout contract, the local signed-URL shape, and the
 * Content-Disposition builder. Adds the factory's r2/unknown refusals
 * (Go's are boot asserted; here they're the disclosed deferral), and the
 * O5 widened surface: size, the typed not-found, presigned-PUT over the
 * skill-transfer-lane mechanism, and registered-driver factory selection.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UPLOADS_SEGMENT } from "../../domain/skill/constants.js";
import { UploadSlots } from "../../domain/skill/transfer/slots.js";
import { uploadUrl } from "../../domain/skill/transfer/handler.js";
import { SKILL_ARTIFACTS_PATH_PREFIX } from "../../transport/constants.js";
import {
  ArtifactStorageNotFoundError,
  LocalArtifactStorage,
  contentDispositionAttachment,
  newArtifactStorage,
} from "../artifact-storage.js";
import type { ArtifactStorage } from "../artifact-storage.js";

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

    // Go url.QueryEscape byte-exactness on the two characters where
    // URLSearchParams disagrees: '~' stays bare, '*' percent-encodes.
    const exotic = await storage.getSignedUrl(key, 3600_000, "a~b*c.md");
    expect(exotic).toBe(`http://localhost:7235/${key}?download=a~b%2Ac.md`);
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

  describe("O5 widened surface", () => {
    it("size stats the stored byte count without loading", async () => {
      await storage.upload("attachments/01S/f.bin", Buffer.from("12345"), "");
      expect(await storage.size("attachments/01S/f.bin")).toBe(5);
    });

    it("download and size answer the typed not-found with the historical copy", async () => {
      for (const op of [
        () => storage.download("attachments/absent.bin"),
        () => storage.size("attachments/absent.bin"),
      ]) {
        const error = await op().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ArtifactStorageNotFoundError);
        expect((error as Error).message).toBe(
          "artifact not found: attachments/absent.bin",
        );
      }
    });

    it("presignPut without a wired lane is the explicit not-configured throw, never a silent no-op", async () => {
      await expect(storage.presignPut(16, 60_000)).rejects.toThrow(
        "local presigned uploads not configured",
      );
    });
  });
});

// The local presigned-PUT arm over the REAL skill-transfer-lane slot
// mechanism (§6b, the Q1 ruling: one upload surface, no new lane) — the
// adapter below mirrors boot/compose.ts's wiring exactly.
describe("LocalArtifactStorage presignPut over the transfer-lane slots", () => {
  const BASE_URL = "http://localhost:8080";
  let root: string;
  let slots: UploadSlots;
  let driver: ArtifactStorage;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "artifact-presign-"));
    slots = new UploadSlots(
      path.join(root, "skills-staging"),
      60_000,
      1024 * 1024,
    );
    driver = new LocalArtifactStorage(root, "", {
      mint: (declaredSizeBytes) => slots.mint(declaredSizeBytes),
      uploadUrl: (ref) => uploadUrl(BASE_URL, ref),
      stagedKey: (ref) => `skills-staging/${slots.stagedFileName(ref)}`,
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("mint → PUT (lane receive) → download(stagingKey) round-trips the bytes", async () => {
    const bytes = Buffer.from("staged artifact bytes");
    const upload = await driver.presignPut(bytes.length, 999_999_999);

    // The URL is the lane's wire shape and the ref is its last segment —
    // exactly how the lane handler dispatches a PUT.
    expect(
      upload.url.startsWith(
        `${BASE_URL}${SKILL_ARTIFACTS_PATH_PREFIX}${UPLOADS_SEGMENT}`,
      ),
    ).toBe(true);
    // The lane's slot TTL governs, not the caller's larger ask.
    expect(upload.ttlMs).toBe(60_000);

    const ref = upload.url.slice(upload.url.lastIndexOf("/") + 1);
    await slots.receive(ref, Readable.from(bytes));

    expect(Buffer.from(await driver.download(upload.stagingKey))).toEqual(
      bytes,
    );
    expect(await driver.size(upload.stagingKey)).toBe(bytes.length);
  });

  it("the staged key never resolves outside the driver root", async () => {
    const upload = await driver.presignPut(4, 60_000);
    expect(upload.stagingKey.startsWith("skills-staging/")).toBe(true);
    // Unreceived slot: the key is honest about absence.
    await expect(driver.download(upload.stagingKey)).rejects.toThrow(
      ArtifactStorageNotFoundError,
    );
  });
});

const NO_R2 = {
  r2Bucket: "",
  r2Endpoint: "",
  r2AccessKeyId: "",
  r2SecretAccessKey: "",
  r2Region: "",
} as const;

describe("newArtifactStorage factory", () => {
  it("empty type defaults to local", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "artifact-factory-"));
    try {
      const s = newArtifactStorage({
        type: "",
        localBasePath: path.join(parent, "store"),
        localServeUrl: "http://localhost:7235",
        ...NO_R2,
      });
      expect(s).toBeInstanceOf(LocalArtifactStorage);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("r2 constructs the R2 backend (validation pins live in r2-storage tests)", () => {
    // The former boot-fail deferral test: the r2 arm now constructs, and
    // an incomplete config fails with Go NewR2Storage's copy.
    expect(() =>
      newArtifactStorage({ type: "r2", localBasePath: "", localServeUrl: "", ...NO_R2 }),
    ).toThrow("R2 bucket name is required");
  });

  it("unknown type refuses", () => {
    expect(() =>
      newArtifactStorage({ type: "s3", localBasePath: "", localServeUrl: "", ...NO_R2 }),
    ).toThrow("unknown storage type: s3 (must be 'local' or 'r2')");
  });

  it("selects a registered driver by name — and only constructs the selected one (O5)", () => {
    let constructed = 0;
    let neverConstructed = 0;
    const fake = { health: () => Promise.resolve() } as unknown as ReturnType<
      typeof newArtifactStorage
    >;
    const registered = new Map([
      [
        "cloud-r2",
        () => {
          constructed += 1;
          return fake;
        },
      ],
      [
        "unused",
        () => {
          neverConstructed += 1;
          return fake;
        },
      ],
    ]);
    const s = newArtifactStorage(
      { type: "cloud-r2", localBasePath: "", localServeUrl: "", ...NO_R2 },
      registered,
    );
    expect(s).toBe(fake);
    expect(constructed).toBe(1);
    expect(neverConstructed, "unselected drivers must construct nothing").toBe(0);
  });

  it("unknown type names the registered drivers in its refusal (O5)", () => {
    expect(() =>
      newArtifactStorage(
        { type: "s3", localBasePath: "", localServeUrl: "", ...NO_R2 },
        new Map([["cloud-r2", () => ({}) as never]]),
      ),
    ).toThrow("unknown storage type: s3 (must be 'local' or 'r2' or 'cloud-r2')");
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
