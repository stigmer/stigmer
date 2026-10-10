/**
 * Fills the status of a plugin installed before a plugin was one thing.
 * Such a plugin's status recorded only the install's lifecycle and counts
 * (fields the contract now reserves, kept as unknown fields), while its
 * skills, agents and servers lived as separate resources the store
 * migration has since removed (store/mcp-server-retired.ts). A turn reads
 * the lists from the status, so each such plugin is read again from its
 * own stored archive, exactly as install reads it (plan-status.ts and the
 * sign-in probe), and its status is rewritten with the same digest: no new
 * version, nothing else touched.
 *
 * It runs once per plugin: the rewrite drops the retired fields that mark
 * it. A plugin whose archive cannot be read or no longer reads is left as
 * it is and logged; a turn that lists it gets none of its parts, and a
 * push of the archive repairs it. Boot never fails on it.
 *
 * Tests: __tests__/legacy-status.test.ts.
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import type { OutboundFetch } from "@stigmer/outbound/egress";
import { readPluginPackage } from "@stigmer/plugin-package";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginWarningSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ContentAddressedArchiveStore } from "../../archive/content-store.js";
import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";
import { openPluginArchive } from "./archive.js";
import { planPluginStatus } from "./plan-status.js";
import { probeSignIns } from "./probe-sign-in.js";
import { evalSuiteOf } from "./evals.js";
import { hooksOf } from "./push.js";

/** The retired PluginStatus fields an install before plugins were whole always wrote (state, materialized). */
const RETIRED_STATUS_FIELDS: ReadonlySet<number> = new Set([3, 5]);

export interface LegacyStatusDeps {
  readonly store: Store;
  readonly artifactStorage: ContentAddressedArchiveStore;
  readonly outboundFetch: OutboundFetch;
  readonly logger: Logger;
}

/** Whether a stored plugin's status still has the shape installs wrote before plugins were whole. */
export function isLegacyStatus(plugin: Plugin): boolean {
  return (plugin.status?.$unknown ?? []).some((field) => RETIRED_STATUS_FIELDS.has(field.no));
}

/** Refreshes every plugin with a legacy status; returns how many were refreshed. */
export async function refreshLegacyPluginStatuses(deps: LegacyStatusDeps): Promise<number> {
  const rows = await deps.store.listResources(ApiResourceKind.plugin);
  let refreshed = 0;
  for (const raw of rows) {
    const plugin = fromBinary(PluginSchema, raw);
    if (!isLegacyStatus(plugin)) {
      continue;
    }
    try {
      await refreshOne(deps, plugin);
      refreshed++;
    } catch (error) {
      deps.logger.warn("A plugin installed before plugins were whole could not be read again; push it again to use it", {
        plugin: `${plugin.metadata?.org ?? ""}/${plugin.metadata?.slug ?? ""}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (refreshed > 0) {
    deps.logger.info("Filled the status of plugins installed before plugins were whole", { refreshed });
  }
  return refreshed;
}

async function refreshOne(deps: LegacyStatusDeps, plugin: Plugin): Promise<void> {
  const status = plugin.status;
  if (status === undefined || status.artifactStorageKey === "") {
    throw new Error("it records no archive");
  }
  const archive = openPluginArchive(await deps.artifactStorage.get(status.artifactStorageKey));
  const outcome = readPluginPackage(archive.files);
  if (!outcome.ok) {
    throw new Error(outcome.errors.map((finding) => finding.message).join("; "));
  }
  const plan = planPluginStatus(outcome.plugin, archive.files);
  const probed = await probeSignIns(deps, plan, archive.digest, undefined);
  delete status.$unknown;
  status.skills = [...plan.skills];
  status.agents = [...plan.agents];
  status.mcpServers = probed.mcpServers;
  status.env = probed.env;
  status.hooks = plan.hooks === undefined ? undefined : hooksOf(plan.hooks);
  status.evals = plan.evals === undefined ? undefined : evalSuiteOf(plan.evals);
  status.warnings = [
    ...outcome.warnings.map((finding) =>
      create(PluginWarningSchema, { kind: finding.kind, message: finding.message, path: finding.path ?? "" }),
    ),
    ...plan.warnings,
  ];
  await deps.store.saveResource(ApiResourceKind.plugin, plugin.metadata?.id ?? "", PluginSchema, plugin);
}
