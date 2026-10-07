/**
 * Credential assignments between their two shapes: the stored proto
 * (`CredentialAssignment`, as a schedule, share, channel or platform
 * client returns it) and the SDK input a write sends. The writer is the
 * server's to stamp, so the input form never carries it in either
 * direction: reading drops it, and building a proto leaves it empty.
 *
 * Pinned by `__tests__/assignments.test.ts`.
 */
import { create } from "@bufbuild/protobuf";
import {
  CredentialAssignmentSchema,
  type CredentialAssignment,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { CredentialAssignmentInput } from "@stigmer/sdk";
import { fromCredentialTarget, fromTargetInput, toTargetInput, type CredentialTargetRef } from "./model.js";

/** A stored assignment as an input, without its writer; `undefined` for one with no declarer. */
export function assignmentInputOf(
  assignment: CredentialAssignment,
): CredentialAssignmentInput | undefined {
  const declarer = assignment.requirement?.declarer
    ? fromCredentialTarget(assignment.requirement.declarer)
    : undefined;
  if (declarer === undefined) return undefined;
  const requirement = { declarer: toTargetInput(declarer), key: assignment.requirement?.key ?? "" };
  const source = assignment.source;
  switch (source.case) {
    case "credential": {
      const ref = source.value.credential;
      return {
        requirement,
        credential: {
          credential: { org: ref?.org ?? "", slug: ref?.slug ?? "" },
          ...(source.value.field ? { field: source.value.field } : {}),
        },
      };
    }
    case "literal":
      return { requirement, literal: source.value };
    case undefined:
      return { requirement };
    default: {
      const exhaustive: never = source;
      throw new Error(`unknown assignment source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Every stored assignment as an input, without writers. */
export function assignmentInputsOf(
  assignments: readonly CredentialAssignment[],
): CredentialAssignmentInput[] {
  return assignments.flatMap((assignment) => {
    const input = assignmentInputOf(assignment);
    return input ? [input] : [];
  });
}

function targetProto(ref: CredentialTargetRef) {
  switch (ref.kind) {
    case "agent":
      return { case: "agent" as const, value: { org: ref.org, slug: ref.slug, kind: ApiResourceKind.agent } };
    case "mcp_server":
      return { case: "mcpServer" as const, value: { org: ref.org, slug: ref.slug, kind: ApiResourceKind.mcp_server } };
    case "git_host":
      return { case: "gitHost" as const, value: ref.host };
    default: {
      const exhaustive: never = ref;
      throw new Error(`unknown credential target: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * An input as the stored proto, for a caller that edits a resource's
 * proto in place (a schedule's lossless write path). The writer is left
 * empty: the server stamps it.
 */
export function assignmentProtoOf(
  input: CredentialAssignmentInput,
): CredentialAssignment | undefined {
  const declarer = fromTargetInput(input.requirement.declarer);
  if (declarer === undefined) return undefined;
  return create(CredentialAssignmentSchema, {
    requirement: { declarer: { target: targetProto(declarer) }, key: input.requirement.key ?? "" },
    source: input.credential
      ? {
          case: "credential",
          value: {
            credential: {
              org: input.credential.credential.org,
              slug: input.credential.credential.slug,
              kind: ApiResourceKind.credential,
            },
            field: input.credential.field ?? "",
          },
        }
      : input.literal !== undefined
        ? { case: "literal", value: input.literal }
        : { case: undefined },
  });
}
