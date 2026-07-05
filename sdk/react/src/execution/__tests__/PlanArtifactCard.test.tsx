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

describe("PlanArtifactCard — compact document card", () => {
  it("is an accessible region with the plan's title, filename, and size", () => {
    renderCard(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        title="Refactor the auth flow"
        org="acme"
      />,
    );

    const region = screen.getByRole("region", { name: "Plan" });
    expect(region.textContent).toContain("Refactor the auth flow");
    expect(region.textContent).toContain("plan.md");
    expect(region.textContent).toContain("KB");
  });

  it("falls back to 'Plan' when the plan has no title", () => {
    renderCard(
      <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
    );
    const region = screen.getByRole("region", { name: "Plan" });
    expect(region.textContent).toContain("Plan");
  });

  it("does NOT render the plan content (the document lives in the plan tab)", () => {
    const { stigmer, getArtifactContent } = createStigmerMock();
    render(
      withStigmer(
        <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
        stigmer,
      ),
    );
    // The card is the plan's compact stand-in — it must not fetch the plan
    // body; that belongs to the plan tab (or the explicit preview modal).
    expect(getArtifactContent).not.toHaveBeenCalled();
  });

  it("offers exactly one primary 'Build' action that calls onImplement", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        org="acme"
        onImplement={onImplement}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(onImplement).toHaveBeenCalledTimes(1);
  });

  it("hides 'Build' when onImplement is not provided", () => {
    renderCard(
      <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
    );
    expect(screen.queryByRole("button", { name: "Build" })).toBeNull();
  });

  it("shows the pending label while the approved plan uploads (buildPending)", () => {
    renderCard(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        org="acme"
        onImplement={vi.fn()}
        disabled
        buildPending
      />,
    );

    // The primary reads as in-progress and stays disabled — no double-submits
    // while the upload precedes the implement turn.
    expect(screen.queryByRole("button", { name: "Build" })).toBeNull();
    const button = screen.getByText("Starting build…").closest("button")!;
    expect(button.disabled).toBe(true);
  });

  it("disables 'Build' when disabled", () => {
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

    const button = screen.getByRole("button", { name: "Build" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onImplement).not.toHaveBeenCalled();
  });

  it("copies the plan text to the clipboard on demand", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const getArtifactContent = vi
      .fn()
      .mockResolvedValue({ content: new TextEncoder().encode("# Plan\n\nsteps") });
    const getArtifactDownloadUrl = vi.fn();
    const stigmer = {
      agentExecution: { getArtifactContent, getArtifactDownloadUrl },
    } as unknown as Stigmer;

    render(
      withStigmer(
        <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
        stigmer,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy plan" }));

    // Content is fetched at click time from the stable storage key, then
    // written to the clipboard — the card never pre-fetches on mount.
    expect(getArtifactContent).toHaveBeenCalledTimes(1);
    const req = getArtifactContent.mock.calls[0][0];
    expect(req.executionId).toBe("aex_1");
    expect(req.storageKey).toBe("artifacts/aex_1/plan.md");
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledWith("# Plan\n\nsteps");

    vi.unstubAllGlobals();
  });

  it("downloads the artifact on demand via a freshly minted URL", async () => {
    const { stigmer, getArtifactDownloadUrl } = createStigmerMock();
    render(
      withStigmer(
        <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
        stigmer,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Download plan.md" }));
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

    const region = screen.getByRole("region", { name: "Plan" });
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

    const region = screen.getByRole("region", { name: "Plan" });
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

    const region = screen.getByRole("region", { name: "Plan" });
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

    const region = screen.getByRole("region", { name: "Plan" });
    fireEvent.keyDown(region, { key: "Enter", metaKey: true });
    expect(onImplement).not.toHaveBeenCalled();
  });
});

describe("PlanArtifactCard — Open plan modal fallback (org-gated preview)", () => {
  it("opens the shared preview modal when the open icon is clicked (no onOpenPlan)", () => {
    const { stigmer } = createStigmerMock();
    render(
      withStigmer(
        <PlanArtifactCard executionId="aex_1" artifact={planArtifact} org="acme" />,
        stigmer,
      ),
    );

    // No dialog before the user opens it.
    expect(document.querySelector("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open plan" }));

    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute("aria-label")).toBe("Preview plan.md");
  });

  it("hides the open action when org is absent (modal needs org), keeping Build + Download", () => {
    const onImplement = vi.fn();
    renderCard(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        onImplement={onImplement}
      />,
    );
    expect(screen.queryByRole("button", { name: "Open plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Build" })).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Download plan.md" }),
    ).not.toBeNull();
  });
});

describe("PlanArtifactCard — Open plan (panel-first review)", () => {
  it("routes the open action to the panel when onOpenPlan is provided (no modal)", () => {
    const onOpenPlan = vi.fn();
    renderCard(
      <PlanArtifactCard
        executionId="aex_1"
        artifact={planArtifact}
        org="acme"
        onOpenPlan={onOpenPlan}
      />,
    );

    // One review affordance, not two: the facet supersedes the modal.
    expect(screen.getAllByRole("button", { name: "Open plan" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Open plan" }));
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
    expect(document.querySelector("dialog")).toBeNull();
  });
});
