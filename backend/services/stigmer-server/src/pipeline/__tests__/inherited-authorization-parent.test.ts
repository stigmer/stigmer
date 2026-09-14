/**
 * Pins `inheritedAuthorizationParentOf` (pipeline/apiresource-meta.ts):
 * the kind_meta question "is this kind's authorization its parent's
 * whole?", answered by the PARENT-scope + INHERITED-owner pair and by
 * nothing else (stigmer-cloud 20260913.04 T04, Q-LB-34).
 *
 * The table below is the WHOLE kind enum, on purpose. The list read scope
 * carries `authorizationParent` for exactly the kinds this function names,
 * and a composed driver asks its authorization backend about the parent
 * in the child's place — so a second kind joining the set is a change in
 * what that driver checks, and must arrive as a reviewed edit of this
 * table, never as a silent consequence of a kind_meta edit. Kinds with
 * additional parents whose inheritance is partial (workflow_execution's
 * opt-in `execution_viewer from workflow_instance`, agent_instance's
 * `viewer from default_of`) own themselves and are pinned as `undefined`.
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { inheritedAuthorizationParentOf } from "../apiresource-meta.js";

describe("inheritedAuthorizationParentOf — the parent a kind's authorization is", () => {
  it("agent_execution's authorization is its session's: relation `session`, spec field `session_id`", () => {
    const parent = inheritedAuthorizationParentOf(
      ApiResourceKind.agent_execution,
    );
    expect(parent).toBeDefined();
    expect(parent?.kind).toBe("session");
    expect(parent?.relation).toBe("session");
    expect(parent?.specField).toBe("session_id");
  });

  it("every other kind's authorization is its own (the whole enum, pinned)", () => {
    const inherited = Object.values(ApiResourceKind)
      .filter((value): value is ApiResourceKind => typeof value === "number")
      .filter((kind) => kind !== ApiResourceKind.api_resource_kind_unknown)
      .filter((kind) => inheritedAuthorizationParentOf(kind) !== undefined)
      .map((kind) => ApiResourceKind[kind]);
    expect(inherited).toEqual(["agent_execution"]);
  });

  it.each([
    ApiResourceKind.workflow_execution,
    ApiResourceKind.agent_instance,
    ApiResourceKind.workflow_instance,
    ApiResourceKind.memory,
  ])("a kind with an additional, partial parent owns itself: %s", (kind) => {
    expect(inheritedAuthorizationParentOf(kind)).toBeUndefined();
  });
});
