import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { uniquifyFilename, allocateUniqueName } from "../attachment-naming.js";
import { injectAttachments } from "../../activities/execute-deep-agent/attachment-injector.js";
import { resolveAttachments } from "../../activities/execute-cursor/attachment-resolver.js";
import { getPlatformDir } from "../workspace/platform-dir.js";
import { makeInMemoryArtifactStorage } from "../../__test-utils__/fake-artifact-storage.js";
import type { WorkspaceBackend } from "../workspace/types.js";

describe("uniquifyFilename", () => {
  // This table is the byte-for-byte twin of the React SDK suite
  // (sdk/react/src/attachment/__tests__/attachment-utils.test.ts) — the two
  // implementations are kept in sync by hand, so their pins must agree.
  const cases: Array<{
    scenario: string;
    name: string;
    taken: string[];
    expected: string;
  }> = [
    {
      scenario: "returns the name unchanged when nothing collides",
      name: "report.pdf",
      taken: [],
      expected: "report.pdf",
    },
    {
      scenario: "suffixes -2 before the extension on first collision",
      name: "report.pdf",
      taken: ["report.pdf"],
      expected: "report-2.pdf",
    },
    {
      scenario: "walks past already-taken suffixes",
      name: "report.pdf",
      taken: ["report.pdf", "report-2.pdf", "report-3.pdf"],
      expected: "report-4.pdf",
    },
    {
      scenario: "handles names without an extension",
      name: "Makefile",
      taken: ["Makefile"],
      expected: "Makefile-2",
    },
    {
      scenario: "treats a leading dot as a hidden-file prefix, not an extension",
      name: ".env",
      taken: [".env"],
      expected: ".env-2",
    },
    {
      scenario: "only splits on the last dot of a multi-dot name",
      name: "backup.tar.gz",
      taken: ["backup.tar.gz"],
      expected: "backup.tar-2.gz",
    },
  ];

  for (const { scenario, name, taken, expected } of cases) {
    it(scenario, () => {
      expect(uniquifyFilename(name, new Set(taken))).toBe(expected);
    });
  }
});

describe("allocateUniqueName", () => {
  it("claims the allocated name so sequential allocations see each other", () => {
    const taken = new Set<string>();

    expect(allocateUniqueName("data.csv", taken)).toEqual({ name: "data.csv" });
    expect(allocateUniqueName("data.csv", taken)).toEqual({
      name: "data-2.csv",
      renamedFrom: "data.csv",
    });
    expect(allocateUniqueName("data.csv", taken)).toEqual({
      name: "data-3.csv",
      renamedFrom: "data.csv",
    });
    expect(taken).toEqual(new Set(["data.csv", "data-2.csv", "data-3.csv"]));
  });

  it("carries no renamedFrom when the name was free (nothing to disclose)", () => {
    const allocated = allocateUniqueName("report.pdf", new Set());
    expect(allocated.name).toBe("report.pdf");
    expect("renamedFrom" in allocated && allocated.renamedFrom !== undefined).toBe(false);
  });
});

describe("cross-harness naming parity", () => {
  // Both harnesses must resolve the same attachment list to the same final
  // basenames — one platform answer, not two accidental ones (issue #364).
  let workspaceDir: string;
  let sessionId: string;
  let platformDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), "naming-parity-ws-"));
    sessionId = `parity-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    platformDir = getPlatformDir(sessionId);
  });

  afterEach(() => {
    rmSync(platformDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  function makeAttachment(filename: string, storageKey: string) {
    return {
      filename,
      storageKey,
      mountPath: "",
      contentType: "text/plain",
      extract: false,
      localPath: "",
      $typeName: "ai.stigmer.agentic.agentexecution.v1.Attachment" as const,
      $unknown: undefined,
    } as any;
  }

  it("both harnesses produce identical final basenames for the same duplicate-heavy list", async () => {
    const { storage } = makeInMemoryArtifactStorage();
    await storage.upload("attachments/01A/data.csv", Buffer.from("a"), "text/plain");
    await storage.upload("attachments/01B/data.csv", Buffer.from("b"), "text/plain");
    await storage.upload("attachments/01C/Makefile", Buffer.from("c"), "text/plain");
    await storage.upload("attachments/01D/Makefile", Buffer.from("d"), "text/plain");
    const attachments = [
      makeAttachment("data.csv", "attachments/01A/data.csv"),
      makeAttachment("data.csv", "attachments/01B/data.csv"),
      makeAttachment("Makefile", "attachments/01C/Makefile"),
      makeAttachment("Makefile", "attachments/01D/Makefile"),
    ];

    const backend = { writeFileBuffer: vi.fn() } as unknown as WorkspaceBackend;
    const injected = await injectAttachments({
      backend,
      attachments,
      storage,
      isLocalMode: false,
    });

    const resolved = await resolveAttachments(attachments, {
      sessionId,
      primaryWorkspaceDir: workspaceDir,
      mode: "cloud",
      storage,
    });

    const injectedNames = injected.map((f) => f.filename);
    const resolvedNames = resolved.map((r) => r.filename);
    expect(injectedNames).toEqual(["data.csv", "data-2.csv", "Makefile", "Makefile-2"]);
    expect(resolvedNames).toEqual(injectedNames);
    expect(injected.map((f) => f.renamedFrom)).toEqual(
      resolved.map((r) => r.renamedFrom),
    );
    // The resolver's files really land under the renamed paths.
    expect(readFileSync(join(platformDir, "inputs", "data-2.csv"), "utf-8")).toBe("b");
  });
});
