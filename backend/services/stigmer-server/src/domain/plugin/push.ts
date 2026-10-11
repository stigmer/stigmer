/**
 * Plugin push pipeline — the steps that turn a PushPluginRequest into an
 * installed plugin, in two chains the controller runs back to back over
 * one request context:
 *
 *   plan:    Authorize → ValidateProto → ResolveArtifactSource →
 *            GateAndHashArchive → ReadPluginPackage → BuildInitialPlugin →
 *            FindExistingBySlug → GenerateIDIfNeeded → PlanPluginStatus →
 *            GuardPluginVisibility → ResolveConvergence
 *   install: ProbeServerSignIns → CheckAndStoreArtifact →
 *            PopulatePluginFields → ArchiveCurrentPlugin → StorePlugin →
 *            PluginPushAuthorizationTuples → IndexPluginSearch
 *
 * Install writes the plugin and nothing else: what the archive holds is
 * read into the plugin's status (plan-status.ts), and a turn that lists
 * the plugin gets every part of it, named under the plugin. So an install
 * either stores a ready plugin in one write or refuses; there is no
 * half-installed state to report or converge. Everything that can refuse
 * — the archive, the package, a server whose tool names could not be told
 * apart, a missing permission, the level — refuses in the plan chain
 * before any write. When the stored plugin already is this archive at
 * this level (same digest, same visibility), the controller returns it and
 * the install chain never runs.
 *
 * Skill push is the precedent (domain/skill/push.ts): content addressing,
 * repoint-never-duplicate, the audit tag as the single holder.
 *
 * Proven by __tests__/plugin.test.ts (composed-server round-trips) and the
 * plugin conformance suite.
 */
import { create } from "@bufbuild/protobuf";

import type { PluginFinding, PluginHooks, PluginPackage } from "@stigmer/plugin-package";
import { readPluginPackage } from "@stigmer/plugin-package";
import type { OutboundFetch } from "@stigmer/outbound/egress";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PushPluginRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import {
  PluginAuthorSchema,
  PluginDialect,
  PluginSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/spec_pb";
import {
  HookConfigSchema,
  HookFormat,
  HookGroupSchema,
  HookHandlerSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import type { HookConfig } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import {
  PluginStatusSchema,
  PluginWarningSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  ApiResourceMetadataSchema,
  ApiResourceMetadataVersionSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import type { Logger } from "../../boot/logger.js";
import type { ContentAddressedArchiveStore } from "../../archive/content-store.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import {
  defaultVisibilityFor,
  getIdPrefix,
} from "../../pipeline/apiresource-meta.js";
import {
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
import { checkDerivedSlug, generateSlug } from "../../pipeline/steps/slug.js";
import {
  refuseChildOrgsVisibilityInChild,
  rejectUnsupportedVisibility,
} from "../../pipeline/steps/validate-visibility.js";
import { newArchiveCurrentVersionStep } from "../../pipeline/steps/version-archive.js";
import type { Store } from "../../store/interface.js";
import { openPluginArchive } from "./archive.js";
import { VERSION_TAG_PATTERN } from "./constants.js";
import type { OpenedPluginArchive } from "./archive.js";
import { planPluginStatus, ServerNameError } from "./plan-status.js";
import type { PluginStatusPlan } from "./plan-status.js";
import { probeSignIns } from "./probe-sign-in.js";
import { evalSuiteOf } from "./evals.js";
import { pluginSearchExtractor } from "./search-extractor.js";

type PushDesc = typeof PushPluginRequestSchema;

// Context keys for the push operation.
export const PLUGIN_KEY = "plugin";
export const PLUGIN_ARCHIVE_KEY = "pluginArchive";
export const PLUGIN_PACKAGE_KEY = "pluginPackage";
export const PLUGIN_LIBRARY_WARNINGS_KEY = "pluginLibraryWarnings";
export const EXISTING_PLUGIN_KEY = "existingPlugin";
export const SHOULD_CREATE_PLUGIN_KEY = "shouldCreatePlugin";
export const PLUGIN_PLAN_KEY = "pluginPlan";
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
 * from the manifest. The id and every status field come later. The open
 * format admits a name (up to 64 characters, or starting with a digit)
 * whose slug no reference could hold, so the slug is held to
 * metadata.slug's rules (`checkDerivedSlug`) and such a name is refused in
 * words.
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
      checkDerivedSlug(slug, {
        from: `the plugin name '${pkg.name}'`,
        fix: "rename the plugin",
      });
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
 * PlanPluginStatus — what the archive holds, as the plugin's status will
 * list it (plan-status.ts): its skills, agents, server entries, the
 * variables they read and its hooks, with every warning the plan raised.
 * A server whose tool names could not be told apart refuses here, before
 * anything is written.
 */
export function newPlanPluginStatusStep(): PipelineStep<PushDesc> {
  return {
    name: "PlanPluginStatus",
    execute(ctx: RequestContext<PushDesc>): void {
      const pkg = ctx.get(PLUGIN_PACKAGE_KEY) as PluginPackage;
      try {
        const archive = ctx.get(PLUGIN_ARCHIVE_KEY) as OpenedPluginArchive;
        ctx.set(PLUGIN_PLAN_KEY, planPluginStatus(pkg, archive.files));
      } catch (error) {
        if (error instanceof ServerNameError) {
          throw invalidArgumentError(error.message);
        }
        throw error;
      }
    },
  };
}

/**
 * GuardPluginVisibility — the requested level must be one the plugin
 * supports, and a child organization may not share with child
 * organizations: the push chain's counterpart of the ValidateVisibility
 * step on the resource create chains, asked before anything is written.
 */
export function newGuardPluginVisibilityStep(
  store: Store,
): PipelineStep<PushDesc> {
  return {
    name: "GuardPluginVisibility",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const level = requestedVisibility(ctx);
      rejectUnsupportedVisibility(ctx.apiResourceKind, level);
      await refuseChildOrgsVisibilityInChild(store, ctx.input.org, level);
    },
  };
}

/**
 * ResolveConvergence — the no-op decision: the stored plugin already IS
 * this archive at this level when its digest and its visibility match.
 * Anything less installs.
 */
export function newResolveConvergenceStep(): PipelineStep<PushDesc> {
  return {
    name: "ResolveConvergence",
    execute(ctx: RequestContext<PushDesc>): void {
      const existing = ctx.get(EXISTING_PLUGIN_KEY) as Plugin | undefined;
      const archive = ctx.get(PLUGIN_ARCHIVE_KEY) as OpenedPluginArchive;
      const converged =
        existing !== undefined &&
        existing.status?.digest === archive.digest &&
        (existing.metadata?.visibility ??
          ApiResourceVisibility.api_resource_visibility_unspecified) ===
          requestedVisibility(ctx);
      ctx.set(PLUGIN_CONVERGED_KEY, converged);
    },
  };
}

/**
 * ProbeServerSignIns — each server at an address that says nothing about
 * authentication is asked once whether it wants a sign-in, and completed
 * when it does (probe-sign-in.ts). A re-push of the installed archive
 * reuses what the plugin already records and asks nothing.
 */
export function newProbeServerSignInsStep(deps: {
  readonly outboundFetch: OutboundFetch;
  readonly logger: Logger;
}): PipelineStep<PushDesc> {
  return {
    name: "ProbeServerSignIns",
    async execute(ctx: RequestContext<PushDesc>): Promise<void> {
      const plan = ctx.get(PLUGIN_PLAN_KEY) as PluginStatusPlan;
      const archive = ctx.get(PLUGIN_ARCHIVE_KEY) as OpenedPluginArchive;
      const existing = ctx.get(EXISTING_PLUGIN_KEY) as Plugin | undefined;
      const probed = await probeSignIns(deps, plan, archive.digest, existing?.status);
      ctx.set(PLUGIN_PLAN_KEY, { ...plan, ...probed } satisfies PluginStatusPlan);
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
 * PopulatePluginFields — the manifest into the spec; the archive identity
 * and what it holds into the status, with every warning (the library's and
 * the plan's) and the hooks recorded; the level; the metadata.version
 * chain; and the audit stamping discipline: creates stamp both slots;
 * updates copy the loaded head's slot pointers and stamp spec_audit only (a
 * push is a definition change; the helper sets a fresh spec_audit, never
 * mutating the copied pointer, #540).
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
      const plan = ctx.get(PLUGIN_PLAN_KEY) as PluginStatusPlan;
      const libraryWarnings = ctx.get(
        PLUGIN_LIBRARY_WARNINGS_KEY,
      ) as readonly PluginFinding[];

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
      status.skills = [...plan.skills];
      status.agents = [...plan.agents];
      status.mcpServers = [...plan.mcpServers];
      status.env = { ...plan.env };
      status.hooks = plan.hooks === undefined ? undefined : hooksOf(plan.hooks);
      status.evals = plan.evals === undefined ? undefined : evalSuiteOf(plan.evals);
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

/** StorePlugin — persists the plugin, the install's one write. */
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
          caller: ctx.callerIdentity,
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

/** The library's hooks in the contract's shape, field for field. */
export function hooksOf(hooks: PluginHooks): HookConfig {
  return create(HookConfigSchema, {
    format:
      hooks.format === "cursor"
        ? HookFormat.CURSOR
        : HookFormat.CLAUDE_CODE,
    groups: hooks.groups.map((group) =>
      create(HookGroupSchema, {
        event: group.event,
        matcher: group.matcher,
        handlers: group.handlers.map((handler) =>
          create(HookHandlerSchema, {
            command: handler.command,
            args: [...handler.args],
            timeoutSeconds: handler.timeoutSeconds ?? 0,
            condition: handler.condition ?? "",
            failClosed: handler.failClosed,
          }),
        ),
      }),
    ),
  });
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
