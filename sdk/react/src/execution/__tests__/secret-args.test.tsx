/**
 * A settled tool-call row never shows a secret-keyed argument (stigmer#1119).
 *
 * The runner redacts a row's `args` at creation, but rows persisted before it
 * did still carry the values, so every sink that renders `args` hides them
 * through `@stigmer/sdk`'s `redactSecretArgs` / `isSecretArgKey` — the reader
 * side of test/fixtures/tool-view/secret-args.json. Each case renders a row as
 * an older runner stored it, with the secret in clear.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  ToolCallSchema,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { McpToolDetail } from "../McpToolDetail";
import { ToolArgsView } from "../ToolArgsView";
import { ToolCallDetail } from "../ToolCallDetail";
import { extractPrimaryArg } from "../tool-categories";

afterEach(cleanup);

const SECRET = "s3cret-value";

function settledRow(name: string, mcpServerSlug: string, args: Record<string, unknown>): ToolCall {
  return create(ToolCallSchema, {
    id: "tc-1",
    name,
    mcpServerSlug,
    args: args as JsonObject,
    result: "ok",
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
  });
}

describe("the detail views hide a secret-keyed argument and keep the rest", () => {
  it("McpToolDetail's argument list", () => {
    const { container } = render(
      <McpToolDetail toolCall={settledRow("push", "github", { token: SECRET, repo: "acme/x" })} />,
    );
    expect(container.textContent).not.toContain(SECRET);
    expect(container.textContent).toContain("[REDACTED]");
    expect(container.textContent).toContain("acme/x");
  });

  it("ToolArgsView's MCP branch", () => {
    const { container } = render(
      <ToolArgsView toolName="push" mcpServerSlug="github" args={{ Api_Key: SECRET, repo: "acme/x" }} />,
    );
    expect(container.textContent).not.toContain(SECRET);
    expect(container.textContent).toContain("acme/x");
  });

  it("ToolArgsView's generic branch, and ToolCallDetail through it", () => {
    const args = { authorization: SECRET, region: "eu-west-1" };
    const view = render(<ToolArgsView toolName="mystery_tool" args={args} />);
    expect(view.container.textContent).not.toContain(SECRET);
    expect(view.container.textContent).toContain("eu-west-1");
    cleanup();

    const detail = render(<ToolCallDetail toolCall={settledRow("mystery_tool", "", args)} />);
    expect(detail.container.textContent).not.toContain(SECRET);
  });
});

describe("the row title never falls back to a secret", () => {
  it("skips a secret first argument for the next argument", () => {
    expect(extractPrimaryArg(settledRow("push", "github", { token: SECRET, repo: "acme/x" }))).toBe("acme/x");
  });

  it("has no title argument when every argument is secret", () => {
    expect(extractPrimaryArg(settledRow("push", "github", { password: SECRET }))).toBeNull();
  });

  it("keeps the first argument when it is not secret", () => {
    expect(extractPrimaryArg(settledRow("push", "github", { repo: "acme/x", token: SECRET }))).toBe("acme/x");
  });
});
