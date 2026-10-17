/**
 * Eval push pipeline — the steps that turn a PushEvalRequest into an
 * eval's new version, in two chains the controller runs back to back over
 * one request context:
 *
 *   plan:    ValidateProto → BuildInitialEval → FindExistingBySlug →
 *            AuthorizeEvalWrite → RefuseRenamedSlug → ResolveArtifactSource →
 *            GateAndHashArchive → ReadEvalFolder → GenerateIDIfNeeded →
 *            GuardEvalVisibility → ResolveConvergence
 *   install: CheckAndStoreArtifact → PopulateEvalFields → ClaimName →
 *            StoreEval → ArchiveCurrentEval → EvalPushAuthorizationTuples
 *
 * Every step that knows nothing of an eval is the shared push steps'
 * (pipeline/steps/archive-push.ts), the plugin's chain's. What differs:
 *
 *   - the slug is the request's, never the content's: Claude Code's evals/
 *     folder names nothing, so the head is built from the request before
 *     the archive is read;
 *   - authorization is the handler's, as agent apply's is: a push that
 *     creates asks can_create_eval on the organization, one that adds a
 *     version asks can_edit on the eval the slug names. It runs before the
 *     staged upload is consumed and before a byte of the archive is read,
 *     so a caller who may not push costs the server nothing;
 *   - the folder is read by the library's `readEvalFolder`, and a folder
 *     where no case loads is refused with its findings; one where some do
 *     is stored with the rest as findings, as Claude Code runs what loads;
 *   - the tag is the request's (the skill's discipline): a push naming a
 *     tag moves it, even onto a version already archived, and a re-push of
 *     the held folder with a new tag moves only the tag;
 *   - an unspecified level and an empty display name keep the stored ones,
 *     so a pipeline that pushes on every merge never re-levels an eval
 *     someone made private.
 *
 * Proven by __tests__/eval.test.ts (composed-server round trips) and the
 * eval conformance suite.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { readEvalFolder, summariseEvalSuite } from "@stigmer/plugin-package";
import type { EvalSuite } from "@stigmer/plugin-package";
import { EvalSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import type { Eval } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import type { PushEvalRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/io_pb";
import { EvalSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/spec_pb";
import {
  EvalCaseSummarySchema,
  EvalFindingSchema,
  EvalStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/eval/v1/status_pb";
import type { EvalStatus } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/status_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import {
  ApiResourceMetadataSchema,
  ApiResourceMetadataVersionSchema,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { OpenedArchive } from "../../archive/open-files.js";
import type { Logger } from "../../boot/logger.js";
import { defaultVisibilityFor } from "../../pipeline/apiresource-meta.js";
import { invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import {
  EXISTING_PUSHED_RESOURCE_KEY,
  OPENED_ARCHIVE_KEY,
  PUSHED_RESOURCE_KEY,
  RENAMED_AWAY_ID_KEY,
  SHOULD_CREATE_KEY,
} from "../../pipeline/steps/archive-push.js";
import type { ArchivePushBinding } from "../../pipeline/steps/archive-push.js";
import type { AuthorizationTarget } from "../../pipeline/steps/authorize.js";
import {
  setAuditFieldsForCreate,
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import { newArchiveCurrentVersionStep } from "../../pipeline/steps/version-archive.js";
import type { Store } from "../../store/interface.js";
import { EVAL_MAX_LISTED_MOCK_SERVERS, EVAL_NOUN, EVAL_PUSH_DENIED } from "./constants.js";

type PushDesc = typeof PushEvalRequestSchema;

/** The folder as the library read it (EvalSuite). */
export const EVAL_SUITE_KEY = "evalSuite";

/** The request fields every eval write names its eval by: a push's and an upload mint's. */
export interface EvalWriteRequest {
  readonly org: string;
  readonly slug: string;
  /** The display name a push asks for; empty or absent, none. */
  readonly name?: string;
}

/**
 * BuildInitialEval — the head from the request: its organization, its
 * slug, and its display name (the request's, or the slug's until
 * PopulateEvalFields keeps a stored one). The id, spec and status come
 * later. Serves the push and the upload mint, whose requests name the
 * eval the same way.
 */
export function newBuildInitialEvalStep<Req extends DescMessage>(
  requestOf: (input: MessageShape<Req>) => EvalWriteRequest,
): PipelineStep<Req> {
  return {
    name: "BuildInitialEval",
    execute(ctx: RequestContext<Req>): void {
      ctx.set(PUSHED_RESOURCE_KEY, initialEval(requestOf(ctx.input)));
    },
  };
}

/** The eval a write names, before anything is read: organization, slug, and the request's name when it has one. */
export function initialEval(request: EvalWriteRequest): Eval {
  return create(EvalSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Eval",
    metadata: create(ApiResourceMetadataSchema, {
      org: request.org,
      slug: request.slug,
      name: request.name !== undefined && request.name !== "" ? request.name : request.slug,
    }),
    spec: create(EvalSpecSchema, {}),
    status: create(EvalStatusSchema, {}),
  });
}

/**
 * AuthorizeEvalWrite's questions once FindExistingBySlug ran: create on
 * the organization when no eval holds the slug, edit on the eval when one
 * does. One copy for both, so a refusal says nothing about which arm ran.
 * A resolver over any request context the shared step ran in: a push's
 * and an upload mint's.
 */
export function writeTargetsOf(ctx: {
  get(key: string): unknown;
}): ReadonlyArray<AuthorizationTarget> {
  const head = ctx.get(PUSHED_RESOURCE_KEY) as Eval | undefined;
  if (head === undefined) {
    throw new Error("AuthorizeEvalWrite: no eval under the push key; BuildInitialEval must run first");
  }
  const existing = ctx.get(EXISTING_PUSHED_RESOURCE_KEY) as Eval | undefined;
  // A slug renamed away from is asked about as the eval it leads to: only
  // its editors may learn of the rename (RefuseRenamedSlug answers them).
  const renamedAway = ctx.get(RENAMED_AWAY_ID_KEY) as string | undefined;
  const editedId = existing?.metadata?.id ?? renamedAway;
  if (editedId === undefined) {
    return [
      {
        permission: IamPermission.can_create_eval,
        resourceKind: ApiResourceKind.organization,
        resourceId: head.metadata?.org ?? "",
        deniedMessage: EVAL_PUSH_DENIED,
      },
    ];
  }
  return [
    {
      permission: IamPermission.can_edit,
      resourceKind: ApiResourceKind.eval,
      resourceId: editedId,
      deniedMessage: EVAL_PUSH_DENIED,
    },
  ];
}

/**
 * ReadEvalFolder — the library reads the folder at the archive's root. A
 * folder where no case loads is refused, listing every finding in the
 * sentences `stigmer push eval --dry-run` prints; anything less is stored,
 * the cases that do not load listed as findings.
 */
export function newReadEvalFolderStep(): PipelineStep<PushDesc> {
  return {
    name: "ReadEvalFolder",
    execute(ctx: RequestContext<PushDesc>): void {
      const archive = ctx.get(OPENED_ARCHIVE_KEY) as OpenedArchive;
      let suite: EvalSuite;
      try {
        suite = readEvalFolder(archive.files);
      } catch (error) {
        // The reader's own throw: an entry that failed to inflate.
        throw invalidArgumentError(
          `failed to read eval archive: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (suite.cases.length === 0) {
        throw invalidArgumentError(noCaseRefusal(suite));
      }
      ctx.set(EVAL_SUITE_KEY, suite);
    },
  };
}

/** The refusal of a folder with no case that loads, naming why each one did not. */
export function noCaseRefusal(suite: EvalSuite): string {
  const count = suite.findings.length;
  if (count === 0) {
    return "eval cannot be pushed: the folder holds no case; a case is a directory holding prompt.md or case.yaml, at the folder's root or beneath it";
  }
  return (
    `eval cannot be pushed: no case in the folder loads, ${count} problem${count === 1 ? "" : "s"} found:\n` +
    suite.findings.map((finding) => `  - ${finding.message}`).join("\n")
  );
}

/** The level this push writes: the request's, else the stored eval's, else the kind's default. */
export function requestedEvalVisibility(ctx: RequestContext<PushDesc>): ApiResourceVisibility {
  if (ctx.input.visibility !== ApiResourceVisibility.api_resource_visibility_unspecified) {
    return ctx.input.visibility;
  }
  const existing = ctx.get(EXISTING_PUSHED_RESOURCE_KEY) as Eval | undefined;
  const stored = existing?.metadata?.visibility ?? ApiResourceVisibility.api_resource_visibility_unspecified;
  return stored !== ApiResourceVisibility.api_resource_visibility_unspecified
    ? stored
    : defaultVisibilityFor(ctx.apiResourceKind);
}

/** The eval to the shared push steps: its schema, its level, its digest, and the tag and name a push may ask for. */
export const evalPushBinding: ArchivePushBinding<typeof EvalSchema, PushDesc> = {
  schema: EvalSchema,
  noun: EVAL_NOUN,
  visibilityOf: requestedEvalVisibility,
  digestOf: (evalResource) => evalResource.status?.digest ?? "",
  alreadyAsRequested: (existing, ctx) =>
    (ctx.input.tag === "" || existing.spec?.tag === ctx.input.tag) &&
    (ctx.input.name === "" || existing.metadata?.name === ctx.input.name),
};

/**
 * PopulateEvalFields — the folder's reading into the status, bounded as a
 * plugin's suite summary is; the level, the display name and the tag the
 * request asks for or the stored eval holds; the metadata.version chain;
 * and the audit discipline: a create stamps both slots, a new version
 * copies the stored slots and stamps spec_audit only.
 */
export function newPopulateEvalFieldsStep(): PipelineStep<PushDesc> {
  return {
    name: "PopulateEvalFields",
    execute(ctx: RequestContext<PushDesc>): void {
      const head = ctx.get(PUSHED_RESOURCE_KEY) as Eval;
      const archive = ctx.get(OPENED_ARCHIVE_KEY) as OpenedArchive;
      const suite = ctx.get(EVAL_SUITE_KEY) as EvalSuite;
      const shouldCreate = ctx.get(SHOULD_CREATE_KEY) === true;
      const existing = ctx.get(EXISTING_PUSHED_RESOURCE_KEY) as Eval | undefined;
      const metadata = head.metadata!;

      metadata.visibility = requestedEvalVisibility(ctx);
      if (ctx.input.name === "" && existing?.metadata !== undefined) {
        metadata.name = existing.metadata.name;
      }
      if (existing?.metadata !== undefined) {
        metadata.labels = { ...existing.metadata.labels };
        metadata.tags = [...existing.metadata.tags];
      }
      // A push of the folder the eval already holds (a retag, a re-level,
      // a new display name) adds no version, so the head keeps the version
      // it has: its id, the one before it and its message.
      const storedVersion = existing?.metadata?.version;
      metadata.version =
        existing?.status?.digest === archive.digest && storedVersion !== undefined
          ? create(ApiResourceMetadataVersionSchema, {
              id: storedVersion.id,
              message: storedVersion.message,
              previousVersionId: storedVersion.previousVersionId,
            })
          : create(ApiResourceMetadataVersionSchema, {
              id: archive.digest,
              message: ctx.input.message,
              previousVersionId: existing?.status?.digest ?? "",
            });
      // The request's tag, which the archive step moves here; none leaves
      // the head untagged, and the archive step shows the tag an already
      // archived version holds.
      head.spec = create(EvalSpecSchema, { tag: ctx.input.tag });
      head.status = statusOf(suite, archive.digest);

      if (shouldCreate) {
        setAuditFieldsForCreate(EvalSchema, head, ctx.callerIdentity);
      } else {
        if (existing?.status?.audit !== undefined) {
          head.status.audit = create(ApiResourceAuditSchema, {
            specAudit: existing.status.audit.specAudit,
            statusAudit: existing.status.audit.statusAudit,
          });
        }
        setAuditFieldsForUpdate(EvalSchema, head, "spec_audit", ctx.callerIdentity);
      }
    },
  };
}

/** The folder's reading as the eval's status, bounded by the library's summary. */
export function statusOf(suite: EvalSuite, digest: string): EvalStatus {
  const summary = summariseEvalSuite(suite);
  return create(EvalStatusSchema, {
    digest,
    caseCount: summary.caseCount,
    caseTags: [...summary.caseTags],
    cases: summary.cases.map((c) =>
      create(EvalCaseSummarySchema, {
        caseName: c.name,
        path: c.dir,
        caseTags: [...c.tags],
        unsupported: c.unsupported ?? "",
      }),
    ),
    findings: summary.findings.map((finding) =>
      create(EvalFindingSchema, {
        kind: finding.kind,
        message: finding.message,
        path: finding.path,
      }),
    ),
    mockServers: suite.servers.slice(0, EVAL_MAX_LISTED_MOCK_SERVERS),
  });
}

/**
 * ArchiveCurrentEval — the shared versioning step bound to the eval's
 * digest and its tag, the skill's discipline: the tag lives in the audit
 * column and is moved there by the single-holder assignment, and a
 * version already archived shows the tag it holds when the push named
 * none.
 */
export function newArchiveCurrentEvalStep(
  store: Store,
  logger: Logger,
): PipelineStep<PushDesc> {
  return newArchiveCurrentVersionStep<typeof EvalSchema, PushDesc>(store, logger, {
    stepName: "ArchiveCurrentEval",
    resourceKey: PUSHED_RESOURCE_KEY,
    schema: EvalSchema,
    noun: EVAL_NOUN,
    headHashOf: (head) => head.status?.digest ?? "",
    clearHeadHash: (head) => {
      head.status!.digest = "";
      if (head.metadata?.version !== undefined) {
        head.metadata.version.id = "";
      }
    },
    liveTagOf: (head) => head.spec?.tag ?? "",
    clearLiveTag: (head) => {
      if (head.spec !== undefined) {
        head.spec.tag = "";
      }
    },
    showArchivedTag: (head, tag) => {
      head.spec ??= create(EvalSpecSchema, {});
      head.spec.tag = tag;
    },
  });
}
