/**
 * Plugin push pipeline — the steps that turn a PushPluginRequest into an
 * installed plugin, in two chains the controller runs back to back over
 * one request context:
 *
 *   plan:    Authorize → ValidateProto → ResolveArtifactSource →
 *            GateAndHashArchive → ReadPluginPackage → BuildInitialPlugin →
 *            FindExistingBySlug → GenerateIDIfNeeded → ParseOverlayDocuments →
 *            SanitizePluginMetadata → PlanMaterialization →
 *            GuardPluginVisibility → ResolveConvergence
 *   install: CheckAndStoreArtifact → PopulatePluginFields →
 *            ArchiveCurrentPlugin → StorePlugin (INSTALLING) →
 *            MaterializeMembers → RemoveDroppedMembers →
 *            FinalizePluginStatus → StorePlugin → PluginPushAuthorizationTuples →
 *            IndexPluginSearch
 *
 * The split is the apply chain's shape (plan, then branch): when the plan
 * chain finds the stored plugin already converged on this archive (same
 * digest, READY, every member present and stamped with it) the controller
 * returns the head and the install chain never runs, so a re-push writes
 * nothing. Everything that can refuse — the archive, the package, the
 * overlay, a reserved label, a held slug (unless it is system content the
 * plugin replaces, which is adopted in place: members.ts, judgeSlug), a
 * missing permission, the level — refuses in the plan chain BEFORE any
 * write; the install chain's own
 * failures are a child's, wrapped with the plugin's name, and leave a head
 * that says FAILED so the next push of the same archive converges.
 *
 * Skill push is the precedent (domain/skill/push.ts): content addressing,
 * repoint-never-duplicate, the audit tag as the single holder, non-
 * transactional materialisation that a retry converges. What is a
 * plugin's: the library reads the package, the plan is checked whole
 * before the first child write, and every child is written through the
 * in-process lane as the installing caller.
 *
 * Proven by __tests__/plugin.test.ts (composed-server round-trips) and the
 * plugin conformance suite.
 */
import { create } from "@bufbuild/protobuf";

import type { PluginFinding, PluginPackage } from "@stigmer/plugin-package";
import { readPluginPackage } from "@stigmer/plugin-package";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PushPluginRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import {
  PluginAuthorSchema,
  PluginDialect,
  PluginSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/spec_pb";
import {
  PluginMaterializationSchema,
  PluginState,
  PluginStatusSchema,
  PluginWarningSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { PluginWarning } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  ApiResourceMetadataSchema,
  ApiResourceMetadataVersionSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { Code, ConnectError } from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";
import type { ContentAddressedArchiveStore } from "../../archive/content-store.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import {
  defaultVisibilityFor,
  getIdPrefix,
} from "../../pipeline/apiresource-meta.js";
import {
  alreadyExistsError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import {
  diffVisibilityShapes,
  resolveResourceCreatedEvent,
} from "../../pipeline/steps/authorization-tuples.js";
import {
  generateId,
  setAuditFieldsForCreate,
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { ARTIFACT_BYTES_KEY } from "../../pipeline/steps/resolve-artifact-source.js";
import { generateSlug } from "../../pipeline/steps/slug.js";
import { rejectUnsupportedVisibility } from "../../pipeline/steps/validate-visibility.js";
import { newArchiveCurrentVersionStep } from "../../pipeline/steps/version-archive.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { openPluginArchive } from "./archive.js";
import { SERVER_WARNING_KINDS, VERSION_TAG_PATTERN } from "./constants.js";
import type { OpenedPluginArchive } from "./archive.js";
import type { PluginIdentity } from "./materialize/identity.js";
import { McpServerOverlayError } from "./materialize/mcp-servers.js";
import { planMaterialization } from "./materialize/plan.js";
import type { MaterializationPlan } from "./materialize/plan.js";
import type { PluginMaterializerProvider } from "./materialize/ports.js";
import {
  droppedMembers,
  findMembers,
  judgeSlug,
  membersConverge,
  slugHolder,
} from "./members.js";
import type { Member, PlannedMember } from "./members.js";
import { parseOverlays } from "./overlay/documents.js";
import type { ParsedOverlays } from "./overlay/documents.js";
import { OverlayParseError } from "./overlay/parse.js";
import { sanitizeOverlays } from "./overlay/sanitize.js";
import { pluginSearchExtractor } from "./search-extractor.js";

type PushDesc = typeof PushPluginRequestSchema;

// Context keys for the push operation.
export const PLUGIN_KEY = "plugin";
export const PLUGIN_ARCHIVE_KEY = "pluginArchive";
export const PLUGIN_PACKAGE_KEY = "pluginPackage";
export const PLUGIN_LIBRARY_WARNINGS_KEY = "pluginLibraryWarnings";
export const EXISTING_PLUGIN_KEY = "existingPlugin";
export const SHOULD_CREATE_PLUGIN_KEY = "shouldCreatePlugin";
export const PLUGIN_OVERLAYS_KEY = "pluginOverlays";
export const PLUGIN_PLAN_KEY = "pluginPlan";
export const EXISTING_MEMBERS_KEY = "pluginExistingMembers";
export const PLUGIN_CONVERGED_KEY = "pluginConverged";
export const ARTIFACT_STORAGE_KEY_KEY = "artifactStorageKey";

/**
 * GateAndHashArchive — the ZIP gate over the shared archive plumbing:
 * size ceiling, hash, prefilter, structural budgets, and the lazy reader
 * the library reads through. Every gate failure is one InvalidArgument arm.
 */
export function newGateAndHashArchiveStep(): PipelineStep<PushDesc> {
  return {
    name: "GateAndHashArchive",
    execute(ctx: RequestContext<PushDesc>): void {
      const bytes = ctx.get(ARTIFACT_BYTES_KEY) as Uint8Array;
      let archive: OpenedPluginArchive;
      try {
        archive = openPluginArchive(bytes);
      } catch (error) {
        throw invalidArgumentError(
          `failed to read plugin archive: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      ctx.set(PLUGIN_ARCHIVE_KEY, archive);
    },
  };
}

/**
 * ReadPluginPackage — the library reads the package; a refusal lists every
 * problem in the sentences `stigmer validate -f` prints, so an author who
 * skipped the offline check reads the same words here.
 */
export function newReadPluginPackageStep(): PipelineStep<PushDesc> {
  return {
    name: "ReadPluginPackage",
    execute(ctx: RequestContext<PushDesc>): void {
      const archive = ctx.get(PLUGIN_ARCHIVE_KEY) as OpenedPluginArchive;
      let outcome;
      try {
        outcome = readPluginPackage(archive.files);
      } catch (error) {
        // The reader's own throw: an entry that failed to inflate.
        throw invalidArgumentError(
          `failed to read plugin archive: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!outcome.ok) {
        const count = outcome.errors.length;
        throw invalidArgumentError(
          `plugin cannot be installed, ${count} problem${count === 1 ? "" : "s"} found:\n` +
            outcome.errors
              .map((finding) => `  - ${finding.message}`)
              .join("\n"),
        );
      }
      ctx.set(PLUGIN_PACKAGE_KEY, outcome.plugin);
      ctx.set(PLUGIN_LIBRARY_WARNINGS_KEY, outcome.warnings);
    },
  };
}

/**
 * BuildInitialPlugin — the scaffold: org from the request, name and slug
 * from the manifest. The id and every status field come later.
 */
export function newBuildInitialPluginStep(): PipelineStep<PushDesc> {
  return {
    name: "BuildInitialPlugin",
    execute(ctx: RequestContext<PushDesc>): void {
      const pkg = ctx.get(PLUGIN_PACKAGE_KEY) as PluginPackage;
      const slug = generateSlug(pkg.name);
      if (slug === "") {
        throw invalidArgumentError(`invalid plugin name: ${pkg.name}`);
      }
      const plugin = create(PluginSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Plugin",
        metadata: create(ApiResourceMetadataSchema, {
          org: ctx.input.org,
          name: pkg.name,
          slug,
        }),
        spec: create(PluginSpecSchema, {}),
        status: create(PluginStatusSchema, {}),
      });
      ctx.set(PLUGIN_KEY, plugin);
    },
  };
}

/** FindExistingBySlug — push is upsert-by-slug: an existing plugin's id is adopted. */
export function newFindExistingPluginBySlugStep(
  store: Store,
): PipelineStep<PushDesc> {
  return {
    name: "FindExistingBySlug",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const plugin = ctx.get(PLUGIN_KEY) as Plugin;
      let existing: Plugin | undefined;
      try {
        existing = await findResourceBySlug(
          store,
          ctx.apiResourceKind,
          PluginSchema,
          plugin.metadata!.slug,
          plugin.metadata!.org,
        );
      } catch (error) {
        throw internalError(error, "failed to search for existing plugin");
      }
      if (existing !== undefined) {
        plugin.metadata!.id = existing.metadata!.id;
        ctx.set(EXISTING_PLUGIN_KEY, existing);
        ctx.set(SHOULD_CREATE_PLUGIN_KEY, false);
      } else {
        ctx.set(EXISTING_PLUGIN_KEY, undefined);
        ctx.set(SHOULD_CREATE_PLUGIN_KEY, true);
      }
    },
  };
}

/** GenerateIDIfNeeded — plg_{ulid} for new plugins; upgrades keep theirs. */
export function newGeneratePluginIdIfNeededStep(): PipelineStep<PushDesc> {
  return {
    name: "GenerateIDIfNeeded",
    execute(ctx: RequestContext<PushDesc>): void {
      const plugin = ctx.get(PLUGIN_KEY) as Plugin;
      if (ctx.get(SHOULD_CREATE_PLUGIN_KEY) as boolean) {
        plugin.metadata!.id = generateId(getIdPrefix(ctx.apiResourceKind));
      }
    },
  };
}

/** ParseOverlayDocuments — the `ai.stigmer/` documents become protos, strictly. */
export function newParseOverlayDocumentsStep(): PipelineStep<PushDesc> {
  return {
    name: "ParseOverlayDocuments",
    execute(ctx: RequestContext<PushDesc>): void {
      const pkg = ctx.get(PLUGIN_PACKAGE_KEY) as PluginPackage;
      try {
        ctx.set(PLUGIN_OVERLAYS_KEY, parseOverlays(pkg.overlay, ctx.input.org));
      } catch (error) {
        if (error instanceof OverlayParseError) {
          throw invalidArgumentError(error.message);
        }
        throw error;
      }
    },
  };
}

/** SanitizePluginMetadata — what an overlay author may not say (overlay/sanitize.ts). */
export function newSanitizePluginMetadataStep(
  authorizer: Authorizer,
): PipelineStep<PushDesc> {
  return {
    name: "SanitizePluginMetadata",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const pkg = ctx.get(PLUGIN_PACKAGE_KEY) as PluginPackage;
      const overlays = ctx.get(PLUGIN_OVERLAYS_KEY) as ParsedOverlays;
      await sanitizeOverlays(
        overlays,
        { pluginName: pkg.name },
        authorizer,
        ctx.callerIdentity,
      );
    },
  };
}

/**
 * The create permission each member kind's own chain will evaluate for the
 * caller, checked here first so a missing one is a sentence before any
 * write. MCP server create carries `is_skip_authorization` in its
 * contract (mcpserver/v1/command.proto), so it has no row.
 */
const MEMBER_CREATE_PERMISSIONS: ReadonlyMap<ApiResourceKind, IamPermission> =
  new Map([
    [ApiResourceKind.skill, IamPermission.can_create_skill],
    [ApiResourceKind.agent, IamPermission.can_create_agent],
    [ApiResourceKind.workflow, IamPermission.can_create_workflow],
  ]);

/** The plugin as its members see it, from the head and the archive. */
export function identityOf(
  plugin: Plugin,
  digest: string,
  visibility: ApiResourceVisibility,
): PluginIdentity {
  return {
    org: plugin.metadata!.org,
    id: plugin.metadata!.id,
    slug: plugin.metadata!.slug,
    name: plugin.metadata!.name,
    digest,
    visibility,
  };
}

/** The level this push installs at: the request's, or the kind's default. */
export function requestedVisibility(
  ctx: RequestContext<PushDesc>,
): ApiResourceVisibility {
  return ctx.input.visibility ===
    ApiResourceVisibility.api_resource_visibility_unspecified
    ? defaultVisibilityFor(ctx.apiResourceKind)
    : ctx.input.visibility;
}

/**
 * PlanMaterialization — everything the push will write, checked whole:
 * every child slug against the organization (free, ours, adopted system
 * content, or refused naming the holder), the caller's permission for
 * every member kind, and the plugin's current members for the convergence
 * and drop decisions. An adopted slug is recorded as a warning on the plan,
 * so the install receipt says which rows the plugin took over.
 */
export function newPlanMaterializationStep(
  store: Store,
  authorizer: Authorizer,
): PipelineStep<PushDesc> {
  return {
    name: "PlanMaterialization",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const plugin = ctx.get(PLUGIN_KEY) as Plugin;
      const pkg = ctx.get(PLUGIN_PACKAGE_KEY) as PluginPackage;
      const archive = ctx.get(PLUGIN_ARCHIVE_KEY) as OpenedPluginArchive;
      const overlays = ctx.get(PLUGIN_OVERLAYS_KEY) as ParsedOverlays;
      const identity = identityOf(
        plugin,
        archive.digest,
        requestedVisibility(ctx),
      );

      let plan: MaterializationPlan;
      try {
        plan = planMaterialization(
          pkg,
          archive.files,
          overlays,
          identity,
          ctx.input.message,
        );
      } catch (error) {
        if (error instanceof McpServerOverlayError) {
          throw invalidArgumentError(error.message);
        }
        throw error;
      }

      const adopted: PluginWarning[] = [];
      for (const member of plan.members) {
        let holder;
        try {
          holder = await slugHolder(store, member, identity.org);
        } catch (error) {
          throw internalError(error, "failed to check a member slug");
        }
        const decision = judgeSlug(holder, member, identity.id);
        const noun = memberNoun(member.kind);
        switch (decision.kind) {
          case "free":
          case "ours":
            break;
          case "adopt":
            adopted.push(
              create(PluginWarningSchema, {
                kind: SERVER_WARNING_KINDS.memberAdopted,
                path: declaringDocumentOf(overlays, member),
                message:
                  `${noun} '${member.slug}' (${decision.holder.id}) was seeded by the platform before this plugin and is now managed by it; ` +
                  "its definition is the plugin's, and its instances and conversations continue",
              }),
            );
            break;
          case "held-unmanaged":
            throw alreadyExistsError(
              noun,
              `'${member.slug}' exists in org '${identity.org}' and is not managed by a plugin; rename or delete it first`,
            );
          case "held-by-plugin":
            throw alreadyExistsError(
              noun,
              `'${member.slug}' is held by plugin '${await pluginSlugOf(store, decision.pluginId)}'`,
            );
          default: {
            const exhaustive: never = decision;
            throw internalError(
              new Error(`unknown slug decision ${JSON.stringify(exhaustive)}`),
              "failed to check a member slug",
            );
          }
        }
      }

      const missing: string[] = [];
      for (const kind of new Set(plan.members.map((member) => member.kind))) {
        const permission = MEMBER_CREATE_PERMISSIONS.get(kind);
        if (permission === undefined) {
          continue;
        }
        let decision;
        try {
          decision = await authorizer.authorize(ctx.callerIdentity, {
            permission,
            resourceKind: ApiResourceKind.organization,
            resourceId: identity.org,
          });
        } catch (error) {
          throw internalError(
            error,
            "plugin install authorization could not be completed",
          );
        }
        switch (decision.kind) {
          case "allow":
            break;
          case "deny":
          case "not-found":
            missing.push(IamPermission[permission] ?? String(permission));
            break;
          case "unavailable":
            throw internalError(
              decision.cause,
              "plugin install authorization could not be completed",
            );
          default: {
            const exhaustive: never = decision;
            throw internalError(
              new Error(`unknown decision ${JSON.stringify(exhaustive)}`),
              "plugin install authorization could not be completed",
            );
          }
        }
      }
      if (missing.length > 0) {
        throw new ConnectError(
          `installing plugin '${identity.slug}' needs ${missing.join(", ")} in organization '${identity.org}'`,
          Code.PermissionDenied,
        );
      }

      let members: Member[];
      try {
        members = await findMembers(store, identity.id, identity.org);
      } catch (error) {
        throw internalError(error, "failed to list plugin members");
      }
      // An adoption is something this push noticed and did not refuse, so it
      // rides the plan's warnings onto the install receipt like the rest.
      ctx.set(PLUGIN_PLAN_KEY, {
        ...plan,
        warnings: [...plan.warnings, ...adopted],
      } satisfies MaterializationPlan);
      ctx.set(EXISTING_MEMBERS_KEY, members);
    },
  };
}

/**
 * GuardPluginVisibility — the requested level must be one the plugin and
 * every planned member kind support: the push chain's counterpart of the
 * ValidateVisibility step on the resource create chains, asked here for
 * the head and for each member kind before anything is written, so a
 * plugin cannot be installed at a level one of its members may not hold.
 * Each member's own chain checks again in-process; refusing here keeps the
 * head from being written before the answer is known.
 */
export function newGuardPluginVisibilityStep(): PipelineStep<PushDesc> {
  return {
    name: "GuardPluginVisibility",
    execute(ctx: RequestContext<PushDesc>): void {
      const level = requestedVisibility(ctx);
      const plan = ctx.get(PLUGIN_PLAN_KEY) as MaterializationPlan;
      rejectUnsupportedVisibility(ctx.apiResourceKind, level);
      for (const kind of new Set(plan.members.map((member) => member.kind))) {
        rejectUnsupportedVisibility(kind, level);
      }
    },
  };
}

/**
 * ResolveConvergence — the no-op decision: the stored plugin already IS
 * this archive when its digest matches, it is READY, and every planned
 * member exists stamped with the digest. Anything less installs.
 */
export function newResolveConvergenceStep(): PipelineStep<PushDesc> {
  return {
    name: "ResolveConvergence",
    execute(ctx: RequestContext<PushDesc>): void {
      const existing = ctx.get(EXISTING_PLUGIN_KEY) as Plugin | undefined;
      const archive = ctx.get(PLUGIN_ARCHIVE_KEY) as OpenedPluginArchive;
      const plan = ctx.get(PLUGIN_PLAN_KEY) as MaterializationPlan;
      const members = ctx.get(EXISTING_MEMBERS_KEY) as Member[];
      const converged =
        existing !== undefined &&
        existing.status?.digest === archive.digest &&
        existing.status.state === PluginState.READY &&
        (existing.metadata?.visibility ??
          ApiResourceVisibility.api_resource_visibility_unspecified) ===
          requestedVisibility(ctx) &&
        membersConverge(members, plan.members, archive.digest);
      ctx.set(PLUGIN_CONVERGED_KEY, converged);
    },
  };
}

/** CheckAndStoreArtifact — content-addressed dedupe: same digest reuses the stored copy. */
export function newCheckAndStoreArtifactStep(
  artifactStorage: ContentAddressedArchiveStore,
): PipelineStep<PushDesc> {
  return {
    name: "CheckAndStoreArtifact",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const bytes = ctx.get(ARTIFACT_BYTES_KEY) as Uint8Array;
      const archive = ctx.get(PLUGIN_ARCHIVE_KEY) as OpenedPluginArchive;
      let exists: boolean;
      try {
        exists = await artifactStorage.exists(archive.digest);
      } catch (error) {
        throw internalError(error, "failed to check artifact existence");
      }
      let storageKey: string;
      if (exists) {
        storageKey = artifactStorage.getStorageKey(archive.digest);
      } else {
        try {
          storageKey = await artifactStorage.store(archive.digest, bytes);
        } catch (error) {
          throw internalError(error, "failed to store artifact");
        }
      }
      ctx.set(ARTIFACT_STORAGE_KEY_KEY, storageKey);
    },
  };
}

/**
 * PopulatePluginFields — the manifest into the spec, the archive identity
 * and INSTALLING into the status, the level, the metadata.version chain,
 * and the audit stamping discipline: creates stamp both slots; updates copy
 * the loaded head's slot pointers and stamp spec_audit only (a push is a
 * definition change; the helper sets a fresh spec_audit, never mutating
 * the copied pointer, #540).
 */
export function newPopulatePluginFieldsStep(): PipelineStep<PushDesc> {
  return {
    name: "PopulatePluginFields",
    execute(ctx: RequestContext<PushDesc>): void {
      const plugin = ctx.get(PLUGIN_KEY) as Plugin;
      const pkg = ctx.get(PLUGIN_PACKAGE_KEY) as PluginPackage;
      const archive = ctx.get(PLUGIN_ARCHIVE_KEY) as OpenedPluginArchive;
      const storageKey = ctx.get(ARTIFACT_STORAGE_KEY_KEY) as string;
      const shouldCreate = ctx.get(SHOULD_CREATE_PLUGIN_KEY) as boolean;
      const existing = ctx.get(EXISTING_PLUGIN_KEY) as Plugin | undefined;

      plugin.spec = create(PluginSpecSchema, {
        name: pkg.name,
        version: pkg.version ?? "",
        description: pkg.description ?? "",
        homepage: pkg.homepage ?? "",
        repository: pkg.repository ?? "",
        license: pkg.license ?? "",
        keywords: [...pkg.keywords],
        dialect: dialectOf(pkg.dialect),
      });
      if (pkg.author !== undefined) {
        plugin.spec.author = create(PluginAuthorSchema, {
          name: pkg.author.name ?? "",
          email: pkg.author.email ?? "",
          url: pkg.author.url ?? "",
        });
      }

      plugin.metadata!.visibility = requestedVisibility(ctx);
      plugin.metadata!.version = create(ApiResourceMetadataVersionSchema, {
        id: archive.digest,
        message: ctx.input.message,
        previousVersionId: existing?.status?.digest ?? "",
      });

      const status = plugin.status!;
      status.digest = archive.digest;
      status.artifactStorageKey = storageKey;
      status.state = PluginState.INSTALLING;
      status.error = "";

      if (shouldCreate) {
        setAuditFieldsForCreate(PluginSchema, plugin, ctx.callerIdentity);
      } else {
        if (existing?.status?.audit !== undefined) {
          status.audit ??= create(ApiResourceAuditSchema, {});
          status.audit.specAudit = existing.status.audit.specAudit;
          status.audit.statusAudit = existing.status.audit.statusAudit;
        }
        setAuditFieldsForUpdate(
          PluginSchema,
          plugin,
          "spec_audit",
          ctx.callerIdentity,
        );
      }
    },
  };
}

/**
 * ArchiveCurrentPlugin — the shared versioning step bound to the plugin's
 * digest and tag. The live tag IS the manifest version when it fits the
 * tag pattern (the plan already warned when it does not), so the
 * single-holder assignment and the getByReference ladder read one fact;
 * the version is the manifest's word and is never cleared, so a failed
 * tag assignment degrades to "reachable by digest" without touching the
 * spec.
 */
export function newArchiveCurrentPluginStep(
  store: Store,
  logger: Logger,
): PipelineStep<PushDesc> {
  return newArchiveCurrentVersionStep<typeof PluginSchema, PushDesc>(
    store,
    logger,
    {
      stepName: "ArchiveCurrentPlugin",
      resourceKey: PLUGIN_KEY,
      schema: PluginSchema,
      noun: "plugin",
      headHashOf: (plugin) => plugin.status?.digest ?? "",
      clearHeadHash: (plugin) => {
        plugin.status!.digest = "";
        if (plugin.metadata?.version !== undefined) {
          plugin.metadata.version.id = "";
        }
      },
      liveTagOf: pluginLiveTag,
      clearLiveTag: () => undefined,
    },
  );
}

/** The tag a plugin head claims: its manifest version when the pattern admits it. */
export function pluginLiveTag(plugin: Plugin): string {
  const version = plugin.spec?.version ?? "";
  return VERSION_TAG_PATTERN.test(version) ? version : "";
}

/** StorePlugin — persists the head; runs twice, before and after materialisation. */
export function newStorePluginStep(
  store: Store,
  stepName: string,
): PipelineStep<PushDesc> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const plugin = ctx.get(PLUGIN_KEY) as Plugin;
      try {
        await store.saveResource(
          ctx.apiResourceKind,
          plugin.metadata!.id,
          PluginSchema,
          plugin,
        );
      } catch (error) {
        throw internalError(error, "failed to save plugin");
      }
    },
  };
}

/**
 * MaterializeMembers — skills, MCP servers, the agent, workflows, each
 * through the in-process lane as the installing caller, in the order
 * references resolve. An existing member whose level differs from the
 * plugin's is moved through its kind's updateVisibility afterwards (apply
 * preserves a stored level by contract). A child failure records FAILED on
 * the head, persists it, and fails the request with the plugin named.
 */
export function newMaterializeMembersStep(
  store: Store,
  materializerProvider: PluginMaterializerProvider,
  logger: Logger,
): PipelineStep<PushDesc> {
  return {
    name: "MaterializeMembers",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const plugin = ctx.get(PLUGIN_KEY) as Plugin;
      const plan = ctx.get(PLUGIN_PLAN_KEY) as MaterializationPlan;
      const materializer = materializerProvider();
      const caller = ctx.callerIdentity;
      const level = requestedVisibility(ctx);

      const reconcileLevel = async (
        kind: ApiResourceKind,
        applied: {
          readonly metadata?: {
            readonly id: string;
            readonly visibility: ApiResourceVisibility;
          };
        },
      ): Promise<void> => {
        const metadata = applied.metadata;
        if (metadata !== undefined && metadata.visibility !== level) {
          await materializer.updateVisibility(kind, metadata.id, level, caller);
        }
      };

      const materialize = async <T>(
        kind: ApiResourceKind,
        slug: string,
        write: () => Promise<T>,
      ): Promise<T> => {
        try {
          return await write();
        } catch (error) {
          throw await recordFailure(store, ctx, plugin, kind, slug, error);
        }
      };

      for (const skill of plan.skills) {
        const pushed = await materialize(
          ApiResourceKind.skill,
          skill.slug,
          () => materializer.pushSkill(skill.request, caller),
        );
        await materialize(ApiResourceKind.skill, skill.slug, () =>
          reconcileLevel(ApiResourceKind.skill, pushed),
        );
      }
      for (const server of plan.mcpServers) {
        const applied = await materialize(
          ApiResourceKind.mcp_server,
          server.slug,
          () => materializer.applyMcpServer(server.resource, caller),
        );
        await materialize(ApiResourceKind.mcp_server, server.slug, () =>
          reconcileLevel(ApiResourceKind.mcp_server, applied),
        );
      }
      if (plan.agent !== undefined) {
        const agent = plan.agent;
        const applied = await materialize(
          ApiResourceKind.agent,
          agent.slug,
          () => materializer.applyAgent(agent.resource, caller),
        );
        await materialize(ApiResourceKind.agent, agent.slug, () =>
          reconcileLevel(ApiResourceKind.agent, applied),
        );
      }
      for (const workflow of plan.workflows) {
        const applied = await materialize(
          ApiResourceKind.workflow,
          workflow.slug,
          () => materializer.applyWorkflow(workflow.resource, caller),
        );
        await materialize(ApiResourceKind.workflow, workflow.slug, () =>
          reconcileLevel(ApiResourceKind.workflow, applied),
        );
      }

      logger.info("Materialized plugin members", {
        pluginId: plugin.metadata!.id,
        skills: plan.skills.length,
        mcpServers: plan.mcpServers.length,
        agents: plan.agent === undefined ? 0 : 1,
        workflows: plan.workflows.length,
      });
    },
  };
}

/**
 * RemoveDroppedMembers — an upgrade whose archive no longer names a member
 * deletes it through the member's own delete chain (agent first, so a
 * workflow or a user's own resource still referencing it is judged by
 * that chain, then the rest in reverse materialisation order).
 */
export function newRemoveDroppedMembersStep(
  store: Store,
  materializerProvider: PluginMaterializerProvider,
  logger: Logger,
): PipelineStep<PushDesc> {
  return {
    name: "RemoveDroppedMembers",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const plugin = ctx.get(PLUGIN_KEY) as Plugin;
      const plan = ctx.get(PLUGIN_PLAN_KEY) as MaterializationPlan;
      const existing = ctx.get(EXISTING_MEMBERS_KEY) as Member[];
      const dropped = droppedMembers(existing, plan.members);
      if (dropped.length === 0) {
        return;
      }
      const materializer = materializerProvider();
      for (const member of orderForDeletion(dropped)) {
        try {
          await materializer.deleteByKind(
            member.kind,
            member.id,
            ctx.callerIdentity,
          );
        } catch (error) {
          throw await recordFailure(
            store,
            ctx,
            plugin,
            member.kind,
            member.slug,
            error,
            "remove",
          );
        }
      }
      logger.info("Removed members the new archive dropped", {
        pluginId: plugin.metadata!.id,
        dropped: dropped.map(
          (member) => `${ApiResourceKind[member.kind]}:${member.slug}`,
        ),
      });
    },
  };
}

/** Cascade order: the agent first (it references the rest), then reverse materialisation order. */
export function orderForDeletion(members: readonly Member[]): Member[] {
  const rank = new Map<ApiResourceKind, number>([
    [ApiResourceKind.agent, 0],
    [ApiResourceKind.workflow, 1],
    [ApiResourceKind.mcp_server, 2],
    [ApiResourceKind.skill, 3],
  ]);
  return [...members].sort(
    (a, b) => (rank.get(a.kind) ?? 9) - (rank.get(b.kind) ?? 9),
  );
}

/**
 * FinalizePluginStatus — the install receipt: counts, every warning (the
 * library's and the plan's), READY.
 */
export function newFinalizePluginStatusStep(): PipelineStep<PushDesc> {
  return {
    name: "FinalizePluginStatus",
    execute(ctx: RequestContext<PushDesc>): void {
      const plugin = ctx.get(PLUGIN_KEY) as Plugin;
      const plan = ctx.get(PLUGIN_PLAN_KEY) as MaterializationPlan;
      const libraryWarnings = ctx.get(
        PLUGIN_LIBRARY_WARNINGS_KEY,
      ) as readonly PluginFinding[];
      const status = plugin.status!;
      status.state = PluginState.READY;
      status.error = "";
      status.materialized = create(PluginMaterializationSchema, {
        skills: plan.skills.length,
        mcpServers: plan.mcpServers.length,
        agents: plan.agent === undefined ? 0 : 1,
        workflows: plan.workflows.length,
      });
      status.warnings = [
        ...libraryWarnings.map((finding) =>
          create(PluginWarningSchema, {
            kind: finding.kind,
            message: finding.message,
            path: finding.path ?? "",
          }),
        ),
        ...plan.warnings,
      ];
    },
  };
}

/**
 * PluginPushAuthorizationTuples — the tuple-lifecycle splice for the push
 * lane, the skill push's shape: a genuine create fires the creation event;
 * a re-push diffs the stored level against the pushed head.
 */
export function newPluginPushAuthorizationTuplesStep(
  lifecycle: ResourceAuthorizationLifecycle | undefined,
  logger: Logger,
): PipelineStep<PushDesc> {
  return {
    name: "PluginPushAuthorizationTuples",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      if (lifecycle === undefined) {
        return;
      }
      const plugin = ctx.get(PLUGIN_KEY) as Plugin;
      if (ctx.get(SHOULD_CREATE_PLUGIN_KEY) as boolean) {
        const event = resolveResourceCreatedEvent(
          ctx.apiResourceKind,
          plugin,
          ctx.callerIdentity,
          logger,
        );
        if (event === undefined) {
          return;
        }
        try {
          await lifecycle.onResourceCreated(event);
        } catch (error) {
          throw internalError(error, "failed to create authorization tuples");
        }
        return;
      }
      const existing = ctx.get(EXISTING_PLUGIN_KEY) as Plugin | undefined;
      const oldLevel =
        existing?.metadata?.visibility ??
        ApiResourceVisibility.api_resource_visibility_unspecified;
      const newLevel =
        plugin.metadata?.visibility ??
        ApiResourceVisibility.api_resource_visibility_unspecified;
      const { shapesToCreate, shapesToDelete } = diffVisibilityShapes(
        ctx.apiResourceKind,
        oldLevel,
        newLevel,
      );
      if (shapesToCreate.length === 0 && shapesToDelete.length === 0) {
        return;
      }
      try {
        await lifecycle.onVisibilityChanged({
          kind: ctx.apiResourceKind,
          resourceId: plugin.metadata?.id ?? "",
          orgId: plugin.metadata?.org ?? "",
          shapesToCreate,
          shapesToDelete,
        });
      } catch (error) {
        throw internalError(error, "failed to update visibility tuples");
      }
    },
  };
}

/** IndexPluginSearch — search-index upsert, best-effort by contract. */
export function newIndexPluginSearchStep(
  store: Store,
  logger: Logger,
): PipelineStep<PushDesc> {
  return {
    name: "IndexPluginSearch",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const plugin = ctx.get(PLUGIN_KEY) as Plugin;
      const entry = pluginSearchExtractor.getSearchIndexEntry(plugin);
      if (entry === undefined) {
        return;
      }
      try {
        await store.upsertSearchIndex(
          ctx.apiResourceKind,
          plugin.metadata!.id,
          entry,
        );
      } catch (error) {
        logger.warn(
          "IndexPluginSearch: failed to update search index (best-effort)",
          {
            id: plugin.metadata?.id ?? "",
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────

const MEMBER_NOUNS: ReadonlyMap<ApiResourceKind, string> = new Map([
  [ApiResourceKind.skill, "skill"],
  [ApiResourceKind.mcp_server, "MCP server"],
  [ApiResourceKind.agent, "agent"],
  [ApiResourceKind.workflow, "workflow"],
]);

function memberNoun(kind: ApiResourceKind): string {
  return MEMBER_NOUNS.get(kind) ?? ApiResourceKind[kind] ?? String(kind);
}

/**
 * The overlay document that declared an adopted member, for the warning's
 * path: only an overlay can carry the system label, so a skill (whose
 * request carries the plugin's labels alone) never reaches this.
 */
function declaringDocumentOf(
  overlays: ParsedOverlays,
  member: PlannedMember,
): string {
  switch (member.kind) {
    case ApiResourceKind.agent:
      return overlays.agent?.path ?? "";
    case ApiResourceKind.mcp_server:
      return (
        overlays.mcpServers.find((document) => document.server === member.name)
          ?.path ?? ""
      );
    case ApiResourceKind.workflow:
      return (
        overlays.workflows.find((document) => document.name === member.name)
          ?.path ?? ""
      );
    default:
      return "";
  }
}

/** The holding plugin's slug for a refusal; a dangling id names itself. */
async function pluginSlugOf(store: Store, pluginId: string): Promise<string> {
  try {
    const plugin = await store.getResource(
      ApiResourceKind.plugin,
      pluginId,
      PluginSchema,
    );
    return plugin.metadata?.slug ?? pluginId;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return pluginId;
    }
    throw internalError(error, "failed to load the holding plugin");
  }
}

/**
 * A child failed: the head records FAILED with one sentence and is
 * persisted before the request fails, so `get plugin` tells the truth and
 * the next push of the same archive re-materialises.
 */
async function recordFailure(
  store: Store,
  ctx: RequestContext<PushDesc>,
  plugin: Plugin,
  kind: ApiResourceKind,
  slug: string,
  error: unknown,
  verb: "materialize" | "remove" = "materialize",
): Promise<ConnectError> {
  const cause =
    error instanceof ConnectError
      ? error.rawMessage
      : error instanceof Error
        ? error.message
        : String(error);
  const sentence = `failed to ${verb} ${memberNoun(kind)} '${slug}' from plugin '${plugin.metadata?.slug ?? ""}': ${cause}`;
  const status = plugin.status!;
  status.state = PluginState.FAILED;
  status.error = sentence;
  try {
    await store.saveResource(
      ctx.apiResourceKind,
      plugin.metadata!.id,
      PluginSchema,
      plugin,
    );
  } catch {
    // The original failure is the one the caller must hear; a second
    // failure persisting the receipt would only hide it.
  }
  if (error instanceof ConnectError) {
    return new ConnectError(sentence, error.code, undefined, undefined, error);
  }
  return internalError(error, sentence);
}

function dialectOf(dialect: PluginPackage["dialect"]): PluginDialect {
  switch (dialect) {
    case "agent-plugins":
      return PluginDialect.AGENT_PLUGINS;
    case "claude":
      return PluginDialect.CLAUDE;
    case "cursor":
      return PluginDialect.CURSOR;
    case "codex":
      return PluginDialect.CODEX;
    default: {
      const exhaustive: never = dialect;
      throw new Error(`unknown dialect ${String(exhaustive)}`);
    }
  }
}
