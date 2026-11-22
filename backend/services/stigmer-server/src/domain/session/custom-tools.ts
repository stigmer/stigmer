/**
 * A conversation's custom tools (SessionSpec.custom_tools): the host app's
 * own tools, offered to the agent beside its own, whose calls the host
 * answers (hitl/answer-custom-tool-use.ts).
 *
 * ValidateCustomTools (create and update, on the state to be stored). The
 * one check the runner also runs before it offers the tools
 * (`@stigmer/tool-vocabulary` `customToolsProblem`: names, reserved names,
 * descriptions, schemas, limits), so a conversation the server accepts is
 * one every engine can offer. A refusal is INVALID_ARGUMENT naming the tool
 * and the rule. A turn created with a new session (RunSpec.session_spec)
 * creates it through the same chain.
 *
 * ValidateCustomToolsImmutability (update). Fixed once the conversation has
 * run (has-run.ts), beside its harness, execution target, Environment and
 * computer: a call already made waits on, is answered by and is replayed
 * under the tool's declared name and schema, so a tool may not change under
 * it. Compared as the tools' bytes, in order; an update that leaves the
 * field out of its mask keeps them, and so changes nothing.
 *
 * Proven by __tests__/custom-tools-steps.test.ts and the custom_tools block
 * of __tests__/session.test.ts (over the wire).
 */
import { equals } from "@bufbuild/protobuf";

import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { CustomToolSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import type { CustomTool } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { customToolsProblem } from "@stigmer/tool-vocabulary/custom-tools";

import { failedPreconditionError, invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import { sessionHasRun } from "./has-run.js";

type SessionDesc = typeof SessionSchema;

/** The refusal of a change to a conversation's custom tools once it has run. */
export const CUSTOM_TOOLS_FIXED_MESSAGE =
  "session custom_tools cannot be changed after the first execution — a call already made waits on, is answered by and is replayed under the tool its conversation declared";

/** Refuses custom tools no engine could offer (module header). */
export function newValidateCustomToolsStep(): PipelineStep<SessionDesc> {
  return {
    name: "ValidateCustomTools",
    execute(ctx: RequestContext<SessionDesc>): void {
      const tools = ctx.newState.spec?.customTools ?? [];
      const problem = customToolsProblem(
        tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
      );
      if (problem !== undefined) {
        throw invalidArgumentError(problem);
      }
    },
  };
}

/** Refuses a change to the custom tools of a conversation that has run (module header). */
export function newValidateCustomToolsImmutabilityStep(store: Store): PipelineStep<SessionDesc> {
  return {
    name: "ValidateCustomToolsImmutability",
    async execute(ctx: RequestContext<SessionDesc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Session | undefined;
      if (existing === undefined) {
        return;
      }
      if (sameTools(existing.spec?.customTools ?? [], ctx.newState.spec?.customTools ?? [])) {
        return;
      }
      if (!(await sessionHasRun(store, ctx, existing))) {
        return;
      }
      throw failedPreconditionError(CUSTOM_TOOLS_FIXED_MESSAGE);
    },
  };
}

function sameTools(stored: ReadonlyArray<CustomTool>, next: ReadonlyArray<CustomTool>): boolean {
  return stored.length === next.length && stored.every((tool, index) => equals(CustomToolSchema, tool, next[index]!));
}
