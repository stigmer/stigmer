/**
 * Where an eval keeps its version: the archive's digest is the hash, the
 * push's tag the live tag, and a fetched older version reports the tag it
 * holds now (the audit column), the skill's discipline. One binding serves
 * getByReference, listVersions and the two downloads, so a download and a
 * read can never disagree about which version a reference names.
 *
 * A version entry carries no storage key: every download names the eval at
 * a version and asks can_view on it, so no key leaves the server.
 */
import { create } from "@bufbuild/protobuf";

import { EvalSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import {
  EvalVersionEntrySchema,
  ListEvalVersionsResponseSchema,
} from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import type {
  EvalVersionEntry,
  ListEvalVersionsResponse,
} from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import type { EvalQueryController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/query_pb";
import { EvalSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { VersionHistoryBinding } from "../../pipeline/steps/version-history.js";
import { EVAL_NOUN } from "./constants.js";

type ListVersionsDesc = typeof EvalQueryController.method.listVersions.input;

/** Where an eval keeps its hash and its tag, and how its history renders. */
export const evalVersionBinding: VersionHistoryBinding<
  typeof EvalSchema,
  ListVersionsDesc,
  EvalVersionEntry,
  ListEvalVersionsResponse
> = {
  kind: ApiResourceKind.eval,
  schema: EvalSchema,
  noun: EVAL_NOUN,
  headHashOf: (evalResource) => evalResource.status?.digest ?? "",
  liveTagOf: (evalResource) => evalResource.spec?.tag ?? "",
  overlayTag: (evalResource, tag) => {
    evalResource.spec ??= create(EvalSpecSchema, {});
    evalResource.spec.tag = tag;
  },
  input: (req) => req,
  mapEntry: (snapshot, isCurrent, tag) => {
    const entry = create(EvalVersionEntrySchema, { isCurrent, tag });
    if (snapshot.status !== undefined) {
      entry.digest = snapshot.status.digest;
      const specAudit = snapshot.status.audit?.specAudit;
      if (specAudit !== undefined) {
        entry.pushedAt = specAudit.updatedAt ?? specAudit.createdAt;
        entry.pushedBy = specAudit.updatedBy ?? specAudit.createdBy;
      }
    }
    if (snapshot.metadata?.version !== undefined) {
      entry.message = snapshot.metadata.version.message;
    }
    return entry;
  },
  response: (entries, nextPageToken) =>
    create(ListEvalVersionsResponseSchema, { entries, nextPageToken }),
};
