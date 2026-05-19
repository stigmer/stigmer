import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceProvisioner } from "../provisioner.js";
import { SourceType, WorkspaceProvisionError } from "../types.js";
import { LocalWorkspaceBackend } from "../local-backend.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ws-test-"));
}

describe("WorkspaceProvisioner", () => {
  let provisioner: WorkspaceProvisioner;

  beforeEach(() => {
    provisioner = new WorkspaceProvisioner();
  });

  describe("empty workspace", () => {
    it("returns EMPTY source type when no source is provided", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      const result = await provisioner.provision(undefined, backend, {}, true);
      expect(result.sourceType).toBe(SourceType.EMPTY);
      expect(result.rootDir).toBe(root);
      expect(result.consumedKeys).toEqual([]);
    });

    it("returns EMPTY when source case is undefined", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      const result = await provisioner.provision(
        { source: { case: undefined, value: undefined } },
        backend, {}, true,
      );
      expect(result.sourceType).toBe(SourceType.EMPTY);
    });
  });

  describe("local path", () => {
    it("returns LOCAL_PATH with the original directory", async () => {
      const root = makeTempDir();
      const projectDir = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      const result = await provisioner.provision(
        { source: { case: "localPath", value: { path: projectDir } } },
        backend, {}, true,
      );
      expect(result.sourceType).toBe(SourceType.LOCAL_PATH);
      expect(result.rootDir).toBe(projectDir);
    });

    it("rejects relative paths", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      await expect(
        provisioner.provision(
          { source: { case: "localPath", value: { path: "relative/path" } } },
          backend, {}, true,
        ),
      ).rejects.toThrow(WorkspaceProvisionError);
    });

    it("rejects in cloud mode", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      await expect(
        provisioner.provision(
          { source: { case: "localPath", value: { path: root } } },
          backend, {}, false,
        ),
      ).rejects.toThrow("only supported in local mode");
    });

    it("rejects non-existent paths", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      await expect(
        provisioner.provision(
          { source: { case: "localPath", value: { path: "/nonexistent/path" } } },
          backend, {}, true,
        ),
      ).rejects.toThrow("does not exist");
    });
  });

  describe("provisionAll", () => {
    it("returns empty array for no entries", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      const results = await provisioner.provisionAll([], backend, {}, true);
      expect(results).toEqual([]);
    });

    it("stamps entryName on each result", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      const results = await provisioner.provisionAll(
        [{ name: "app", source: undefined }],
        backend, {}, true,
      );
      expect(results).toHaveLength(1);
      expect(results[0].entryName).toBe("app");
      expect(results[0].sourceType).toBe(SourceType.EMPTY);
    });
  });

  describe("WORKSPACE_PROVISION_ key stripping", () => {
    it("adds prefixed keys to consumedKeys", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      const env = { WORKSPACE_PROVISION_TOKEN: "secret", OTHER: "value" };
      const result = await provisioner.provision(undefined, backend, env, true);
      expect(result.consumedKeys).toContain("WORKSPACE_PROVISION_TOKEN");
      expect(result.consumedKeys).not.toContain("OTHER");
    });
  });
});

describe("LocalWorkspaceBackend", () => {
  it("executes shell commands in the workspace root", async () => {
    const root = makeTempDir();
    writeFileSync(join(root, "test.txt"), "hello");
    const backend = new LocalWorkspaceBackend(root);
    const output = await backend.execute("cat test.txt");
    expect(output).toBe("hello");
  });

  it("checks file existence", async () => {
    const root = makeTempDir();
    writeFileSync(join(root, "exists.txt"), "");
    const backend = new LocalWorkspaceBackend(root);
    expect(await backend.exists("exists.txt")).toBe(true);
    expect(await backend.exists("nope.txt")).toBe(false);
  });

  it("reads and writes files", async () => {
    const root = makeTempDir();
    const backend = new LocalWorkspaceBackend(root);
    await backend.writeFile("out.txt", "content");
    const content = await backend.readFile("out.txt");
    expect(content).toBe("content");
  });
});
