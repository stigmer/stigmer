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

import { create, type Message } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { RenameInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { RenameInput, UpdateVisibilityInput } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
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
    // Server preserved stored org; manifest declares platform.
    const { handler, calls } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_org),
      updateVisibility: () => Promise.resolve(agent(ApiResourceVisibility.visibility_platform)),
    });

    const outcome = await applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_platform), "acme", false);

    expect(calls).toHaveLength(1);
    expect(calls[0].resourceId).toBe("agent-1");
    expect(calls[0].visibility).toBe(ApiResourceVisibility.visibility_platform);
    expect(outcome.warning).toBeUndefined();
    const appliedMeta = (outcome.applied as { metadata?: { visibility?: ApiResourceVisibility } })?.metadata;
    expect(appliedMeta?.visibility).toBe(ApiResourceVisibility.visibility_platform);
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
      applyReturns: agent(ApiResourceVisibility.visibility_platform),
      updateVisibility: () => Promise.reject(new Error("must not be called")),
    });

    const outcome = await applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_platform), "acme", false);

    expect(calls).toHaveLength(0);
    expect(outcome.warning).toBeUndefined();
  });

  it("warns instead of silently swallowing a diff on kinds without the RPC", async () => {
    const { handler } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_private),
    });

    const outcome = await applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_platform), "acme", false);

    expect(outcome.warning).toMatch(/visibility cannot be changed declaratively/);
    expect(outcome.warning).toMatch(/stored value is kept/);
  });

  it("fails loudly when the guarded door rejects, naming the partial state", async () => {
    // e.g. the default-instance FAILED_PRECONDITION or an unsupported level.
    const { handler } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_org),
      updateVisibility: () => Promise.reject(new Error("default instances do not have their own visibility")),
    });

    await expect(
      applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_platform), "acme", false),
    ).rejects.toThrow(/spec applied, but the manifest's visibility change was rejected/);
  });

  it("does not follow up in dry-run mode", async () => {
    const { handler, calls } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_org),
      updateVisibility: () => Promise.reject(new Error("must not be called")),
    });

    const outcome = await applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_platform), "acme", true);

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
        return Promise.resolve(agent(ApiResourceVisibility.visibility_platform));
      },
      rename: (_c, input) => {
        renameCalls.push(input);
        return Promise.reject(new ConnectError("the slug is taken", Code.AlreadyExists));
      },
    };
    const manifest = create(AgentSchema, {
      metadata: { id: "agent-1", slug: "taken", org: "acme", visibility: ApiResourceVisibility.visibility_platform },
    });

    await expect(applyMessage(controller, handler, manifest, "acme", false)).rejects.toThrow(
      /Agent spec and visibility applied, but the manifest's slug change was rejected: .*the slug is taken\. The slug stays 'reviewer'; choose another slug and apply again\./,
    );
    expect(visibilityCalls).toHaveLength(1);
    expect(visibilityCalls[0].visibility).toBe(ApiResourceVisibility.visibility_platform);
    expect(renameCalls).toHaveLength(1);
  });

  it("carries the visibility warning into a refused rename for a kind without the visibility door", async () => {
    const { handler } = organizationHandler(organization("acme"), () => Promise.reject(new Error("the slug is taken")));
    const manifest = create(OrganizationSchema, {
      metadata: { id: ACME_ID, name: "Acme", slug: "taken", visibility: ApiResourceVisibility.visibility_platform },
    });

    await expect(applyMessage(controller, handler, manifest, "", false)).rejects.toThrow(
      /Organization spec applied \(Organization visibility cannot be changed declaratively.*\), but the manifest's slug change was rejected/,
    );
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
});
