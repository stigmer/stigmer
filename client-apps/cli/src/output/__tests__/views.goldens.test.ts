// Goldens of `get`'s designed views (CLI-09): what a person sees for an
// agent, a skill, a session with its runs, a failed run, an organization, a
// paused routine and a limited Environment, each at 80 columns (a terminal)
// and piped (no width: nothing wrapped or cut). Frozen as files in
// `__goldens__` beside the other output goldens, so a change to a view is a
// diff a reviewer reads; `npx vitest run -u` rewrites them. The inputs are
// fixed protos stamped from one frozen instant (views/__fixtures__), drawn
// with colour off; colour is the unit tests' subject.

import type { DescMessage, Message } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { describe, it } from "vitest";
import { expectGolden } from "../../__test-utils__/golden.js";
import { asObject } from "../../resources/render.js";
import * as fixtures from "../../resources/views/__fixtures__/resources.js";
import { VIEWS } from "../../resources/views/index.js";
import { renderView } from "../../resources/views/view.js";
import { protoToJsonValue } from "../proto.js";
import { styler } from "../style.js";

/** The kind's view of `message`, as acme's, at `width` columns (undefined: piped). */
function draw(kind: ApiResourceKind, schema: DescMessage, message: Message, width: number | undefined): string {
  const runs = fixtures.sessionRuns.map((run) => asObject(protoToJsonValue(RunSchema, run)));
  return renderView(VIEWS.get(kind)!, asObject(protoToJsonValue(schema, message)), {
    hideOrg: false,
    orgLabel: "acme",
    width,
    style: styler(false),
    now: fixtures.FROZEN,
    runs: kind === ApiResourceKind.session ? runs : undefined,
  });
}

const CASES: ReadonlyArray<[name: string, kind: ApiResourceKind, schema: DescMessage, message: Message]> = [
  ["agent", ApiResourceKind.agent, AgentSchema, fixtures.agent],
  ["skill", ApiResourceKind.skill, SkillSchema, fixtures.skill],
  ["session", ApiResourceKind.session, SessionSchema, fixtures.session],
  ["run", ApiResourceKind.run, RunSchema, fixtures.failedRun],
  ["organization", ApiResourceKind.organization, OrganizationSchema, fixtures.organization],
  ["routine", ApiResourceKind.routine, RoutineSchema, fixtures.routine],
  ["environment", ApiResourceKind.environment, EnvironmentSchema, fixtures.environment],
];

describe("CLI-09 get shows a view designed for each kind a person reads", () => {
  it.each(CASES)("draws the %s view at 80 columns and piped", async (name, kind, schema, message) => {
    await expectGolden(draw(kind, schema, message, 80), `get-${name}-80`);
    await expectGolden(draw(kind, schema, message, undefined), `get-${name}-piped`);
  });
});
