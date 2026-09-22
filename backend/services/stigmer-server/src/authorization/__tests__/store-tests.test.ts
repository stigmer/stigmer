/**
 * Runs the cloud's own OpenFGA store tests against the built-in
 * evaluator: the documents under fixtures/fga/ are pinned copies of
 * stigmer-cloud's `fga/tests/*.fga.yaml` (each header names its source
 * and commit), written by the model's authors and run against real
 * OpenFGA in the cloud's CI. Every `check` assertion on a kind this
 * edition declares must answer the same here — the proof that "the model
 * evaluated over derived tuples" means the SAME model.
 *
 * What is not run is reported, never dropped: a check that targets a kind
 * this edition does not serve, every `list_objects` assertion (the list
 * scope's proof), and an assertion whose walk read a grant through a
 * type this edition does not declare come back from the kit as a skipped
 * set this file pins entry by entry, so a fixture that gains a scenario
 * is a visible diff here and not a silently smaller proof. The second
 * describe below pins the walk-dependent reason's own behaviour over a
 * throwaway model, so the kit is proven and not only used.
 *
 * The cloud re-runs the LIVE documents through the same kit at the
 * re-pin (the drift test's second table), which is what makes the pinned
 * copies safe to hold.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { builtInModel, newModel } from "../model/index.js";
import {
  computed,
  declareKind,
  direct,
  objectOf,
  union,
  usersetOf,
} from "../model/rewrite.js";
import type { StoreTestDocument, StoreTestSkip } from "../store-test-kit.js";
import { parseStoreTestDocument, storeTestCases } from "../store-test-kit.js";

const FIXTURES = new URL("./fixtures/fga/", import.meta.url);

/**
 * Every document the cloud's `fga/tests/` folder holds, by file name — the
 * fixtures folder is a byte-exact mirror of it; a file added to either
 * without a line here fails.
 */
const DOCUMENTS = [
  "agent-channel-owner.fga.yaml",
  "agent-instance-creation.fga.yaml",
  "agent-share-owner.fga.yaml",
  "artifact-org-and-owner.fga.yaml",
  "blueprint-private-visibility.fga.yaml",
  "channel-app-owner.fga.yaml",
  "channel-participation.fga.yaml",
  "channel-session-visibility.fga.yaml",
  "cross-org-share-creation.fga.yaml",
  "default-instance-inheritance.fga.yaml",
  "mcp-server-authoring.fga.yaml",
  "memory-subject-only.fga.yaml",
  "org-admin-owner-inheritance.fga.yaml",
  "org-shared-environment.fga.yaml",
  "platform-visibility.fga.yaml",
  "provider-standing-viewer.fga.yaml",
  "public-visibility-setter.fga.yaml",
  "reserved-label-writer.fga.yaml",
  "schedule-owner.fga.yaml",
  "schedule-session-visibility.fga.yaml",
  "session-personal-resource.fga.yaml",
  "workflow-execution-sharing.fga.yaml",
] as const;

function skipLine(skip: StoreTestSkip): string {
  const relation = skip.relation === undefined ? "" : ` ${skip.relation}`;
  const types = skip.types === undefined ? "" : ` (${skip.types.join(", ")})`;
  return `${skip.document} :: ${skip.test} :: ${skip.subject}${relation} ${skip.object} :: ${skip.reason}${types}`;
}

/**
 * Every assertion the kit did not run, pinned, in the kit's three
 * reasons. `list-objects` lines are the list scope's proof and run when
 * it lands. `undeclared-kind` lines target `platform`, a kind this
 * edition never serves (the driver refuses it before any evaluation).
 * `undeclared-subject-type` lines are the checks whose walk read the
 * cloud's platform-tenancy grant, `identity_provider:<idp>#platform_user`
 * — a userset on a kind this edition does not declare, so the answer here
 * (nobody) is not the oracle's and is not asserted; the cloud runs the
 * same lines over its full model at the re-pin.
 */
const SKIPPED_PINNED: ReadonlyArray<string> = [
  // list-objects
  "agent-channel-owner :: listing channels reflects ownership and grants, not membership :: identity_account:alice <agent_channel> :: list-objects",
  "agent-channel-owner :: listing channels reflects ownership and grants, not membership :: identity_account:carol <agent_channel> :: list-objects",
  "agent-channel-owner :: listing channels reflects ownership and grants, not membership :: identity_account:mallory <agent_channel> :: list-objects",
  "agent-share-owner :: listing shares reflects ownership and grants, not membership :: identity_account:alice <agent_share> :: list-objects",
  "agent-share-owner :: listing shares reflects ownership and grants, not membership :: identity_account:carol <agent_share> :: list-objects",
  "agent-share-owner :: listing shares reflects ownership and grants, not membership :: identity_account:mallory <agent_share> :: list-objects",
  "artifact-org-and-owner :: listing reflects org inheritance plus creator ownership :: identity_account:acme-guest <artifact> :: list-objects",
  "artifact-org-and-owner :: listing reflects org inheritance plus creator ownership :: identity_account:eve <artifact> :: list-objects",
  "artifact-org-and-owner :: listing reflects org inheritance plus creator ownership :: identity_account:victor <artifact> :: list-objects",
  "blueprint-private-visibility :: org admin's listable agents include private ones (T08) :: identity_account:oscar <agent> :: list-objects",
  "blueprint-private-visibility :: org member's listable agents exclude private ones (wildcard suppressed) :: identity_account:dave <agent> :: list-objects",
  "blueprint-private-visibility :: org viewer's listable agents are exactly the viewer-shaped org-visible ones :: identity_account:vera <agent> :: list-objects",
  "blueprint-private-visibility :: owner's listable agents include everything they authored :: identity_account:carol <agent> :: list-objects",
  "channel-app-owner :: listing channel apps reflects ownership and grants, not membership :: identity_account:alice <channel_app> :: list-objects",
  "channel-app-owner :: listing channel apps reflects ownership and grants, not membership :: identity_account:carol <channel_app> :: list-objects",
  "channel-app-owner :: listing channel apps reflects ownership and grants, not membership :: identity_account:mallory <channel_app> :: list-objects",
  "channel-participation :: list viewable and participable channels resolve per grant (drives listConversations) :: identity_account:carol <agent_channel> :: list-objects",
  "channel-participation :: list viewable and participable channels resolve per grant (drives listConversations) :: identity_account:dave <agent_channel> :: list-objects",
  "channel-participation :: list viewable and participable channels resolve per grant (drives listConversations) :: identity_account:trina <agent_channel> :: list-objects",
  "channel-session-visibility :: list viewable sessions resolves the channel chain (drives listByChannel) :: identity_account:alice <session> :: list-objects",
  "channel-session-visibility :: list viewable sessions resolves the channel chain (drives listByChannel) :: identity_account:bob <session> :: list-objects",
  "channel-session-visibility :: list viewable sessions resolves the channel chain (drives listByChannel) :: identity_account:carol <session> :: list-objects",
  "default-instance-inheritance :: list managed-org member's viewable agent instances resolves the default_of chain :: identity_account:alice <agent_instance> :: list-objects",
  "memory-subject-only :: list-objects returns only the subject's own records :: identity_account:alice <memory> :: list-objects",
  "memory-subject-only :: list-objects returns only the subject's own records :: identity_account:mallory <memory> :: list-objects",
  "org-admin-owner-inheritance :: admin's listable resources include private blueprints, never personal kinds :: identity_account:ana <agent> :: list-objects",
  "org-admin-owner-inheritance :: admin's listable resources include private blueprints, never personal kinds :: identity_account:ana <agent_instance> :: list-objects",
  "org-admin-owner-inheritance :: admin's listable resources include private blueprints, never personal kinds :: identity_account:ana <session> :: list-objects",
  "org-shared-environment :: org-members-can-list-shared-environments-only :: identity_account:dave <environment> :: list-objects",
  "platform-visibility :: list managed-org member's viewable agents includes only the shared one :: identity_account:alice <agent> :: list-objects",
  "schedule-owner :: listing schedules reflects ownership and grants, not membership :: identity_account:alice <schedule> :: list-objects",
  "schedule-owner :: listing schedules reflects ownership and grants, not membership :: identity_account:carol <schedule> :: list-objects",
  "schedule-owner :: listing schedules reflects ownership and grants, not membership :: identity_account:mallory <schedule> :: list-objects",
  "schedule-session-visibility :: list viewable sessions resolves the schedule chain :: identity_account:alice <session> :: list-objects",
  "schedule-session-visibility :: list viewable sessions resolves the schedule chain :: identity_account:bob <session> :: list-objects",
  "schedule-session-visibility :: list viewable sessions resolves the schedule chain :: identity_account:carol <session> :: list-objects",
  "workflow-execution-sharing :: list a teammate's viewable runs reflects both sharing axes :: identity_account:bob <workflow_execution> :: list-objects",
  // undeclared-kind: platform
  "provider-standing-viewer :: operator may view provider standing, tenants may not :: identity_account:mallory platform:stigmer :: undeclared-kind",
  "provider-standing-viewer :: operator may view provider standing, tenants may not :: identity_account:opal platform:stigmer :: undeclared-kind",
  "public-visibility-setter :: operators may set public visibility, tenants may not :: identity_account:machine platform:stigmer :: undeclared-kind",
  "public-visibility-setter :: operators may set public visibility, tenants may not :: identity_account:mallory platform:stigmer :: undeclared-kind",
  "public-visibility-setter :: operators may set public visibility, tenants may not :: identity_account:opal platform:stigmer :: undeclared-kind",
  "reserved-label-writer :: operator may write reserved labels, tenants may not :: identity_account:machine platform:stigmer :: undeclared-kind",
  "reserved-label-writer :: operator may write reserved labels, tenants may not :: identity_account:mallory platform:stigmer :: undeclared-kind",
  // undeclared-subject-type: identity_provider#platform_user
  "default-instance-inheritance :: managed-org member reaches the default instance of a platform-shared agent :: identity_account:alice can_execute agent_instance:sara-default :: undeclared-subject-type (identity_provider)",
  "default-instance-inheritance :: managed-org member reaches the default instance of a platform-shared agent :: identity_account:alice can_view agent_instance:sara-default :: undeclared-subject-type (identity_provider)",
  "default-instance-inheritance :: managed-org member reaches the default instance of a platform-shared workflow :: identity_account:alice can_execute workflow_instance:onboarding-default :: undeclared-subject-type (identity_provider)",
  "default-instance-inheritance :: managed-org member reaches the default instance of a platform-shared workflow :: identity_account:alice can_view workflow_instance:onboarding-default :: undeclared-subject-type (identity_provider)",
  "default-instance-inheritance :: outsiders get nothing from the default_of link :: identity_account:mallory can_execute agent_instance:sara-default :: undeclared-subject-type (identity_provider)",
  "default-instance-inheritance :: outsiders get nothing from the default_of link :: identity_account:mallory can_view agent_instance:sara-default :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: managed-org members can view and execute a platform-shared agent :: identity_account:alice can_create_instance agent:sara :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: managed-org members can view and execute a platform-shared agent :: identity_account:alice can_execute agent:sara :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: managed-org members can view and execute a platform-shared agent :: identity_account:alice can_view agent:sara :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: managed-org members can view and execute a platform-shared agent :: identity_account:bob can_execute agent:sara :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: managed-org members can view and execute a platform-shared agent :: identity_account:bob can_view agent:sara :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: outsiders and unrelated orgs get nothing from platform visibility :: identity_account:mallory can_create_instance agent:sara :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: outsiders and unrelated orgs get nothing from platform visibility :: identity_account:mallory can_execute agent:sara :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: outsiders and unrelated orgs get nothing from platform visibility :: identity_account:mallory can_view agent:sara :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: platform-shared mcp_server is usable by managed-org members :: identity_account:alice can_connect mcp_server:github :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: platform-shared mcp_server is usable by managed-org members :: identity_account:alice can_use mcp_server:github :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: platform-shared mcp_server is usable by managed-org members :: identity_account:alice can_view mcp_server:github :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: platform-shared skill is usable by managed-org members :: identity_account:alice can_use skill:research :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: platform-shared skill is usable by managed-org members :: identity_account:alice can_view skill:research :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: platform-shared workflow is viewable and executable by managed-org members :: identity_account:alice can_execute workflow:onboarding :: undeclared-subject-type (identity_provider)",
  "platform-visibility :: platform-shared workflow is viewable and executable by managed-org members :: identity_account:alice can_view workflow:onboarding :: undeclared-subject-type (identity_provider)",
];

describe("the cloud's OpenFGA store tests over the built-in evaluator", () => {
  it("the fixtures folder holds exactly the documents this file pins", () => {
    expect(
      readdirSync(FIXTURES)
        .filter((name) => name.endsWith(".fga.yaml"))
        .sort(),
    ).toEqual([...DOCUMENTS]);
  });

  const kits = DOCUMENTS.map((name) => {
    const document = parseStoreTestDocument(
      yaml.load(readFileSync(fileURLToPath(new URL(name, FIXTURES)), "utf8")),
      name,
    );
    return { document, kit: storeTestCases(document, builtInModel) };
  });

  for (const { document, kit } of kits) {
    if (kit.cases.length === 0) {
      // Every check targets a kind this edition does not declare (the
      // platform documents); reported as skipped, pinned below.
      it.skip(`${document.name}: no check targets a declared kind`, () => {});
      continue;
    }
    describe(document.name, () => {
      for (const storeTestCase of kit.cases) {
        it(storeTestCase.name, storeTestCase.run);
      }
    });
  }

  // Declared after every case: a kit's `skipped` is complete once its
  // cases have run (the walk-dependent reason is decided per assertion).
  it("reports every assertion it did not run, and the list is the pinned one", () => {
    const skipped = kits.flatMap(({ kit }) => kit.skipped.map(skipLine));
    expect(skipped.sort()).toEqual([...SKIPPED_PINNED].sort());
  });
});

/**
 * The kit's walk-dependent skip, proven over a throwaway model shaped
 * like a blueprint whose `viewer` line reads, in order, a direct person,
 * `owner`, then a userset on a type the model does not declare — the
 * platform-tenancy shape — so each arm below settles at a different point
 * of the union.
 */
describe("the kit skips an assertion whose walk read a type the model does not declare", () => {
  const model = newModel([
    declareKind({
      kind: ApiResourceKind.agent,
      schema: AgentSchema,
      source: "fga/model/agentic/agent.fga",
      relations: [
        ["owner", direct(objectOf("identity_account"))],
        [
          "platform_viewer",
          direct(usersetOf("identity_provider", "platform_user")),
        ],
        [
          "viewer",
          union(
            direct(objectOf("identity_account")),
            computed("owner"),
            computed("platform_viewer"),
          ),
        ],
        ["can_view", computed("viewer")],
        ["can_edit", computed("owner")],
      ],
    }),
  ]);

  const document: StoreTestDocument = {
    name: "throwaway",
    tuples: [
      { user: "identity_account:carol", relation: "owner", object: "agent:a" },
      {
        user: "identity_provider:idp#platform_user",
        relation: "platform_viewer",
        object: "agent:a",
      },
      { user: "identity_account:carol", relation: "owner", object: "agent:b" },
    ],
    tests: [
      {
        name: "arms",
        check: [
          // The owner: `viewer` settles on the direct line; `can_edit` never reads platform_viewer.
          {
            user: "identity_account:carol",
            object: "agent:a",
            assertions: { can_view: true, can_edit: true },
          },
          // A stranger: the union walks to platform_viewer and reads the undeclared userset.
          {
            user: "identity_account:mallory",
            object: "agent:a",
            assertions: { can_view: false, can_edit: false },
          },
          // No such tuple on this object: the same stranger's walk reads nothing undeclared.
          {
            user: "identity_account:mallory",
            object: "agent:b",
            assertions: { can_view: false },
          },
        ],
        list_objects: [],
      },
    ],
  };

  it("runs the arms the walk settles before the undeclared type, skips exactly the one that read it — whatever it would have answered", async () => {
    const kit = storeTestCases(document, model);
    expect(kit.skipped).toEqual([]);
    for (const storeTestCase of kit.cases) {
      await storeTestCase.run();
    }
    expect(kit.skipped.map(skipLine)).toEqual([
      "throwaway :: arms :: identity_account:mallory can_view agent:a :: undeclared-subject-type (identity_provider)",
    ]);
  });

  it("asserts the arms it runs: a wrong expectation on a settled arm still fails", async () => {
    const wrong: StoreTestDocument = {
      ...document,
      tests: [
        {
          name: "wrong",
          check: [
            {
              user: "identity_account:carol",
              object: "agent:a",
              assertions: { can_edit: false },
            },
          ],
          list_objects: [],
        },
      ],
    };
    const kit = storeTestCases(wrong, model);
    await expect(kit.cases[0]?.run()).rejects.toThrow(
      /expected false, got true/,
    );
  });
});
