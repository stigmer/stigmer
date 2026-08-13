import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TerminalSession, TerminalTail } from "../TerminalSession";
import { SandboxContext } from "../SandboxContext";

afterEach(cleanup);

describe("TerminalSession", () => {
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

describe("TerminalTail", () => {
  it("keeps the command at full contrast and dims the output tail", () => {
    const { container } = render(
      <TerminalTail command="echo hi" stdout="hi" exitCode={0} />,
    );
    const tail = container.querySelector('[data-cursor-target="terminal-tail"]')!;
    expect(tail.textContent).toContain("$ echo hi");
    // Intent keeps reading contrast; the tail is one step below it.
    expect(screen.getByText(/echo hi/).className).toContain("stg:text-foreground");
    expect(screen.getByText("hi").className).toContain("stg:text-muted-foreground");
  });

  it("shows only the last lines, with an honest hidden-line count", () => {
    const stdout = ["one", "two", "three", "four", "five"].join("\n");
    const { container } = render(<TerminalTail command="seq 5" stdout={stdout} />);
    const tail = container.querySelector('[data-cursor-target="terminal-tail"]')!;
    expect(tail.textContent).toContain("three");
    expect(tail.textContent).toContain("five");
    expect(tail.textContent).not.toContain("one");
    expect(tail.textContent).toContain("… +2 lines");
  });

  it("omits the hidden-count marker when everything fits", () => {
    const { container } = render(
      <TerminalTail command="pwd" stdout="/work\nok" />,
    );
    expect(container.textContent).not.toContain("+");
    expect(container.textContent).toContain("/work");
    expect(container.textContent).toContain("ok");
  });

  it("appends stderr after stdout in the combined tail", () => {
    const { container } = render(
      <TerminalTail command="build" stdout="step 1\nstep 2" stderr="warning: slow" />,
    );
    const tail = container.querySelector('[data-cursor-target="terminal-tail"]')!;
    // Last three of the combined stream: step 1, step 2, warning.
    expect(tail.textContent).toContain("step 2");
    expect(tail.textContent).toContain("warning: slow");
  });

  it("keeps the exit badge when a failed session is shown collapsed", () => {
    render(<TerminalTail command="false" stdout="boom" exitCode={2} />);
    expect(screen.getByText("exit 2")).toBeTruthy();
    expect(screen.getByText("Command exited with code 2")).toBeTruthy();
  });

  it("ignores a trailing newline when slicing the tail", () => {
    const { container } = render(
      <TerminalTail command="x" stdout={"a\nb\nc\nd\n"} />,
    );
    const tail = container.querySelector('[data-cursor-target="terminal-tail"]')!;
    expect(tail.textContent).toContain("d");
    expect(tail.textContent).toContain("… +1 line");
  });

  it("normalizes absolute sandbox paths like the full session", () => {
    const { container } = render(
      <SandboxContext.Provider value={{ sandboxWorkspaceRoot: "/home/daytona/workspace" }}>
        <TerminalTail
          command="ls /home/daytona/workspace/src"
          stdout="/home/daytona/workspace/src/a.ts"
        />
      </SandboxContext.Provider>,
    );
    expect(container.textContent).not.toContain("/home/daytona/workspace/");
    expect(container.textContent).toContain("$ ls src");
  });
});
