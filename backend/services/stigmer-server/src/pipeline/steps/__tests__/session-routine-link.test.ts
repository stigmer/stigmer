/**
 * Pins the one row fact the built-in authorizer and every tuple writer
 * read a fired session's routine from (authorization-facts.ts
 * `parentLinksOf`, the session kind's `status_field` parent): a session
 * whose status names a routine links it as `session#routine`; a session
 * whose status names none links no routine, whatever its spec or labels
 * carry, so the link cannot be forged by what a client writes.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { parentLinksOf } from "../authorization-facts.js";

describe("a session's routine link", () => {
  it("is derived from the routine its status names", () => {
    const fired = create(SessionSchema, {
      metadata: { id: "ses_1", org: "org_acme" },
      status: { routineId: "rtn_1" },
    });
    expect(parentLinksOf(ApiResourceKind.session, fired, "org_acme")).toContainEqual({
      relation: "routine",
      parentKind: ApiResourceKind.routine,
      parentId: "rtn_1",
    });
  });

  it("is absent when the status names none, whatever the labels say", () => {
    const console = create(SessionSchema, {
      metadata: { id: "ses_2", org: "org_acme", labels: { "stigmer.ai/routine-id": "rtn_1" } },
    });
    expect(
      parentLinksOf(ApiResourceKind.session, console, "org_acme").filter((link) => link.relation === "routine"),
    ).toEqual([]);
  });
});
