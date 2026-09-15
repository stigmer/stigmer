/**
 * Pins the one place two readers of `kind_meta.authorization` could
 * drift: the tuple lifecycle resolves a just-persisted row into the facts
 * a driver writes tuples from (`resolveResourceCreatedEvent`), and the
 * built-in authorizer resolves a LOADED row into the facts it derives
 * tuples from (`rowFactsOf`). The two are separate functions on purpose —
 * the create-time one throws on a missing organization or parent (a
 * create must not half-succeed), the read-time one carries what the row
 * says (a legacy row is a fact, not a fault) — so for every declared kind
 * a well-formed row must resolve to the same parent links and the same
 * visibility shapes through both, and this file is where that is proven
 * rather than remembered.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { silentLogger } from "../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  resolveResourceCreatedEvent,
  visibilityShapesFor,
} from "../../pipeline/steps/authorization-tuples.js";
import { rowFactsOf } from "../facts.js";
import { builtInModel } from "../model/index.js";
import { fixtureRow } from "./support.js";

const CREATOR: CallerIdentity = {
  identityId: "ida_carol",
  callerClass: "user",
  issuer: "https://issuer.example",
  rawToken: "opaque",
};

describe("rowFactsOf against the tuple lifecycle's own resolution", () => {
  for (const declaration of builtInModel.declarations) {
    for (const visibility of [
      ApiResourceVisibility.visibility_private,
      ApiResourceVisibility.visibility_org,
      ApiResourceVisibility.visibility_public,
    ]) {
      it(`${declaration.type} at ${ApiResourceVisibility[visibility]}: the same parent links and visibility shapes`, () => {
        const row = fixtureRow(declaration, {
          id: `${declaration.type}-1`,
          org: declaration.type === "organization" ? "" : "acme",
          visibility,
          createdBy: CREATOR.identityId,
        });
        const facts = rowFactsOf(declaration, row);
        const event = resolveResourceCreatedEvent(
          declaration.kind,
          row,
          CREATOR,
          silentLogger,
        );
        expect(facts.parentLinks).toEqual(event?.parentLinks ?? []);
        expect([
          ...visibilityShapesFor(declaration.kind, facts.visibility),
        ]).toEqual(event?.visibilityShapes ?? []);
        expect(facts.createdBy).toBe(CREATOR.identityId);
        expect(facts.id).toBe(`${declaration.type}-1`);
      });
    }
  }

  it("carries a legacy row's missing organization as no scope link, where the create-time resolver throws", () => {
    const agent = builtInModel.byType("agent");
    if (agent === undefined) {
      throw new Error("agent is declared in this slice");
    }
    const row = fixtureRow(agent, {
      id: "agent-legacy",
      org: "",
      visibility: ApiResourceVisibility.visibility_org,
      createdBy: "ida_carol",
    });
    expect(rowFactsOf(agent, row).parentLinks).toEqual([]);
    expect(() =>
      resolveResourceCreatedEvent(agent.kind, row, CREATOR, silentLogger),
    ).toThrow();
  });

  it("reads an absent creator stamp as the empty string", () => {
    const agent = builtInModel.byType("agent");
    if (agent === undefined) {
      throw new Error("agent is declared in this slice");
    }
    const bare = create(agent.schema, {
      metadata: { id: "agent-bare", org: "acme" },
    });
    expect(rowFactsOf(agent, bare).createdBy).toBe("");
  });
});
