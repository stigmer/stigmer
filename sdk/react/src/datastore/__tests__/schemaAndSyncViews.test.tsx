// Render tests for the two Overview views: the schema view (spec for
// structure — fields, constraints with authored messages, authorization
// summary) and the sync report (status for health).

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  DatastoreSpecSchema,
  FieldType,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import {
  CollectionMaterializationState,
  DatastoreStatusSchema,
  DatastoreSyncOutcome,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/status_pb";
import { CollectionSchemaView, formatSubject } from "../CollectionSchemaView";
import { DatastoreSyncReport } from "../DatastoreSyncReport";

afterEach(() => cleanup());

describe("CollectionSchemaView", () => {
  const spec = create(DatastoreSpecSchema, {
    timezone: "Asia/Kolkata",
    authorization: {
      roles: [{ name: "admin" }, { name: "patient" }],
      defaultRole: "patient",
      bindings: [
        {
          subject: {
            kind: { case: "channelSender", value: { senderKind: "whatsapp", value: "+15550100" } },
          },
          role: "admin",
        },
      ],
    },
    collections: [
      {
        name: "bookings",
        description: "Confirmed appointments",
        fields: [
          { name: "slot_date", type: FieldType.date, required: true },
          {
            name: "status",
            type: FieldType.string,
            enumValues: ["confirmed", "cancelled"],
            description: "Booking lifecycle",
          },
        ],
        uniques: [
          {
            name: "one_confirmed_per_slot",
            fields: ["slot_date"],
            message: "that slot is already booked",
          },
        ],
      },
    ],
  });

  it("renders fields, enum values, and required markers", () => {
    render(<CollectionSchemaView spec={spec} />);
    expect(screen.getByText("slot_date")).toBeTruthy();
    expect(screen.getByText(/confirmed \| cancelled/)).toBeTruthy();
    expect(screen.getByText("Booking lifecycle")).toBeTruthy();
  });

  it("renders constraints with the operator's authored message verbatim", () => {
    render(<CollectionSchemaView spec={spec} />);
    expect(screen.getByText("one_confirmed_per_slot")).toBeTruthy();
    expect(screen.getByText(/that slot is already booked/)).toBeTruthy();
  });

  it("summarizes the authorization block: roles, bindings, default_role, timezone", () => {
    render(<CollectionSchemaView spec={spec} />);
    // "admin" appears as a role chip and as the binding's role.
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
    // "patient" appears as a role chip and as the default_role chip.
    expect(screen.getAllByText("patient").length).toBeGreaterThan(0);
    expect(screen.getByText("whatsapp:+15550100")).toBeTruthy();
    expect(screen.getByText("Asia/Kolkata")).toBeTruthy();
  });

  it("states the deny-by-default posture when no default_role is set", () => {
    const noDefault = create(DatastoreSpecSchema, {
      authorization: { roles: [{ name: "admin" }] },
      collections: [{ name: "c", fields: [{ name: "f", type: FieldType.string }] }],
    });
    render(<CollectionSchemaView spec={noDefault} />);
    expect(screen.getByText(/unbound callers are denied/)).toBeTruthy();
  });
});

describe("formatSubject", () => {
  it("renders channel senders and principals plainly", () => {
    expect(
      formatSubject({
        kind: { case: "channelSender", value: { senderKind: "whatsapp", value: "+1" } },
      } as never),
    ).toBe("whatsapp:+1");
    expect(
      formatSubject({
        kind: { case: "principal", value: { kind: "identity_account", id: "ida_1" } },
      } as never),
    ).toBe("identity_account/ida_1");
    expect(formatSubject(undefined)).toBe("unknown");
  });
});

describe("DatastoreSyncReport", () => {
  it("renders the outcome badge and per-collection counts", () => {
    const status = create(DatastoreStatusSchema, {
      lastSyncOutcome: DatastoreSyncOutcome.synced,
      collections: [
        {
          name: "bookings",
          state: CollectionMaterializationState.active,
          recordCount: 214n,
        },
        {
          name: "old_notes",
          state: CollectionMaterializationState.removed,
          recordCount: 3n,
        },
      ],
    });
    render(<DatastoreSyncReport status={status} />);
    expect(screen.getByText("synced")).toBeTruthy();
    expect(screen.getByText("214")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByText("removed")).toBeTruthy();
  });

  it("renders the rejected outcome", () => {
    const status = create(DatastoreStatusSchema, {
      lastSyncOutcome: DatastoreSyncOutcome.rejected,
    });
    render(<DatastoreSyncReport status={status} />);
    expect(screen.getByText("rejected")).toBeTruthy();
    expect(screen.getByText(/No collections have been synced yet/)).toBeTruthy();
  });
});
