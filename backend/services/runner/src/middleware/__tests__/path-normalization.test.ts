import { describe, it, expect, vi } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import {
  createPathNormalizationMiddleware,
  normalizeWorkspacePathArg,
} from "../path-normalization.js";
import type { ToolCallRequest } from "../types.js";

const ROOT = "/workspace/session-1/repo";

function makeRequest(
  name: string,
  args: Record<string, unknown>,
): ToolCallRequest {
  return {
    toolCall: { id: "tc_1", name, args },
    tool: undefined,
    state: { messages: [] },
    runtime: {},
  };
}

/** Run the middleware and return the args the inner handler observed. */
async function argsSeenByHandler(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const mw = createPathNormalizationMiddleware({ rootDir: ROOT });
  const handler = vi.fn(async (req: ToolCallRequest) => {
    return new ToolMessage({ content: "ok", tool_call_id: req.toolCall.id, name });
  });
  await mw.wrapToolCall!(makeRequest(name, args), handler);
  expect(handler).toHaveBeenCalledTimes(1);
  return handler.mock.calls[0][0].toolCall.args;
}

describe("normalizeWorkspacePathArg", () => {
  it("maps a workspace-relative path to its virtual-absolute form", () => {
    expect(normalizeWorkspacePathArg("src/main.py", ROOT)).toBe("/src/main.py");
  });

  it("strips a leading ./ before rooting", () => {
    expect(normalizeWorkspacePathArg("./notes.md", ROOT)).toBe("/notes.md");
  });

  it("handles multi-workspace entry-relative paths", () => {
    expect(normalizeWorkspacePathArg("entry-1/src/main.py", ROOT)).toBe(
      "/entry-1/src/main.py",
    );
  });

  it("resolves interior .. segments that stay inside the root", () => {
    expect(normalizeWorkspacePathArg("src/../notes.md", ROOT)).toBe("/notes.md");
    // Same repair on an already-virtual path: the virtual resolver rejects
    // `..` outright, so the safe interior collapse happens at this seam.
    expect(normalizeWorkspacePathArg("/src/../notes.md", ROOT)).toBe("/notes.md");
  });

  it("maps a REAL-absolute in-root path to its virtual form (legacy-dialect compatibility)", () => {
    expect(normalizeWorkspacePathArg(`${ROOT}/src/main.py`, ROOT)).toBe("/src/main.py");
    // The root itself is the virtual root.
    expect(normalizeWorkspacePathArg(ROOT, ROOT)).toBe("/");
  });

  it("leaves canonical virtual-absolute paths untouched", () => {
    // In the virtual dialect these are already canonical names — "/etc/hosts"
    // means the WORKSPACE's etc/hosts, not the host file.
    expect(normalizeWorkspacePathArg("/etc/hosts", ROOT)).toBeUndefined();
    expect(normalizeWorkspacePathArg("/", ROOT)).toBeUndefined();
  });

  it("refuses to rewrite relatives that escape the workspace root", () => {
    // posix.normalize would silently swallow a leading ".." on an absolute
    // path — rewriting the call onto a DIFFERENT in-root file. The escape is
    // detected in relative form and left raw for the upstream refusal.
    expect(normalizeWorkspacePathArg("../sibling/secret.txt", ROOT)).toBeUndefined();
    expect(normalizeWorkspacePathArg("src/../../escape.txt", ROOT)).toBeUndefined();
    expect(normalizeWorkspacePathArg("/src/../../escape.txt", ROOT)).toBeUndefined();
  });

  it("leaves ~-carrying paths untouched (upstream refuses them either way)", () => {
    expect(normalizeWorkspacePathArg("~/notes.md", ROOT)).toBeUndefined();
    expect(normalizeWorkspacePathArg("docs/~/x.md", ROOT)).toBeUndefined();
  });

  it("leaves the empty string untouched", () => {
    expect(normalizeWorkspacePathArg("", ROOT)).toBeUndefined();
  });
});

describe("createPathNormalizationMiddleware", () => {
  it("rewrites file_path on the file tools", async () => {
    for (const tool of ["read_file", "write_file", "edit_file"]) {
      const args = await argsSeenByHandler(tool, {
        file_path: "src/main.py",
        content: "x",
      });
      expect(args.file_path).toBe("/src/main.py");
      // Sibling args ride along untouched.
      expect(args.content).toBe("x");
    }
  });

  it("rewrites the base path on ls/glob/grep", async () => {
    for (const tool of ["ls", "glob", "grep"]) {
      const args = await argsSeenByHandler(tool, { path: "src", pattern: "**/*.py" });
      expect(args.path).toBe("/src");
      // The pattern is never a path — byte-untouched.
      expect(args.pattern).toBe("**/*.py");
    }
  });

  it("passes canonical virtual paths through byte-untouched", async () => {
    const args = await argsSeenByHandler("read_file", { file_path: "/etc/hosts" });
    expect(args.file_path).toBe("/etc/hosts");
  });

  it("leaves an omitted base path alone — the tools' '/' default IS the workspace root now", async () => {
    // Deliberate reversal of the #528 injection: under the legacy backend the
    // schema default "/" meant the OS ROOT, so the middleware had to fill the
    // omission. Under the virtual root (issue #754) the default already means
    // the workspace root — filling it would just duplicate the tool's own
    // behavior.
    for (const tool of ["ls", "glob", "grep"]) {
      const args = await argsSeenByHandler(tool, { pattern: "TOKEN" });
      expect(args.path).toBeUndefined();
      expect(args.pattern).toBe("TOKEN");
    }
  });

  it("does not fill an omitted file_path on the file tools", async () => {
    // An absent file_path is a genuine model error — the tool's own input
    // validation gives the better message than any path this seam could invent.
    const args = await argsSeenByHandler("read_file", {});
    expect(args.file_path).toBeUndefined();
  });

  it("never touches tools outside the built-in filesystem set", async () => {
    // An MCP tool could plausibly carry a same-named arg with different
    // semantics; only the six built-in names are rewritten.
    const args = await argsSeenByHandler("vendor_upload", { file_path: "src/main.py" });
    expect(args.file_path).toBe("src/main.py");
  });

  it("leaves non-string path args for the tool's own input validation", async () => {
    const args = await argsSeenByHandler("read_file", { file_path: 42 });
    expect(args.file_path).toBe(42);
  });

  it("preserves the original request identity fields on rewrite", async () => {
    const mw = createPathNormalizationMiddleware({ rootDir: ROOT });
    const handler = vi.fn(async (req: ToolCallRequest) => {
      return new ToolMessage({ content: "ok", tool_call_id: req.toolCall.id, name: req.toolCall.name });
    });
    const original = makeRequest("read_file", { file_path: "notes.md" });
    await mw.wrapToolCall!(original, handler);

    const seen = handler.mock.calls[0][0];
    expect(seen.toolCall.id).toBe("tc_1");
    expect(seen.toolCall.name).toBe("read_file");
    expect(seen.state).toBe(original.state);
    expect(seen.runtime).toBe(original.runtime);
    // The original request is never mutated in place.
    expect(original.toolCall.args.file_path).toBe("notes.md");
  });
});
