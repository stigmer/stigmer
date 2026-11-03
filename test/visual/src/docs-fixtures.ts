// The docs pages' world: the resources their pictures draw, built from the
// values each page prints (docs-examples.ts), so a picture names nothing
// its page does not. Times are stamped from the samples' instant, as the
// rest of the gallery's data is, so nothing reads the clock.
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentSchema, type Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { RoutineSchema, type Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import {
  RoutineFireListSchema,
  RoutineFireOrigin,
  RoutineFireOutcome,
  type RoutineFireList,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { sampleDate } from "@stigmer/react-sdk/test";
import { AGENT_EXAMPLE, ROUTINE_EXAMPLE } from "./docs-examples.ts";
import { ORGANIZATION } from "./fixtures.ts";

const ORG_ID = ORGANIZATION.metadata?.id ?? "";
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Ada, who made every resource the docs' pages make: the gallery's account. */
const ADA = { id: "ia-ada", displayName: "Ada Lovelace", email: "ada@acme.example" } as const;

/** Made `daysAgo` days before the samples' instant by Ada, and not changed since. */
function madeBy(daysAgo: number) {
  const at = timestampFromDate(sampleDate(-daysAgo * DAY_MS));
  return { specAudit: { createdBy: ADA, createdAt: at, updatedBy: ADA, updatedAt: at } };
}

/** The Agent the agents page prints as YAML, each field of its detail page one of the file's. */
export const VARIANCE_REPORTER: Agent = create(AgentSchema, {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Agent",
  metadata: {
    id: "agt_00000000000000000000000051",
    name: AGENT_EXAMPLE.name,
    slug: AGENT_EXAMPLE.name,
    org: ORG_ID,
    visibility: ApiResourceVisibility.visibility_org,
  },
  spec: {
    description: AGENT_EXAMPLE.description,
    instructions: AGENT_EXAMPLE.instructions.join("\n\n"),
    skillRefs: AGENT_EXAMPLE.skills.map((slug) => ({ org: ORG_ID, kind: ApiResourceKind.skill, slug })),
    plugins: [{ org: ORG_ID, kind: ApiResourceKind.plugin, slug: AGENT_EXAMPLE.plugin }],
    tools: [...AGENT_EXAMPLE.tools],
    env: Object.fromEntries(
      AGENT_EXAMPLE.envNames.map((name, index) => [
        name,
        { isSecret: name.endsWith("_KEY"), description: AGENT_EXAMPLE.envDescriptions[index] },
      ]),
    ),
  },
  status: { audit: madeBy(30) },
});

/** The run the routine's first start began. */
const FIRST_RUN_ID = "run_00000000000000000000000062";

/**
 * The routine the routines page makes: `enabled` off as the page's form
 * leaves it, or on once Enable & run now has started its first run.
 */
export function varianceRoutine(enabled: boolean): Routine {
  return create(RoutineSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Routine",
    metadata: {
      id: "rtn_00000000000000000000000061",
      name: ROUTINE_EXAMPLE.name,
      slug: ROUTINE_EXAMPLE.name,
      org: ORG_ID,
    },
    spec: {
      cron: ROUTINE_EXAMPLE.cron,
      timeZone: ROUTINE_EXAMPLE.timeZone,
      enabled,
      agent: {
        agentRef: { org: ORG_ID, kind: ApiResourceKind.agent, slug: ROUTINE_EXAMPLE.agent },
        message: ROUTINE_EXAMPLE.message,
      },
    },
    status: {
      // 09:00 in Kolkata is 03:30 UTC: the next one after the samples' instant (11:00 UTC) is tomorrow's.
      ...(enabled ? { nextFireAt: timestampFromDate(new Date(sampleDate(DAY_MS).toISOString().slice(0, 10) + "T03:30:00.000Z")) } : {}),
      ...(enabled ? { lastFireAt: timestampFromDate(sampleDate(-5 * MINUTE_MS)), lastRunId: FIRST_RUN_ID } : {}),
      audit: madeBy(0),
    },
  });
}

/** The routine's history after Enable & run now: one start, by hand, by Ada, five minutes ago. */
export function firstRunHistory(): RoutineFireList {
  return create(RoutineFireListSchema, {
    entries: [
      {
        routineId: "rtn_00000000000000000000000061",
        org: ORG_ID,
        nominalFireTime: timestampFromDate(sampleDate(-5 * MINUTE_MS)),
        origin: RoutineFireOrigin.MANUAL,
        outcome: RoutineFireOutcome.STARTED,
        runId: FIRST_RUN_ID,
        recordedAt: timestampFromDate(sampleDate(-5 * MINUTE_MS)),
        fireId: "fire_00000000000000000000000063",
        firedBy: ADA,
      },
    ],
  });
}
