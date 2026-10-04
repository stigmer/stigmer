/**
 * ResolveAgentCallOrganizations: a workflow's `agent_call` tasks name their
 * agent and environments inside a `google.protobuf.Struct` config, where
 * the serving chain's organization-name resolver
 * (pipeline/interceptors/organization-names.ts) cannot see them. This step
 * gives those names the treatment every typed reference gets at the edge:
 * an organization named by its slug (`agent: "acme/reviewer"`, an
 * environment reference's `org: acme`) is stored by its id
 * (`org_01j9…/reviewer`). A stored reference then names the organization
 * that was meant when the workflow was saved, whatever that organization is
 * renamed to and whoever registers its old slug later.
 *
 * Only those values change; the rest of the config is stored as written.
 * What is left alone, and why:
 *   - a bare slug, which the runner resolves in the organization the
 *     workflow runs in (agent-call-references.ts, "RELATIVE");
 *   - a value holding `${`, fixed only when the task runs;
 *   - a value already shaped as an id, and a name nobody holds, which the
 *     reference rule then refuses as another organization's resource that
 *     is not available, in the same sentence it gives a held name, which
 *     names neither organization (pipeline/steps/references.ts);
 *   - a config that does not decode, which spec validation has refused.
 *
 * An organization from an earlier release is filed under its first slug,
 * so its old references resolve to that same value and are stored
 * unchanged.
 *
 * Runs after NormalizeReferences and before ValidateAgentCallReferences on
 * the workflow create and update chains, so the rule judges, and the
 * version hash covers, the stored form. Proven by
 * __tests__/agent-call-organizations.test.ts.
 */
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import type { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

import type { OrganizationNameResolver } from "../../pipeline/interceptors/organization-names.js";
import { isOrganizationId } from "../../pipeline/interceptors/organization-names.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { classifyAgentReference } from "./agent-call-references.js";
import { tryUnmarshalTaskConfig } from "./converter/unmarshal.js";
import { nestedTasks } from "./validation/task-config-constraints.js";

/** One task as this step edits it: its kind, its config as stored, and its compensation. */
interface TaskSite {
  readonly kind: WorkflowTaskKind;
  readonly config: JsonObject | undefined;
  readonly compensate: readonly TaskSite[];
}

function objectOf(value: JsonValue | undefined): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

function arrayOf(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

/** A typed task of the spec: its config object is the one the row stores. */
function siteOf(task: WorkflowTask): TaskSite {
  return {
    kind: task.kind,
    config: task.taskConfig,
    compensate: task.compensate.map(siteOf),
  };
}

/**
 * The tasks a control-flow config nests, as stored JSON, in the order
 * nestedTasks (validation/task-config-constraints.ts) yields their decoded
 * twins: `for` its `do`, `fork` each branch's `do`, `try` its `try` and
 * then its `catch.do`.
 */
function storedNestedTasks(kind: WorkflowTaskKind, config: JsonObject): JsonValue[] {
  switch (kind) {
    case WorkflowTaskKind.for_each:
      return arrayOf(config.do);
    case WorkflowTaskKind.fork:
      return arrayOf(config.branches).flatMap((branch) => arrayOf(objectOf(branch)?.do));
    case WorkflowTaskKind.try_catch:
      return [...arrayOf(config.try), ...arrayOf(objectOf(objectOf(config.catch))?.do)];
    default:
      return [];
  }
}

/** Pairs decoded nested tasks (for their kinds) with their stored JSON (for the edit). */
function nestedSites(decoded: readonly WorkflowTask[], stored: readonly JsonValue[]): TaskSite[] {
  return decoded.map((task, index) => {
    const json = objectOf(stored[index]);
    return {
      kind: task.kind,
      config: objectOf(json?.task_config ?? json?.taskConfig),
      compensate: nestedSites(task.compensate, arrayOf(json?.compensate)),
    };
  });
}

export function newResolveAgentCallOrganizationsStep(
  resolver: OrganizationNameResolver,
): PipelineStep<typeof WorkflowSchema> {
  return {
    name: "ResolveAgentCallOrganizations",
    async execute(ctx: RequestContext<typeof WorkflowSchema>): Promise<void> {
      const spec = ctx.newState.spec;
      if (spec === undefined) {
        return;
      }
      // One lookup per distinct name per write, as the serving resolver does.
      const lookups = new Map<string, Promise<string | undefined>>();
      const idOf = (org: string): Promise<string | undefined> => {
        if (isOrganizationId(org)) {
          return Promise.resolve(org);
        }
        let lookup = lookups.get(org);
        if (lookup === undefined) {
          lookup = resolver.resolve(org);
          lookups.set(org, lookup);
        }
        return lookup;
      };

      const visit = async (site: TaskSite): Promise<void> => {
        const config = site.config;
        if (config !== undefined) {
          const decoded = tryUnmarshalTaskConfig<Parameters<typeof nestedTasks>[0]>(site.kind, config);
          if (decoded !== undefined) {
            if (site.kind === WorkflowTaskKind.agent_call) {
              await resolveAgentCall(config, idOf);
            }
            for (const nested of nestedSites(nestedTasks(decoded), storedNestedTasks(site.kind, config))) {
              await visit(nested);
            }
          }
        }
        for (const compensation of site.compensate) {
          await visit(compensation);
        }
      };
      for (const task of spec.tasks) {
        await visit(siteOf(task));
      }
    },
  };
}

/** Stores the organization of an agent_call's literal agent and of its environment references by id. */
async function resolveAgentCall(
  config: JsonObject,
  idOf: (org: string) => Promise<string | undefined>,
): Promise<void> {
  const agent = config.agent;
  if (typeof agent === "string") {
    const form = classifyAgentReference(agent);
    if (form.kind === "literal") {
      const id = await idOf(form.org);
      if (id !== undefined) {
        config.agent = `${id}/${form.slug}`;
      }
    }
  }
  for (const ref of arrayOf(config.environment_refs ?? config.environmentRefs)) {
    const reference = objectOf(ref);
    const org = reference?.org;
    if (reference !== undefined && typeof org === "string" && org !== "") {
      const id = await idOf(org);
      if (id !== undefined) {
        reference.org = id;
      }
    }
  }
}
