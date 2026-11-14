// Pins useToolPresentation over the session fold's tool uses: kind and
// category classification (Claude and Stigmer names, MCP tools), labels,
// the step's own words (`phrase`, from `stepPhrase`) and the title's
// precedence (a host's label, then a background stop's words, then the
// phrase), primary argument, result views and summaries, the default
// disclosure (every kind a closed summary step but shell's tail and a
// memory proposal's preview), and the presenter registry's overrides
// (label, summary, disclosure, chrome, run-grouping) with their disposers.
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useToolPresentation, registerToolPresenter } from "../tool-presenter";
import { toolUse } from "./__fixtures__/fold-values";

describe("useToolPresentation", () => {
  it("classifies a PascalCase edit tool", () => {
    const tc = toolUse({
      name: "Edit",
      input: { file_path: "/x.ts", old_string: "a", new_string: "b" },
      result: "The file /x.ts has been updated successfully.",
    });
    const { result } = renderHook(() => useToolPresentation(tc));

    expect(result.current.kind).toBe("file_edit");
    expect(result.current.category).toBe("edit");
    expect(result.current.label).toBe("Edit");
    expect(result.current.result.type).toBe("diff");
    expect(result.current.resultSummary).toBe("+1 \u22121");
  });

  it("summarizes a failed shell exit code", () => {
    const tc = toolUse({
      name: "Bash",
      input: { command: "false" },
      result: "oops\n[Command failed with exit code 3]",
    });
    const { result } = renderHook(() => useToolPresentation(tc));

    expect(result.current.kind).toBe("shell");
    expect(result.current.result.type).toBe("terminal");
    expect(result.current.resultSummary).toBe("exit 3");
  });

  it("extracts the primary argument", () => {
    const tc = toolUse({ name: "Bash", input: { command: "ls -la" } });
    const { result } = renderHook(() => useToolPresentation(tc));
    expect(result.current.primaryArg).toBe("ls -la");
  });

  it("honors a registered custom presenter override and restores on dispose", () => {
    const dispose = registerToolPresenter("shell", {
      label: () => "Run command",
    });
    try {
      const tc = toolUse({ name: "Bash", input: { command: "ls" } });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.label).toBe("Run command");
    } finally {
      dispose();
    }

    // After dispose, the default label is restored — no global leakage.
    const tc = toolUse({ name: "Bash", input: { command: "ls" } });
    const { result } = renderHook(() => useToolPresentation(tc));
    expect(result.current.label).toBe("Shell");
  });

  describe("phrase and title", () => {
    it("exposes the step's own words and titles the row with them", () => {
      const tc = toolUse({
        name: "Edit",
        input: { file_path: "src/billing/invoice.ts", old_string: "a", new_string: "b" },
        result: "ok",
      });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.phrase).toEqual({ text: "Edited invoice.ts", tense: "past", folder: "src/billing", app: "" });
      expect(result.current.title).toBe("Edited invoice.ts");
      expect(result.current.label).toBe("Edit");
    });

    it("reads a connected app's tool as its own name, with the app beside it", () => {
      const tc = toolUse({ name: "create_issue", mcpServerName: "acme-github", input: { title: "x" }, result: "{}" });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.title).toBe("Create issue");
      expect(result.current.phrase.app).toBe("acme-github");
    });

    it("titles a failed step in the failed form", () => {
      const tc = toolUse({ name: "Edit", input: { file_path: "invoice.ts" }, isError: true, result: "no match" });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.phrase.tense).toBe("failed");
      expect(result.current.title).toBe("Couldn't edit invoice.ts");
    });

    it("lets a host's label outrank a background stop's words and the phrase", () => {
      const stop = toolUse({
        name: "stop_background_command",
        input: { id: "bg-1" },
        result: "stopped",
        stoppedBackground: { toolUseId: "run_1.bg-1", input: { command: "npm run dev" } },
      });
      expect(renderHook(() => useToolPresentation(stop)).result.current.title).toBe("Stopped");
      const dispose = registerToolPresenter("background_stop", { label: () => "Halted" });
      try {
        expect(renderHook(() => useToolPresentation(stop)).result.current.title).toBe("Halted");
      } finally {
        dispose();
      }
    });
  });

  describe("disclosure", () => {
    it("keeps known compact tools as summary", () => {
      // Shell is intentionally excluded — it is the `tail` category,
      // asserted separately below.
      for (const name of ["Read", "Grep", "Glob"]) {
        const tc = toolUse({ name, input: { path: "/x", command: "ls", pattern: "p" } });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.disclosure).toBe("summary");
      }
    });

    it("closes file edits and writes as summary steps (the line counts the change)", () => {
      for (const name of ["Edit", "Write"]) {
        const tc = toolUse({
          name,
          input: { file_path: "/x.ts", content: "x", old_string: "a", new_string: "b" },
        });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.disclosure).toBe("summary");
      }
    });

    it("keeps a memory proposal open as a preview (a decision surface)", () => {
      const tc = toolUse({ name: "remember", mcpServerName: "stigmer-memory", input: { fact: "prefers tabs" } });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.category).toBe("memory");
      expect(result.current.disclosure).toBe("preview");
    });

    it("gives shell the tail disclosure (open while live, open on a failure)", () => {
      const tc = toolUse({ name: "Bash", input: { command: "ls" }, result: "files" });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.category).toBe("shell");
      expect(result.current.disclosure).toBe("tail");
    });

    it("lets a host restore the always-expanded shell preview via the registry", () => {
      // The one-line opt-out for hosts that prefer the pre-tail behaviour.
      const dispose = registerToolPresenter("shell", {
        disclosure: () => "preview",
      });
      try {
        const tc = toolUse({ name: "Bash", input: { command: "ls" }, result: "files" });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.disclosure).toBe("preview");
      } finally {
        dispose();
      }
    });

    it("closes MCP tools as summary steps", () => {
      const tc = toolUse({
        name: "send_message",
        mcpServerName: "acme/slack",
        input: { channel: "general" },
      });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.category).toBe("mcp");
      expect(result.current.disclosure).toBe("summary");
    });

    it("closes an unrecognized tool as a summary step", () => {
      const tc = toolUse({ name: "frobnicate_widget", input: { x: "1" } });
      const { result } = renderHook(() => useToolPresentation(tc));
      expect(result.current.category).toBe("unknown");
      expect(result.current.disclosure).toBe("summary");
    });

    it("lets a registered presenter override the disclosure", () => {
      const dispose = registerToolPresenter("mcp", {
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
      const card = toolUse({ name: "Bash", input: { command: "ls" }, result: "files" });
      expect(renderHook(() => useToolPresentation(quiet)).result.current.chrome).toBe("quiet");
      expect(renderHook(() => useToolPresentation(card)).result.current.chrome).toBe("card");
    });

    it("lets a registered presenter restore the boxed look for a kind", () => {
      const dispose = registerToolPresenter("file_read", {
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
      for (const name of ["Read", "ls"]) {
        const tc = toolUse({ name, input: { path: "/x", pattern: "p" } });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.runGroupable).toBe(true);
      }
    });

    it("never folds high-signal categories", () => {
      // A search names its own pattern and what it found: folding hides both.
      for (const name of ["Bash", "Edit", "Grep", "Glob"]) {
        const tc = toolUse({ name, input: { command: "ls", path: "/x" } });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.runGroupable).toBe(false);
      }
    });

    it("lets a registered presenter override run-grouping", () => {
      const dispose = registerToolPresenter("shell", {
        runGroupable: () => true,
      });
      try {
        const tc = toolUse({ name: "Bash", input: { command: "ls" } });
        const { result } = renderHook(() => useToolPresentation(tc));
        expect(result.current.runGroupable).toBe(true);
      } finally {
        dispose();
      }
    });
  });
});
