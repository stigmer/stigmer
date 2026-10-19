/**
 * Pins the workspace provisioner's dispatch (empty, local path, git), that
 * a File is no part of the workspace (it neither provisions nor counts
 * toward the per-resource subdirectories), that a git repository receives
 * only its own repository token, matched by name and URL, and the local
 * backend's command, file and per-command env behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceProvisioner } from "../provisioner.js";
import { WorkspaceProvisionError } from "../types.js";
import { LocalWorkspaceBackend } from "../local-backend.js";
import { forgetGitVersion } from "../git-credential.js";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ws-test-"));
}

describe("WorkspaceProvisioner", () => {
  let provisioner: WorkspaceProvisioner;

  beforeEach(() => {
    provisioner = new WorkspaceProvisioner();
    forgetGitVersion();
  });

  describe("empty workspace", () => {
    it("returns EMPTY source type when no resource type is set", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      const result = await provisioner.provision({ name: "", resource: { case: undefined } }, backend, [], true);
      expect(result.sourceType).toBe("empty");
      expect(result.rootDir).toBe(root);
    });

  });

  describe("local path", () => {
    it("returns LOCAL_PATH with the original directory", async () => {
      const root = makeTempDir();
      const projectDir = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      const result = await provisioner.provision(
        { name: "", resource: { case: "localPath", value: { path: projectDir } } },
        backend, [], true,
      );
      expect(result.sourceType).toBe("local_path");
      expect(result.rootDir).toBe(projectDir);
    });

    it("links a multi-entry session's entry to the directory, and keeps or replaces the link as the directory stays or moves", async () => {
      const root = makeTempDir();
      const first = makeTempDir();
      const second = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      const entry = (path: string) => ({ name: "app", resource: { case: "localPath" as const, value: { path } } });
      await provisioner.provision(entry(first), backend, [], true, { targetSubdir: "app" });
      expect(readlinkSync(join(root, "app"))).toBe(first);
      await provisioner.provision(entry(first), backend, [], true, { targetSubdir: "app" });
      expect(readlinkSync(join(root, "app")), "the same directory keeps its link").toBe(first);
      await provisioner.provision(entry(second), backend, [], true, { targetSubdir: "app" });
      expect(readlinkSync(join(root, "app")), "a moved directory is linked anew").toBe(second);
    });

    it("rejects relative paths", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      await expect(
        provisioner.provision(
          { name: "", resource: { case: "localPath", value: { path: "relative/path" } } },
          backend, [], true,
        ),
      ).rejects.toThrow(WorkspaceProvisionError);
    });

    it("rejects in cloud mode", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      await expect(
        provisioner.provision(
          { name: "", resource: { case: "localPath", value: { path: root } } },
          backend, [], false,
        ),
      ).rejects.toThrow("only supported in local mode");
    });

    it("rejects non-existent paths", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      await expect(
        provisioner.provision(
          { name: "", resource: { case: "localPath", value: { path: "/nonexistent/path" } } },
          backend, [], true,
        ),
      ).rejects.toThrow("does not exist");
    });
  });

  describe("provisionAll", () => {
    it("returns empty array for no entries", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      const results = await provisioner.provisionAll([], backend, [], true);
      expect(results).toEqual([]);
    });

    it("stamps entryName on each result", async () => {
      const root = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      const results = await provisioner.provisionAll(
        [{ name: "app", resource: { case: undefined } }],
        backend, [], true,
      );
      expect(results).toHaveLength(1);
      expect(results[0].entryName).toBe("app");
      expect(results[0].sourceType).toBe("empty");
    });
  });

  describe("a File among the resources", () => {
    it("is left out: a folder beside it is provisioned in place, as the only workspace resource", async () => {
      const root = makeTempDir();
      const projectDir = makeTempDir();
      const backend = new LocalWorkspaceBackend(root);
      const results = await provisioner.provisionAll(
        [
          { name: "", resource: { case: "file", value: { fileId: "file_1", mountPath: "a.txt" } } },
          { name: "app", resource: { case: "localPath", value: { path: projectDir } } },
        ],
        backend, [], true,
      );
      expect(results).toHaveLength(1);
      expect(results[0]!.entryName).toBe("app");
      expect(results[0]!.rootDir, "one workspace resource is used where it is, not linked under a subdirectory").toBe(projectDir);
      expect(existsSync(join(root, "app"))).toBe(false);
    });

    it("leaves a session holding only Files with no workspace resource", async () => {
      const backend = new LocalWorkspaceBackend(makeTempDir());
      const results = await provisioner.provisionAll(
        [{ name: "", resource: { case: "file", value: { fileId: "file_1", mountPath: "a.txt" } } }],
        backend, [], true,
      );
      expect(results).toEqual([]);
    });
  });

  describe("a git entry's token", () => {
    it("is its own repository value, matched by the entry's name and URL together", async () => {
      const url = "https://github.com/acme/app.git";
      const execute = vi.fn(async (cmd: string) => {
        if (cmd === "git --version") return "git version 2.39.5\n";
        if (cmd === "git config --list --show-scope --name-only") return "local\tremote.origin.url\n";
        if (cmd === "git config --local --get remote.origin.url") return `${url}\n`;
        return "";
      });
      const backend = mockWorkspaceBackend({ execute });
      const repositories = [
        { name: "app", url: "https://github.com/acme/other.git", token: "ghp_other_url" },
        { name: "web", url, token: "ghp_other_name" },
        { name: "app", url, token: "ghp_own" },
      ];

      await provisioner.provisionAll(
        [{ name: "app", resource: { case: "gitRepository", value: { url, branch: "main" } } }],
        backend, repositories, false, true,
      );

      const envs = execute.mock.calls.map((call) => (call as unknown[])[1] as { env?: Record<string, string> } | undefined)
        .map((options) => options?.env?.GIT_CONFIG_VALUE_4)
        .filter((value): value is string => value !== undefined);
      expect(envs.length).toBeGreaterThan(0);
      for (const value of envs) {
        expect(Buffer.from(value.replace("AUTHORIZATION: basic ", ""), "base64").toString()).toBe("x-access-token:ghp_own");
      }
    });
  });
});

describe("LocalWorkspaceBackend", () => {
  it("adds a command's env to that child alone, never to the runner's own", async () => {
    const backend = new LocalWorkspaceBackend(makeTempDir());
    const output = await backend.execute('printf %s "$ONLY_HERE"', { env: { ONLY_HERE: "child" } });
    expect(output).toBe("child");
    expect(process.env.ONLY_HERE).toBeUndefined();
    expect(await backend.execute('printf %s "${ONLY_HERE:-unset}"')).toBe("unset");
  });

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
