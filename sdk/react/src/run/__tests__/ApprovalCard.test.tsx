/**
 * Pins the approval card (../ApprovalCard.tsx) over a tool use that waits
 * for a person, as the session's events fold it: its neutral chrome with a
 * warning (or, for a delete, destructive) accent, and its category and
 * clock icons in the at-risk colour the theme contract measures; the header
 * saying what the agent wants as a sentence from the call's kind ("The agent
 * wants to create a file"), with a file path beside it, its folder dimmed;
 * the body's first line saying what waits for the answer ("Nothing runs until
 * you allow it."), after the agent's own description of a command; the shell
 * gate's command shown once and its auto-keep note; classification from the
 * tool's name and MCP server; the why-gated line from the ask's rule word,
 * suppressed for the everyday default; a file tool's restating message
 * suppressed; the three answers — Allow (`allow`), Deny with an optional
 * reason (`deny`), and Allow all of the call's class (`grant`,
 * labelled by class, MCP server or the hook that asked); the proposed content
 * read from the tool's input over the ask's sanitized preview, never a
 * redacted field, and no preview at all for a write or edit with only a path;
 * and a failed answer shown in-card.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { JsonObject } from "@bufbuild/protobuf";
import type { ToolUse } from "@stigmer/client";
import { samples } from "@stigmer/react-core/test";
import { ApprovalCard, ApprovalCardBody } from "../ApprovalCard";

afterEach(cleanup);

const noop = () => {};

interface WaitingInit {
  readonly input?: JsonObject;
  readonly argsPreview?: string;
  readonly message?: string;
  readonly policySource?: string;
  readonly policyHook?: string;
  readonly mcpServerName?: string;
}

/** A tool use that waits for an answer: its use (permission ask) and the ask, folded. */
function waiting(name: string, init: WaitingInit = {}): ToolUse {
  const use = samples.toolUseEvent(name, init.input ?? {}, {
    evaluatedPermission: "ask",
    ...(init.mcpServerName === undefined ? {} : { mcpServerName: init.mcpServerName }),
  });
  const toolUseId = use.event.value!.id;
  const ask = samples.permissionAskedEvent(toolUseId, {
    argsPreview: init.argsPreview ?? "{}",
    message: init.message ?? "",
    policySource: init.policySource ?? "",
    policyHook: init.policyHook ?? "",
  });
  const tool = samples
    .fold([samples.userMessageEvent("go"), use, ask])
    .turns[0]!.items.find((item): item is ToolUse => item.kind === "tool_use")!;
  expect(tool.state).toBe("waiting");
  return tool;
}

/** The body's first line: what waits for the answer. */
function waitLine(container: HTMLElement): string | null {
  return container.querySelector('[data-cursor-target="approval-waits"]')?.textContent ?? null;
}

describe("ApprovalCard chrome", () => {
  it("renders neutral chrome with a restrained warning accent (no amber fill)", () => {
    render(
      <ApprovalCard
        toolUse={waiting("edit_file", { argsPreview: '{"path":"src/x.ts","new_string":"x"}' })}
        onAnswer={noop}
      />,
    );
    const card = screen.getByRole("alert");
    expect(card.className).toContain("stg:border-border-prominent");
    expect(card.className).toContain("stg:border-l-warning");
    expect(card.className).not.toContain("stg:bg-warning");
    expect(card.getAttribute("aria-label")).toBe("Approval required for edit_file");
    // The header's one mark, the hand, in the at-risk colour.
    expect(
      card.querySelectorAll('[aria-hidden="true"].stg\\:text-status-degraded'),
    ).toHaveLength(1);
  });

  it("keeps a destructive red accent for a delete approval", () => {
    render(<ApprovalCard toolUse={waiting("delete_file", { argsPreview: '{"path":"/tmp/x"}' })} onAnswer={noop} />);
    expect(screen.getByRole("alert").className).toContain("stg:border-l-destructive");
  });

  it("shows a shell gate's command once, in the body's terminal session", () => {
    const { container } = render(
      <ApprovalCard toolUse={waiting("shell", { argsPreview: '{"command":"npm test"}' })} onAnswer={noop} />,
    );
    const session = container.querySelector('[data-cursor-target="terminal-session"]');
    expect(session?.textContent).toContain("$ npm test");
    expect((container.textContent!.match(/npm test/g) ?? []).length).toBe(1);
    expect(screen.getByText(/kept automatically/)).toBeTruthy();
  });

  it("titles a shell gate by its kind, and says the call's intent phrase before what waits", () => {
    const { container } = render(
      <ApprovalCard
        toolUse={waiting("shell", { argsPreview: '{"command":"npm test","description":"Run the unit tests"}' })}
        onAnswer={noop}
      />,
    );
    expect(screen.getByText("The agent wants to run a command")).toBeTruthy();
    expect(screen.queryByText("Run the unit tests")).toBeNull();
    expect(waitLine(container)).toBe("Run the unit tests. Nothing runs until you allow it.");
  });

  it("never shows the auto-keep note on a non-shell gate", () => {
    render(
      <ApprovalCard toolUse={waiting("write_file", { argsPreview: '{"path":"src/x.ts","content":"x"}' })} onAnswer={noop} />,
    );
    expect(screen.queryByText(/kept automatically/)).toBeNull();
  });

  it("classifies a tool by its name, and an unknown MCP tool by its server", () => {
    render(<ApprovalCard toolUse={waiting("delete_file", { argsPreview: '{"path":"/tmp/x"}' })} onAnswer={noop} />);
    expect(screen.getByText("The agent wants to delete a file")).toBeTruthy();
    cleanup();
    render(
      <ApprovalCard
        toolUse={waiting("create_issue", { mcpServerName: "github", argsPreview: '{"slug":"acme/repo"}' })}
        onAnswer={noop}
      />,
    );
    expect(screen.getByText("The agent wants to use Create issue")).toBeTruthy();
    expect(screen.getAllByText("acme/repo").length).toBeGreaterThan(0);
  });
});

describe("ApprovalCard header sentence", () => {
  it("says what the agent wants from the call's kind", () => {
    const cases: ReadonlyArray<{ name: string; mcpServerName?: string; argsPreview?: string; expected: string }> = [
      { name: "write_file", argsPreview: '{"path":"src/x.ts","content":"x"}', expected: "The agent wants to create a file" },
      { name: "edit_file", argsPreview: '{"path":"src/x.ts","new_string":"x"}', expected: "The agent wants to edit a file" },
      { name: "delete_file", argsPreview: '{"path":"/tmp/x"}', expected: "The agent wants to delete a file" },
      { name: "shell", argsPreview: '{"command":"npm test"}', expected: "The agent wants to run a command" },
      { name: "read_file", argsPreview: '{"path":"src/x.ts"}', expected: "The agent wants to read a file" },
      { name: "web_fetch", argsPreview: '{"url":"https://example.com"}', expected: "The agent wants to open a web page" },
      { name: "WebSearch", argsPreview: '{"query":"vitest"}', expected: "The agent wants to search the web" },
      { name: "create_issue", mcpServerName: "github", expected: "The agent wants to use Create issue" },
      { name: "publishNote", expected: "The agent wants to use Publish note" },
      { name: "grep", argsPreview: '{"pattern":"TODO"}', expected: "The agent wants to go ahead" },
    ];
    for (const { name, mcpServerName, argsPreview, expected } of cases) {
      const init = {
        ...(mcpServerName === undefined ? {} : { mcpServerName }),
        ...(argsPreview === undefined ? {} : { argsPreview }),
      };
      const { getByText, unmount } = render(<ApprovalCard toolUse={waiting(name, init)} onAnswer={noop} />);
      expect(getByText(expected)).toBeTruthy();
      unmount();
    }
  });

  it("sets the sentence at 14/20 in the header row", () => {
    render(<ApprovalCard toolUse={waiting("delete_file", { argsPreview: '{"path":"/tmp/x"}' })} onAnswer={noop} />);
    const row = screen.getByText("The agent wants to delete a file").closest("div");
    expect(row?.className).toContain("stg:text-sm");
    expect(row?.className).toContain("stg:px-3");
    expect(row?.className).toContain("stg:py-2");
  });

  it("puts the file's whole path on its own muted line under the sentence", () => {
    render(
      <ApprovalCard
        toolUse={waiting("write_file", { argsPreview: '{"path":"src/billing/rounding.ts","content":"x"}' })}
        onAnswer={noop}
      />,
    );
    const path = screen.getByText("src/billing/rounding.ts");
    expect(path.className).toContain("stg:font-mono");
    expect(path.className).toContain("stg:text-muted-foreground");
    expect(path.closest("button")).toBeNull();
  });
});

describe("ApprovalCard wait line", () => {
  it("says what waits for the answer, by the call's kind", () => {
    const cases: ReadonlyArray<{ name: string; mcpServerName?: string; argsPreview?: string; expected: string }> = [
      { name: "write_file", argsPreview: '{"path":"src/x.ts","content":"x"}', expected: "It waits for your answer. Nothing is written until you allow it." },
      { name: "edit_file", argsPreview: '{"path":"src/x.ts","new_string":"x"}', expected: "It waits for your answer. Nothing is written until you allow it." },
      { name: "delete_file", argsPreview: '{"path":"/tmp/x"}', expected: "It waits for your answer. Nothing is deleted until you allow it." },
      { name: "shell", argsPreview: '{"command":"npm test"}', expected: "It waits for your answer. Nothing runs until you allow it." },
      { name: "create_issue", mcpServerName: "github", expected: "It waits for your answer. Nothing happens until you allow it." },
      { name: "web_fetch", argsPreview: '{"url":"https://example.com"}', expected: "It waits for your answer. Nothing happens until you allow it." },
    ];
    for (const { name, mcpServerName, argsPreview, expected } of cases) {
      const init = {
        ...(mcpServerName === undefined ? {} : { mcpServerName }),
        ...(argsPreview === undefined ? {} : { argsPreview }),
      };
      const { container, unmount } = render(<ApprovalCard toolUse={waiting(name, init)} onAnswer={noop} />);
      expect(waitLine(container)).toBe(expected);
      unmount();
    }
  });

  it("trims a command description's own trailing period before the wait words", () => {
    const { container } = render(
      <ApprovalCardBody
        toolUse={waiting("shell", { argsPreview: '{"command":"npm test","description":"Run the unit tests. "}' })}
        onAnswer={noop}
      />,
    );
    expect(waitLine(container)).toBe("Run the unit tests. Nothing runs until you allow it.");
  });

  it("says no description for one made only of periods and spaces, trimmed in linear time", () => {
    const { container } = render(
      <ApprovalCardBody toolUse={waiting("shell", { argsPreview: JSON.stringify({ command: "npm test", description: ". .".repeat(2000) }) })} onAnswer={noop} />,
    );
    expect(waitLine(container)).toBe("It waits for your answer. Nothing runs until you allow it.");
  });

  it("says no description for a command the agent did not describe", () => {
    const { container } = render(
      <ApprovalCardBody toolUse={waiting("shell", { argsPreview: '{"command":"npm test"}' })} onAnswer={noop} />,
    );
    expect(waitLine(container)).toBe("It waits for your answer. Nothing runs until you allow it.");
  });
});

describe("ApprovalCard quiet decision buttons", () => {
  function renderGate() {
    return render(
      <ApprovalCard toolUse={waiting("write_file", { argsPreview: '{"path":"src/x.ts","content":"x"}' })} onAnswer={noop} />,
    );
  }

  it("Allow is the kit's primary button, never the loud success green", () => {
    renderGate();
    const allow = screen.getByRole("button", { name: "Allow" });
    expect(allow.className).toContain("stg:bg-primary");
    expect(allow.className).not.toContain("stg:bg-success");
    expect(allow.getAttribute("data-cursor-target")).toBe("approve-button");
  });

  it("Deny is outlined, never filled red", () => {
    renderGate();
    const deny = screen.getByRole("button", { name: "Deny" });
    expect(deny.className).toContain("stg:border-border");
    expect(deny.className).not.toContain("stg:bg-destructive");
  });

  it("demotes Allow all to the far right at the lowest weight, with no opacity modifiers", () => {
    renderGate();
    const allowAll = screen.getByRole("button", { name: "Allow all file edits" });
    expect(allowAll.className).toContain("stg:ml-auto");
    for (const name of ["Allow", "Deny", "Allow all file edits"]) {
      expect(screen.getByRole("button", { name }).className).not.toMatch(/\/\d+(?:\s|$)/);
    }
  });
});

describe("ApprovalCard why-gated provenance", () => {
  it("renders the why-gated line from the ask's rule word", () => {
    render(
      <ApprovalCard
        toolUse={waiting("delete_issue", { mcpServerName: "github", policySource: "annotation_destructive_tighten" })}
        onAnswer={noop}
      />,
    );
    expect(screen.getByText("required: marked destructive by the server")).toBeTruthy();
  });

  it("names the plugin whose hook asked", () => {
    render(<ApprovalCard toolUse={waiting("execute", { policySource: "hook", policyHook: "safety" })} onAnswer={noop} />);
    expect(screen.getByText("decided by the safety plugin's hook")).toBeTruthy();
  });

  it("renders no line when no rule is recorded, and suppresses the everyday default", () => {
    render(<ApprovalCard toolUse={waiting("delete_file")} onAnswer={noop} />);
    expect(screen.queryByText(/required by/)).toBeNull();
    cleanup();
    render(<ApprovalCard toolUse={waiting("delete_file", { policySource: "builtin_category" })} onAnswer={noop} />);
    expect(screen.queryByText(/required by/)).toBeNull();
  });
});

describe("ApprovalCard message redundancy", () => {
  it("suppresses a file tool's message that only restates the header", () => {
    render(
      <ApprovalCard
        toolUse={waiting("write_file", { message: "Write file: src/x.ts", argsPreview: '{"path":"src/x.ts","content":"x"}' })}
        onAnswer={noop}
      />,
    );
    expect(screen.queryByText("Write file: src/x.ts")).toBeNull();
  });

  it("keeps a non-file tool's informative message", () => {
    render(
      <ApprovalCard
        toolUse={waiting("create_issue", { mcpServerName: "github", message: "Create an issue in acme/repo titled 'Bug'" })}
        onAnswer={noop}
      />,
    );
    expect(screen.getByText("Create an issue in acme/repo titled 'Bug'")).toBeTruthy();
  });
});

describe("ApprovalCard answers", () => {
  it("labels Allow all by the call's class", () => {
    const cases: ReadonlyArray<{ name: string; mcpServerName?: string; expected: string }> = [
      { name: "delete_file", expected: "Allow all file deletions" },
      { name: "write_file", expected: "Allow all file edits" },
      { name: "edit_file", expected: "Allow all file edits" },
      { name: "shell", expected: "Allow all commands" },
      { name: "web_fetch", expected: "Allow all of this kind" },
      { name: "create_issue", mcpServerName: "github", expected: "Allow all github tools" },
    ];
    for (const { name, mcpServerName, expected } of cases) {
      const init = mcpServerName === undefined ? {} : { mcpServerName };
      const { getByLabelText, unmount } = render(<ApprovalCard toolUse={waiting(name, init)} onAnswer={noop} />);
      expect(getByLabelText(expected)).toBeTruthy();
      unmount();
    }
  });

  it("labels Allow all of a call a hook asked about by that hook and that tool", () => {
    const cases: ReadonlyArray<{ name: string; mcpServerName?: string; hook: string; expected: string }> = [
      { name: "execute", hook: "safety", expected: "Allow all shell commands the safety plugin asks about" },
      { name: "write_file", hook: "safety", expected: "Allow all file writes the safety plugin asks about" },
      { name: "edit_file", hook: "", expected: "Allow all file edits the agent's hooks ask about" },
      { name: "create_issue", mcpServerName: "github", hook: "safety", expected: "Allow all create_issue calls the safety plugin asks about" },
      { name: "delete_file", hook: "safety", expected: "Allow all file deletions the safety plugin asks about" },
      { name: "web_fetch", hook: "safety", expected: "Allow all web_fetch calls the safety plugin asks about" },
    ];
    for (const { name, mcpServerName, hook, expected } of cases) {
      const init = { policySource: "hook", policyHook: hook, ...(mcpServerName === undefined ? {} : { mcpServerName }) };
      const { getByLabelText, unmount } = render(<ApprovalCard toolUse={waiting(name, init)} onAnswer={noop} />);
      expect(getByLabelText(expected)).toBeTruthy();
      unmount();
    }
  });

  it("answers allow from Allow and grant from Allow all", () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard toolUse={waiting("delete_file")} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByLabelText("Allow"));
    fireEvent.click(screen.getByLabelText("Allow all file deletions"));
    expect(onAnswer.mock.calls).toEqual([["allow", undefined], ["grant", undefined]]);
  });

  it("denies with the reason typed, or with none", () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard toolUse={waiting("delete_file")} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    const reason = screen.getByLabelText("Reason for denying (optional)");
    fireEvent.change(reason, { target: { value: "  use the staging bucket  " } });
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onAnswer).toHaveBeenLastCalledWith("deny", "use the staging bucket");

    fireEvent.change(reason, { target: { value: "   " } });
    fireEvent.submit(reason.closest("form")!);
    expect(onAnswer).toHaveBeenLastCalledWith("deny", undefined);
  });

  it("cancels the deny row back to the three answers without answering", () => {
    const onAnswer = vi.fn();
    render(<ApprovalCard toolUse={waiting("delete_file")} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    fireEvent.change(screen.getByLabelText("Reason for denying (optional)"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Reason for denying (optional)")).toBeNull();
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect((screen.getByLabelText("Reason for denying (optional)") as HTMLInputElement).value).toBe("");
  });

  it("spins the clicked answer while it is in flight, and settles when it lands", () => {
    const { rerender, container } = render(
      <ApprovalCard toolUse={waiting("delete_file")} onAnswer={noop} isSubmitting={false} />,
    );
    fireEvent.click(screen.getByLabelText("Allow"));
    rerender(<ApprovalCard toolUse={waiting("delete_file")} onAnswer={noop} isSubmitting />);
    expect(screen.getByRole("button", { name: "Allow" }).hasAttribute("disabled")).toBe(true);
    expect(container.querySelector("svg.stg\\:animate-spin")).toBeTruthy();
    rerender(<ApprovalCard toolUse={waiting("delete_file")} onAnswer={noop} isSubmitting={false} />);
    expect(screen.getByRole("button", { name: "Allow" }).hasAttribute("disabled")).toBe(false);
  });
});

describe("ApprovalCard proposed change", () => {
  it("shows the proposed content (filename only in the header)", () => {
    render(
      <ApprovalCard
        toolUse={waiting("write_file", { argsPreview: '{"path":"src/fallback.ts","content":"x"}' })}
        onAnswer={noop}
      />,
    );
    expect(screen.getByText("Content")).toBeTruthy();
    expect(screen.getAllByText("src/fallback.ts")).toHaveLength(1);
  });

  it("shows no preview for a path-only edit or a path-only write, the header naming the file", () => {
    for (const name of ["edit_file", "write_file"]) {
      const { container, unmount } = render(
        <ApprovalCard toolUse={waiting(name, { argsPreview: '{"path":"notes.md"}' })} onAnswer={noop} />,
      );
      expect(screen.getAllByText("notes.md")).toHaveLength(1);
      expect(screen.queryByText("Content")).toBeNull();
      expect(screen.queryByText(/preview/i)).toBeNull();
      expect(waitLine(container)).toBe("It waits for your answer. Nothing is written until you allow it.");
      unmount();
    }
  });

  it("reads the whole content from the tool's input when the preview left it out", () => {
    const big = Array.from({ length: 30 }, (_, i) => `gate line ${i + 1}`).join("\n") + "\n";
    render(
      <ApprovalCardBody
        toolUse={waiting("write_file", {
          argsPreview: '{"file_path":"/tmp/big.txt","content":"[381 chars]"}',
          input: { file_path: "/tmp/big.txt", content: big },
        })}
        onAnswer={noop}
      />,
    );
    expect(screen.getByText("Content")).toBeTruthy();
    expect(screen.getByText(/gate line 1\b/)).toBeTruthy();
    expect(screen.queryByText(/\[381 chars\]/)).toBeNull();
  });

  it("overlays the content only — a field the preview redacted stays redacted", () => {
    render(
      <ApprovalCardBody
        toolUse={waiting("publish", {
          mcpServerName: "notes",
          argsPreview: '{"title":"hello","token":"[REDACTED]"}',
          input: { title: "hello", token: "s3cr3t-raw" },
        })}
        onAnswer={noop}
      />,
    );
    expect(screen.getByText("[REDACTED]")).toBeTruthy();
    expect(screen.queryByText(/s3cr3t-raw/)).toBeNull();
  });

  it("overlays nothing onto a preview the card cannot parse", () => {
    const { container } = render(
      <ApprovalCardBody
        toolUse={waiting("write_file", {
          argsPreview: '{"file_path":"/tmp/big.txt","content":"gate li…',
          input: { file_path: "/tmp/big.txt", content: "the raw input content" },
        })}
        onAnswer={noop}
      />,
    );
    expect(screen.queryByText("Content")).toBeNull();
    expect(screen.queryByText(/the raw input content/)).toBeNull();
    expect(screen.queryByText(/preview/i)).toBeNull();
    expect(waitLine(container)).toBe("It waits for your answer. Nothing is written until you allow it.");
  });
});

describe("ApprovalCard in-card answer error", () => {
  it("surfaces a failed answer in-card, beside the actions", () => {
    const { container } = render(
      <ApprovalCard toolUse={waiting("delete_file")} onAnswer={noop} error={new Error("gate already resolved")} />,
    );
    const alert = container.querySelector('[data-cursor-target="approval-error"]');
    expect(alert?.textContent).toContain("gate already resolved");
    expect(alert?.getAttribute("role")).toBe("alert");
  });

  it("shows no in-card error when healthy", () => {
    const { container } = render(<ApprovalCard toolUse={waiting("delete_file")} onAnswer={noop} />);
    expect(container.querySelector('[data-cursor-target="approval-error"]')).toBeNull();
  });
});
