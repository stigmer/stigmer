import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerContext } from "../../context";
import { PlanArtifactCard } from "../PlanArtifactCard";

const planArtifact = create(ExecutionArtifactSchema, {
  name: "plan.md",
  kind: ExecutionArtifactKind.FILE,
  sizeBytes: 4500n,
  storageKey: "artifacts/aex_1/plan.md",
  downloadUrl: "https://example.test/plan.md",
});

/** Modal content fetches artifact text — keep it pending so nothing rejects. */
function createStigmerMock(): Stigmer {
  return {
    agentExecution: {
      getArtifactContent: vi.fn().mockReturnValue(new Promise(() => {})),
    },
  } as unknown as Stigmer;
}

function withStigmer(children: ReactNode) {
  return (
    <StigmerContext.Provider value={createStigmerMock()}>
      {children}
    </StigmerContext.Provider>
  );
}

afterEach(cleanup);

describe("PlanArtifactCard", () => {
  it("renders the review header with the artifact name and size", () => {
    render(
      <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
    );

    const region = screen.getByRole("region", { name: "Plan ready to review" });
    expect(region.textContent).toContain("Plan ready to review");
    expect(region.textContent).toContain("plan.md");
  });

  it("calls onImplement when Implement is clicked", () => {
    const onImplement = vi.fn();
    render(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        org="acme"
        onImplement={onImplement}
      />,
    );

    fireEvent.click(screen.getByText("Implement"));
    expect(onImplement).toHaveBeenCalledTimes(1);
  });

  it("hides Implement when onImplement is not provided", () => {
    render(
      <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
    );
    expect(screen.queryByText("Implement")).toBeNull();
  });

  it("disables Implement when disabled", () => {
    const onImplement = vi.fn();
    render(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        org="acme"
        onImplement={onImplement}
        disabled
      />,
    );

    const button = screen.getByText("Implement").closest("button")!;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onImplement).not.toHaveBeenCalled();
  });

  it("exposes a Download link to the artifact", () => {
    render(
      <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
    );
    const link = screen.getByText("Download").closest("a")!;
    expect(link.getAttribute("href")).toBe("https://example.test/plan.md");
  });

  it("opens the shared preview modal when Review plan is clicked", () => {
    render(
      withStigmer(
        <PlanArtifactCard
          executionId="aex_1"
          artifact={planArtifact}
          org="acme"
        />,
      ),
    );

    // No dialog before the user reviews.
    expect(document.querySelector("dialog")).toBeNull();

    fireEvent.click(screen.getByText("Review plan"));

    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute("aria-label")).toBe("Preview plan.md");
  });

  it("hides Review plan when org is absent (modal needs org)", () => {
    render(<PlanArtifactCard executionId="aex_1" artifact={planArtifact} />);
    expect(screen.queryByText("Review plan")).toBeNull();
  });
});
