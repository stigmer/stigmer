/**
 * The Cursor engine's setup-time refusals over the agent's tool lists
 * (`turn-setup.ts` `checkToolScope`) and how the turn classifies them: each
 * is a typed refusal the adapter settles on the `actionable` surface with its
 * own sentence (`turn.ts`), never the internal-error copy. Also the read root
 * an excluded `Read` is confined to (`platformReadRoot`). The hermetic
 * tool-lists test pins the settled status for the two refusals a local
 * session can reach; the cloud refusal is pinned here, because the runner
 * routes every session local today.
 */

import { describe, expect, it, onTestFinished } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { TurnInput } from "../../../harness/types.js";
import { ToolListResolutionError, ToolScope, type ToolLists } from "../../../shared/tool-lists.js";
import { CursorToolListRefusal, checkToolScope, platformReadRoot } from "../turn-setup.js";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** One resolved server as the inventory reads it: its slug and what discovery knows. */
interface ServerFacts {
  readonly slug: string;
  readonly discoveredToolNames: readonly string[] | null;
}

/** The four fields `checkToolScope` reads, as a turn input. */
function input(lists: ToolLists, subAgentLists: ToolLists[] = [], servers: readonly ServerFacts[] = []): TurnInput {
  const subAgents = subAgentLists.map((l, i) =>
    create(SubAgentSchema, { name: `sub-${i}`, tools: [...l.tools], disallowedTools: [...l.disallowedTools] }),
  );
  return {
    executionId: "aex-1",
    blueprint: { subAgents },
    mcp: { toolScope: ToolScope.of('Agent "a"', lists), servers },
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
      { slug: "github", discoveredToolNames: ["list_prs"] },
      { slug: "fresh", discoveredToolNames: null },
    ];
    const check = (tools: string[]) => () =>
      checkToolScope(input({ tools, disallowedTools: [] }, [], servers), { agentMode: "local" });

    it("a discovered tool and a whole attached server resolve", () => {
      expect(check(["mcp__github__list_prs"])).not.toThrow();
      expect(check(["mcp__github"])).not.toThrow();
    });

    it("a tool discovery never saw on a server it did see names nothing", () => {
      expect(check(["mcp__github__merge_pr"])).toThrow(ToolListResolutionError);
    });

    it("any tool of a server never discovered resolves: absence cannot be proven", () => {
      expect(check(["mcp__fresh__anything"])).not.toThrow();
    });

    it("a server the turn does not have names nothing", () => {
      expect(check(["mcp__elsewhere__x"])).toThrow(ToolListResolutionError);
    });
  });

  it("checks only the sub-agents Agent(type, …) admits: an excluded one's lists cannot matter", () => {
    const lists = { tools: ["Read", "Agent(sub-1)"], disallowedTools: [] };
    // sub-0 carries lists but Agent(sub-1) excludes it: never registered, never run.
    const excludedOnly = input(lists, [{ tools: ["Read"], disallowedTools: [] }, { tools: [], disallowedTools: [] }]);
    expect(() => checkToolScope(excludedOnly, { agentMode: "local" })).not.toThrow();
    // The admitted sub-1 carrying lists still refuses the turn.
    const admitted = input(lists, [{ tools: [], disallowedTools: [] }, { tools: ["Read"], disallowedTools: [] }]);
    expect(() => checkToolScope(admitted, { agentMode: "local" })).toThrow('Sub-agent "sub-1" carries its own tool lists');
  });

  it("refuses a tools list that names nothing the turn has with the shared resolution error", () => {
    const run = () => checkToolScope(input({ tools: ["NotebookEdit"], disallowedTools: [] }), { agentMode: "local" });
    expect(run).toThrow(ToolListResolutionError);
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
