// Tests for ApplyManifestDialog's onApplied contract — the refresh
// signal every Library list page wires to appear-without-reload. It must
// fire on full success AND when the operator dismisses the dialog after a
// partial apply (some documents applied, a later one failed), and must
// never fire when nothing applied. Historically onApplied's predecessor
// had zero coverage and stayed unwired at every call site; this locks the
// contract the list pages now depend on.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ApplyManifestDialog } from "../ApplyManifestDialog";
import type {
  ManifestPreviewEntry,
  UseApplyManifestReturn,
} from "../useApplyManifest";

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

// A preview entry in a chosen terminal status; the document shape is only
// what the dialog's preview row and apply flow read.
function entry(
  slug: string,
  status: ManifestPreviewEntry["status"],
): ManifestPreviewEntry {
  return {
    document: {
      handler: { yamlKind: "datastore", displayName: "Datastore" },
      name: slug,
      slug,
      org: "acme",
    },
    action: "create",
    status,
  } as ManifestPreviewEntry;
}

// The mock's mutable knobs: the entries the hook exposes and the terminal
// entries applyAll resolves to. Set per test before rendering.
let mockEntries: readonly ManifestPreviewEntry[] | null;
let applyAllResult: readonly ManifestPreviewEntry[];
const applyAllMock = vi.fn(async () => applyAllResult);

vi.mock("../useApplyManifest", () => ({
  useApplyManifest: (): UseApplyManifestReturn =>
    ({
      content: "kind: Datastore",
      setContent: vi.fn(),
      readFile: vi.fn(),
      entries: mockEntries,
      validationError: null,
      isValidating: false,
      hasRedactedSecrets: false,
      applyAll: applyAllMock,
      isApplying: false,
      reset: vi.fn(),
    }) as UseApplyManifestReturn,
}));

// CodeMirror stays out of the test environment.
vi.mock("../YamlEditor", () => ({
  YamlEditor: () => <div data-testid="yaml-editor" />,
}));

describe("ApplyManifestDialog — onApplied", () => {
  it("fires with the applied entries on full success and closes", async () => {
    mockEntries = [entry("a", "pending"), entry("b", "pending")];
    applyAllResult = [entry("a", "applied"), entry("b", "applied")];
    const onApplied = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ApplyManifestDialog
        open
        onOpenChange={onOpenChange}
        org="acme"
        onApplied={onApplied}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(
      onApplied.mock.calls[0][0].map((e: ManifestPreviewEntry) => e.document.slug),
    ).toEqual(["a", "b"]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("fires with only the applied subset when a partial apply is dismissed", async () => {
    // Applied one, failed the next — the dialog stays open on failure.
    mockEntries = [entry("a", "applied"), entry("b", "failed")];
    applyAllResult = [entry("a", "applied"), entry("b", "failed")];
    const onApplied = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ApplyManifestDialog
        open
        onOpenChange={onOpenChange}
        org="acme"
        onApplied={onApplied}
      />,
    );

    // Apply first: full success did not happen, so onApplied has not fired.
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => expect(applyAllMock).toHaveBeenCalled());
    expect(onApplied).not.toHaveBeenCalled();

    // Dismiss with an applied entry present → refresh the list.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(
      onApplied.mock.calls[0][0].map((e: ManifestPreviewEntry) => e.document.slug),
    ).toEqual(["a"]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not fire when the dialog is dismissed with nothing applied", () => {
    mockEntries = [entry("a", "pending")];
    const onApplied = vi.fn();

    render(
      <ApplyManifestDialog
        open
        onOpenChange={vi.fn()}
        org="acme"
        onApplied={onApplied}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onApplied).not.toHaveBeenCalled();
  });
});
