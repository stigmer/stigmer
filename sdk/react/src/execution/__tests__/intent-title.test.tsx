/**
 * Model-authored intent titles for shell tool calls (stigmer#276).
 *
 * The extraction contract is pinned by the cross-surface fixture
 * test/fixtures/tool-view/intent-title.json — the same file the runner's
 * tool-intent middleware tests assert against, so the wire key and the
 * kind-scoping can never drift between the writer and the readers.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  ToolCallSchema,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ToolCallStatus, ToolKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  extractShellIntent,
  extractShellIntentFromPreview,
  SHELL_INTENT_ARG_FIELD,
} from "../tool-categories";
import { useToolPresentation, registerToolPresenter } from "../tool-presenter";
import { ToolCallItem } from "../ToolCallItem";
import { ApprovalCardHeader } from "../ApprovalCard";

afterEach(cleanup);

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../../../../../test/fixtures/tool-view/intent-title.json");

interface IntentFixture {
  argField: string;
  cases: Array<{
    name: string;
    mcpServerSlug: string;
    args: Record<string, unknown>;
    intent: string | null;
  }>;
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as IntentFixture;

function makeToolCall(opts: {
  name: string;
  args?: Record<string, unknown>;
  mcpServerSlug?: string;
  status?: ToolCallStatus;
}): ToolCall {
  return create(ToolCallSchema, {
    id: opts.name,
    name: opts.name,
    args: (opts.args ?? {}) as JsonObject,
    mcpServerSlug: opts.mcpServerSlug ?? "",
    status: opts.status ?? ToolCallStatus.TOOL_CALL_COMPLETED,
  });
}

describe("intent-title fixture contract", () => {
  it("pins the wire key shared with the runner middleware", () => {
    expect(SHELL_INTENT_ARG_FIELD).toBe(fixture.argField);
  });

  it.each(fixture.cases.map((c, i) => [i, c] as const))(
    "case %#: %j",
    (_i, c) => {
      const tc = makeToolCall({
        name: c.name,
        args: c.args,
        mcpServerSlug: c.mcpServerSlug,
      });
      expect(extractShellIntent(tc)).toBe(c.intent);
    },
  );
});

describe("extractShellIntentFromPreview", () => {
  it("mirrors the ToolCall extraction on a JSON args preview", () => {
    expect(
      extractShellIntentFromPreview(
        "execute",
        JSON.stringify({ command: "make check", [SHELL_INTENT_ARG_FIELD]: "Verify the build" }),
      ),
    ).toBe("Verify the build");
  });

  it("prefers the denormalized wire kind over the name", () => {
    // A shell tool whose NAME the classifier does not recognize still
    // resolves via the wire kind — matching extractPrimaryArgFromPreview.
    expect(
      extractShellIntentFromPreview(
        "custom_runner",
        JSON.stringify({ command: "ls", [SHELL_INTENT_ARG_FIELD]: "List files" }),
        "",
        ToolKind.SHELL,
      ),
    ).toBe("List files");
  });

  it("returns null for malformed previews and non-shell kinds", () => {
    expect(extractShellIntentFromPreview("execute", "not json{")).toBeNull();
    expect(extractShellIntentFromPreview("execute", "")).toBeNull();
    expect(
      extractShellIntentFromPreview(
        "read_file",
        JSON.stringify({ file_path: "a", [SHELL_INTENT_ARG_FIELD]: "x" }),
      ),
    ).toBeNull();
  });
});

describe("useToolPresentation title precedence", () => {
  it("titles a shell row with the model-authored intent", () => {
    const tc = makeToolCall({
      name: "Shell",
      args: { command: "npm test", [SHELL_INTENT_ARG_FIELD]: "Run the test suite" },
    });
    const { result } = renderHook(() => useToolPresentation(tc));

    expect(result.current.intent).toBe("Run the test suite");
    expect(result.current.title).toBe("Run the test suite");
    // The short kind label is unchanged — chips and badges keep "Shell".
    expect(result.current.label).toBe("Shell");
  });

  it("falls back to the category label when no intent is present", () => {
    const tc = makeToolCall({ name: "Shell", args: { command: "ls" } });
    const { result } = renderHook(() => useToolPresentation(tc));

    expect(result.current.intent).toBeNull();
    expect(result.current.title).toBe("Shell");
  });

  it("a registered presenter label override outranks the intent", () => {
    const dispose = registerToolPresenter(ToolKind.SHELL, {
      label: () => "Run command",
    });
    try {
      const tc = makeToolCall({
        name: "Shell",
        args: { command: "ls", [SHELL_INTENT_ARG_FIELD]: "List files" },
      });
      const { result } = renderHook(() => useToolPresentation(tc));

      expect(result.current.title).toBe("Run command");
      expect(result.current.intent).toBe("List files");
    } finally {
      dispose();
    }
  });
});

describe("ToolCallItem shell header", () => {
  function headerOf(container: HTMLElement): Element {
    const row = container.querySelector('[data-cursor-target="tool-call-row"]')!;
    return row.firstElementChild!;
  }

  it("renders the intent as the title and the command as the subtitle", () => {
    const tc = makeToolCall({
      name: "Shell",
      args: {
        command: "npx vitest run src/parser",
        [SHELL_INTENT_ARG_FIELD]: "Run unit tests for the parser",
      },
    });
    const { container } = render(<ToolCallItem toolCall={tc} />);

    const header = headerOf(container);
    expect(header.textContent).toContain("Run unit tests for the parser");
    expect(header.textContent).toContain("npx vitest run src/parser");
    expect(header.textContent).not.toContain("Shell");
  });

  it("renders an intent-less shell row exactly as before: bare label, no subtitle", () => {
    const tc = makeToolCall({
      name: "Shell",
      args: { command: "ls -la" },
    });
    const { container } = render(<ToolCallItem toolCall={tc} />);

    const header = headerOf(container);
    expect(header.textContent).toContain("Shell");
    // The command lives in the terminal body only — never in the header.
    expect(header.textContent).not.toContain("ls -la");
  });
});

describe("ApprovalCardHeader shell title", () => {
  it("titles a gated shell call with the intent phrase", () => {
    const pending = create(PendingApprovalSchema, {
      toolCallId: "tc-1",
      toolName: "execute",
      toolKind: ToolKind.SHELL,
      argsPreview: JSON.stringify({
        command: "rm -rf build",
        [SHELL_INTENT_ARG_FIELD]: "Clean the build directory",
      }),
    });
    render(<ApprovalCardHeader pendingApproval={pending} />);

    expect(screen.getByText("Clean the build directory")).toBeDefined();
  });

  it("keeps the bare category label when no intent is present", () => {
    const pending = create(PendingApprovalSchema, {
      toolCallId: "tc-2",
      toolName: "execute",
      toolKind: ToolKind.SHELL,
      argsPreview: JSON.stringify({ command: "rm -rf build" }),
    });
    render(<ApprovalCardHeader pendingApproval={pending} />);

    expect(screen.getByText("Shell")).toBeDefined();
  });
});
