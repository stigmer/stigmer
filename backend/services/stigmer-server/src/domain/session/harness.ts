/**
 * The engines this platform offers, and the one rule that refuses any
 * other wherever a request names one: an agent's engine, a conversation's,
 * a routine's, an eval run's targets, and the engine a message's turn is
 * placed on (domain/run/controller.ts, after ResolveRunConfig).
 *
 * The engine set the proto names is closed and larger than the set this
 * platform runs: an engine is named on the wire before its runner exists,
 * so the surfaces and stored resources can learn the word first. Naming
 * is not offering. Before this rule, an engine the server did not map
 * became native wherever the engine turned into behaviour, so a
 * conversation someone believed ran on one engine ran on another, with
 * its tools and its bill. Refusing at the write keeps the mistake next to
 * the choice: a stored agent, conversation or schedule never holds an
 * engine its first message would fail on.
 *
 * Offering is a product decision per edition, so the set is declared here
 * by hand rather than learned from the runners or the model catalog. An
 * undefined number never reaches this rule on a validated write
 * (`enum.defined_only` on every `harness` field); the rule still names it,
 * since the run's placement reads stored and defaulted values too.
 *
 * FailedPrecondition, the code ResolveRunConfig refuses with: the request
 * is valid, and this platform cannot run it.
 *
 * Proven by __tests__/harness.test.ts and the run-admission conformance
 * suite's engine arm.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { failedPreconditionError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";

/** The engines this platform runs. Unspecified is native, the platform default, and is always offered. */
export const OFFERED_HARNESSES: ReadonlySet<Harness> = new Set([
  Harness.NATIVE,
  Harness.CURSOR,
]);

/** The engine's name as people read it; undefined for a number no engine owns. */
function engineLabel(harness: Harness): string | undefined {
  switch (harness) {
    case Harness.UNSPECIFIED:
    case Harness.NATIVE:
      return "Stigmer's native engine";
    case Harness.CURSOR:
      return "Cursor";
    case Harness.CLAUDE:
      return "Claude";
    default: {
      const unknown: never = harness;
      void unknown;
      return undefined;
    }
  }
}

/**
 * The refusal copy for `harness` named at `field`, or "" when this
 * platform runs it.
 */
export function offeredHarnessRefusal(harness: Harness, field: string): string {
  if (harness === Harness.UNSPECIFIED || OFFERED_HARNESSES.has(harness)) {
    return "";
  }
  const label = engineLabel(harness);
  if (label === undefined) {
    return `${field} names engine ${String(harness)}, which is not one this platform runs`;
  }
  return `${label} is not available on this platform yet (${field})`;
}

/** One engine a request names, at the field that names it. */
export interface NamedHarness {
  readonly field: string;
  readonly harness: Harness;
}

/**
 * The refusal as a pipeline step over any request that names engines:
 * `harnessesOf` reads each one from the request's new state, at its field.
 * Place it after proto validation and after any step that fills an engine
 * from a default.
 */
export function newRefuseUnofferedHarnessStep<Desc extends DescMessage>(
  harnessesOf: (state: MessageShape<Desc>) => readonly NamedHarness[],
): PipelineStep<Desc> {
  return {
    name: "RefuseUnofferedHarness",
    execute(ctx: RequestContext<Desc>): void {
      for (const { field, harness } of harnessesOf(ctx.newState)) {
        const refusal = offeredHarnessRefusal(harness, field);
        if (refusal !== "") {
          throw failedPreconditionError(refusal);
        }
      }
    },
  };
}
