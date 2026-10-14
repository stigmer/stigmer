/**
 * ValidateProto — ports steps/validation.go. Redundant on the RPC path
 * (the protovalidate interceptor already validated at the boundary) but
 * deliberately retained: it is the ONLY validation on the direct-call path
 * unit tests use, and the shared validator makes the overlap free.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { DescMessage, Message } from "@bufbuild/protobuf";
import { ValidationError, createValidator } from "@bufbuild/protovalidate";
import type { Validator, Violation } from "@bufbuild/protovalidate";

import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { metadataOf } from "./shapes.js";

// Process-wide shared validator (Go SharedValidator): constraints compile
// once, not per request.
let sharedValidator: Validator | undefined;

export function validator(): Validator {
  if (sharedValidator === undefined) {
    sharedValidator = createValidator();
  }
  return sharedValidator;
}

/**
 * `of: "state"` validates the state the chain built instead of its input:
 * an update's request carries only the fields its mask names, so the rules
 * hold for the merged resource, the one that will be stored.
 *
 * One exception, on an update: a row stored before the label and tag rules
 * may hold values they refuse (store/label-tag-report.ts names such rows,
 * and nothing rewrites them). A write that leaves the row's labels, or its
 * tags, exactly as stored is not refused for them; a write that changes
 * them is held to the rules, and every other rule binds as before. A
 * create has no stored row, so it meets every rule.
 */
export function newValidateProtoStep<Desc extends DescMessage>(
  options: { readonly of?: "input" | "state" } = {},
): PipelineStep<Desc> {
  return {
    name: "ValidateProto",
    execute(ctx: RequestContext<Desc>): void {
      const state = options.of === "state";
      const result = validator().validate(
        ctx.schema,
        state ? ctx.newState : ctx.input,
      );
      if (result.kind === "valid") {
        return;
      }
      if (result.kind === "invalid") {
        const violations = state
          ? withoutStoredLabelsAndTags(
              result.error.violations,
              ctx.newState,
              ctx.get(EXISTING_RESOURCE_KEY) as Message | undefined,
            )
          : result.error.violations;
        if (violations.length === 0) {
          return;
        }
        throw new ConnectError(
          new ValidationError(violations).message,
          Code.InvalidArgument,
        );
      }
      // A rule that fails to compile/evaluate is a server defect, not bad
      // input (same mapping as the transport interceptor).
      throw new ConnectError(
        `validation could not run: ${result.error.message}`,
        Code.Internal,
      );
    },
  };
}

/**
 * The violations left once those on `metadata.labels` or `metadata.tags`
 * are dropped wherever the state holds that field exactly as the stored row
 * does. With no stored row (a create) every violation stands.
 */
function withoutStoredLabelsAndTags(
  violations: readonly Violation[],
  state: Message,
  stored: Message | undefined,
): Violation[] {
  if (stored === undefined) {
    return [...violations];
  }
  const now = metadataOf(state);
  const before = metadataOf(stored);
  const unchanged = new Set<string>();
  if (sameLabels(now?.labels ?? {}, before?.labels ?? {})) {
    unchanged.add("labels");
  }
  if (sameTags(now?.tags ?? [], before?.tags ?? [])) {
    unchanged.add("tags");
  }
  if (unchanged.size === 0) {
    return [...violations];
  }
  return violations.filter((violation) => {
    const [first, second] = violation.field;
    return !(
      first?.kind === "field" &&
      first.name === "metadata" &&
      second?.kind === "field" &&
      unchanged.has(second.name)
    );
  });
}

function sameLabels(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && b[key] === a[key])
  );
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}
