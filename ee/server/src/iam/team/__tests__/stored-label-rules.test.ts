/**
 * Pins Enterprise's update chain on a team stored before the label and tag
 * rules: an update whose mask leaves labels and tags out keeps them as
 * stored and succeeds; one that changes them to values the rules refuse is
 * refused. The chain validates the merged team with the library's
 * ValidateProto of the state, so the rule is the library's (its own cases
 * are pinned beside ValidateProto in @stigmer/server).
 */
import { create } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
  type Interceptor,
} from "@connectrpc/connect";
import type { Authorizer, Logger } from "@stigmer/server";
import { callerIdentityKey, createLogger } from "@stigmer/server";
import { describe, expect, it } from "vitest";

import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { TeamSchema } from "@stigmer/apis/ai/stigmer/iam/team/v1/api_pb";
import { TeamCommandController } from "@stigmer/apis/ai/stigmer/iam/team/v1/command_pb";
import { TeamSpecSchema } from "@stigmer/apis/ai/stigmer/iam/team/v1/spec_pb";

import { newTeamServiceRegistrations, type TeamLaneDeps } from "../handlers.js";
import { InMemoryTeamStore, storedTeam } from "./in-memory-team-store.js";
import { inMemoryNames } from "../../../__test-utils__/in-memory-names.js";
import { UNBOUND_CREDENTIAL_BINDING } from "../../../__test-utils__/unbound-credential-binding.js";

const silent: Logger = createLogger({ level: "error", pretty: false, write: () => {} });

function admin(): Interceptor {
  return (next) => (request) => {
    request.contextValues.set(callerIdentityKey, {
      identityId: "ida_admin",
      callerClass: "user",
      issuer: "https://issuer.invalid",
      rawToken: "tok",
    });
    return next(request);
  };
}

const allowAll: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };

/** A team lane over an in-memory store holding one team with labels and tags the rules refuse. */
async function teamStoredWithBreakingLabels() {
  const teams = new InMemoryTeamStore();
  const names = inMemoryNames();
  const deps: TeamLaneDeps = {
    authorizer: allowAll,
    credentialBinding: UNBOUND_CREDENTIAL_BINDING,
    logger: silent,
    teams,
    names,
    removal: { remove: async () => {} },
    lifecycle: { onResourceCreated: async () => {} },
  };
  const team = storedTeam({ id: "tm_core", org: "acme", slug: "core" });
  team.metadata!.labels = { "team name": "core" };
  team.metadata!.tags = ["Prod"];
  await teams.insert(team);
  await names.resourceNames.claim({ kind: "team", org: "acme", name: "core" }, "tm_core", new Date().toISOString());
  const transport = createRouterTransport(
    (router) => {
      for (const register of newTeamServiceRegistrations(deps)) {
        register(router);
      }
    },
    { router: { interceptors: [admin()] } },
  );
  return { teams, commands: createClient(TeamCommandController, transport) };
}

function edit(labels: Record<string, string>, description: string) {
  return create(TeamSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "Team",
    metadata: create(ApiResourceMetadataSchema, { id: "tm_core", org: "acme", slug: "core", name: "core", labels }),
    spec: create(TeamSpecSchema, { description }),
  });
}

describe("a team stored with labels and tags the rules refuse", () => {
  it("an update masked to its description keeps them and succeeds", async () => {
    const { teams, commands } = await teamStoredWithBreakingLabels();

    const updated = await commands.update({
      resource: edit({}, "The people on call."),
      updateMask: { paths: ["spec.description"] },
    });

    expect(updated.spec?.description).toBe("The people on call.");
    const row = await teams.findById("tm_core");
    expect(row?.metadata?.labels).toEqual({ "team name": "core" });
    expect(row?.metadata?.tags).toEqual(["Prod"]);
  });

  it("an update that changes its labels to values the rules refuse is refused", async () => {
    const { commands } = await teamStoredWithBreakingLabels();

    const error = await commands
      .update({ resource: edit({ "on call": "yes" }, ""), updateMask: { paths: ["metadata.labels"] } })
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
  });
});
