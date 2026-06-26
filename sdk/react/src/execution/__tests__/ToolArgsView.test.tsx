import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ToolArgsView } from "../ToolArgsView";

afterEach(cleanup);

// The file-tool args view captions write/edit content with a path. When an
// ancestor already names the file (the approval gate header), showFileName=false
// drops that redundant path while keeping the decision-relevant content.
describe("ToolArgsView file tools", () => {
  it("shows the path and content by default for a write", () => {
    render(
      <ToolArgsView
        toolName="write_file"
        args={{ path: "src/a.ts", contents: "hi" }}
      />,
    );
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("Content")).toBeTruthy();
  });

  it("suppresses the redundant path but keeps the content when showFileName is false", () => {
    render(
      <ToolArgsView
        toolName="write_file"
        args={{ path: "src/a.ts", contents: "hi" }}
        showFileName={false}
      />,
    );
    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.getByText("Content")).toBeTruthy();
  });
});
