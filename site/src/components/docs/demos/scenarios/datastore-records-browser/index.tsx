"use client";

import { DatastoreDetailView } from "@stigmer/react";
import { PreviewProvider } from "@scenar/preview/runtime";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { DatastoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/query_pb";
import { DatastoreRecordQueryController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_query_pb";
import { DatastoreRecordCommandController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_command_pb";
import { DatastoreSchema } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import {
  DatastoreSpecSchema,
  DatastoreVerb,
  FieldType,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import {
  CollectionMaterializationState,
  DatastoreStatusSchema,
  DatastoreSyncOutcome,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/status_pb";
import {
  DatastoreDescriptionSchema,
  RecordEnvelopeSchema,
  RecordListSchema,
  type InsertRecordRequest,
  type UpdateRecordRequest,
  type DeleteRecordRequest,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { connectFixture } from "@scenar/preview/connect";
import { DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import { DemoDetailShell } from "../../shared/DemoDetailShell";

const DEMO_ORG = "acme";
const DEMO_SLUG = "clinic-records";

// ---------------------------------------------------------------------------
// The datastore resource: spec (structure) + status (health)
// ---------------------------------------------------------------------------

function buildDemoDatastore() {
  return create(DatastoreSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Datastore",
    metadata: create(ApiResourceMetadataSchema, {
      id: "dst_01demo0000000000000000000",
      name: DEMO_SLUG,
      slug: DEMO_SLUG,
      org: DEMO_ORG,
    }),
    spec: create(DatastoreSpecSchema, {
      description:
        "Clinic appointment records — bookings written by the WhatsApp assistant and browsed by staff.",
      timezone: "Asia/Kolkata",
      authorization: {
        roles: [{ name: "admin" }, { name: "patient" }],
        defaultRole: "patient",
        bindings: [
          {
            subject: {
              kind: {
                case: "channelSender",
                value: { senderKind: "whatsapp", value: "+15550100" },
              },
            },
            role: "admin",
          },
        ],
      },
      collections: [
        {
          name: "bookings",
          description: "Confirmed appointments, one record per booked slot.",
          fields: [
            { name: "slot_date", type: FieldType.date, required: true },
            { name: "slot_time", type: FieldType.time, required: true },
            { name: "patient_phone", type: FieldType.string, required: true },
            {
              name: "status",
              type: FieldType.string,
              enumValues: ["confirmed", "cancelled"],
              default: undefined,
              description: "Booking lifecycle state.",
            },
            { name: "notes", type: FieldType.string },
          ],
          uniques: [
            {
              name: "one_confirmed_per_slot",
              fields: ["slot_date", "slot_time"],
              where: undefined,
              message: "that slot is already booked",
            },
          ],
          grants: [
            {
              role: "admin",
              verbs: [
                DatastoreVerb.read,
                DatastoreVerb.insert,
                DatastoreVerb.update,
                DatastoreVerb.delete,
              ],
            },
          ],
        },
      ],
    }),
    status: create(DatastoreStatusSchema, {
      lastSyncOutcome: DatastoreSyncOutcome.synced,
      lastSyncedAt: { seconds: BigInt(Math.floor(Date.now() / 1000) - 3600), nanos: 0 },
      collections: [
        {
          name: "bookings",
          state: CollectionMaterializationState.active,
          recordCount: BigInt(3),
        },
      ],
    }),
  });
}

// ---------------------------------------------------------------------------
// The caller-effective description: verbs + partitions (the projection
// every write affordance gates on)
// ---------------------------------------------------------------------------

function buildDemoDescription() {
  const spec = buildDemoDatastore().spec!;
  return create(DatastoreDescriptionSchema, {
    datastore: DEMO_SLUG,
    description: spec.description,
    timezone: spec.timezone,
    partitions: ["default"],
    collections: [
      {
        name: "bookings",
        description: spec.collections[0].description,
        fields: spec.collections[0].fields,
        constraints: [
          { name: "one_confirmed_per_slot", kind: 1, message: "that slot is already booked" },
        ],
        access: [
          { verb: DatastoreVerb.read },
          { verb: DatastoreVerb.insert },
          { verb: DatastoreVerb.update },
          { verb: DatastoreVerb.delete },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Records: a stateful page so demo inserts/edits/deletes reflect live
// ---------------------------------------------------------------------------

const seedTimestamp = { seconds: BigInt(Math.floor(Date.now() / 1000) - 7200), nanos: 0 };

function envelope(id: string, fields: JsonObject) {
  return create(RecordEnvelopeSchema, {
    id,
    createdAt: seedTimestamp,
    updatedAt: seedTimestamp,
    createdBy: {
      kind: {
        case: "channelSender",
        value: { senderKind: "whatsapp", value: "+15550142" },
      },
    },
    fields,
  });
}

const demoRecords = [
  envelope("dsr_01demo0000000000000000001", {
    slot_date: "2026-08-03",
    slot_time: "09:00:00",
    patient_phone: "+15550142",
    status: "confirmed",
    notes: "first visit",
  }),
  envelope("dsr_01demo0000000000000000002", {
    slot_date: "2026-08-03",
    slot_time: "10:30:00",
    patient_phone: "+15550171",
    status: "confirmed",
  }),
  envelope("dsr_01demo0000000000000000003", {
    slot_date: "2026-08-04",
    slot_time: "09:00:00",
    patient_phone: "+15550198",
    status: "cancelled",
    notes: "rescheduling next week",
  }),
];

const previewFixtures = [
  connectFixture(DatastoreQueryController, "getByReference", () => buildDemoDatastore()),
  connectFixture(DatastoreRecordQueryController, "describeDatastore", () =>
    buildDemoDescription(),
  ),
  connectFixture(DatastoreRecordQueryController, "findRecords", () =>
    create(RecordListSchema, {
      records: demoRecords,
      total: demoRecords.length,
      limit: 25,
      offset: 0,
    }),
  ),
  // Write echoes so demo interactions succeed instead of erroring; the
  // grid refetch re-reads the mutated in-memory page.
  connectFixture(DatastoreRecordCommandController, "insertRecord", (input) => {
    const req = input as InsertRecordRequest;
    const inserted = envelope(
      `dsr_01demo000000000000000000${demoRecords.length + 1}`,
      req.record ?? {},
    );
    demoRecords.push(inserted);
    return inserted;
  }),
  connectFixture(DatastoreRecordCommandController, "updateRecord", (input) => {
    const req = input as UpdateRecordRequest;
    const target = demoRecords.find((r) => r.id === req.id) ?? demoRecords[0];
    for (const [name, value] of Object.entries(req.fields ?? {})) {
      if (value === null) delete target.fields![name];
      else target.fields![name] = value;
    }
    return target;
  }),
  connectFixture(DatastoreRecordCommandController, "deleteRecord", (input) => {
    const req = input as DeleteRecordRequest;
    const index = demoRecords.findIndex((r) => r.id === req.id);
    const [removed] = index >= 0 ? demoRecords.splice(index, 1) : [demoRecords[0]];
    return removed;
  }),
];

export function DatastoreRecordsBrowser() {
  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <DemoDetailShell>
        <div className="p-4" style={{ zoom: DEMO_CONTENT_ZOOM }}>
          <DatastoreDetailView org={DEMO_ORG} slug={DEMO_SLUG} defaultTab="records" />
        </div>
      </DemoDetailShell>
    </PreviewProvider>
  );
}
