/**
 * Model-authored intent titles for shell tool calls (stigmer#276), read from
 * a tool use's input or, for a waiting call's card, its ask's preview: the
 * intent is a shell row's line, with the command beside it; without one the
 * line says what the step did ("Ran a command"); a waiting shell call's
 * card says what the agent wants in its header and the intent in its body.
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
import type { JsonObject } from "@bufbuild/protobuf";
import type { ToolUse } from "@stigmer/client";
import { extractShellIntentFromPreview } from "@stigmer/react-core";
import { extractIntent, extractShellIntent, SHELL_INTENT_ARG_FIELD } from "@stigmer/react-core/internal";
import { useToolPresentation, registerToolPresenter } from "../tool-presenter";
import { ToolCallItem } from "../ToolCallItem";
import { ApprovalCardBody, ApprovalCardHeader } from "../ApprovalCard";
import { toolUse } from "./__fixtures__/fold-values";

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

function makeToolUse(opts: {
  name: string;
  args?: Record<string, unknown>;
  mcpServerSlug?: string;
}): ToolUse {
  return toolUse({
    name: opts.name,
    input: (opts.args ?? {}) as JsonObject,
    mcpServerName: opts.mcpServerSlug ?? "",
  });
}

describe("intent-title fixture contract", () => {
  it("pins the wire key shared with the runner middleware", () => {
    expect(SHELL_INTENT_ARG_FIELD).toBe(fixture.argField);
  });

  it.each(fixture.cases.map((c, i) => [i, c] as const))(
    "case %#: %j",
    (_i, c) => {
      const tc = makeToolUse({
        name: c.name,
        args: c.args,
        mcpServerSlug: c.mcpServerSlug,
      });
      expect(extractShellIntent(tc)).toBe(c.intent);
    },
  );
});

describe("extractIntent", () => {
  it("reads a shell call's intent from its input, and nothing for another kind or a blank value", () => {
    expect(
      extractIntent({ name: "execute", mcpServerName: "", input: { command: "ls", [SHELL_INTENT_ARG_FIELD]: "List files" } }),
    ).toBe("List files");
    expect(extractIntent({ name: "execute", mcpServerName: "", input: { command: "ls", [SHELL_INTENT_ARG_FIELD]: "" } })).toBeNull();
    expect(
      extractIntent({ name: "task", mcpServerName: "", input: { [SHELL_INTENT_ARG_FIELD]: "a subagent's subject" } }),
    ).toBeNull();
  });
});

describe("extractShellIntentFromPreview", () => {
  it("mirrors the tool use extraction on a JSON args preview", () => {
    expect(
      extractShellIntentFromPreview(
        "execute",
        JSON.stringify({ command: "make check", [SHELL_INTENT_ARG_FIELD]: "Verify the build" }),
      ),
    ).toBe("Verify the build");
  });

  it("prefers a kind the caller holds over the name", () => {
    // A shell tool whose NAME the classifier does not recognize still
    // resolves via the given kind — matching extractPrimaryArgFromPreview.
    expect(
      extractShellIntentFromPreview(
        "custom_runner",
        JSON.stringify({ command: "ls", [SHELL_INTENT_ARG_FIELD]: "List files" }),
        "",
        "shell",
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
    const tc = makeToolUse({
      name: "Bash",
      args: { command: "npm test", [SHELL_INTENT_ARG_FIELD]: "Run the test suite" },
    });
    const { result } = renderHook(() => useToolPresentation(tc));

    expect(result.current.intent).toBe("Run the test suite");
    expect(result.current.title).toBe("Run the test suite");
    // The short kind label is unchanged — chips and badges keep "Shell".
    expect(result.current.label).toBe("Shell");
  });

  it("falls back to what the step did when no intent is present", () => {
    const tc = toolUse({ name: "Bash", input: { command: "ls" }, result: "a.ts" });
    const { result } = renderHook(() => useToolPresentation(tc));

    expect(result.current.intent).toBeNull();
    expect(result.current.title).toBe("Ran a command");
    expect(result.current.label).toBe("Shell");
  });

  it("a registered presenter label override outranks the intent", () => {
    const dispose = registerToolPresenter("shell", {
      label: () => "Run command",
    });
    try {
      const tc = makeToolUse({
        name: "Bash",
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
    const tc = makeToolUse({
      name: "Bash",
      args: {
        command: "npx vitest run src/parser",
        [SHELL_INTENT_ARG_FIELD]: "Run unit tests for the parser",
      },
    });
    const { container } = render(<ToolCallItem toolUse={tc} />);

    const header = headerOf(container);
    expect(header.textContent).toContain("Run unit tests for the parser");
    expect(header.textContent).toContain("npx vitest run src/parser");
    expect(header.textContent).not.toContain("Shell");
  });

  it("renders an intent-less shell row as what it did, with the command beside it", () => {
    const tc = toolUse({ name: "Bash", input: { command: "ls -la" }, result: "a.ts" });
    const { container } = render(<ToolCallItem toolUse={tc} />);

    const header = headerOf(container);
    expect(header.textContent).toContain("Ran a command");
    expect(header.textContent).toContain("ls -la");
    expect(header.textContent).not.toContain("Shell");
  });
});

describe("ApprovalCardHeader shell title", () => {
  it("says a waiting shell call's intent phrase from its ask's preview, before what waits", () => {
    const pending = toolUse({
      id: "tc-1",
      name: "execute",
      ask: {
        argsPreview: JSON.stringify({
          command: "rm -rf build",
          [SHELL_INTENT_ARG_FIELD]: "Clean the build directory.",
        }),
      },
    });
    const { container } = render(<ApprovalCardBody toolUse={pending} onAnswer={() => {}} />);

    expect(container.querySelector('[data-cursor-target="approval-waits"]')?.textContent).toBe(
      "Clean the build directory. Nothing runs until you allow it.",
    );
  });

  it("titles a waiting shell call with what the agent wants, intent or none", () => {
    for (const args of [{ command: "rm -rf build" }, { command: "rm -rf build", [SHELL_INTENT_ARG_FIELD]: "Clean the build directory" }]) {
      const pending = toolUse({ id: "tc-2", name: "execute", ask: { argsPreview: JSON.stringify(args) } });
      const { unmount } = render(<ApprovalCardHeader toolUse={pending} />);

      expect(screen.getByText("The agent wants to run a command")).toBeDefined();
      expect(screen.queryByText("Shell")).toBeNull();
      expect(screen.queryByText("Clean the build directory")).toBeNull();
      unmount();
    }
  });
});
