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
 *
 * The facts have a second producer since the list scope: the list lanes'
 * shared helper builds every candidate's `ListEntryMeta` through the same
 * structural resolver, so the second half pins that a row offered to a
 * list carries exactly the facts the point-check driver would derive
 * from the loaded row — the "two producers" the module header promised,
 * proven equal.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { silentLogger } from "../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type {
  ListEntryMeta,
  ListReadScope,
} from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import {
  resolveResourceCreatedEvent,
  visibilityShapesFor,
} from "../../pipeline/steps/authorization-tuples.js";
import { rowFactsOf, rowFactsOfEntry } from "../facts.js";
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
      ApiResourceVisibility.visibility_platform,
    ]) {
      it(`${declaration.type} at ${ApiResourceVisibility[visibility]}: the same parent links and visibility shapes`, () => {
        const row = fixtureRow(declaration, {
          id: `${declaration.type}-1`,
          org: declaration.type === "organization" ? "" : "acme",
          visibility,
          createdBy: CREATOR.identityId,
        });
        const facts = rowFactsOf(declaration.kind, row);
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
    expect(rowFactsOf(agent.kind, row).parentLinks).toEqual([]);
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
    expect(rowFactsOf(agent.kind, bare).createdBy).toBe("");
  });
});

describe("a list candidate against the loaded row — the facts' two producers", () => {
  /** What the list lanes' helper offers a scope for `rows`, captured. */
  async function candidatesOf(
    kind: (typeof builtInModel.declarations)[number]["kind"],
    rows: ReadonlyArray<object>,
  ): Promise<ReadonlyArray<ListEntryMeta>> {
    let offered: ReadonlyArray<ListEntryMeta> = [];
    const recording: ListReadScope = {
      authorizedResourceIds: () => Promise.resolve(new Set<string>()),
      restrictListEntries: (_caller, _kind, entries) => {
        offered = entries;
        return Promise.resolve(new Set<string>());
      },
    };
    await restrictListByReadScope(
      recording,
      CREATOR,
      kind,
      rows as Array<{ metadata?: { id?: string } }>,
      "",
    );
    return offered;
  }

  for (const declaration of builtInModel.declarations) {
    for (const visibility of [
      ApiResourceVisibility.visibility_private,
      ApiResourceVisibility.visibility_org,
      ApiResourceVisibility.visibility_platform,
    ]) {
      it(`${declaration.type} at ${ApiResourceVisibility[visibility]}: the candidate the helper builds carries the facts the driver derives from`, async () => {
        const row = fixtureRow(declaration, {
          id: `${declaration.type}-1`,
          org: declaration.type === "organization" ? "" : "acme",
          visibility,
          createdBy: CREATOR.identityId,
        });
        const [candidate] = await candidatesOf(declaration.kind, [row]);
        if (candidate === undefined) {
          throw new Error("the helper offers every row it is given");
        }
        expect(rowFactsOfEntry(declaration.kind, candidate)).toEqual(
          rowFactsOf(declaration.kind, row),
        );
      });
    }
  }
});
