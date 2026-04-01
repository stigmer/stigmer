import { describe, it, expect } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { fixtures, buildScenario, type FixtureSpec } from "../fixtures";
import { rpcKey } from "../types";

describe("fixtures", () => {
  describe("session", () => {
    it("get returns correct key and unary entry", () => {
      const handler = () => ({ id: "test" });
      const spec = fixtures.session.get(handler);

      expect(spec.key).toBe(
        "ai.stigmer.agentic.session.v1.SessionQueryController/get",
      );
      expect(spec.entry.unary).toBe(handler);
      expect(spec.entry.stream).toBeUndefined();
      expect(spec.searchResourceKind).toBeUndefined();
    });

    it("list returns correct key", () => {
      const spec = fixtures.session.list(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.agentic.session.v1.SessionQueryController/list",
      );
    });

    it("create returns correct key", () => {
      const spec = fixtures.session.create(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.agentic.session.v1.SessionCommandController/create",
      );
    });

    it("update returns correct key", () => {
      const spec = fixtures.session.update(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.agentic.session.v1.SessionCommandController/update",
      );
    });
  });

  describe("agentExecution", () => {
    it("subscribe returns a stream entry", () => {
      const handler = () => [{ id: "1" }, { id: "2" }];
      const spec = fixtures.agentExecution.subscribe(handler);

      expect(spec.key).toBe(
        "ai.stigmer.agentic.agentexecution.v1.AgentExecutionQueryController/subscribe",
      );
      expect(spec.entry.stream).toBe(handler);
      expect(spec.entry.unary).toBeUndefined();
    });

    it("listBySession returns correct key", () => {
      const spec = fixtures.agentExecution.listBySession(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.agentic.agentexecution.v1.AgentExecutionQueryController/listBySession",
      );
    });

    it("create returns correct key", () => {
      const spec = fixtures.agentExecution.create(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.agentic.agentexecution.v1.AgentExecutionCommandController/create",
      );
    });

    it("getArtifactContent returns correct key", () => {
      const spec = fixtures.agentExecution.getArtifactContent(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.agentic.agentexecution.v1.AgentExecutionQueryController/getArtifactContent",
      );
    });
  });

  describe("search-backed list helpers", () => {
    const searchKey = "ai.stigmer.search.v1.SearchService/search";

    it("agent.list sets searchResourceKind to agent", () => {
      const spec = fixtures.agent.list(() => ({}));
      expect(spec.key).toBe(searchKey);
      expect(spec.searchResourceKind).toBe(ApiResourceKind.agent);
    });

    it("skill.list sets searchResourceKind to skill", () => {
      const spec = fixtures.skill.list(() => ({}));
      expect(spec.key).toBe(searchKey);
      expect(spec.searchResourceKind).toBe(ApiResourceKind.skill);
    });

    it("mcpServer.list sets searchResourceKind to mcp_server", () => {
      const spec = fixtures.mcpServer.list(() => ({}));
      expect(spec.key).toBe(searchKey);
      expect(spec.searchResourceKind).toBe(ApiResourceKind.mcp_server);
    });
  });

  describe("other domains", () => {
    it("agent.getByReference returns correct key", () => {
      const spec = fixtures.agent.getByReference(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.agentic.agent.v1.AgentQueryController/getByReference",
      );
    });

    it("skill.getByReference returns correct key", () => {
      const spec = fixtures.skill.getByReference(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.agentic.skill.v1.SkillQueryController/getByReference",
      );
    });

    it("environment.list returns correct key", () => {
      const spec = fixtures.environment.list(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.agentic.environment.v1.EnvironmentQueryController/list",
      );
    });

    it("agentInstance.create returns correct key", () => {
      const spec = fixtures.agentInstance.create(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.agentic.agentinstance.v1.AgentInstanceCommandController/create",
      );
    });

    it("apiKey.findAll returns correct key", () => {
      const spec = fixtures.apiKey.findAll(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.iam.apikey.v1.ApiKeyQueryController/findAll",
      );
    });

    it("github.getOAuthAuthorizeUrl returns correct key", () => {
      const spec = fixtures.github.getOAuthAuthorizeUrl(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.platform.github.v1.GitHubService/getOAuthAuthorizeUrl",
      );
    });

    it("organization.create returns correct key", () => {
      const spec = fixtures.organization.create(() => ({}));
      expect(spec.key).toBe(
        "ai.stigmer.tenancy.organization.v1.OrganizationCommandController/create",
      );
    });
  });
});

describe("buildScenario", () => {
  it("creates a DemoScenario from direct fixture specs", () => {
    const sessionData = { id: "ses-1" };
    const scenario = buildScenario(
      fixtures.session.get(() => sessionData),
    );

    expect(scenario.fixtures).toBeInstanceOf(Map);
    const key = rpcKey(
      { typeName: "ai.stigmer.agentic.session.v1.SessionQueryController" },
      "get",
    );
    const entry = scenario.fixtures.get(key);
    expect(entry?.unary?.({})).toBe(sessionData);
  });

  it("merges search-backed list fixtures into a dispatch handler", () => {
    const agentData = { kind: "agent" };
    const skillData = { kind: "skill" };

    const scenario = buildScenario(
      fixtures.agent.list(() => agentData),
      fixtures.skill.list(() => skillData),
    );

    const searchKey = "ai.stigmer.search.v1.SearchService/search";
    const entry = scenario.fixtures.get(searchKey);
    expect(entry).toBeDefined();

    expect(entry!.unary!({ kinds: [ApiResourceKind.agent] })).toBe(agentData);
    expect(entry!.unary!({ kinds: [ApiResourceKind.skill] })).toBe(skillData);
  });

  it("throws for unregistered search resource kind", () => {
    const scenario = buildScenario(
      fixtures.agent.list(() => ({})),
    );

    const searchKey = "ai.stigmer.search.v1.SearchService/search";
    const entry = scenario.fixtures.get(searchKey)!;

    expect(() => entry.unary!({ kinds: [ApiResourceKind.skill] })).toThrow(
      "No search fixture for resource kind skill",
    );
  });

  it("combines direct and search specs", () => {
    const scenario = buildScenario(
      fixtures.session.get(() => ({ id: "ses-1" })),
      fixtures.agent.list(() => ({ entries: [] })),
    );

    const sessionKey =
      "ai.stigmer.agentic.session.v1.SessionQueryController/get";
    const searchKey = "ai.stigmer.search.v1.SearchService/search";

    expect(scenario.fixtures.has(sessionKey)).toBe(true);
    expect(scenario.fixtures.has(searchKey)).toBe(true);
  });

  it("returns empty fixtures when called with no args", () => {
    const scenario = buildScenario();
    expect(scenario.fixtures.size).toBe(0);
  });
});
