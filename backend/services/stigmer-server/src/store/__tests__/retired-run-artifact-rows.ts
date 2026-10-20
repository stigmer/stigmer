/**
 * Builds stored run rows as a release wrote them before RunStatus field 15
 * (`artifacts`) was reserved, and the scenario both drivers' migration
 * step to Files runs (SQLite v45, Postgres v41): the rows a database held,
 * what each holds after the step, and the conversion rows it writes. The
 * retired message is written by wire number, as the stored bytes hold it,
 * since no schema defines it any more.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";

import type { OutputConversion } from "../file-blobs.js";

/** A retired RunArtifact. `kind` is 1 for a file, 2 for a directory. */
export interface RetiredRunArtifact {
  readonly name: string;
  readonly kind: number;
  readonly storageKey: string;
  readonly sandboxPath?: string;
  readonly sizeBytes?: number;
  readonly createdAt?: string;
  readonly entries?: readonly string[];
  readonly contentHash?: string;
}

function text(w: BinaryWriter, no: number, value: string | undefined): void {
  if (value !== undefined && value !== "") {
    w.tag(no, WireType.LengthDelimited).string(value);
  }
}

/** One RunArtifact{name=1, sandbox_path=2, kind=3, size_bytes=4, storage_key=5, created_at=7, entries=9, content_hash=10}. */
export function retiredRunArtifactBytes(artifact: RetiredRunArtifact): Uint8Array {
  const w = new BinaryWriter();
  text(w, 1, artifact.name);
  text(w, 2, artifact.sandboxPath);
  if (artifact.kind !== 0) {
    w.tag(3, WireType.Varint).int32(artifact.kind);
  }
  if (artifact.sizeBytes !== undefined) {
    w.tag(4, WireType.Varint).int64(artifact.sizeBytes);
  }
  text(w, 5, artifact.storageKey);
  text(w, 7, artifact.createdAt);
  for (const entry of artifact.entries ?? []) {
    text(w, 9, entry);
  }
  text(w, 10, artifact.contentHash);
  return w.finish();
}

/** A run row whose status held `artifacts` at field 15. */
export function runRowWithArtifacts(
  init: MessageInitShape<typeof RunSchema>,
  artifacts: readonly RetiredRunArtifact[],
): Uint8Array {
  const run = create(RunSchema, init);
  const status = run.status;
  if (status === undefined) {
    throw new Error("the fixture needs a run status");
  }
  status.$unknown = [
    ...(status.$unknown ?? []),
    ...artifacts.map((artifact) => ({
      no: 15,
      wireType: WireType.LengthDelimited,
      data: new BinaryWriter().bytes(retiredRunArtifactBytes(artifact)).finish(),
    })),
  ];
  return toBinary(RunSchema, run);
}

// =============================================================================
// The migration step's scenario
// =============================================================================

/** One stored row: its kind column, its id and its bytes. */
export interface RunArtifactsStepRow {
  readonly kind: string;
  readonly id: string;
  readonly data: Uint8Array;
}

const STEP_ORG = "org_01kartifactstep00000000000";
const STEP_CREATED_AT = new Date("2026-10-02T09:00:00.125Z");

const stepRun = {
  metadata: { id: "run_step", org: STEP_ORG, etag: "kept-etag" },
  spec: { target: { case: "sessionId" as const, value: "ses_step" }, message: "Write the report." },
  status: { audit: { specAudit: { createdAt: timestampFromDate(STEP_CREATED_AT) } } },
};
const quietRun = toBinary(RunSchema, create(RunSchema, { metadata: { id: "run_quiet", org: STEP_ORG }, status: {} }));

/** The rows a database held before the step. */
export const RUN_ARTIFACTS_STEP_ROWS: readonly RunArtifactsStepRow[] = [
  {
    kind: "run",
    id: "run_step",
    data: runRowWithArtifacts(stepRun, [
      {
        name: "report.md",
        kind: 1,
        storageKey: "artifacts/run_step/report.md",
        sandboxPath: "/workspace/out/report.md",
        sizeBytes: 12,
        createdAt: "2026-10-02T09:01:00Z",
        contentHash: "ab".repeat(32),
      },
      { name: "skill", kind: 2, storageKey: "artifacts/run_step/skill.zip", entries: ["SKILL.md"] },
      { name: "main.ts", kind: 1, storageKey: "artifacts/run_step/main.ts" },
    ]),
  },
  { kind: "run", id: "run_quiet", data: quietRun },
];

/** What each row holds after the step: the run without its stored files, its etag as it was. */
export const RUN_ARTIFACTS_STEP_EXPECTED: ReadonlyMap<string, Uint8Array> = new Map([
  ["run_step", toBinary(RunSchema, create(RunSchema, stepRun))],
  ["run_quiet", quietRun],
]);

/** The conversion rows the step writes, by run then position: files only, a directory dropped. */
export const RUN_ARTIFACTS_STEP_CONVERSIONS: readonly OutputConversion[] = [
  {
    runId: "run_step",
    position: 0,
    org: STEP_ORG,
    sessionId: "ses_step",
    name: "report.md",
    storageKey: "artifacts/run_step/report.md",
    createdAt: "2026-10-02T09:00:00.125000000Z",
  },
  {
    runId: "run_step",
    position: 2,
    org: STEP_ORG,
    sessionId: "ses_step",
    name: "main.ts",
    storageKey: "artifacts/run_step/main.ts",
    createdAt: "2026-10-02T09:00:00.125000000Z",
  },
];

/** An output conversion row read raw, in the record's shape. */
export function outputConversionOfRow(row: Record<string, unknown>): OutputConversion {
  return {
    runId: String(row.run_id),
    position: Number(row.position),
    org: String(row.org),
    sessionId: String(row.session_id),
    name: String(row.name),
    storageKey: String(row.storage_key),
    createdAt: String(row.created_at),
  };
}
