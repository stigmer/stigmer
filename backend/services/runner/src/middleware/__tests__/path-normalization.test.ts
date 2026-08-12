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
  it("maps a workspace-relative path to its rootDir-joined absolute form", () => {
    expect(normalizeWorkspacePathArg("src/main.py", ROOT)).toBe(`${ROOT}/src/main.py`);
  });

  it("strips a leading ./ before joining", () => {
    expect(normalizeWorkspacePathArg("./notes.md", ROOT)).toBe(`${ROOT}/notes.md`);
  });

  it("handles multi-workspace entry-relative paths", () => {
    expect(normalizeWorkspacePathArg("entry-1/src/main.py", ROOT)).toBe(
      `${ROOT}/entry-1/src/main.py`,
    );
  });

  it("resolves interior .. segments that stay inside the root", () => {
    expect(normalizeWorkspacePathArg("src/../notes.md", ROOT)).toBe(`${ROOT}/notes.md`);
  });

  it("leaves absolute paths untouched", () => {
    expect(normalizeWorkspacePathArg("/etc/hosts", ROOT)).toBeUndefined();
    expect(normalizeWorkspacePathArg(`${ROOT}/src/main.py`, ROOT)).toBeUndefined();
    expect(normalizeWorkspacePathArg("/", ROOT)).toBeUndefined();
  });

  it("refuses to rewrite relatives that escape the workspace root", () => {
    // A naive join would resolve `..` away and hand upstream validation a
    // clean out-of-root absolute path — an out-of-root read that today's
    // validation refuses. The guard keeps the refusal.
    expect(normalizeWorkspacePathArg("../sibling/secret.txt", ROOT)).toBeUndefined();
    expect(normalizeWorkspacePathArg("src/../../escape.txt", ROOT)).toBeUndefined();
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
      expect(args.file_path).toBe(`${ROOT}/src/main.py`);
      // Sibling args ride along untouched.
      expect(args.content).toBe("x");
    }
  });

  it("rewrites the base path on ls/glob/grep", async () => {
    for (const tool of ["ls", "glob", "grep"]) {
      const args = await argsSeenByHandler(tool, { path: "src", pattern: "**/*.py" });
      expect(args.path).toBe(`${ROOT}/src`);
      // The pattern is never a path — byte-untouched.
      expect(args.pattern).toBe("**/*.py");
    }
  });

  it("passes absolute paths through byte-untouched", async () => {
    const args = await argsSeenByHandler("read_file", { file_path: "/etc/hosts" });
    expect(args.file_path).toBe("/etc/hosts");
  });

  it("leaves an omitted base path (backend default) alone", async () => {
    const args = await argsSeenByHandler("ls", {});
    expect(args.path).toBeUndefined();
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
