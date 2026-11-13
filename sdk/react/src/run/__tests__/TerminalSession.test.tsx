import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TerminalSession } from "../TerminalSession";
import { SandboxContext } from "../SandboxContext";

afterEach(cleanup);

describe("TerminalSession", () => {
  it("keeps a running command's newest lines in view, folding the oldest into a count", () => {
    const stdout = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const { container } = render(<TerminalSession command="make" stdout={stdout} live />);
    const live = container.querySelector('[data-cursor-target="terminal-live-output"]');
    expect(live?.textContent).toContain("… +4 lines");
    expect(live?.textContent).toContain("line 14");
    expect(live?.textContent).not.toContain("line 4\n");
    expect(screen.queryByText(/Show all \d+ lines/), "no reveal while the output still grows").toBeNull();
  });

  it("shows a short running output whole, with no count", () => {
    const { container } = render(<TerminalSession command="make" stdout={"one\n"} live />);
    expect(container.querySelector('[data-cursor-target="terminal-live-output"]')?.textContent).toBe("one");
  });

  it("renders one session: the $ command prompt line then its output", () => {
    const { container } = render(
      <TerminalSession command="echo hello" stdout="hello world" exitCode={0} />,
    );
    const session = container.querySelector(
      '[data-cursor-target="terminal-session"]',
    );
    expect(session).toBeTruthy();
    expect(session!.textContent).toContain("$ echo hello");
    expect(session!.textContent).toContain("hello world");
  });

  it("draws no frame of its own inside a card, and its own when framed", () => {
    const frame = ["stg:rounded-md", "stg:border", "stg:bg-muted-subtle"];
    const inCard = render(<TerminalSession command="ls" stdout="a.ts" />);
    const bare = inCard.container.querySelector('[data-cursor-target="terminal-session"]')!.className.split(" ");
    for (const cls of frame) expect(bare, `no ${cls} inside a card`).not.toContain(cls);
    cleanup();

    const alone = render(<TerminalSession command="ls" stdout="a.ts" framed />);
    const own = alone.container.querySelector('[data-cursor-target="terminal-session"]')!.className.split(" ");
    for (const cls of frame) expect(own).toContain(cls);
  });

  it("shows no exit badge on success", () => {
    const { container } = render(
      <TerminalSession command="true" stdout="" exitCode={0} />,
    );
    expect(container.textContent).not.toContain("exit 0");
  });

  it("shows an exit badge and an sr-only status on failure", () => {
    render(<TerminalSession command="false" stdout="" exitCode={2} />);
    // The visible badge.
    expect(screen.getByText("exit 2")).toBeTruthy();
    // The accessible status (screen-reader text).
    expect(screen.getByText("Command exited with code 2")).toBeTruthy();
  });

  it("renders stderr in the destructive color", () => {
    render(<TerminalSession command="oops" stderr="bad things" exitCode={1} />);
    const stderr = screen.getByText("bad things");
    expect(stderr.className).toContain("stg:text-destructive");
  });

  it("preserves a multi-line (heredoc) command in full", () => {
    const command = "cat > f << EOF\nline one\nline two\nEOF";
    const { container } = render(<TerminalSession command={command} />);
    expect(container.textContent).toContain("line one");
    expect(container.textContent).toContain("line two");
    // A long command must NOT grow its own truncation toggle (only output does).
    expect(screen.queryByText(/Show all \d+ lines/)).toBeNull();
  });

  it("supports a command-only render (the pre-execution gate)", () => {
    const { container } = render(<TerminalSession command="npm test" />);
    expect(container.textContent).toContain("$ npm test");
    // No output, no failure badge.
    expect(container.textContent).not.toMatch(/exit \d+/);
  });

  it("normalizes absolute sandbox paths to workspace-relative for display", () => {
    const { container } = render(
      <SandboxContext.Provider value={{ sandboxWorkspaceRoot: "/home/daytona/workspace" }}>
        <TerminalSession
          command="ls /home/daytona/workspace/src"
          stdout="/home/daytona/workspace/src/a.ts"
        />
      </SandboxContext.Provider>,
    );
    // The absolute root is stripped; the relative remainder is shown.
    expect(container.textContent).not.toContain("/home/daytona/workspace/");
    expect(container.textContent).toContain("$ ls src");
    expect(container.textContent).toContain("src/a.ts");
  });
});
