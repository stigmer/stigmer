/**
 * The Cursor engine's setup-time refusals over the agent's tool lists
 * (`turn-setup.ts` `checkToolScope`) and how the turn classifies them: each
 * is a typed refusal the adapter settles on the `actionable` surface with its
 * own sentence (`turn.ts`), never the internal-error copy, for the agent's
 * lists and a turn's over them alike. Also the read root an excluded `Read`
 * is confined to (`platformReadRoot`) and the root a hidden skill's read is
 * refused under (`platformRealRoot`). The hermetic
 * tool-lists test pins the settled status for the two refusals a local
 * session can reach; the cloud refusal is pinned here, because the runner
 * routes every session local today.
 */

import { describe, expect, it, onTestFinished } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { TurnInput } from "../../../harness/types.js";
import { ToolListResolutionError, ToolScope, type ToolLists } from "../../../shared/tool-lists.js";
import { CursorToolListRefusal, checkToolScope, platformReadRoot, platformRealRoot } from "../turn-setup.js";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** One resolved server as the inventory reads it: its slug and what the turn start listed of it (null: its listing failed). */
interface ServerFacts {
  readonly slug: string;
  readonly listedTools: readonly string[] | null;
}

/** The four fields `checkToolScope` reads, as a turn input. */
function input(
  lists: ToolLists,
  subAgentLists: ToolLists[] = [],
  servers: readonly ServerFacts[] = [],
  platformServerSlugs: readonly string[] = [],
): TurnInput {
  const subAgents = subAgentLists.map((l, i) =>
    create(SubAgentSchema, { name: `sub-${i}`, tools: [...l.tools], disallowedTools: [...l.disallowedTools] }),
  );
  return {
    executionId: "aex-1",
    blueprint: { subAgents },
    mcp: {
      toolScope: ToolScope.of('Agent "a"', lists),
      servers: servers.map(({ slug }) => ({ slug })),
      listing: {
        listed: servers.flatMap(({ slug, listedTools }) => (listedTools === null ? [] : [{ server: slug, tools: listedTools }])),
        destructive: [],
        unlisted: servers.filter(({ listedTools }) => listedTools === null).map(({ slug }) => slug),
      },
      platformServerSlugs: new Set(platformServerSlugs),
    },
  } as unknown as TurnInput;
}

describe("checkToolScope", () => {
  it("passes an agent with no lists on either mode", () => {
    expect(() => checkToolScope(input({ tools: [], disallowedTools: [] }), { agentMode: "cloud" })).not.toThrow();
  });

  it("refuses a cloud agent with lists, naming the agent", () => {
    const run = () => checkToolScope(input({ tools: ["Read"], disallowedTools: [] }), { agentMode: "cloud" });
    expect(run).toThrow(CursorToolListRefusal);
    expect(run).toThrow('Agent "a" has tool lists, which a cloud Cursor agent cannot enforce');
  });

  it("refuses a sub-agent with lists of its own on a local agent", () => {
    const run = () =>
      checkToolScope(input({ tools: [], disallowedTools: [] }, [{ tools: [], disallowedTools: ["Bash"] }]), {
        agentMode: "local",
      });
    expect(run).toThrow(CursorToolListRefusal);
    expect(run).toThrow('Sub-agent "sub-0" carries its own tool lists');
  });

  describe("an MCP entry resolves against the turn's servers", () => {
    const servers: ServerFacts[] = [
      { slug: "github", listedTools: ["list_prs"] },
      { slug: "fresh", listedTools: null },
    ];
    const check = (tools: string[]) => () =>
      checkToolScope(input({ tools, disallowedTools: [] }, [], servers), { agentMode: "local" });

    it("a listed tool and a whole attached server resolve", () => {
      expect(check(["mcp__github__list_prs"])).not.toThrow();
      expect(check(["mcp__github"])).not.toThrow();
    });

    it("a tool the listing did not name on a server it did list names nothing", () => {
      expect(check(["mcp__github__merge_pr"])).toThrow(ToolListResolutionError);
    });

    it("any tool of a server whose listing failed resolves: absence cannot be proven", () => {
      expect(check(["mcp__fresh__anything"])).not.toThrow();
    });

    it("the platform's own attachments count for nothing, as on the native engine", () => {
      const platformOnly = (tools: string[]) => () =>
        checkToolScope(input({ tools, disallowedTools: [] }, [], [{ slug: "stigmer-memory", listedTools: ["remember"] }], ["stigmer-memory"]), {
          agentMode: "local",
        });
      expect(platformOnly(["mcp__*"])).toThrow(ToolListResolutionError);
      expect(platformOnly(["mcp__stigmer-memory__remember"])).toThrow(ToolListResolutionError);
      // A user server beside it still answers mcp__*.
      const withUserServer = input({ tools: ["mcp__*"], disallowedTools: [] }, [], [...servers, { slug: "stigmer-memory", listedTools: null }], ["stigmer-memory"]);
      expect(() => checkToolScope(withUserServer, { agentMode: "local" })).not.toThrow();
    });

    it("a server the turn does not have names nothing", () => {
      expect(check(["mcp__elsewhere__x"])).toThrow(ToolListResolutionError);
    });
  });

  it("checks only the sub-agents Agent(type, …) admits: an excluded one's lists cannot matter", () => {
    const lists = { tools: ["Read", "Agent(sub-1)"], disallowedTools: [] };
    // sub-0 carries lists but Agent(sub-1) excludes it: its lists are not the
    // refusal; the type list itself is.
    const excludedOnly = input(lists, [{ tools: ["Read"], disallowedTools: [] }, { tools: [], disallowedTools: [] }]);
    const run = () => checkToolScope(excludedOnly, { agentMode: "local" });
    expect(run).toThrow("lists Agent(sub-1), which the Cursor engine cannot enforce");
    expect(run).not.toThrow("sub-0");
    // The admitted sub-1 carrying lists refuses the turn, named, first.
    const admitted = input(lists, [{ tools: [], disallowedTools: [] }, { tools: ["Read"], disallowedTools: [] }]);
    expect(() => checkToolScope(admitted, { agentMode: "local" })).toThrow('Sub-agent "sub-1" carries its own tool lists');
  });

  describe("an Agent(type, …) type list", () => {
    const check = (tools: string[], disallowedTools: string[] = []) => () =>
      checkToolScope(input({ tools, disallowedTools }), { agentMode: "local" });

    it("is refused on this engine, naming the entry: Cursor's own sub-agent types start unseen", () => {
      expect(check(["Read", "Agent(explore)"])).toThrow(CursorToolListRefusal);
      expect(check(["Read", "Agent(explore)"])).toThrow(
        'Agent "a" lists Agent(explore), which the Cursor engine cannot enforce: it cannot limit which sub-agents an agent starts. ' +
          "Run this agent on the native engine, or list Agent without types.",
      );
    });

    it("is not refused when there is no type limit: bare Agent, bare Agent beside a typed one, or Agent excluded", () => {
      expect(check(["Read", "Agent"])).not.toThrow();
      expect(check(["Agent(explore)", "Agent"])).not.toThrow();
      expect(check(["Read"])).not.toThrow();
      expect(check([], ["Agent"])).not.toThrow();
    });
  });

  it("refuses a tools list that names nothing the turn has with the shared resolution error", () => {
    const run = () => checkToolScope(input({ tools: ["NotebookEdit"], disallowedTools: [] }), { agentMode: "local" });
    expect(run).toThrow(ToolListResolutionError);
  });

  describe("a turn's lists over the agent's", () => {
    function layered(agent: ToolLists, turn: ToolLists): TurnInput {
      const base = input(agent);
      const toolScope = ToolScope.ofMain([
        { owner: 'Agent "a"', lists: agent },
        { owner: "The turn", lists: turn },
      ]);
      return { ...base, mcp: { ...base.mcp, toolScope } } as TurnInput;
    }

    it("names every owner whose list types Agent", () => {
      const run = () =>
        checkToolScope(layered({ tools: ["Read", "Agent(explore)"], disallowedTools: [] }, { tools: ["Agent(explore, plan)"], disallowedTools: [] }), {
          agentMode: "local",
        });
      expect(run).toThrow('Agent "a" lists Agent(explore); The turn lists Agent(explore, plan), which the Cursor engine cannot enforce');
    });

    it("refuses a turn tools list the agent leaves nothing of, in the turn's name", () => {
      const run = () =>
        checkToolScope(layered({ tools: [], disallowedTools: ["Bash"] }, { tools: ["Bash"], disallowedTools: [] }), { agentMode: "local" });
      expect(run).toThrow(new ToolListResolutionError("The turn", ["Bash"]));
    });
  });
});

describe("platformRealRoot", () => {
  it("is the platform dir's real path whatever the link, and empty when the dir does not exist", async () => {
    const platform = mkdtempSync(join(tmpdir(), "real-root-platform-"));
    onTestFinished(() => rmSync(platform, { recursive: true, force: true }));
    expect(await platformRealRoot(platform)).toBe(realpathSync(platform));
    expect(await platformRealRoot(join(platform, "missing"))).toBe("");
  });
});

describe("platformReadRoot", () => {
  function dirs(): { workspace: string; platform: string } {
    const workspace = mkdtempSync(join(tmpdir(), "read-root-ws-"));
    const platform = mkdtempSync(join(tmpdir(), "read-root-platform-"));
    onTestFinished(() => {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(platform, { recursive: true, force: true });
    });
    return { workspace, platform };
  }

  it("is the platform dir's real path on a turn whose .stigmer links to it", async () => {
    const { workspace, platform } = dirs();
    symlinkSync(platform, join(workspace, ".stigmer"), "dir");
    expect(await platformReadRoot(workspace, platform)).toBe(realpathSync(platform));
  });

  it("is empty on a turn with no link, or with the repository's own .stigmer link", async () => {
    const { workspace, platform } = dirs();
    expect(await platformReadRoot(workspace, platform)).toBe("");
    mkdirSync(join(workspace, "elsewhere"));
    symlinkSync(join(workspace, "elsewhere"), join(workspace, ".stigmer"), "dir");
    expect(await platformReadRoot(workspace, platform)).toBe("");
  });
});
