/**
 * Pins the organization-name resolver (interceptors/organization-names.ts)
 * over a router transport whose handlers record what reaches them:
 *
 *   - every organization a request names by slug reaches the handler as
 *     its id: `metadata.org`, a reference's `org` nested in a spec, a
 *     top-level `org`, the Organization service's own annotated id, and a
 *     policy ref whose kind is organization;
 *   - an id, an empty value, a name nothing holds and a policy ref of
 *     another kind pass untouched, and a request that needs nothing is
 *     handed on as it came;
 *   - each distinct name is looked up once, and the caller's message is
 *     never mutated;
 *   - the field rule reads the contract's spelling (`org`, `*_org`,
 *     `orgs`) and the annotation, and is safe on recursive message types;
 *     its list arm is pinned on the fixture below, since no contract
 *     message holds a repeated `orgs` today;
 *   - the walk reaches every shape the rule allows, over a fixture service
 *     built from a descriptor here, since no served method's input holds
 *     them today: a repeated `orgs`, an `org` inside the values of a map,
 *     and an annotation whose path holds no string (passed over, never a
 *     failure); an annotated path through an unset message is passed over.
 */
import { create, createFileRegistry, setExtension } from "@bufbuild/protobuf";
import type {
  DescMessage,
  DescMethodUnary,
  DescService,
  Message,
} from "@bufbuild/protobuf";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
  MethodOptionsSchema,
} from "@bufbuild/protobuf/wkt";
import { createClient, createRouterTransport } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { GrantCommandController } from "@stigmer/protos/ai/stigmer/iam/grant/v1/command_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { RpcAuthorizationConfigSchema } from "@stigmer/protos/ai/stigmer/commons/rpc/authorization_config_pb";
import { config as rpcAuthorizationConfig } from "@stigmer/protos/ai/stigmer/commons/rpc/method_options_pb";

import {
  annotatedOrganizationPath,
  createOrganizationNameInterceptor,
  isOrganizationId,
  namesOrganization,
  organizationFieldsOf,
} from "../organization-names.js";
import type { OrganizationNameResolver } from "../organization-names.js";

const ACME = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const GLOBEX = "org_01jbbbbbbbbbbbbbbbbbbbbbbb";

/** A resolver over a fixed table, counting its lookups. */
function resolverOf(table: Record<string, string>): OrganizationNameResolver & {
  lookups: string[];
} {
  const lookups: string[] = [];
  return {
    lookups,
    resolve: async (name) => {
      lookups.push(name);
      return table[name];
    },
  };
}

function harness(resolver: OrganizationNameResolver) {
  const seen: Message[] = [];
  const passedOn: Message[] = [];
  const recordPassedOn: Interceptor = (next) => (request) => {
    if (!request.stream) {
      passedOn.push(request.message);
    }
    return next(request);
  };
  const transport = createRouterTransport(
    (router) => {
      router.service(AgentCommandController, {
        create: (request) => {
          seen.push(request);
          return create(AgentSchema, request);
        },
      });
      router.service(SearchService, {
        search: (request) => {
          seen.push(request);
          return {};
        },
      });
      router.service(OrganizationQueryController, {
        get: (request) => {
          seen.push(request);
          return create(OrganizationSchema);
        },
      });
      router.service(GrantCommandController, {
        bootstrapGrant: (request) => {
          seen.push(request);
          return create(GrantSchema);
        },
      });
    },
    {
      transport: {
        interceptors: [
          createOrganizationNameInterceptor(resolver),
          recordPassedOn,
        ],
      },
    },
  );
  return {
    seen,
    passedOn,
    agents: createClient(AgentCommandController, transport),
    search: createClient(SearchService, transport),
    organizations: createClient(OrganizationQueryController, transport),
    policies: createClient(GrantCommandController, transport),
  };
}

describe("the organization-name resolver", () => {
  it("turns every organization a resource names by slug into its id, nested references included", async () => {
    const resolver = resolverOf({ acme: ACME, globex: GLOBEX });
    const { agents, seen } = harness(resolver);
    const input = create(AgentSchema, {
      metadata: { org: "acme", slug: "helper" },
      spec: {
        skillRefs: [
          create(ApiResourceReferenceSchema, { org: "globex", slug: "search" }),
          create(ApiResourceReferenceSchema, { org: "acme", slug: "write" }),
          create(ApiResourceReferenceSchema, { org: "", slug: "same-org" }),
        ],
      },
    });

    await agents.create(input);

    const agent = seen[0] as typeof input;
    expect(agent.metadata?.org).toBe(ACME);
    expect(agent.spec?.skillRefs.map((ref) => ref.org)).toEqual([
      GLOBEX,
      ACME,
      "",
    ]);
    expect(resolver.lookups.sort(), "each distinct name once").toEqual([
      "acme",
      "globex",
    ]);
    expect(input.metadata?.org, "the caller's message is untouched").toBe("acme");
  });

  it("resolves a top-level org, the Organization service's annotated id, and a policy ref of kind organization", async () => {
    const resolver = resolverOf({ acme: ACME });
    const { search, organizations, policies: grants, seen } = harness(resolver);

    await search.search({ org: "acme" });
    await organizations.get({ value: "acme" });
    await grants.bootstrapGrant({
      principal: { kind: "identity_account", id: "acme" },
      resource: { kind: "organization", id: "acme" },
      relation: "member",
    });

    expect((seen[0] as unknown as { org: string }).org).toBe(ACME);
    expect((seen[1] as unknown as { value: string }).value).toBe(ACME);
    const policy = seen[2] as unknown as {
      principal?: { id: string };
      resource?: { id: string };
    };
    expect(policy.resource?.id).toBe(ACME);
    expect(
      policy.principal?.id,
      "a ref of another kind is not an organization",
    ).toBe("acme");
  });

  it("passes ids, empty values and names nothing holds through untouched, handing on the request as it came", async () => {
    const resolver = resolverOf({});
    const { agents, search, passedOn } = harness(resolver);
    const byId = create(AgentSchema, { metadata: { org: ACME, slug: "a" } });
    const unknown = { org: "nobody-holds-this" };

    await agents.create(byId);
    await search.search(unknown);
    await search.search({ org: "" });

    expect((passedOn[0] as typeof byId).metadata?.org).toBe(ACME);
    expect((passedOn[1] as unknown as { org: string }).org).toBe("nobody-holds-this");
    expect(resolver.lookups, "an id and an empty value need no lookup").toEqual([
      "nobody-holds-this",
    ]);
  });
});

describe("the field rule, from the contract", () => {
  it("names organization fields by the spelling rule only", () => {
    const fields = (schema: { fields: Parameters<typeof namesOrganization>[0][] }) =>
      schema.fields.filter(namesOrganization).map((f) => f.name);
    expect(fields(ApiResourceReferenceSchema)).toEqual(["org"]);
    expect(
      fields(fixtureService().holder),
      "a repeated string named orgs; a map and a message field are not",
    ).toEqual(["orgs"]);
  });

  it("lists an input's organization fields at any depth, and the annotation of the Organization service", () => {
    expect(organizationFieldsOf(AgentSchema)).toEqual(
      expect.arrayContaining(["metadata.org", "spec.skill_refs.org"]),
    );
    expect(organizationFieldsOf(OrganizationSchema)).toContain("metadata.org");
    expect(annotatedOrganizationPath(OrganizationQueryController.method.get)).toBe(
      "value",
    );
    expect(annotatedOrganizationPath(OrganizationCommandController.method.rename)).toBe(
      "resource_id",
    );
    expect(annotatedOrganizationPath(AgentCommandController.method.create)).toBe(
      "metadata.org",
    );
    expect(annotatedOrganizationPath(SearchService.method.search)).toBeUndefined();
  });

  it("tells a minted id from a slug", () => {
    expect(isOrganizationId(ACME)).toBe(true);
    expect(isOrganizationId("acme")).toBe(false);
    expect(isOrganizationId("org-acme")).toBe(false);
    expect(isOrganizationId("org_ACME")).toBe(false);
  });
});

/**
 * A fixture service whose input holds the shapes no served method's input
 * holds today:
 *
 *   message Ref { string org = 1; }
 *   message Holder { map<string, Ref> refs = 1; repeated string orgs = 2; Ref ref = 3; }
 *   service Fixture {
 *     // annotated with kind organization at `ref`, a message, not a string
 *     rpc Put(Holder) returns (Holder);
 *   }
 */
function fixtureService(): { service: DescService; holder: DescMessage } {
  const { STRING: TYPE_STRING, MESSAGE: TYPE_MESSAGE } = FieldDescriptorProto_Type;
  const { OPTIONAL: LABEL_OPTIONAL, REPEATED: LABEL_REPEATED } = FieldDescriptorProto_Label;
  const options = create(MethodOptionsSchema);
  setExtension(
    options,
    rpcAuthorizationConfig,
    create(RpcAuthorizationConfigSchema, {
      resourceKind: ApiResourceKind.organization,
      fieldPath: "ref",
    }),
  );
  const registry = createFileRegistry(
    create(FileDescriptorProtoSchema, {
      name: "organization_names_fixture.proto",
      package: "organizationnames.fixture.v1",
      syntax: "proto3",
      messageType: [
        {
          name: "Ref",
          field: [{ name: "org", number: 1, type: TYPE_STRING, label: LABEL_OPTIONAL, jsonName: "org" }],
        },
        {
          name: "Holder",
          field: [
            {
              name: "refs",
              number: 1,
              type: TYPE_MESSAGE,
              label: LABEL_REPEATED,
              typeName: ".organizationnames.fixture.v1.Holder.RefsEntry",
              jsonName: "refs",
            },
            { name: "orgs", number: 2, type: TYPE_STRING, label: LABEL_REPEATED, jsonName: "orgs" },
            {
              name: "ref",
              number: 3,
              type: TYPE_MESSAGE,
              label: LABEL_OPTIONAL,
              typeName: ".organizationnames.fixture.v1.Ref",
              jsonName: "ref",
            },
          ],
          nestedType: [
            {
              name: "RefsEntry",
              options: { mapEntry: true },
              field: [
                { name: "key", number: 1, type: TYPE_STRING, label: LABEL_OPTIONAL, jsonName: "key" },
                {
                  name: "value",
                  number: 2,
                  type: TYPE_MESSAGE,
                  label: LABEL_OPTIONAL,
                  typeName: ".organizationnames.fixture.v1.Ref",
                  jsonName: "value",
                },
              ],
            },
          ],
        },
      ],
      service: [
        {
          name: "Fixture",
          method: [
            {
              name: "Put",
              inputType: ".organizationnames.fixture.v1.Holder",
              outputType: ".organizationnames.fixture.v1.Holder",
              options,
            },
          ],
        },
      ],
    }),
    () => undefined,
  );
  const service = registry.getService("organizationnames.fixture.v1.Fixture");
  const holder = registry.getMessage("organizationnames.fixture.v1.Holder");
  if (service === undefined || holder === undefined) {
    throw new Error("the fixture descriptor did not build");
  }
  return { service, holder };
}

describe("the walk over every shape the field rule allows", () => {
  const { service, holder } = fixtureService();
  const put = service.methods[0] as DescMethodUnary<DescMessage, DescMessage>;

  /** Calls Put through the resolver, answering what reached the handler. */
  async function putThrough(
    resolver: OrganizationNameResolver,
    message: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const seen: Message[] = [];
    const transport = createRouterTransport(
      (router) => {
        router.rpc(put, (request: Message) => {
          seen.push(request);
          return request;
        });
      },
      { transport: { interceptors: [createOrganizationNameInterceptor(resolver)] } },
    );
    // The fixture's descriptor is built at run time, so its client has no
    // generated method types; Put is called by the shape it has.
    const client = createClient(service, transport) as unknown as {
      put(request: Message): Promise<Message>;
    };
    await client.put(create(holder, message));
    return seen[0] as unknown as Record<string, unknown>;
  }

  it("lists the repeated orgs, the orgs inside a map's values, and not the annotation that holds no string", () => {
    expect(organizationFieldsOf(holder).sort()).toEqual(["orgs", "ref.org", "refs.org"]);
    expect(annotatedOrganizationPath(put), "the annotation is read as written").toBe("ref");
  });

  it("resolves every element of a repeated orgs and the org in every map value, leaving ids and unknown names", async () => {
    const resolver = resolverOf({ acme: ACME, globex: GLOBEX });
    const reached = await putThrough(resolver, {
      orgs: ["acme", ACME, "", "nobody-holds-this"],
      refs: {
        first: { org: "globex" },
        second: { org: "acme" },
        third: { org: "" },
      },
    });

    expect(reached.orgs).toEqual([ACME, ACME, "", "nobody-holds-this"]);
    const refs = reached.refs as Record<string, { org: string }>;
    expect(refs.first?.org).toBe(GLOBEX);
    expect(refs.second?.org).toBe(ACME);
    expect(refs.third?.org).toBe("");
    expect(resolver.lookups.sort()).toEqual(["acme", "globex", "nobody-holds-this"]);
  });

  it("passes over an annotated path that ends at a message, resolving the org inside it by the field rule alone", async () => {
    const resolver = resolverOf({ acme: ACME });
    const reached = await putThrough(resolver, { ref: { org: "acme" } });
    expect((reached.ref as { org: string }).org).toBe(ACME);
    expect(resolver.lookups).toEqual(["acme"]);
  });

  it("passes over an annotated path whose message is unset", async () => {
    // AgentCommandController.create is annotated at metadata.org; an agent
    // with no metadata names no organization and reaches the handler as sent.
    const resolver = resolverOf({ acme: ACME });
    const { agents, seen } = harness(resolver);
    await agents.create(create(AgentSchema, { spec: { description: "no metadata" } }));
    expect((seen[0] as unknown as { metadata?: unknown }).metadata).toBeUndefined();
    expect(resolver.lookups).toEqual([]);
  });
});
