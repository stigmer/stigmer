// Tests for the shared Edit-YAML dialog's apply-error affordance: the
// server's refusal renders verbatim with Try-again/Dismiss — shared
// by every kind (Agent, Schedule, Skill), so any apply-time guard
// gets the same acknowledge-and-retry treatment. And its summary of what
// applying will do: an edited slug on a document that keeps its id reads
// as a rename, a kind that cannot rename says it keeps its slug, and a
// kind that cannot change its visibility says it keeps that, before Apply
// is pressed. Cancel closes the dialog without applying.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
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
    validation: { status: "valid" as const, document: { handler: { displayName: "Agent" } } as never },
    target: { action: "update" as const, slug: "clinic", slugKept: false, visibilityKept: false },
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

function renderDialog(onOpenChange: (open: boolean) => void = vi.fn()) {
  return render(
    <EditResourceYamlDialog
      open
      onOpenChange={onOpenChange}
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
    editState = { target: { action: "rename", from: "test-bot", slug: "support-bot", visibilityKept: false } };
    renderDialog();
    expect(screen.getByText("Applying will rename test-bot to support-bot.")).toBeTruthy();
  });

  it("says a kind with no rename keeps its slug", () => {
    editState = {
      validation: {
        status: "valid",
        document: { handler: { displayName: "Session" } } as never,
      },
      target: { action: "update", slug: "test-session", slugKept: true, visibilityKept: false },
    };
    renderDialog();
    expect(
      screen.getByText("Applying will update test-session. Session slugs do not change, so it keeps this slug."),
    ).toBeTruthy();
  });

  it("says a kind that cannot change its visibility keeps it", () => {
    editState = {
      validation: { status: "valid", document: { handler: { displayName: "Channel" } } as never },
      target: { action: "update", slug: "support", slugKept: false, visibilityKept: true },
    };
    renderDialog();
    expect(
      screen.getByText("Applying will update support. Channel visibility does not change, so it keeps its visibility."),
    ).toBeTruthy();
  });

  it("says a renamed resource keeps a visibility its kind cannot change", () => {
    editState = {
      validation: { status: "valid", document: { handler: { displayName: "Channel" } } as never },
      target: { action: "rename", from: "support", slug: "helpdesk", visibilityKept: true },
    };
    renderDialog();
    expect(
      screen.getByText(
        "Applying will rename support to helpdesk. Channel visibility does not change, so it keeps its visibility.",
      ),
    ).toBeTruthy();
  });

  it("names both when a kind keeps the slug and the visibility", () => {
    editState = {
      validation: { status: "valid", document: { handler: { displayName: "Session" } } as never },
      target: { action: "update", slug: "test-session", slugKept: true, visibilityKept: true },
    };
    renderDialog();
    expect(
      screen.getByText(
        "Applying will update test-session. Session slugs do not change, so it keeps this slug. " +
          "Session visibility does not change, so it keeps its visibility.",
      ),
    ).toBeTruthy();
  });

  it("says nothing about applying while the document is invalid", () => {
    editState = {
      validation: { status: "invalid", message: "unknown field spec.instructionz" },
      target: { action: "update", slug: "clinic", slugKept: false, visibilityKept: false },
    };
    renderDialog();
    expect(screen.getByText("unknown field spec.instructionz")).toBeTruthy();
    expect(screen.queryByText(/Applying will/)).toBeNull();
  });

  it("reads a new resource as a create", () => {
    editState = { target: { action: "create", slug: "second-bot" } };
    renderDialog();
    expect(screen.getByText("Applying will create second-bot.")).toBeTruthy();
  });
});

describe("EditResourceYamlDialog — Cancel", () => {
  it("closes the dialog without applying", () => {
    editState = {};
    applyMock.mockClear();
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(applyMock).not.toHaveBeenCalled();
  });
});
