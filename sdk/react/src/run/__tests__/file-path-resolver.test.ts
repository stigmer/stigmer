import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  WorkspaceEntrySchema,
  WorkspaceSourceSchema,
  GitRepoSourceSchema,
  LocalPathSourceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import {
  classifyPath,
  resolveGitBrowseUrl,
  resolvePathAction,
  splitDisplayPath,
} from "../file-path-resolver";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function gitEntry(name: string, url: string, branch = "main"): WorkspaceEntry {
  return create(WorkspaceEntrySchema, {
    name,
    source: create(WorkspaceSourceSchema, {
      source: {
        case: "gitRepo",
        value: create(GitRepoSourceSchema, { url, branch, commit: "" }),
      },
    }),
  });
}

function localEntry(name: string, path: string): WorkspaceEntry {
  return create(WorkspaceEntrySchema, {
    name,
    source: create(WorkspaceSourceSchema, {
      source: {
        case: "localPath",
        value: create(LocalPathSourceSchema, { path }),
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// classifyPath
// ---------------------------------------------------------------------------

describe("classifyPath", () => {
  it("classifies platform paths", () => {
    expect(classifyPath(".stigmer/skills/foo.md")).toEqual({
      kind: "platform",
      subpath: "skills/foo.md",
    });
  });

  it("classifies bare .stigmer directory", () => {
    expect(classifyPath(".stigmer")).toEqual({
      kind: "platform",
      subpath: "",
    });
  });

  it("strips leading slashes from platform paths", () => {
    expect(classifyPath("/.stigmer/inputs/bar")).toEqual({
      kind: "platform",
      subpath: "inputs/bar",
    });
  });

  it("classifies workspace paths", () => {
    expect(classifyPath("src/main.go")).toEqual({
      kind: "workspace",
      remainder: "src/main.go",
    });
  });

  it("strips leading slashes from workspace paths", () => {
    expect(classifyPath("/src/main.go")).toEqual({
      kind: "workspace",
      remainder: "src/main.go",
    });
  });
});

// ---------------------------------------------------------------------------
// splitDisplayPath
// ---------------------------------------------------------------------------

describe("splitDisplayPath", () => {
  it("splits a nested path into dir (with trailing slash) and base", () => {
    expect(splitDisplayPath("src/app/main.ts")).toEqual({
      dir: "src/app/",
      base: "main.ts",
    });
  });

  it("keeps an absolute path's leading prefix in the dir", () => {
    expect(splitDisplayPath("/Users/me/scm/notes.md")).toEqual({
      dir: "/Users/me/scm/",
      base: "notes.md",
    });
  });

  it("treats a path with no slash as all base", () => {
    expect(splitDisplayPath("notes.md")).toEqual({ dir: "", base: "notes.md" });
  });

  it("tolerates a trailing slash (directory), keeping the last segment as base", () => {
    expect(splitDisplayPath("src/app/")).toEqual({ dir: "src/", base: "app" });
  });

  it("handles platform-mount paths", () => {
    expect(splitDisplayPath(".stigmer/skills/foo.md")).toEqual({
      dir: ".stigmer/skills/",
      base: "foo.md",
    });
  });

  it("returns empty parts for an empty path", () => {
    expect(splitDisplayPath("")).toEqual({ dir: "", base: "" });
  });

  it("collapses a slash-only path to empty parts", () => {
    expect(splitDisplayPath("/")).toEqual({ dir: "", base: "" });
  });
});

// ---------------------------------------------------------------------------
// resolveGitBrowseUrl
// ---------------------------------------------------------------------------

describe("resolveGitBrowseUrl", () => {
  it("constructs a correct GitHub blob URL", () => {
    expect(
      resolveGitBrowseUrl(
        "https://github.com/acme/app.git",
        "main",
        "",
        "src/index.ts",
      ),
    ).toBe("https://github.com/acme/app/blob/main/src/index.ts");
  });

  it("prefers commit over branch", () => {
    expect(
      resolveGitBrowseUrl(
        "https://github.com/acme/app.git",
        "main",
        "abc123",
        "README.md",
      ),
    ).toBe("https://github.com/acme/app/blob/abc123/README.md");
  });

  it("falls back to HEAD when both branch and commit are empty", () => {
    expect(
      resolveGitBrowseUrl(
        "https://github.com/acme/app.git",
        "",
        "",
        "README.md",
      ),
    ).toBe("https://github.com/acme/app/blob/HEAD/README.md");
  });

  it("returns null for non-GitHub hosts", () => {
    expect(
      resolveGitBrowseUrl(
        "https://gitlab.com/acme/app.git",
        "main",
        "",
        "src/main.go",
      ),
    ).toBeNull();
  });

  it("returns null for invalid URLs", () => {
    expect(
      resolveGitBrowseUrl("not-a-url", "main", "", "file.txt"),
    ).toBeNull();
  });

  it("strips duplicate org/repo prefix from relPath", () => {
    expect(
      resolveGitBrowseUrl(
        "https://github.com/plantonhq/agent-fleet.git",
        "main",
        "",
        "plantonhq/agent-fleet/mcp-servers/mcp-server-planton.yaml",
      ),
    ).toBe(
      "https://github.com/plantonhq/agent-fleet/blob/main/mcp-servers/mcp-server-planton.yaml",
    );
  });

  it("does not strip when relPath shares a partial prefix", () => {
    expect(
      resolveGitBrowseUrl(
        "https://github.com/acme/app.git",
        "main",
        "",
        "acme/other-thing/file.txt",
      ),
    ).toBe("https://github.com/acme/app/blob/main/acme/other-thing/file.txt");
  });

  it("handles clone URLs without .git suffix", () => {
    expect(
      resolveGitBrowseUrl(
        "https://github.com/acme/app",
        "main",
        "",
        "src/lib.rs",
      ),
    ).toBe("https://github.com/acme/app/blob/main/src/lib.rs");
  });
});

// ---------------------------------------------------------------------------
// resolvePathAction — integration (exercises matchWorkspaceEntry internally)
// ---------------------------------------------------------------------------

describe("resolvePathAction", () => {
  it("returns copy for empty path", () => {
    const result = resolvePathAction("", []);
    expect(result.action).toBe("copy");
  });

  it("returns copy for platform paths", () => {
    const entries = [gitEntry("app", "https://github.com/acme/app.git")];
    const result = resolvePathAction(".stigmer/skills/foo.md", entries);
    expect(result.action).toBe("copy");
  });

  it("returns copy when no workspace entries", () => {
    const result = resolvePathAction("src/main.go", []);
    expect(result.action).toBe("copy");
  });

  describe("single git workspace entry", () => {
    const entries = [
      gitEntry("agent-fleet", "https://github.com/plantonhq/agent-fleet.git"),
    ];

    it("produces a GitHub link for a relative path", () => {
      const result = resolvePathAction(
        "mcp-servers/mcp-server-planton.yaml",
        entries,
      );
      expect(result).toEqual({
        action: "link",
        url: "https://github.com/plantonhq/agent-fleet/blob/main/mcp-servers/mcp-server-planton.yaml",
        tooltip: "Open on GitHub",
      });
    });
  });

  describe("multiple git workspace entries — first-segment match", () => {
    const entries = [
      gitEntry(
        "mcp-server-planton",
        "https://github.com/plantonhq/mcp-server-planton.git",
      ),
      gitEntry(
        "agent-fleet",
        "https://github.com/plantonhq/agent-fleet.git",
      ),
    ];

    it("matches entry by first path segment and strips it", () => {
      const result = resolvePathAction(
        "agent-fleet/mcp-servers/mcp-server-planton.yaml",
        entries,
      );
      expect(result).toEqual({
        action: "link",
        url: "https://github.com/plantonhq/agent-fleet/blob/main/mcp-servers/mcp-server-planton.yaml",
        tooltip: "Open on GitHub",
      });
    });
  });

  describe("multiple git workspace entries — deep segment match (bug fix)", () => {
    const entries = [
      gitEntry(
        "mcp-server-planton",
        "https://github.com/plantonhq/mcp-server-planton.git",
      ),
      gitEntry(
        "agent-fleet",
        "https://github.com/plantonhq/agent-fleet.git",
      ),
    ];

    it("matches entry by deeper segment when org prefix is present", () => {
      const result = resolvePathAction(
        "plantonhq/agent-fleet/mcp-servers/mcp-server-planton.yaml",
        entries,
      );
      expect(result).toEqual({
        action: "link",
        url: "https://github.com/plantonhq/agent-fleet/blob/main/mcp-servers/mcp-server-planton.yaml",
        tooltip: "Open on GitHub",
      });
    });
  });

  describe("fallback to first entry when no segment matches", () => {
    const entries = [
      gitEntry("my-app", "https://github.com/acme/my-app.git"),
      gitEntry("my-lib", "https://github.com/acme/my-lib.git"),
    ];

    it("falls back to entries[0] with full path as relPath", () => {
      const result = resolvePathAction("unknown/path/file.txt", entries);
      expect(result).toEqual({
        action: "link",
        url: "https://github.com/acme/my-app/blob/main/unknown/path/file.txt",
        tooltip: "Open on GitHub",
      });
    });
  });

  describe("local path workspace entry", () => {
    const entries = [
      localEntry("my-app", "/Users/dev/projects/my-app"),
    ];

    it("joins local path for copy action", () => {
      const result = resolvePathAction("src/main.go", entries);
      expect(result).toEqual({
        action: "copy",
        value: "/Users/dev/projects/my-app/src/main.go",
        tooltip: "Copy path",
      });
    });
  });
});
