import { describe, it, expect } from "vitest";
import {
  specWorkspaceToInput,
  specMcpUsagesToInput,
  specSkillRefsToInput,
} from "../session-spec-converters";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

type SessionSpec = Session["spec"];

function makeSpec(overrides: Partial<NonNullable<SessionSpec>> = {}): SessionSpec {
  return {
    agentInstanceId: "",
    subject: "",
    harnessStateId: "",
    metadata: {},
    workspaceEntries: [],
    mcpServerUsages: [],
    skillRefs: [],
    harness: 0,
    cursorMode: 0,
    ...overrides,
  } as unknown as SessionSpec;
}

describe("specWorkspaceToInput", () => {
  it("returns undefined for undefined spec", () => {
    expect(specWorkspaceToInput(undefined)).toBeUndefined();
  });

  it("returns empty array for spec with no workspace entries", () => {
    expect(specWorkspaceToInput(makeSpec())).toEqual([]);
  });

  it("converts git repo entries", () => {
    const spec = makeSpec({
      workspaceEntries: [
        {
          name: "my-repo",
          source: {
            source: {
              case: "gitRepo" as const,
              value: { url: "https://github.com/org/repo", branch: "main", commit: "", depth: 0 },
            },
          },
        },
      ] as unknown as SessionSpec extends undefined ? never : NonNullable<SessionSpec>["workspaceEntries"],
    });

    const result = specWorkspaceToInput(spec);
    expect(result).toEqual([
      {
        name: "my-repo",
        source: {
          gitRepo: {
            url: "https://github.com/org/repo",
            branch: "main",
            commit: undefined,
            depth: undefined,
          },
        },
      },
    ]);
  });

  it("converts local path entries", () => {
    const spec = makeSpec({
      workspaceEntries: [
        {
          name: "local",
          source: {
            source: {
              case: "localPath" as const,
              value: { path: "/home/user/project" },
            },
          },
        },
      ] as unknown as SessionSpec extends undefined ? never : NonNullable<SessionSpec>["workspaceEntries"],
    });

    const result = specWorkspaceToInput(spec);
    expect(result).toEqual([
      {
        name: "local",
        source: {
          localPath: { path: "/home/user/project" },
        },
      },
    ]);
  });
});

describe("specMcpUsagesToInput", () => {
  it("returns undefined for undefined spec", () => {
    expect(specMcpUsagesToInput(undefined)).toBeUndefined();
  });

  it("returns empty array for spec with no MCP server usages", () => {
    expect(specMcpUsagesToInput(makeSpec())).toEqual([]);
  });

  it("converts MCP server usages with ref and enabled tools", () => {
    const spec = makeSpec({
      mcpServerUsages: [
        {
          mcpServerRef: {
            org: "acme",
            slug: "github-tools",
            version: "v1",
            kind: ApiResourceKind.mcp_server,
          },
          enabledTools: ["create_issue", "list_prs"],
          toolApprovalOverrides: [],
        },
      ] as unknown as NonNullable<SessionSpec>["mcpServerUsages"],
    });

    const result = specMcpUsagesToInput(spec);
    expect(result).toEqual([
      {
        mcpServerRef: {
          org: "acme",
          slug: "github-tools",
          version: "v1",
          kind: ApiResourceKind.mcp_server,
        },
        enabledTools: ["create_issue", "list_prs"],
        toolApprovalOverrides: undefined,
      },
    ]);
  });

  it("converts MCP server usages with tool approval overrides", () => {
    const spec = makeSpec({
      mcpServerUsages: [
        {
          mcpServerRef: {
            org: "acme",
            slug: "shell",
            version: "",
            kind: ApiResourceKind.mcp_server,
          },
          enabledTools: [],
          toolApprovalOverrides: [
            { toolName: "exec", requiresApproval: true, message: "Dangerous" },
          ],
        },
      ] as unknown as NonNullable<SessionSpec>["mcpServerUsages"],
    });

    const result = specMcpUsagesToInput(spec);
    expect(result).toHaveLength(1);
    expect(result![0].toolApprovalOverrides).toEqual([
      { toolName: "exec", requiresApproval: true, message: "Dangerous" },
    ]);
  });
});

describe("specSkillRefsToInput", () => {
  it("returns undefined for undefined spec", () => {
    expect(specSkillRefsToInput(undefined)).toBeUndefined();
  });

  it("returns empty array for spec with no skill refs", () => {
    expect(specSkillRefsToInput(makeSpec())).toEqual([]);
  });

  it("converts skill references", () => {
    const spec = makeSpec({
      skillRefs: [
        { org: "acme", slug: "code-review", version: "v2", kind: ApiResourceKind.skill },
        { org: "acme", slug: "testing", version: "", kind: ApiResourceKind.skill },
      ] as unknown as NonNullable<SessionSpec>["skillRefs"],
    });

    const result = specSkillRefsToInput(spec);
    expect(result).toEqual([
      { org: "acme", slug: "code-review", version: "v2", kind: ApiResourceKind.skill },
      { org: "acme", slug: "testing", version: undefined, kind: ApiResourceKind.skill },
    ]);
  });
});
