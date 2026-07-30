import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { McpServerSpec } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { DeploymentModeContext } from "../../deployment-mode";
import { StdioSandboxNotice, isStdioInCloud } from "../StdioSandboxNotice";

type McpServerType = McpServerSpec["serverType"];

const STDIO = { case: "stdio" } as McpServerType;
const HTTP = { case: "http" } as McpServerType;
const UNSET = { case: undefined } as McpServerType;

afterEach(cleanup);

describe("isStdioInCloud", () => {
  it("is true only for stdio transport in cloud mode", () => {
    expect(isStdioInCloud("cloud", STDIO)).toBe(true);
  });

  it("is false for stdio transport in local mode", () => {
    expect(isStdioInCloud("local", STDIO)).toBe(false);
  });

  it("is false for http transport in cloud mode", () => {
    expect(isStdioInCloud("cloud", HTTP)).toBe(false);
  });

  it("is false when the transport oneof is unset", () => {
    expect(isStdioInCloud("cloud", UNSET)).toBe(false);
  });

  it("is false when serverType is undefined", () => {
    expect(isStdioInCloud("cloud", undefined)).toBe(false);
  });
});

function withMode(mode: "cloud" | "local", children: ReactNode) {
  return (
    <DeploymentModeContext.Provider value={mode}>
      {children}
    </DeploymentModeContext.Provider>
  );
}

describe("StdioSandboxNotice", () => {
  it("renders the local-runner-only policy for stdio in cloud", () => {
    render(withMode("cloud", <StdioSandboxNotice serverType={STDIO} />));
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText(/only on local runners/i)).toBeTruthy();
    expect(screen.getByText(/remote \(HTTP\) server/i)).toBeTruthy();
  });

  it("does not suggest the CLI (avoids inaccurate guidance)", () => {
    render(withMode("cloud", <StdioSandboxNotice serverType={STDIO} />));
    expect(screen.queryByText(/stigmer connect/i)).toBeNull();
  });

  it("renders nothing for http servers in cloud", () => {
    const { container } = render(
      withMode("cloud", <StdioSandboxNotice serverType={HTTP} />),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for stdio servers in local mode", () => {
    const { container } = render(
      withMode("local", <StdioSandboxNotice serverType={STDIO} />),
    );
    expect(container.firstChild).toBeNull();
  });
});
