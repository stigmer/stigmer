// Tests for the guarded delete flow (DD-008 SD-6): status-informed
// counts, slug-typed arming for non-empty datastores, standard confirm
// for empty ones, and verbatim guard-refusal rendering.

import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { DatastoreSchema } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import { StigmerContext } from "../../context";
import { DeleteDatastoreDialog } from "../DeleteDatastoreDialog";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(() => cleanup());
beforeEach(() => vi.restoreAllMocks());

function makeDatastore(recordCounts: number[]) {
  return create(DatastoreSchema, {
    metadata: { id: "dst_1", slug: "clinic", name: "Clinic", org: "acme" },
    status: {
      collections: recordCounts.map((count, i) => ({
        name: `coll_${i}`,
        recordCount: BigInt(count),
      })),
    },
  });
}

function renderDialog(overrides: {
  datastore: ReturnType<typeof makeDatastore>;
  del?: (...a: unknown[]) => Promise<unknown>;
  onDeleted?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const stigmer = { datastore: { delete: overrides.del ?? vi.fn() } };
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={stigmer as never}>{children}</StigmerContext.Provider>
    );
  }
  return render(
    <DeleteDatastoreDialog
      open
      onOpenChange={overrides.onOpenChange ?? vi.fn()}
      datastore={overrides.datastore}
      onDeleted={overrides.onDeleted}
    />,
    { wrapper: Wrapper },
  );
}

describe("DeleteDatastoreDialog — non-empty datastore", () => {
  it("pre-fills counts from status and requires typing the slug to arm", async () => {
    const user = userEvent.setup();
    const del = vi.fn().mockResolvedValue({});
    renderDialog({ datastore: makeDatastore([200, 14, 0]), del });

    // Counts from the loaded status: 214 records across 2 non-empty collections.
    expect(screen.getByText(/214 records/)).toBeTruthy();
    expect(screen.getByText(/2 collections/)).toBeTruthy();

    const deleteButton = screen.getByRole("button", {
      name: "Delete datastore",
    }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);

    // A wrong slug keeps it disarmed.
    const input = screen.getByLabelText("Type clinic to confirm deletion");
    await user.type(input, "clinik");
    expect(deleteButton.disabled).toBe(true);

    // The exact slug arms it; the armed request carries force.
    await user.clear(input);
    await user.type(input, "clinic");
    expect(deleteButton.disabled).toBe(false);

    await user.click(deleteButton);
    await waitFor(() => expect(del).toHaveBeenCalled());
    expect(del).toHaveBeenCalledWith({ resourceId: "dst_1", force: true });
  });

  it("renders a guard refusal verbatim inside the dialog — server stays authoritative", async () => {
    const user = userEvent.setup();
    const refusal = new Error(
      'datastore "clinic" is referenced by 1 agents (clinic-assistant); remove the datastore_usages references before deleting',
    );
    const del = vi.fn().mockRejectedValue(refusal);
    const onOpenChange = vi.fn();
    renderDialog({ datastore: makeDatastore([214]), del, onOpenChange });

    await user.type(
      screen.getByLabelText("Type clinic to confirm deletion"),
      "clinic",
    );
    await user.click(screen.getByRole("button", { name: "Delete datastore" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("clinic-assistant");
    expect(alert.textContent).toContain("remove the datastore_usages references");
    // The dialog stays open — the operator's next step is detaching.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("DeleteDatastoreDialog — empty datastore", () => {
  it("keeps the standard destructive confirm with no slug typing and no force", async () => {
    const user = userEvent.setup();
    const del = vi.fn().mockResolvedValue({});
    const onDeleted = vi.fn();
    renderDialog({ datastore: makeDatastore([0, 0]), del, onDeleted });

    expect(screen.getByText(/holds no records/)).toBeTruthy();
    expect(screen.queryByLabelText(/to confirm deletion/)).toBeNull();

    const deleteButton = screen.getByRole("button", {
      name: "Delete datastore",
    }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(false);

    await user.click(deleteButton);
    await waitFor(() => expect(del).toHaveBeenCalledWith({ resourceId: "dst_1", force: false }));
    expect(onDeleted).toHaveBeenCalled();
  });
});
