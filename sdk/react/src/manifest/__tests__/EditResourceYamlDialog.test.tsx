// Tests for the shared Edit-YAML dialog's apply-error affordance: the
// server's refusal renders verbatim with Try-again/Dismiss — shared
// by every kind (Agent, Schedule, Skill), so any apply-time guard
// gets the same acknowledge-and-retry treatment. And its summary of what
// applying will do: an edited slug on a document that keeps its id reads
// as a rename, and a kind that cannot rename says it keeps its slug.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { EditResourceYamlDialog } from "../EditResourceYamlDialog";
import type { useEditResourceYaml } from "../useEditResourceYaml";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type EditState = ReturnType<typeof useEditResourceYaml>;

const applyMock = vi.fn();
const clearErrorMock = vi.fn();

let editState: Partial<EditState>;

vi.mock("../useEditResourceYaml", () => ({
  useEditResourceYaml: () => ({
    yaml: "kind: Agent",
    setYaml: vi.fn(),
    validation: { status: "valid" as const },
    target: { action: "update" as const, slug: "clinic" },
    isDirty: true,
    isApplying: false,
    error: null,
    clearError: clearErrorMock,
    apply: applyMock,
    reset: vi.fn(),
    hasRedactedSecrets: false,
    ...editState,
  }),
}));

// CodeMirror stays out of the test environment.
vi.mock("../YamlEditor", () => ({
  YamlEditor: () => <div data-testid="yaml-editor" />,
}));

const RESOURCE = create(AgentSchema, {
  metadata: { id: "agt_1", slug: "clinic", org: "acme", name: "Clinic" },
});

function renderDialog() {
  return render(
    <EditResourceYamlDialog
      open
      onOpenChange={vi.fn()}
      resource={RESOURCE}
      onApplied={vi.fn()}
    />,
  );
}

describe("EditResourceYamlDialog — apply-error affordance", () => {
  it("renders the server's refusal verbatim with Try again and Dismiss", () => {
    editState = {
      error: new Error(
        'spec change refused by an apply-time guard; re-apply with the change acknowledged',
      ),
    };
    renderDialog();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "spec change refused by an apply-time guard",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss error" })).toBeTruthy();
  });

  it("Try again re-invokes apply without reopening the dialog", () => {
    editState = { error: new Error("guard refused") };
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(applyMock).toHaveBeenCalled();
  });

  it("Dismiss clears the error state", () => {
    editState = { error: new Error("guard refused") };
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(clearErrorMock).toHaveBeenCalled();
  });

  it("Try again is disabled while a retry is already in flight", () => {
    editState = { error: new Error("guard refused"), isApplying: true };
    renderDialog();

    const retry = screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
  });

  it("renders no error affordances when healthy", () => {
    editState = {};
    renderDialog();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("EditResourceYamlDialog — what applying will do", () => {
  it("reads an edited slug as a rename from the stored slug", () => {
    editState = { target: { action: "rename", from: "test-bot", slug: "support-bot" } };
    renderDialog();
    expect(screen.getByText("Applying will rename test-bot to support-bot.")).toBeTruthy();
  });

  it("says a kind with no rename keeps its slug", () => {
    editState = {
      validation: {
        status: "valid",
        document: { handler: { displayName: "Agent Share" } } as never,
      },
      target: { action: "update", slug: "test-share", slugKept: true },
    };
    renderDialog();
    expect(
      screen.getByText("Applying will update test-share. Agent Share slugs do not change, so it keeps this slug."),
    ).toBeTruthy();
  });

  it("reads a new resource as a create", () => {
    editState = { target: { action: "create", slug: "second-bot" } };
    renderDialog();
    expect(screen.getByText("Applying will create second-bot.")).toBeTruthy();
  });
});
