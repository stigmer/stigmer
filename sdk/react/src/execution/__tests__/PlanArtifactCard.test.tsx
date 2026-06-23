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
});

/** Modal content fetches artifact text — keep it pending so nothing rejects. */
function createStigmerMock(): {
  stigmer: Stigmer;
  getArtifactContent: ReturnType<typeof vi.fn>;
  getArtifactDownloadUrl: ReturnType<typeof vi.fn>;
} {
  const getArtifactContent = vi.fn().mockReturnValue(new Promise(() => {}));
  const getArtifactDownloadUrl = vi
    .fn()
    .mockResolvedValue({ downloadUrl: "https://example.test/plan.md" });
  return {
    stigmer: {
      agentExecution: { getArtifactContent, getArtifactDownloadUrl },
    } as unknown as Stigmer,
    getArtifactContent,
    getArtifactDownloadUrl,
  };
}

function withStigmer(children: ReactNode, stigmer: Stigmer) {
  return (
    <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
  );
}

/** PlanArtifactCard now resolves downloads on demand, so it needs a provider. */
function renderCard(ui: ReactNode) {
  return render(withStigmer(ui, createStigmerMock().stigmer));
}

afterEach(cleanup);

describe("PlanArtifactCard — action surface", () => {
  it("is an accessible region labelled as the plan's actions, with name + size", () => {
    renderCard(
      <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
    );

    const region = screen.getByRole("region", { name: "Plan actions" });
    expect(region.textContent).toContain("Plan");
    expect(region.textContent).toContain("KB");
  });

  it("does NOT render the plan content (the message above is the document)", () => {
    const { stigmer, getArtifactContent } = createStigmerMock();
    render(
      withStigmer(
        <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
        stigmer,
      ),
    );
    // The card is a pure action surface — it must not fetch the plan body until
    // the user explicitly opens the full preview.
    expect(getArtifactContent).not.toHaveBeenCalled();
  });

  it("offers exactly one primary 'Build from plan' action that calls onImplement", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        org="acme"
        onImplement={onImplement}
      />,
    );

    fireEvent.click(screen.getByText("Build from plan"));
    expect(onImplement).toHaveBeenCalledTimes(1);
  });

  it("hides 'Build from plan' when onImplement is not provided", () => {
    renderCard(
      <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
    );
    expect(screen.queryByText("Build from plan")).toBeNull();
  });

  it("disables 'Build from plan' when disabled", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        org="acme"
        onImplement={onImplement}
        disabled
      />,
    );

    const button = screen.getByText("Build from plan").closest("button")!;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onImplement).not.toHaveBeenCalled();
  });

  it("downloads the artifact on demand via a freshly minted URL", async () => {
    const { stigmer, getArtifactDownloadUrl } = createStigmerMock();
    render(
      withStigmer(
        <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
        stigmer,
      ),
    );
    fireEvent.click(screen.getByText("Download"));
    // The URL is resolved at click time from the stable storage key — never a
    // baked, expirable URL.
    expect(getArtifactDownloadUrl).toHaveBeenCalledTimes(1);
    const req = getArtifactDownloadUrl.mock.calls[0][0];
    expect(req.executionId).toBe("aex_1");
    expect(req.storageKey).toBe("artifacts/aex_1/plan.md");
  });
});

describe("PlanArtifactCard — Cmd/Ctrl+Enter accelerator (card-scoped)", () => {
  it("fires onImplement on Cmd+Enter from within the card", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        org="acme"
        onImplement={onImplement}
      />,
    );

    const region = screen.getByRole("region", { name: "Plan actions" });
    fireEvent.keyDown(region, { key: "Enter", metaKey: true });
    expect(onImplement).toHaveBeenCalledTimes(1);
  });

  it("fires onImplement on Ctrl+Enter", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        org="acme"
        onImplement={onImplement}
      />,
    );

    const region = screen.getByRole("region", { name: "Plan actions" });
    fireEvent.keyDown(region, { key: "Enter", ctrlKey: true });
    expect(onImplement).toHaveBeenCalledTimes(1);
  });

  it("ignores a plain Enter (no modifier) so it never hijacks typing", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        org="acme"
        onImplement={onImplement}
      />,
    );

    const region = screen.getByRole("region", { name: "Plan actions" });
    fireEvent.keyDown(region, { key: "Enter" });
    expect(onImplement).not.toHaveBeenCalled();
  });

  it("does not fire when disabled", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        org="acme"
        onImplement={onImplement}
        disabled
      />,
    );

    const region = screen.getByRole("region", { name: "Plan actions" });
    fireEvent.keyDown(region, { key: "Enter", metaKey: true });
    expect(onImplement).not.toHaveBeenCalled();
  });
});

describe("PlanArtifactCard — Open full (org-gated preview)", () => {
  it("opens the shared preview modal when 'Open full' is clicked", () => {
    const { stigmer } = createStigmerMock();
    render(
      withStigmer(
        <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
        stigmer,
      ),
    );

    // No dialog before the user opens it.
    expect(document.querySelector("dialog")).toBeNull();

    fireEvent.click(screen.getByText("Open full"));

    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute("aria-label")).toBe("Preview plan.md");
  });

  it("hides 'Open full' when org is absent (modal needs org), keeping Build + Download", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        onImplement={onImplement}
      />,
    );
    expect(screen.queryByText("Open full")).toBeNull();
    expect(screen.queryByText("Build from plan")).not.toBeNull();
    expect(screen.queryByText("Download")).not.toBeNull();
  });
});
