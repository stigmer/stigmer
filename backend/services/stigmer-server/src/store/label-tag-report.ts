/**
 * The one report-only data migration both store drivers run when labels
 * and tags gain their rules and `annotations` leaves resource metadata:
 * every stored resource is read, and the ones whose stored labels, tags or
 * annotations the new rules refuse are counted and named in a warning.
 * Nothing is rewritten. The drivers own the SQL; this module owns what one
 * row is found to hold.
 *
 * The rules are the contract's own: a row's metadata is checked by the
 * same protovalidate rules the edge applies to a request
 * (`ApiResourceMetadata.labels` and `.tags` in metadata.proto), keeping
 * only the violations under those two fields, so the report and a write's
 * refusal never disagree. Stored annotations survive the field's removal
 * as an unknown field 7 of the metadata, which is how they are found.
 *
 * Why a report and not a rewrite. The edge validates requests, not stored
 * rows, and the state validation an update runs on the merged row skips
 * labels and tags the write left exactly as stored
 * (pipeline/steps/validation.ts). So an update whose mask leaves labels
 * and tags out keeps the stored values and succeeds; a write that sends a
 * value the rules refuse (a request carrying it, or an update that changes
 * the field to it) is refused. Rewriting would guess what a person meant
 * by a label, and stripping annotations would touch archived versions'
 * bytes for nothing. The warning says which rows hold what, so an operator
 * fixes them at their next edit.
 *
 * A row whose kind has no entry ({@link RESOURCE_SCHEMAS}) is not read; a
 * row that does not decode is counted as unreadable in the same line. A
 * kind renamed after the step is read by the name its rows carried then
 * ({@link SCHEMAS_AT_STEP}, which the etag step before it shares), and a
 * kind merged into another after it by its predecessors' names, through
 * their frozen shapes.
 *
 * Pinned by __tests__/label-tag-report.test.ts and both drivers'
 * migration arms.
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { DescMessage, Message } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import type { Validator } from "@bufbuild/protovalidate";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import type { StoreLogger } from "./logger.js";
import { SCHEMAS_AT_STEP } from "./resource-etags-stamped.js";

/** How many rows the step reads per page. */
export const LABEL_TAG_REPORT_PAGE_SIZE = 100;

/** How many row ids one kind's warning names. */
export const LABEL_TAG_REPORT_SAMPLE = 10;

/** The field number `annotations` held in ApiResourceMetadata, now reserved. */
const ANNOTATIONS_FIELD_NUMBER = 7;

const SCHEMAS_BY_KIND_NAME = SCHEMAS_AT_STEP;

/** The `kind` column values of the rows the step reads. */
export const LABEL_TAG_REPORT_KIND_NAMES: ReadonlyArray<string> = [...SCHEMAS_BY_KIND_NAME.keys()];

/** What one stored row holds that the rules now refuse. */
export interface LabelTagFindings {
  readonly labels: boolean;
  readonly tags: boolean;
  readonly annotations: boolean;
}

let shared: Validator | undefined;
function validator(): Validator {
  return (shared ??= createValidator());
}

/**
 * What one row of `kindName` holds that the rules refuse, or undefined
 * when its kind has no entry or it carries no resource metadata. Throws
 * when the bytes do not decode.
 */
export function labelTagFindings(kindName: string, data: Uint8Array): LabelTagFindings | undefined {
  const schema = SCHEMAS_BY_KIND_NAME.get(kindName);
  if (schema === undefined) {
    return undefined;
  }
  const resource = fromBinary(schema, data);
  const metadata = metadataOf(schema, resource);
  if (metadata === undefined) {
    return undefined;
  }
  let labels = false;
  let tags = false;
  const result = validator().validate(ApiResourceMetadataSchema, metadata);
  if (result.kind === "invalid") {
    for (const violation of result.violations) {
      const first = violation.field[0];
      const name = first?.kind === "field" ? first.name : "";
      labels ||= name === "labels";
      tags ||= name === "tags";
    }
  }
  const annotations = (metadata.$unknown ?? []).some((field) => field.no === ANNOTATIONS_FIELD_NUMBER);
  return { labels, tags, annotations };
}

function metadataOf(schema: DescMessage, resource: Message): ApiResourceMetadata | undefined {
  const root = reflect(schema, resource);
  const field = root.desc.fields.find((candidate) => candidate.name === "metadata");
  if (field?.fieldKind !== "message" || field.message.typeName !== ApiResourceMetadataSchema.typeName || !root.isSet(field)) {
    return undefined;
  }
  return (root.get(field) as ReflectMessage).message as ApiResourceMetadata;
}

/** One kind's tally while the step reads its rows. */
export class LabelTagTally {
  private labels = 0;
  private tags = 0;
  private annotations = 0;
  private unreadable = 0;
  private readonly ids: string[] = [];

  constructor(private readonly kindName: string) {}

  /** Reads one row into the tally. */
  add(id: string, data: Uint8Array): void {
    let findings: LabelTagFindings | undefined;
    try {
      findings = labelTagFindings(this.kindName, data);
    } catch {
      this.unreadable += 1;
      this.sample(id);
      return;
    }
    if (findings === undefined || !(findings.labels || findings.tags || findings.annotations)) {
      return;
    }
    this.labels += Number(findings.labels);
    this.tags += Number(findings.tags);
    this.annotations += Number(findings.annotations);
    this.sample(id);
  }

  /** The kind's one warning, when any row held anything. */
  log(logger: StoreLogger): void {
    if (this.ids.length === 0) {
      return;
    }
    logger.warn(
      "stored labels, tags or annotations break the rules a write now applies; nothing was changed: an update that leaves them out of its mask keeps them, and a write that sends them is refused until they are fixed",
      {
        kind: this.kindName,
        labels: this.labels,
        tags: this.tags,
        annotations: this.annotations,
        unreadable: this.unreadable,
        ids: [...this.ids],
      },
    );
  }

  private sample(id: string): void {
    if (this.ids.length < LABEL_TAG_REPORT_SAMPLE) {
      this.ids.push(id);
    }
  }
}
