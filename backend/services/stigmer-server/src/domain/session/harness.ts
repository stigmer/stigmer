/**
 * The harnesses this platform names, what people call each, which it
 * offers, and the one rule that refuses any other wherever a request names
 * one: an agent's harness, a conversation's, a routine's, an eval run's
 * targets, and the harness a message's turn is placed on
 * (domain/run/controller.ts, after ResolveRunConfig).
 *
 * The harness set the proto names is closed and may be larger than the set
 * this platform runs: a harness is named on the wire before its runner
 * exists, so the surfaces and stored resources can learn the word first.
 * Naming is not offering. Before this rule, a harness the server did not
 * map became Stigmer wherever the harness turned into behaviour, so a
 * conversation someone believed ran on one harness ran on another, with its
 * tools and its bill. Refusing at the write keeps the mistake next to the
 * choice: a stored agent, conversation or schedule never holds a harness
 * its first message would fail on.
 *
 * Offering is a product decision per edition, so it is declared here by
 * hand rather than learned from the runners or the model catalog. An
 * undefined number never reaches this rule on a validated write
 * (`enum.defined_only` on every `harness` field); the rule still names it,
 * since the run's placement reads stored and defaulted values too.
 *
 * FailedPrecondition, the code ResolveRunConfig refuses with: the request
 * is valid, and this platform cannot run it.
 *
 * Every harness the proto names is offered today, so the rule's refusals
 * are met by a number the proto does not name (2, the gap in its
 * numbering, among them),
 * and by the next harness the proto names before this platform runs it.
 *
 * Proven by __tests__/harness.test.ts and the run-admission conformance
 * suite's harness arm.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { failedPreconditionError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";

/** What the platform says about one harness. */
export interface HarnessFacts {
  /** The harness's name as people read it, the same on every surface (docs/vocabulary.md, "Harness"). */
  readonly label: string;
  /**
   * Whether this platform runs it. Offering a harness means every runner
   * that carries it runs it; a runner without it refuses the turn plainly,
   * before anything runs (Claude's adapter, runner
   * `activities/execute-claude/adapter.ts`), so the offer never waits on
   * every runner carrying every harness.
   */
  readonly offered: boolean;
}

/**
 * Every harness the proto names, keyed so a new member is a compile error
 * here until it has a label and an offer. Unspecified is Stigmer, the
 * platform default, and is always offered.
 */
export const HARNESSES: Readonly<Record<Exclude<Harness, Harness.UNSPECIFIED>, HarnessFacts>> = {
  [Harness.STIGMER]: { label: "Stigmer", offered: true },
  [Harness.CLAUDE]: { label: "Claude Agent", offered: true },
};

/** A harness's facts, unspecified read as Stigmer; undefined for a number the proto does not name. */
export function harnessFacts(harness: Harness): HarnessFacts | undefined {
  const named = harness === Harness.UNSPECIFIED ? Harness.STIGMER : harness;
  return (HARNESSES as Partial<Record<Harness, HarnessFacts>>)[named];
}

/**
 * The refusal copy for `harness` named at `field`, or "" when this
 * platform runs it.
 */
export function offeredHarnessRefusal(harness: Harness, field: string): string {
  const facts = harnessFacts(harness);
  if (facts === undefined) {
    return `${field} names harness ${String(harness)}, which this platform does not run`;
  }
  return facts.offered ? "" : `${facts.label} is not available on this platform yet (${field})`;
}

/** One harness a request names, at the field that names it. */
export interface NamedHarness {
  readonly field: string;
  readonly harness: Harness;
}

/**
 * The refusal as a pipeline step over any request that names harnesses:
 * `harnessesOf` reads each one from the request's new state, at its field.
 * Place it after proto validation and after any step that fills a harness
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
