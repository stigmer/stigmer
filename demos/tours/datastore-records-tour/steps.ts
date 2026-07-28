/**
 * Datastore records tour — the clinic-records datastore in the console, for
 * `docs/concepts/datastores.mdx` ("Browsing records in the console").
 *
 * Three beats on the real `DatastoreDetailView`, tab pinned per beat via its
 * controlled `activeTab` prop:
 *
 * 1. **Overview, top** — the sync report's health table and the
 *    authorization summary (the establishing frame; step 0 is
 *    interaction-free by rule).
 * 2. **Overview, constraints** — a `scroll_to` brings the schema's tail into
 *    frame: the `one_confirmed_per_slot` unique with its message shown
 *    *verbatim* (the page's core point: your users read the same declared
 *    message). The scroll anchor is tour-owned chrome in `index.tsx`, not an
 *    SDK internal.
 * 3. **Records** — the bookings grid the staff browses, with the write
 *    affordances the caller's verbs grant.
 *
 * Ported from the `datastore-records-browser` docs inline demo, which was a
 * live interactive browser (stateful insert/update/delete echoes). A packed
 * tour is a playback, so the write fixtures are gone and the docs prose no
 * longer invites the reader to "try it" — the narration carries the
 * constraint story instead. Depicting the *collision itself* (a filled
 * insert form, the rejected submit) needs value-/error-seeding props on
 * `RecordFormPanel` (DD-006 rule 7); recorded as debt in the migration
 * project's notes.
 *
 * Determinism notes:
 * - The legacy demo's two `Date.now()` reads are gone: record timestamps
 *   derive from the tour world's clock (`sampleDate`), and
 *   `status.lastSyncedAt` is deliberately **unset** — `DatastoreSyncReport`
 *   renders its zone-dependent `toLocaleString()` caption only when the
 *   field is present, while `lastSyncOutcome: synced` + the per-collection
 *   table still tell the "your apply landed" story. Same idiom as
 *   `_shared/ApiKeysPage`'s alert-only reveal: omit the one field whose
 *   render varies per reader, name the formatter debt as the reason.
 * - The grid's `created_at` column renders the UTC ISO instant
 *   (`formatSystemTimestamp` only trims zero-fractions), so with derived
 *   instants it reads the same for every reader.
 * - `slot_date`/`slot_time` field values are date-only/time-only strings —
 *   displayed data, not instants.
 */
import { create, type JsonObject } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
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
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { sampleDate } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { DEMO_ORG } from "../_shared/fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The tab the beat pins (`DatastoreDetailView`'s controlled `activeTab`). */
export type DatastoreRecordsTourStep = { view: "datastore"; tab: "overview" | "records" };

/** Slug the fixture datastore is published under (the real view fetches it). */
export const DEMO_SLUG = "clinic-records";

// ---------------------------------------------------------------------------
// Datastore fixture: spec (structure) + status (health)
// ---------------------------------------------------------------------------

export function buildDemoDatastore() {
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
                // wa_id wire shape: digits only, no "+" (apply-time enforced).
                value: { senderKind: "whatsapp_phone", value: "15550100" },
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
      // `lastSyncedAt` stays unset on purpose — see the determinism notes in
      // the file docstring. The outcome badge and collection table carry the
      // health story without the zone-dependent timestamp caption.
      lastSyncOutcome: DatastoreSyncOutcome.synced,
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

export function buildDemoDescription() {
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
// Records: a settled page (playback never writes — no echo fixtures)
// ---------------------------------------------------------------------------

/** Bookings written two hours before the demo day's anchor. */
const seedTimestamp = timestampFromDate(sampleDate(-2 * 60 * 60 * 1000));

function envelope(id: string, fields: JsonObject) {
  return create(RecordEnvelopeSchema, {
    id,
    createdAt: seedTimestamp,
    updatedAt: seedTimestamp,
    createdBy: {
      kind: {
        case: "channelSender",
        // Attribution mirrors what the broker stamps: wa_id, digits only.
        value: { senderKind: "whatsapp_phone", value: "15550142" },
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

export function buildDemoRecordList() {
  return create(RecordListSchema, {
    records: demoRecords,
    total: demoRecords.length,
    limit: 25,
    offset: 0,
  });
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const datastoreRecordsTourSteps: ScenarioStep<DatastoreRecordsTourStep>[] = [
  {
    // Step 0 is interaction-free by rule: an establishing beat of the
    // Overview tab's top — health and authorization.
    delayMs: 6000,
    data: { view: "datastore", tab: "overview" },
    narration:
      "Every datastore is a declared contract. The Overview tab shows the " +
      "bookings schema, who may read and write, and a sync report " +
      "confirming the last apply landed.",
  },
  {
    // Same tab, scrolled: the schema's constraints come into frame while
    // the narration reads the declared message.
    delayMs: 6000,
    data: { view: "datastore", tab: "overview" },
    narration:
      "Constraints are part of the declaration. One confirmed booking per " +
      "slot — and its message, that slot is already booked, is exactly the " +
      "text your users will read.",
    interactions: [{ type: "scroll_to", target: "schema-foot", atPercent: 0.2 }],
  },
  {
    delayMs: 7000,
    data: { view: "datastore", tab: "records" },
    narration:
      "The Records tab is a full browser over the same data your Agents " +
      "write. Filter with schema-aware conditions, insert or edit through a " +
      "typed form — and a conflicting insert gets that declared message " +
      "back, verbatim.",
  },
];
