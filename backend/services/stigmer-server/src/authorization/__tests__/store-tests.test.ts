/**
 * Runs the model's own suites (fga/tests/*.fga.yaml) through the built-in
 * evaluator. The same documents run on the real OpenFGA engine against the
 * same compiled model (`make test-authorization-model`, and CI's
 * authorization-model lane), so every `check` and every `list_objects`
 * assertion answered here is answered by OpenFGA too: the proof that the
 * evaluator and the engine mean one thing by the model.
 *
 * Nothing is skipped. `DOCUMENTS` is the folder's listing, so a suite
 * added to the folder without a line here fails, and a suite is never
 * silently out of the proof.
 *
 * The second describe proves the kit's `list_objects` rule over a
 * throwaway model: candidates are the objects the document's tuples are
 * written on, checked one by one, so an object reached through a tupleset
 * link is listed, one no relation reaches is not, and a wrong expectation
 * fails.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { builtInModel, newModel } from "../model/index.js";
import { parseObjectRef } from "../tuples.js";
import type { StoreTestDocument } from "./store-test-kit.js";
import {
  objectsOfType,
  parseStoreTestDocument,
  storeTestCases,
} from "./store-test-kit.js";
import {
  computed,
  direct,
  from,
  objectOf,
  throwawayDeclaration,
  union,
} from "./throwaway-model.js";

const SUITES = new URL("../../../fga/tests/", import.meta.url);

/** Every suite the model's folder holds, by file name. */
const DOCUMENTS = [
  "agent-channel-owner.fga.yaml",
  "agent-instance-creation.fga.yaml",
  "agent-share-owner.fga.yaml",
  "artifact-org-and-owner.fga.yaml",
  "blueprint-private-visibility.fga.yaml",
  "channel-app-owner.fga.yaml",
  "channel-participation.fga.yaml",
  "channel-session-visibility.fga.yaml",
  "default-instance-inheritance.fga.yaml",
  "identity-provider-administration.fga.yaml",
  "invitation-administration.fga.yaml",
  "license-issuer.fga.yaml",
  "mcp-server-authoring.fga.yaml",
  "memory-subject-only.fga.yaml",
  "org-admin-owner-inheritance.fga.yaml",
  "org-shared-environment.fga.yaml",
  "platform-visibility.fga.yaml",
  "plugin-owner.fga.yaml",
  "provider-standing-viewer.fga.yaml",
  "reserved-label-writer.fga.yaml",
  "schedule-owner.fga.yaml",
  "schedule-session-visibility.fga.yaml",
  "session-personal-resource.fga.yaml",
  "team-membership.fga.yaml",
  "workflow-execution-sharing.fga.yaml",
] as const;

describe("the model's suites over the built-in evaluator", () => {
  it("the suites folder holds exactly the documents this file pins", () => {
    expect(
      readdirSync(SUITES)
        .filter((name) => name.endsWith(".fga.yaml"))
        .sort(),
    ).toEqual([...DOCUMENTS]);
  });

  for (const name of DOCUMENTS) {
    const document = parseStoreTestDocument(
      yaml.load(readFileSync(fileURLToPath(new URL(name, SUITES)), "utf8")),
      name,
    );
    describe(document.name, () => {
      for (const storeTestCase of storeTestCases(document, builtInModel)) {
        it(storeTestCase.name, storeTestCase.run);
      }
    });
  }
});

/**
 * The kit's `list_objects` rule over a throwaway model: an agent whose
 * `owner` is a direct person or an admin of its organization, reached
 * through the `organization` tupleset link.
 */
describe("the kit lists exactly the objects a relation reaches", () => {
  const model = newModel([
    throwawayDeclaration({
      kind: ApiResourceKind.organization,
      schema: OrganizationSchema,
      relations: [["admin", direct(objectOf("identity_account"))]],
    }),
    throwawayDeclaration({
      kind: ApiResourceKind.agent,
      schema: AgentSchema,
      relations: [
        ["organization", direct(objectOf("organization"))],
        ["owner", union(direct(objectOf("identity_account")), from("admin", "organization"))],
        ["can_edit", computed("owner")],
      ],
    }),
  ]);

  const tuples = [
    { user: "identity_account:ada", relation: "owner", object: "agent:mine" },
    { user: "organization:acme", relation: "organization", object: "agent:org" },
    { user: "identity_account:ada", relation: "admin", object: "organization:acme" },
    { user: "organization:other", relation: "organization", object: "agent:elsewhere" },
  ];

  function documentExpecting(expected: ReadonlyArray<string>): StoreTestDocument {
    return {
      name: "throwaway",
      tuples,
      tests: [
        {
          name: "listing",
          check: [],
          list_objects: [
            { user: "identity_account:ada", type: "agent", assertions: { can_edit: expected } },
          ],
        },
      ],
    };
  }

  it("takes as candidates every object of the type a tuple is written on", () => {
    expect(
      objectsOfType(
        tuples.map((tuple) => ({
          object: parseObjectRef(tuple.object),
          relation: tuple.relation,
          subject: { form: "object" as const, object: parseObjectRef(tuple.user) },
        })),
        "agent",
      ),
    ).toEqual(["agent:mine", "agent:org", "agent:elsewhere"]);
  });

  it("lists the direct object and the one reached through the tupleset, in any order", async () => {
    const [listing] = storeTestCases(documentExpecting(["agent:org", "agent:mine"]), model);
    await expect(listing?.run()).resolves.toBeUndefined();
  });

  it("fails an expectation that lists an object no relation reaches, or misses one", async () => {
    const [extra] = storeTestCases(
      documentExpecting(["agent:mine", "agent:org", "agent:elsewhere"]),
      model,
    );
    await expect(extra?.run()).rejects.toThrow("identity_account:ada can_edit objects of type agent");
    const [missing] = storeTestCases(documentExpecting(["agent:mine"]), model);
    await expect(missing?.run()).rejects.toThrow("identity_account:ada can_edit objects of type agent");
  });
});
