// Pins useToolPresentation over the session fold's tool uses: kind and
// category classification (Cursor and native names, MCP tools), labels,
// primary argument, result views and summaries, and the presenter
// registry's overrides (label, summary, disclosure, chrome, run-grouping)
// with their disposers.
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { ToolKind } from "@stigmer/sdk";
import { useToolPresentation, registerToolPresenter } from "../tool-presenter";
import { toolUse } from "./__fixtures__/fold-values";

describe("useToolPresentation", () => {
  it("classifies a Cursor PascalCase edit tool (the bug this fixes)", () => {
    const tc = toolUse({
      name: "StrReplace",
      input: { path: "/x.ts", old_string: "a", new_string: "b" },
      result: '{"status":"success","value":{"linesAdded":1,"linesRemoved":1}}',
    });
    const { result } = renderHook(() => useToolPresentation(tc));

    expect(result.current.kind).toBe(ToolKind.FILE_EDIT);
    expect(result.current.category).toBe("edit");
    expect(result.current.label).toBe("Edit");
    expect(result.current.result.type).toBe("diff");
    expect(result.current.resultSummary).toBe("+1 -1");
  });

  it("summarizes a failed shell exit code", () => {
    const tc = toolUse({
      name: "Shell",
      input: { command: "false" },
      result: "oops\n[Command failed with exit code 3]",
    });
    const { result } = renderHook(() => useToolPresentation(tc));

    expect(result.current.kind).toBe(ToolKind.SHELL);
    expect(result.current.result.type).toBe("terminal");
    expect(result.current.resultSummary).toBe("exit 3");
  });

  it("extracts the primary argument", () => {
    const tc = toolUse({ name: "Shell", input: { command: "ls -la" } });
    const { result } = renderHook(() => useToolPresentation(tc));
    expect(result.current.primaryArg).toBe("ls -la");
  });

  it("honors a registered custom presenter override and restores on dispose", () => {
    const dispose = registerToolPresenter(ToolKind.SHELL, {
      label: () => "Run command",
    });
    try {
      const tc = toolUse({ name: "Shell", input: { command: "ls" } });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.label).toBe("Run command");
    } finally {
      dispose();
    }

    // After dispose, the default label is restored — no global leakage.
    const tc = toolUse({ name: "Shell", input: { command: "ls" } });
    const { result } = renderHook(() => useToolPresentation(tc));
    expect(result.current.label).toBe("Shell");
  });

  describe("disclosure", () => {
    it("keeps known compact tools as summary", () => {
      // Shell/edit/write are intentionally excluded — shell is the `tail`
      // category and edit/write are `preview` categories (output / diff is
      // the information), asserted separately below.
      for (const name of ["Read", "Grep", "Glob"]) {
        const tc = toolUse({ name, input: { path: "/x", command: "ls", pattern: "p" } });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.disclosure).toBe("summary");
      }
    });

    it("previews file edits and writes (the diff is the information)", () => {
      for (const name of ["StrReplace", "Write"]) {
        const tc = toolUse({
          name,
          input: { path: "/x.ts", contents: "x", old_string: "a", new_string: "b" },
        });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.disclosure).toBe("preview");
      }
    });

    it("gives shell the tail disclosure (live preview, dimmed-tail settle)", () => {
      const tc = toolUse({ name: "Shell", input: { command: "ls" }, result: "files" });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.category).toBe("shell");
      expect(result.current.disclosure).toBe("tail");
    });

    it("lets a host restore the always-expanded shell preview via the registry", () => {
      // The one-line opt-out for hosts that prefer the pre-tail behaviour.
      const dispose = registerToolPresenter(ToolKind.SHELL, {
        disclosure: () => "preview",
      });
      try {
        const tc = toolUse({ name: "Shell", input: { command: "ls" }, result: "files" });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.disclosure).toBe("preview");
      } finally {
        dispose();
      }
    });

    it("foregrounds MCP tools as preview", () => {
      const tc = toolUse({
        name: "send_message",
        mcpServerName: "acme/slack",
        input: { channel: "general" },
      });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.category).toBe("mcp");
      expect(result.current.disclosure).toBe("preview");
    });

    it("foregrounds an unrecognized tool as preview", () => {
      const tc = toolUse({ name: "frobnicate_widget", input: { x: "1" } });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.category).toBe("unknown");
      expect(result.current.disclosure).toBe("preview");
    });

    it("lets a registered presenter override the disclosure", () => {
      const dispose = registerToolPresenter(ToolKind.MCP, {
        disclosure: () => "summary",
      });
      try {
        const tc = toolUse({
          name: "noisy_tool",
          mcpServerName: "acme/noisy",
        });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.disclosure).toBe("summary");
      } finally {
        dispose();
      }
    });
  });

  describe("chrome", () => {
    it("quiets metadata-only categories and keeps content-bearing ones as cards", () => {
      const quiet = toolUse({ name: "Read", input: { path: "/x" } });
      const card = toolUse({ name: "Shell", input: { command: "ls" }, result: "files" });
      expect(renderHook(() => useToolPresentation(quiet)).result.current.chrome).toBe("quiet");
      expect(renderHook(() => useToolPresentation(card)).result.current.chrome).toBe("card");
    });

    it("lets a registered presenter restore the boxed look for a kind", () => {
      const dispose = registerToolPresenter(ToolKind.FILE_READ, {
        chrome: () => "card",
      });
      try {
        const tc = toolUse({ name: "Read", input: { path: "/x" } });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.chrome).toBe("card");
      } finally {
        dispose();
      }
    });
  });

  describe("runGroupable", () => {
    it("folds read-only repetitive categories", () => {
      for (const name of ["Read", "Grep", "Glob"]) {
        const tc = toolUse({ name, input: { path: "/x", pattern: "p" } });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.runGroupable).toBe(true);
      }
    });

    it("never folds high-signal categories", () => {
      for (const name of ["Shell", "StrReplace"]) {
        const tc = toolUse({ name, input: { command: "ls", path: "/x" } });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.runGroupable).toBe(false);
      }
    });

    it("lets a registered presenter override run-grouping", () => {
      const dispose = registerToolPresenter(ToolKind.SHELL, {
        runGroupable: () => true,
      });
      try {
        const tc = toolUse({ name: "Shell", input: { command: "ls" } });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.runGroupable).toBe(true);
      } finally {
        dispose();
      }
    });
  });
});
