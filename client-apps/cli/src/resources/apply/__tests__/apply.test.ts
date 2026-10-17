// Unit tests for the shared apply core's follow-ups through guarded doors.
// Plain updates preserve stored visibility (oss#573) and an organization's
// slug, so the apply RPC's response carries the STORED values; when a
// manifest declares a different level the core lands it through
// updateVisibility (or warns when the kind has no such door), and when an
// organization manifest carries its id and a different slug, through rename.
// Visibility lands first, so a refused rename reports what landed with it,
// and its advice follows the refusal's code. And the org-mismatch warning:
// an organization is named by id or slug, so two different strings are
// asked about before they are called different, and the warning names each
// by slug; a lookup that fails for another reason fails the apply. The
// dry-run preview names the organization by slug too.
// And the Organization handler's rename binding, which the follow-up drives.
// An organization's policies follow the visibility precedent: update and
// apply keep the stored policies, so a manifest that declares different ones
// lands them through updatePolicies, and a refusal says the spec landed.
// A write the server refuses for naming a renamed-away slug (SLUG_RENAMED)
// is answered with the slug the resource has now, read as the caller by the
// old one; a caller who may not read it gets the server's words. Every
// manifest kind with a rename binds it, beside its read by reference. A kind
// with no rename keeps its slug, and the apply warns that the file's slug
// was not applied.

import { create, type Message } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { RenameInputSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import type { RenameInput, UpdateVisibilityInput } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";
import type { UpdateOrganizationPoliciesInput } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb";
import { UpdateOrganizationPoliciesInputSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb";
import { describe, expect, it } from "vitest";
import { applyMessage } from "../apply.js";
import { APPLY_HANDLERS } from "../handlers.js";
import type { ApplyHandler, ControllerFn } from "../handlers.js";

// The controller accessor is only ever forwarded to handler methods, which
// these tests stub out — a throwing dummy proves nothing else touches it.
const controller: ControllerFn = () => {
  throw new Error("unexpected controller access");
};

function agent(visibility: ApiResourceVisibility, id = "agent-1") {
  return create(AgentSchema, {
    metadata: { id, name: "a", org: "acme", visibility },
    spec: { instructions: "i" },
  });
}

interface HandlerOptions {
  applyReturns: Message;
  updateVisibility?: (input: UpdateVisibilityInput) => Promise<Message>;
}

function handlerWith(opts: HandlerOptions): { handler: ApplyHandler; calls: UpdateVisibilityInput[] } {
  const calls: UpdateVisibilityInput[] = [];
  const handler: ApplyHandler = {
    kind: ApiResourceKind.agent,
    displayName: "Agent",
    schema: AgentSchema,
    applyOrder: 3,
    apply: () => Promise.resolve(opts.applyReturns),
    ...(opts.updateVisibility !== undefined && {
      updateVisibility: (_c: ControllerFn, input: UpdateVisibilityInput) => {
        calls.push(input);
        return opts.updateVisibility!(input);
      },
    }),
  };
  return { handler, calls };
}

describe("applyMessage declared-visibility follow-up", () => {
  it("lands a declared level the update preserved away, and reflects it on the outcome", async () => {
    // Server preserved stored org; manifest declares child-orgs.
    const { handler, calls } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_org),
      updateVisibility: () => Promise.resolve(agent(ApiResourceVisibility.visibility_child_orgs)),
    });

    const outcome = await applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_child_orgs), "acme", false);

    expect(calls).toHaveLength(1);
    expect(calls[0].resourceId).toBe("agent-1");
    expect(calls[0].visibility).toBe(ApiResourceVisibility.visibility_child_orgs);
    expect(outcome.warning).toBeUndefined();
    const appliedMeta = (outcome.applied as { metadata?: { visibility?: ApiResourceVisibility } })?.metadata;
    expect(appliedMeta?.visibility).toBe(ApiResourceVisibility.visibility_child_orgs);
  });

  it("skips the follow-up when the manifest omits visibility", async () => {
    const { handler, calls } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_org),
      updateVisibility: () => Promise.reject(new Error("must not be called")),
    });

    const outcome = await applyMessage(
      controller,
      handler,
      agent(ApiResourceVisibility.api_resource_visibility_unspecified),
      "acme",
      false,
    );

    expect(calls).toHaveLength(0);
    expect(outcome.warning).toBeUndefined();
  });

  it("skips the follow-up when the server already matches (idempotent re-apply)", async () => {
    const { handler, calls } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_child_orgs),
      updateVisibility: () => Promise.reject(new Error("must not be called")),
    });

    const outcome = await applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_child_orgs), "acme", false);

    expect(calls).toHaveLength(0);
    expect(outcome.warning).toBeUndefined();
  });

  it("warns instead of silently swallowing a diff on kinds without the RPC", async () => {
    const { handler } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_private),
    });

    const outcome = await applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_child_orgs), "acme", false);

    expect(outcome.warning).toMatch(/visibility cannot be changed declaratively/);
    expect(outcome.warning).toMatch(/stored value is kept/);
  });

  it("fails loudly when the guarded door rejects, naming the partial state", async () => {
    // e.g. a level the kind does not support.
    const { handler } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_org),
      updateVisibility: () => Promise.reject(new Error("child-orgs visibility is not supported for this kind")),
    });

    await expect(
      applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_child_orgs), "acme", false),
    ).rejects.toThrow(/spec applied, but the manifest's visibility change was rejected/);
  });

  it("does not follow up in dry-run mode", async () => {
    const { handler, calls } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_org),
      updateVisibility: () => Promise.reject(new Error("must not be called")),
    });

    const outcome = await applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_child_orgs), "acme", true);

    expect(calls).toHaveLength(0);
    expect(outcome.applied).toBeUndefined();
  });
});

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

function organization(slug: string, id = ACME_ID) {
  return create(OrganizationSchema, { metadata: { id, name: "Acme", slug } });
}

function organizationHandler(applyReturns: Message, rename: (input: RenameInput) => Promise<Message>) {
  const calls: RenameInput[] = [];
  const handler: ApplyHandler = {
    kind: ApiResourceKind.organization,
    displayName: "Organization",
    schema: OrganizationSchema,
    applyOrder: 0,
    apply: () => Promise.resolve(applyReturns),
    rename: (_c: ControllerFn, input: RenameInput) => {
      calls.push(input);
      return rename(input);
    },
  };
  return { handler, calls };
}

describe("applyMessage declared-slug follow-up", () => {
  it("renames an organization whose manifest carries its id and a new slug, and reflects it on the outcome", async () => {
    const { handler, calls } = organizationHandler(organization("acme"), () => Promise.resolve(organization("acme-corp")));

    const outcome = await applyMessage(controller, handler, organization("acme-corp"), "", false);

    expect(calls).toHaveLength(1);
    expect(calls[0].resourceId).toBe(ACME_ID);
    expect(calls[0].slug).toBe("acme-corp");
    expect((outcome.applied as { metadata?: { slug?: string } }).metadata?.slug).toBe("acme-corp");
  });

  it("does not rename when the manifest carries no id (the slug is how apply finds it) or the same slug", async () => {
    const { handler, calls } = organizationHandler(organization("acme"), () => Promise.reject(new Error("must not be called")));

    await applyMessage(controller, handler, organization("acme-corp", ""), "", false);
    await applyMessage(controller, handler, organization("acme"), "", false);

    expect(calls).toHaveLength(0);
  });

  it("fails loudly when the rename is refused, naming the partial state and how to finish", async () => {
    const { handler } = organizationHandler(organization("acme"), () =>
      Promise.reject(new ConnectError("the slug is taken", Code.AlreadyExists)),
    );

    await expect(applyMessage(controller, handler, organization("taken"), "", false)).rejects.toThrow(
      /Organization spec applied, but the manifest's slug change was rejected: .*the slug is taken\. The slug stays 'acme'; choose another slug and apply again\.$/,
    );
  });

  it("tells a caller who may not rename that renaming needs the organization's owner, not to pick another slug", async () => {
    const { handler } = organizationHandler(organization("acme"), () =>
      Promise.reject(new ConnectError("can_delete required", Code.PermissionDenied)),
    );

    const err = await applyMessage(controller, handler, organization("acme-corp"), "", false).catch((e: unknown) => e);

    expect((err as Error).message).toMatch(
      /slug change was rejected: .*can_delete required\. The slug stays 'acme'; renaming needs the organization's owner\.$/,
    );
    expect((err as Error).message).not.toMatch(/choose another slug/);
  });

  it("gives no advice for any other refusal", async () => {
    const { handler } = organizationHandler(organization("acme"), () =>
      Promise.reject(new ConnectError("backend unavailable", Code.Unavailable)),
    );

    const err = await applyMessage(controller, handler, organization("acme-corp"), "", false).catch((e: unknown) => e);

    expect((err as Error).message).toMatch(/slug change was rejected: .*backend unavailable\. The slug stays 'acme'\.$/);
  });

  it("lands a declared visibility before a refused rename, and the refusal says both landed", async () => {
    const visibilityCalls: UpdateVisibilityInput[] = [];
    const renameCalls: RenameInput[] = [];
    const stored = create(AgentSchema, {
      metadata: { id: "agent-1", slug: "reviewer", org: "acme", visibility: ApiResourceVisibility.visibility_org },
    });
    const handler: ApplyHandler = {
      kind: ApiResourceKind.agent,
      displayName: "Agent",
      schema: AgentSchema,
      applyOrder: 3,
      apply: () => Promise.resolve(stored),
      updateVisibility: (_c, input) => {
        visibilityCalls.push(input);
        return Promise.resolve(agent(ApiResourceVisibility.visibility_child_orgs));
      },
      rename: (_c, input) => {
        renameCalls.push(input);
        return Promise.reject(new ConnectError("the slug is taken", Code.AlreadyExists));
      },
    };
    const manifest = create(AgentSchema, {
      metadata: { id: "agent-1", slug: "taken", org: "acme", visibility: ApiResourceVisibility.visibility_child_orgs },
    });

    await expect(applyMessage(controller, handler, manifest, "acme", false)).rejects.toThrow(
      /Agent spec and visibility applied, but the manifest's slug change was rejected: .*the slug is taken\. The slug stays 'reviewer'; choose another slug and apply again\./,
    );
    expect(visibilityCalls).toHaveLength(1);
    expect(visibilityCalls[0].visibility).toBe(ApiResourceVisibility.visibility_child_orgs);
    expect(renameCalls).toHaveLength(1);
  });

  it("carries the visibility warning into a refused rename for a kind without the visibility door", async () => {
    const { handler } = organizationHandler(organization("acme"), () => Promise.reject(new Error("the slug is taken")));
    const manifest = create(OrganizationSchema, {
      metadata: { id: ACME_ID, name: "Acme", slug: "taken", visibility: ApiResourceVisibility.visibility_child_orgs },
    });

    await expect(applyMessage(controller, handler, manifest, "", false)).rejects.toThrow(
      /Organization spec applied \(Organization visibility cannot be changed declaratively.*\), but the manifest's slug change was rejected/,
    );
  });
});

describe("applyMessage on a kind that cannot rename", () => {
  it("lands the spec and warns that the file's new slug was not applied", async () => {
    const stored = create(SessionSchema, { metadata: { id: "ses-1", name: "triage", slug: "triage", org: "acme" } });
    const handler: ApplyHandler = {
      kind: ApiResourceKind.session,
      displayName: "Session",
      schema: SessionSchema,
      applyOrder: 14,
      apply: () => Promise.resolve(stored),
    };
    const manifest = create(SessionSchema, { metadata: { id: "ses-1", name: "triage", slug: "triage-q3", org: "acme" } });

    const outcome = await applyMessage(controller, handler, manifest, "acme", false);

    expect(outcome.result.status).toBe("success");
    expect(outcome.warning).toBe(
      "Session slugs do not change: the file's metadata.slug 'triage-q3' was not applied, and the slug stays 'triage'",
    );
    expect((outcome.applied as { metadata?: { slug?: string } }).metadata?.slug).toBe("triage");
  });

  it("stays quiet when the file names the stored slug, or carries no id", async () => {
    const stored = create(SessionSchema, { metadata: { id: "ses-1", name: "triage", slug: "triage", org: "acme" } });
    const handler: ApplyHandler = {
      kind: ApiResourceKind.session,
      displayName: "Session",
      schema: SessionSchema,
      applyOrder: 14,
      apply: () => Promise.resolve(stored),
    };

    for (const metadata of [
      { id: "ses-1", name: "triage", slug: "triage", org: "acme" },
      { name: "triage", slug: "triage", org: "acme" },
    ]) {
      const outcome = await applyMessage(controller, handler, create(SessionSchema, { metadata }), "acme", false);
      expect(outcome.warning).toBeUndefined();
    }
  });
});

describe("applyMessage on a write naming a renamed-away slug", () => {
  const SERVER_WORDS =
    "Agent 'reviewer' was renamed; it still leads to the same agent for reading. Write to it by its current slug or its id";

  function slugRenamed(): ConnectError {
    return new ConnectError(SERVER_WORDS, Code.FailedPrecondition, undefined, [
      { desc: ErrorInfoSchema, value: create(ErrorInfoSchema, { reason: "SLUG_RENAMED", domain: "stigmer.ai", metadata: { slug: "reviewer" } }) },
    ]);
  }

  function renamedAgentHandler(read: (ref: ApiResourceReference) => Promise<Message>) {
    const asked: ApiResourceReference[] = [];
    const handler: ApplyHandler = {
      kind: ApiResourceKind.agent,
      displayName: "Agent",
      schema: AgentSchema,
      applyOrder: 3,
      apply: () => Promise.reject(slugRenamed()),
      getByReference: (_c, ref) => {
        asked.push(ref);
        return read(ref);
      },
    };
    return { handler, asked };
  }

  const manifest = () => create(AgentSchema, { metadata: { name: "a", slug: "reviewer", org: "acme" }, spec: { instructions: "i" } });

  it("names the slug the resource has now, read as the caller by the old slug", async () => {
    const { handler, asked } = renamedAgentHandler(() =>
      Promise.resolve(create(AgentSchema, { metadata: { id: "agent-1", slug: "code-reviewer", org: "acme" } })),
    );

    const err = await applyMessage(controller, handler, manifest(), "acme", false).catch((e: unknown) => e);

    expect((err as Error).message).toBe(
      "Agent 'reviewer' was renamed to 'code-reviewer'; update the file's metadata.slug to 'code-reviewer' and apply again",
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ kind: ApiResourceKind.agent, org: "acme", slug: "reviewer" });
  });

  it("gives the server's words to a caller who may not read the resource", async () => {
    const { handler } = renamedAgentHandler(() => Promise.reject(new ConnectError("unauthorized to view agent", Code.PermissionDenied)));

    const err = await applyMessage(controller, handler, manifest(), "acme", false).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).rawMessage).toBe(SERVER_WORDS);
  });

  it("gives the server's words when the read finds the slug the file names, or no slug", async () => {
    for (const slug of ["reviewer", ""]) {
      const { handler } = renamedAgentHandler(() => Promise.resolve(create(AgentSchema, { metadata: { id: "agent-1", slug, org: "acme" } })));

      const err = await applyMessage(controller, handler, manifest(), "acme", false).catch((e: unknown) => e);

      expect((err as ConnectError).rawMessage, `read answered '${slug}'`).toBe(SERVER_WORDS);
    }
  });

  it("leaves every other refusal as it is, reading nothing", async () => {
    const { handler, asked } = renamedAgentHandler(() => Promise.reject(new Error("must not be called")));
    const refusing: ApplyHandler = { ...handler, apply: () => Promise.reject(new ConnectError("the slug is taken", Code.AlreadyExists)) };

    const err = await applyMessage(controller, refusing, manifest(), "acme", false).catch((e: unknown) => e);

    expect((err as ConnectError).code).toBe(Code.AlreadyExists);
    expect(asked).toHaveLength(0);
  });

  it("tells a caller who may not rename an agent that renaming needs what deleting it needs", async () => {
    const stored = create(AgentSchema, { metadata: { id: "agent-1", slug: "reviewer", org: "acme" } });
    const handler: ApplyHandler = {
      kind: ApiResourceKind.agent,
      displayName: "Agent",
      schema: AgentSchema,
      applyOrder: 3,
      apply: () => Promise.resolve(stored),
      rename: () => Promise.reject(new ConnectError("unauthorized to rename agent", Code.PermissionDenied)),
    };
    const renaming = create(AgentSchema, { metadata: { id: "agent-1", slug: "code-reviewer", org: "acme" } });

    const err = await applyMessage(controller, handler, renaming, "acme", false).catch((e: unknown) => e);

    expect((err as Error).message).toMatch(/The slug stays 'reviewer'; renaming needs the permission to delete the agent\.$/);
  });
});

describe("the renamable manifest kinds' handlers", () => {
  it("bind rename and a read by reference on every kind whose service has a rename", () => {
    for (const kind of [
      ApiResourceKind.organization,
      ApiResourceKind.agent,
      ApiResourceKind.routine,
      ApiResourceKind.channel_app,
      ApiResourceKind.channel,
      ApiResourceKind.oauth_app,
      ApiResourceKind.federation_issuer,
    ]) {
      const handler = APPLY_HANDLERS.get(kind);
      expect(handler?.rename, ApiResourceKind[kind]).toBeDefined();
      expect(handler?.getByReference, ApiResourceKind[kind]).toBeDefined();
    }
    for (const kind of [ApiResourceKind.session]) {
      expect(APPLY_HANDLERS.get(kind)?.rename, ApiResourceKind[kind]).toBeUndefined();
    }
  });
});

describe("applyMessage on an organization beside other kinds", () => {
  it("leaves the organization's own org empty, whatever organization the file's other kinds go to", async () => {
    const sent: Message[] = [];
    const { handler } = organizationHandler(organization("acme"), () => Promise.reject(new Error("must not be called")));
    const recording: ApplyHandler = {
      ...handler,
      apply: (_c, message) => {
        sent.push(message);
        return Promise.resolve(organization("acme"));
      },
    };

    const outcome = await applyMessage(controller, recording, organization("acme", ""), ACME_ID, false);
    const preview = await applyMessage(controller, recording, organization("acme", ""), ACME_ID, true);

    expect((sent[0] as { metadata?: { org?: string } }).metadata?.org).toBe("");
    expect(outcome.warning).toBeUndefined();
    expect(preview.warning).toBeUndefined();
  });
});

describe("applyMessage org-mismatch warning", () => {
  /** A controller whose organization get answers the id each value names, or NotFound. */
  function organizationsNaming(ids: Record<string, string>): ControllerFn {
    return (() => ({
      get: ({ value }: { value: string }) =>
        ids[value] === undefined
          ? Promise.reject(new ConnectError("not found", Code.NotFound))
          : Promise.resolve(organization(value, ids[value])),
    })) as unknown as ControllerFn;
  }

  it("stays quiet when the manifest's org and the target name the same organization in different forms", async () => {
    const { handler } = handlerWith({ applyReturns: agent(ApiResourceVisibility.visibility_org) });
    const outcome = await applyMessage(
      organizationsNaming({ acme: ACME_ID, [ACME_ID]: ACME_ID }),
      handler,
      agent(ApiResourceVisibility.api_resource_visibility_unspecified),
      ACME_ID,
      true,
    );
    expect(outcome.warning).toBeUndefined();
  });

  it("asks once per organization for a whole command, however many documents name it", async () => {
    const asked: string[] = [];
    const counting = (() => ({
      get: ({ value }: { value: string }) => {
        asked.push(value);
        return Promise.resolve(organization(value, ACME_ID));
      },
    })) as unknown as ControllerFn;
    const { handler } = handlerWith({ applyReturns: agent(ApiResourceVisibility.visibility_org) });
    for (let document = 0; document < 3; document++) {
      await applyMessage(counting, handler, agent(ApiResourceVisibility.api_resource_visibility_unspecified), ACME_ID, true);
    }
    expect(asked.sort()).toEqual(["acme", ACME_ID].sort());
  });

  it("warns when they name different organizations, or one the caller cannot see", async () => {
    const { handler } = handlerWith({ applyReturns: agent(ApiResourceVisibility.visibility_org) });
    const outcome = await applyMessage(
      organizationsNaming({ acme: ACME_ID, globex: "org_01jbbbbbbbbbbbbbbbbbbbbbbb" }),
      handler,
      agent(ApiResourceVisibility.api_resource_visibility_unspecified),
      "globex",
      true,
    );
    expect(outcome.warning).toMatch(/resource org 'acme' differs from target org 'globex'; using 'acme'/);
  });

  it("warns when the caller cannot see the target, since no lookup can prove the two the same", async () => {
    const { handler } = handlerWith({ applyReturns: agent(ApiResourceVisibility.visibility_org) });
    const outcome = await applyMessage(
      organizationsNaming({ acme: ACME_ID }),
      handler,
      agent(ApiResourceVisibility.api_resource_visibility_unspecified),
      "hidden",
      true,
    );
    expect(outcome.warning).toMatch(/resource org 'acme' differs from target org 'hidden'; using 'acme'/);
  });

  it("names both organizations by slug where the manifest and the target give ids", async () => {
    const GLOBEX_ID = "org_01jbbbbbbbbbbbbbbbbbbbbbbb";
    const slugs: Record<string, string> = { [ACME_ID]: "acme", [GLOBEX_ID]: "globex" };
    const answering = (() => ({
      get: ({ value }: { value: string }) =>
        slugs[value] === undefined
          ? Promise.reject(new ConnectError("not found", Code.NotFound))
          : Promise.resolve(organization(slugs[value], value)),
    })) as unknown as ControllerFn;
    const { handler } = handlerWith({ applyReturns: agent(ApiResourceVisibility.visibility_org) });
    const manifest = create(AgentSchema, { metadata: { id: "agent-1", name: "a", org: ACME_ID } });

    const outcome = await applyMessage(answering, handler, manifest, GLOBEX_ID, true);

    expect(outcome.warning).toBe("resource org 'acme' differs from target org 'globex'; using 'acme'");
  });

  it("fails the apply when a lookup fails for any reason but not being able to see the organization", async () => {
    const unreachable = (() => ({
      get: () => Promise.reject(new ConnectError("backend unavailable", Code.Unavailable)),
    })) as unknown as ControllerFn;
    const { handler } = handlerWith({ applyReturns: agent(ApiResourceVisibility.visibility_org) });

    await expect(
      applyMessage(unreachable, handler, agent(ApiResourceVisibility.api_resource_visibility_unspecified), "globex", true),
    ).rejects.toThrow(/backend unavailable/);
  });
});

describe("applyMessage dry-run preview", () => {
  it("names the organization by slug where the injected one is an id, and as given where the caller cannot see it", async () => {
    const answering = (() => ({
      get: ({ value }: { value: string }) =>
        value === ACME_ID
          ? Promise.resolve(organization("acme"))
          : Promise.reject(new ConnectError("permission denied", Code.PermissionDenied)),
    })) as unknown as ControllerFn;
    const { handler } = handlerWith({ applyReturns: agent(ApiResourceVisibility.visibility_org) });
    const orgOf = (outcome: Awaited<ReturnType<typeof applyMessage>>) =>
      outcome.result.sections[0]?.fields.find((field) => field.key === "Org")?.value;

    const named = await applyMessage(answering, handler, create(AgentSchema, { metadata: { name: "a" } }), ACME_ID, true);
    const hidden = await applyMessage(answering, handler, create(AgentSchema, { metadata: { name: "a" } }), "org_01jbbbbbbbbbbbbbbbbbbbbbbb", true);

    expect(orgOf(named)).toBe("acme");
    expect(orgOf(hidden)).toBe("org_01jbbbbbbbbbbbbbbbbbbbbbbb");
  });
});

describe("the Organization apply handler", () => {
  it("sends a slug change through the Organization service's rename, the only door for it", async () => {
    const handler = APPLY_HANDLERS.get(ApiResourceKind.organization);
    const services: unknown[] = [];
    const renames: RenameInput[] = [];
    const recording = ((service: unknown) => {
      services.push(service);
      return {
        rename: (input: RenameInput) => {
          renames.push(input);
          return Promise.resolve(organization(input.slug));
        },
      };
    }) as unknown as ControllerFn;
    const input = create(RenameInputSchema, { resourceId: ACME_ID, slug: "acme-corp" });

    const renamed = await handler?.rename?.(recording, input);

    expect(services).toEqual([OrganizationCommandController]);
    expect(renames).toEqual([input]);
    expect((renamed as { metadata?: { slug?: string } } | undefined)?.metadata?.slug).toBe("acme-corp");
  });

  it("reads an organization by reference through the Organization service's get, by its slug", async () => {
    const handler = APPLY_HANDLERS.get(ApiResourceKind.organization);
    const services: unknown[] = [];
    const asked: string[] = [];
    const recording = ((service: unknown) => {
      services.push(service);
      return {
        get: ({ value }: { value: string }) => {
          asked.push(value);
          return Promise.resolve(organization("acme-corp"));
        },
      };
    }) as unknown as ControllerFn;

    const found = await handler?.getByReference?.(recording, create(ApiResourceReferenceSchema, { slug: "acme" }));

    expect(services).toEqual([OrganizationQueryController]);
    expect(asked).toEqual(["acme"]);
    expect((found as { metadata?: { slug?: string } } | undefined)?.metadata?.slug).toBe("acme-corp");
  });
});

function organizationWithPolicies(membersCanCreateAgents: boolean | undefined) {
  return create(OrganizationSchema, {
    metadata: { id: ACME_ID, name: "Acme", slug: "acme" },
    spec: membersCanCreateAgents === undefined ? {} : { policies: { membersCanCreateAgents } },
  });
}

function policiesHandler(
  applyReturns: Message,
  updatePolicies: (input: UpdateOrganizationPoliciesInput) => Promise<Message>,
) {
  const calls: UpdateOrganizationPoliciesInput[] = [];
  const handler: ApplyHandler = {
    kind: ApiResourceKind.organization,
    displayName: "Organization",
    schema: OrganizationSchema,
    applyOrder: 0,
    apply: () => Promise.resolve(applyReturns),
    updatePolicies: (_c: ControllerFn, input: UpdateOrganizationPoliciesInput) => {
      calls.push(input);
      return updatePolicies(input);
    },
  };
  return { handler, calls };
}

describe("applyMessage declared-policies follow-up", () => {
  it("lands declared policies that differ from the stored ones, and reflects them on the outcome", async () => {
    const { handler, calls } = policiesHandler(organizationWithPolicies(true), () =>
      Promise.resolve(organizationWithPolicies(false)),
    );

    const outcome = await applyMessage(controller, handler, organizationWithPolicies(false), "", false);

    expect(calls).toHaveLength(1);
    expect(calls[0].orgId).toBe(ACME_ID);
    expect(calls[0].policies?.membersCanCreateAgents).toBe(false);
    expect((outcome.applied as ReturnType<typeof organizationWithPolicies>).spec?.policies?.membersCanCreateAgents).toBe(
      false,
    );
  });

  it("skips the follow-up when the manifest declares no policies or the stored ones", async () => {
    const { handler, calls } = policiesHandler(organizationWithPolicies(false), () =>
      Promise.reject(new Error("must not be called")),
    );

    await applyMessage(controller, handler, organizationWithPolicies(undefined), "", false);
    await applyMessage(controller, handler, organizationWithPolicies(false), "", false);

    expect(calls).toHaveLength(0);
  });

  it("reads an organization stored without policies as holding the defaults", async () => {
    const { handler, calls } = policiesHandler(organizationWithPolicies(undefined), () =>
      Promise.reject(new Error("must not be called")),
    );

    await applyMessage(controller, handler, organizationWithPolicies(true), "", false);

    expect(calls).toHaveLength(0);
  });

  it("fails loudly when the change is refused, saying the spec landed", async () => {
    const { handler } = policiesHandler(organizationWithPolicies(true), () =>
      Promise.reject(new ConnectError("unauthorized to update organization policies", Code.PermissionDenied)),
    );

    await expect(applyMessage(controller, handler, organizationWithPolicies(false), "", false)).rejects.toThrow(
      /^Organization spec applied, but the manifest's policies change was rejected: .*unauthorized to update organization policies/,
    );
  });
});

describe("the Organization apply handler's policies door", () => {
  it("sends a policies change through the Organization service's updatePolicies", async () => {
    const handler = APPLY_HANDLERS.get(ApiResourceKind.organization);
    const services: unknown[] = [];
    const inputs: UpdateOrganizationPoliciesInput[] = [];
    const recording = ((service: unknown) => {
      services.push(service);
      return {
        updatePolicies: (input: UpdateOrganizationPoliciesInput) => {
          inputs.push(input);
          return Promise.resolve(organizationWithPolicies(input.policies?.membersCanCreateAgents));
        },
      };
    }) as unknown as ControllerFn;
    const input = create(UpdateOrganizationPoliciesInputSchema, {
      orgId: ACME_ID,
      policies: { membersCanCreateAgents: false },
    });

    await handler?.updatePolicies?.(recording, input);

    expect(services).toEqual([OrganizationCommandController]);
    expect(inputs).toEqual([input]);
  });
});
