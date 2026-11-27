// The embedding coverage read, on the target's ENFORCING lane: what an app
// user's chat asks before any conversation exists.
//
// An app user (a person signed in to an organization's own product through a
// user token its backend mints) runs an agent on the vaults the
// organization's embedding settings name, which they cannot read. A chat that
// decides from what it can read offers a sign-in those vaults already fill
// (stigmer#3486). AgentQueryController.checkEmbeddingCoverage answers that one
// source, by name only. Pinned over the wire:
//
//   - for an app user, the read names the agent's keys and the tool addresses
//     whose sign-in a vault of the embedding settings holds, and nothing a
//     vault there does not hold; before the settings name the vault it names
//     nothing;
//   - the answer carries no vault id, slug or name and no value;
//   - a first-party person gets an empty answer, a vault named or not: their
//     runs never read the embedding settings;
//   - a caller who cannot view the agent is refused exactly as getByReference
//     refuses them.
//
// Out of scope here, with the reason: that a run plans the same entries from
// the same surface is the resolver's unit arms' (domain/vault/__tests__/
// resolve.test.ts, "the embedding coverage read"), which plan both over one
// store; a run on this lane needs an engine, which the user-token targets'
// enforcing lane does not boot.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { oneServerPlugin, pushPlugin } from "../support/plugins";
import { createMinter, deleteMinter, mintUserToken, setEmbedding } from "../support/user-tokens";
import { makeSharedVault, setConnectionInput, setSecretsInput, vaultTarget } from "../support/vaults";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
} from "../targets";

const enforcementServed = createTarget().capabilities.userTokens;

// The tool the agent's plugin dials; never reached (the read opens nothing).
const ADDRESS = "https://mcp.coverage.example/mcp";

let target: TargetProfile;
let lane: EnforcingLane;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  if (!enforcementServed) return;
  const enforcing = await enforcingLaneOf(target);
  if (enforcing.lane === undefined) {
    throw new Error(
      `target "${target.name}" declares userTokens but offers no enforcing lane: ${enforcing.reason}`,
    );
  }
  lane = enforcing.lane;
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

interface World {
  readonly org: string;
  readonly founder: ConformanceClients;
  readonly appUser: ConformanceClients;
  readonly vault: { readonly id: string; readonly slug: string; readonly name: string };
  readonly agent: { readonly id: string; readonly org: string };
}

// An organization whose founder keeps a vault holding a login at ADDRESS and
// the agent's key, an org-visible agent that declares that key and one no
// vault holds and lists a plugin whose server takes a login at ADDRESS, and an
// app user its service account minted.
async function world(): Promise<World> {
  const tenancy = await lane.provisionTenancy();
  fixtures.defer(() => lane.cleanupTenancy(tenancy));
  const org = tenancy.org;
  const founder = lane.clients;
  await setEmbedding(founder, org, { signInRole: IamRole.member });
  const minter = await createMinter(founder, { org, name: uniqueName("cov-minter") });
  fixtures.defer(() => deleteMinter(founder, minter.accountId).catch(() => undefined));
  const appUser = lane.clientsPresenting(
    await mintUserToken(lane.clientsPresenting(minter.key), org, uniqueName("cov-app-user")),
  );

  const vault = await founder.vaultCommand.create(
    makeSharedVault({ org, name: uniqueName("cov-everyone") }),
  );
  fixtures.defer(() => founder.vaultCommand.delete({ resourceId: vault.metadata!.id }));
  await founder.vaultCommand.setConnection(
    setConnectionInput(vaultTarget(org, vault.metadata!.id), ADDRESS, "everyone-login"),
  );
  await founder.vaultCommand.setSecrets(
    setSecretsInput(vaultTarget(org, vault.metadata!.id), { COV_AGENT_KEY: "everyone-key" }),
  );

  const plugin = await pushPlugin(
    founder,
    fixtures,
    org,
    oneServerPlugin({
      name: uniqueName("cov-login"),
      server: { url: ADDRESS, headers: { Authorization: "Bearer ${COV_LOGIN}" } },
    }),
    { visibility: ApiResourceVisibility.visibility_org },
  );
  const input = makeAgent({
    org,
    name: uniqueName("cov-agent"),
    env: { COV_AGENT_KEY: {}, COV_NOWHERE: {} },
    plugins: [plugin.metadata!.slug],
  });
  input.metadata = { ...input.metadata, visibility: ApiResourceVisibility.visibility_org };
  const agent = await founder.agentCommand.create(input);
  fixtures.defer(() => founder.agentCommand.delete({ value: agent.metadata!.id }));

  return {
    org,
    founder,
    appUser,
    vault: { id: vault.metadata!.id, slug: vault.metadata!.slug, name: vault.metadata!.name },
    agent: { id: agent.metadata!.id, org },
  };
}

// The embedding settings, naming the founder's vault.
async function nameVault(w: World): Promise<void> {
  await w.founder.organizationCommand.updateEmbedding({
    orgId: w.org,
    embedding: {
      createAccountsOnSignIn: true,
      signInRole: IamRole.member,
      vaults: [{ kind: ApiResourceKind.vault, org: w.org, id: w.vault.id }],
    },
  });
}

function coverageOf(by: ConformanceClients, w: World) {
  return by.agentQuery.checkEmbeddingCoverage({
    agent: { kind: ApiResourceKind.agent, org: w.agent.org, id: w.agent.id },
    org: w.org,
  });
}

describe.skipIf(!enforcementServed)(
  "embedding coverage — what an app user's chat asks before a conversation (userTokens targets)",
  () => {
    it("[rpc:AgentQueryController.checkEmbeddingCoverage] an app user learns which of the agent's keys and sign-ins the embedding settings fill, by name only", async () => {
      const w = await world();

      const before = await coverageOf(w.appUser, w);
      expect([before.keys, before.signInAddresses], "no vault named yet").toEqual([[], []]);

      await nameVault(w);
      const after = await coverageOf(w.appUser, w);
      expect(after.keys, "the agent's key the vault holds, not the one nowhere").toEqual(["COV_AGENT_KEY"]);
      expect(after.signInAddresses, "the plugin's server, signed in at its address").toEqual([ADDRESS]);

      const text = JSON.stringify({ keys: after.keys, signInAddresses: after.signInAddresses });
      for (const hidden of [w.vault.id, w.vault.slug, w.vault.name, "everyone-login", "everyone-key"]) {
        expect(text, `the answer carries no ${hidden}`).not.toContain(hidden);
      }
    });

    it("[rpc:AgentQueryController.checkEmbeddingCoverage] a first-party person gets an empty answer: their runs never read the embedding settings", async () => {
      const w = await world();
      await nameVault(w);
      const answer = await coverageOf(w.founder, w);
      expect([answer.keys, answer.signInAddresses]).toEqual([[], []]);
    });

    it("[rpc:AgentQueryController.checkEmbeddingCoverage] a caller who cannot view the agent is refused as getByReference refuses them", async () => {
      const w = await world();
      await nameVault(w);
      const privateInput = makeAgent({ org: w.org, name: uniqueName("cov-private"), env: { COV_AGENT_KEY: {} } });
      privateInput.metadata = { ...privateInput.metadata, visibility: ApiResourceVisibility.visibility_private };
      const hidden = await w.founder.agentCommand.create(privateInput);
      fixtures.defer(() => w.founder.agentCommand.delete({ value: hidden.metadata!.id }));
      const ref = { kind: ApiResourceKind.agent, org: w.org, id: hidden.metadata!.id };

      const read = await expectGrpcCode(
        () => w.appUser.agentQuery.getByReference(ref),
        Code.PermissionDenied,
        "an app user's read of a private agent",
      );
      const refused = await expectGrpcCode(
        () => w.appUser.agentQuery.checkEmbeddingCoverage({ agent: ref, org: w.org }),
        Code.PermissionDenied,
        "an app user's coverage read of a private agent",
      );
      expect(refused.rawMessage).toBe(read.rawMessage);
    });
  },
);
