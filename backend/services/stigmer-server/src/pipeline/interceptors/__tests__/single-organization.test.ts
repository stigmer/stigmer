/**
 * Pins the single-organization fill (interceptors/single-organization.ts):
 *
 *   - `fillRuleFor` reads one path per method from the contract: a
 *     top-level `org`; `metadata.org` for a kind scoped to an organization
 *     or a parent; nothing for the Organization service or a kind that
 *     belongs to no organization;
 *   - the holder settles once;
 *   - over the real interceptor chain, a unary request with an empty org
 *     reaches protovalidate and the handler filled, an explicit org and a
 *     request with nothing to fill pass untouched (the caller's message is
 *     never mutated), and a holder with no organization fills nothing.
 */
import { create } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import { createClient, createRouterTransport } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { ExecutionContextQueryController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/query_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { createLogger } from "../../../boot/logger.js";
import { buildInterceptorChain } from "../../chain.js";
import { createVerifierChainInterceptor } from "../auth.js";
import {
  createSingleOrganizationInterceptor,
  fillRuleFor,
  newSingleOrganizationHolder,
} from "../single-organization.js";
import type { SingleOrganization } from "../single-organization.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

describe("fillRuleFor — one path per method, from the contract", () => {
  it.each([
    [
      "an org-scoped kind's create fills metadata.org",
      AgentCommandController.method.create,
      { path: "metadata.org" },
    ],
    [
      "an org-scoped kind's apply fills metadata.org",
      AgentCommandController.method.apply,
      { path: "metadata.org" },
    ],
    [
      "a parent-scoped kind (an execution, its session's organization) fills metadata.org",
      AgentExecutionCommandController.method.create,
      { path: "metadata.org" },
    ],
    [
      "a top-level org on a service with no kind fills org",
      SearchService.method.search,
      { path: "org" },
    ],
    [
      "a top-level org on an owner-only kind (the identity provider's organization) fills org",
      IdentityAccountCommandController.method.createFederatedAccount,
      { path: "org" },
    ],
    [
      "a reference lookup's top-level org fills org",
      ExecutionContextQueryController.method.getByReference,
      { path: "org" },
    ],
    [
      "an owner-only kind's metadata is never filled",
      IdentityAccountCommandController.method.create,
      { path: undefined, notFilled: "kind belongs to no organization" },
    ],
    [
      "the Organization service's own create is never filled",
      OrganizationCommandController.method.create,
      { path: undefined, notFilled: "organization service" },
    ],
    [
      "the Organization service's own find is never filled",
      OrganizationQueryController.method.find,
      { path: undefined, notFilled: "organization service" },
    ],
    [
      "a method that takes no organization has no rule",
      OrganizationQueryController.method.findMyOrganizations,
      { path: undefined },
    ],
  ])("%s", (_name, method, expected) => {
    expect(fillRuleFor(method)).toEqual(expected);
  });
});

describe("the holder", () => {
  it("settles once; an empty organization is no organization", () => {
    const holder = newSingleOrganizationHolder();
    expect(holder.current()).toBeUndefined();
    holder.settle("");
    expect(holder.current()).toBeUndefined();
    expect(() => holder.settle("stigmer")).toThrow(
      "the single organization is settled once per process, in start()",
    );
  });
});

const AGENT = {
  apiVersion: "agentic.stigmer.ai/v1",
  kind: "Agent",
  metadata: { name: "fill test agent" },
  spec: { instructions: "An agent the fill tests create." },
} as const;

/** The real chain with the fill installed, an Agent service that records what reached its handler, and a search service. */
function harness(organization: SingleOrganization) {
  const seen: Message[] = [];
  const passedOn: Message[] = [];
  const recordPassedOn: Interceptor = (next) => (request) => {
    passedOn.push(request.message as Message);
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
    },
    {
      router: {
        interceptors: [
          ...buildInterceptorChain(
            silentLogger,
            createVerifierChainInterceptor([], [], silentLogger),
            {
              errorBoundary: (next) => (request) => next(request),
              requestMetrics: (next) => (request) => next(request),
              singleOrganization:
                createSingleOrganizationInterceptor(organization),
            },
          ),
          recordPassedOn,
        ],
      },
    },
  );
  return {
    agents: createClient(AgentCommandController, transport),
    search: createClient(SearchService, transport),
    seen,
    passedOn,
  };
}

const holding = (org: string | undefined): SingleOrganization => ({
  current: () => org,
});

describe("the fill over the interceptor chain", () => {
  it("an empty metadata.org reaches validation and the handler filled", async () => {
    const { agents, seen } = harness(holding("stigmer"));
    const made = await agents.create(AGENT);
    expect(made.metadata?.org).toBe("stigmer");
    expect(seen).toHaveLength(1);
  });

  it("an empty top-level org is filled", async () => {
    const { search, seen } = harness(holding("stigmer"));
    await search.search({ query: "anything" });
    expect(seen).toMatchObject([{ org: "stigmer" }]);
  });

  it("an explicit org is never touched", async () => {
    const { agents, passedOn } = harness(holding("stigmer"));
    const made = await agents.create({
      ...AGENT,
      metadata: { ...AGENT.metadata, org: "elsewhere" },
    });
    expect(made.metadata?.org).toBe("elsewhere");
    expect(passedOn).toMatchObject([{ metadata: { org: "elsewhere" } }]);
  });

  it("the caller's message is never mutated: the fill hands on a clone", async () => {
    const holder = holding("stigmer");
    const interceptor = createSingleOrganizationInterceptor(holder);
    const original = create(AgentSchema, AGENT);
    let handedOn: Message | undefined;
    await interceptor(async (request) => {
      handedOn = request.message as Message;
      return { message: create(AgentSchema), stream: false } as never;
    })({
      stream: false,
      method: AgentCommandController.method.create,
      service: AgentCommandController,
      message: original,
    } as never);
    expect(original.metadata?.org).toBe("");
    expect(handedOn).not.toBe(original);
    expect((handedOn as typeof original).metadata?.org).toBe("stigmer");
  });

  it("a request whose metadata is unset passes untouched: validation refuses it on its own", async () => {
    const interceptor = createSingleOrganizationInterceptor(holding("stigmer"));
    const original = create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
    });
    let handedOn: Message | undefined;
    await interceptor(async (request) => {
      handedOn = request.message as Message;
      return { message: create(AgentSchema), stream: false } as never;
    })({
      stream: false,
      method: AgentCommandController.method.create,
      service: AgentCommandController,
      message: original,
    } as never);
    expect(handedOn).toBe(original);
  });

  it("a holder with no organization fills nothing", async () => {
    const { search, seen } = harness(holding(undefined));
    await search.search({ query: "anything" });
    expect(seen).toMatchObject([{ org: "" }]);
  });
});
