// Holds the build walk's judge (lib/coding-agent-build.mjs): the right
// state passes; a routine switched on or already started, a schedule on the
// wrong day or zone, no routine or two, no plugin holding the MCP server or
// two, a plugin the agent does not list, a tool named bare or a whole server
// granted, and an agent whose instructions or skills were replaced each
// fail, naming what is wrong; a hyphen in the plugin's name stays in the
// tool names; cron spellings of Mondays at 9 read alike; and the flags
// refuse what they do not know.

import assert from "node:assert/strict";
import { test } from "node:test";

import { BUILD, cronFields, judgeBuild, parseBuildArgs, toolNamePart } from "./coding-agent-build.mjs";

const agentBefore = {
  spec: {
    instructions: "You check a month's supplier invoices against their purchase orders.\n",
    skill_refs: [{ kind: "skill", slug: "vendor-aliases" }],
    disallowed_tools: ["Bash"],
  },
};

function rightState() {
  return {
    agentBefore,
    agentAfter: {
      spec: {
        ...structuredClone(agentBefore.spec),
        plugins: [{ kind: "plugin", slug: "ledger" }],
        tools: ["Read", "mcp__plugin_ledger_ledger__get_ledger", "mcp__plugin_ledger_ledger__list_accounts"],
      },
    },
    routines: [
      {
        routine: {
          metadata: { slug: "monday-invoice-check" },
          spec: { cron: "0 9 * * 1", time_zone: "Europe/Berlin", agent: { agent_ref: { kind: "agent", slug: BUILD.agent }, message: "Check this week's invoices." } },
        },
        fires: 0,
      },
    ],
    plugins: [
      { metadata: { slug: "ledger" }, status: { mcpServers: [{ name: "ledger", http: { url: BUILD.mcpUrl } }] } },
      { metadata: { slug: "linear" }, status: { mcpServers: [{ name: "linear", http: { url: "https://mcp.linear.app/mcp" } }] } },
    ],
  };
}

test("the right state passes", () => {
  assert.deepEqual(judgeBuild(rightState()), []);
});

test("a routine switched on, or one that already started a run, fails", () => {
  const on = rightState();
  on.routines[0].routine.spec.enabled = true;
  assert.match(judgeBuild(on).join("\n"), /switched on, which no one asked for/);
  const fired = rightState();
  fired.routines[0].fires = 1;
  assert.match(judgeBuild(fired).join("\n"), /has started 1 run/);
});

test("replaced instructions or skills fail: the change did not start from the live definition", () => {
  const replaced = rightState();
  replaced.agentAfter.spec.instructions = "Check invoices every Monday.";
  assert.match(judgeBuild(replaced).join("\n"), /instructions changed/);
  const noSkills = rightState();
  delete noSkills.agentAfter.spec.skill_refs;
  assert.match(judgeBuild(noSkills).join("\n"), /skill_refs changed/);
});

test("the wrong schedule or zone, no routine, or two routines fail", () => {
  const sunday = rightState();
  sunday.routines[0].routine.spec.cron = "0 9 * * 0";
  assert.match(judgeBuild(sunday).join("\n"), /not Mondays at 9/);
  const utc = rightState();
  utc.routines[0].routine.spec.time_zone = "UTC";
  assert.match(judgeBuild(utc).join("\n"), /not Europe\/Berlin/);
  const none = rightState();
  none.routines = [];
  assert.match(judgeBuild(none).join("\n"), /0 routines name invoice-checker/);
  const two = rightState();
  two.routines.push(structuredClone(two.routines[0]));
  assert.match(judgeBuild(two).join("\n"), /2 routines name invoice-checker/);
});

test("no plugin holding the server, two, or one the agent does not list fail", () => {
  const none = rightState();
  none.plugins = none.plugins.slice(1);
  assert.match(judgeBuild(none).join("\n"), /0 plugins hold an MCP server/);
  const two = rightState();
  two.plugins.push({ metadata: { slug: "ledger-2" }, status: { mcpServers: [{ name: "ledger-2", http: { url: `${BUILD.mcpUrl}/` } }] } });
  assert.match(judgeBuild(two).join("\n"), /2 plugins hold an MCP server/);
  const unlisted = rightState();
  unlisted.agentAfter.spec.plugins = [];
  assert.match(judgeBuild(unlisted).join("\n"), /does not list plugin ledger/);
});

test("a tool named bare, or the whole server granted, fails", () => {
  const bare = rightState();
  bare.agentAfter.spec.tools = ["get_ledger", "list_accounts"];
  assert.match(judgeBuild(bare).join("\n"), /tools do not name mcp__plugin_ledger_ledger__get_ledger/);
  const wide = rightState();
  wide.agentAfter.spec.tools.push("mcp__plugin_ledger_ledger");
  assert.match(judgeBuild(wide).join("\n"), /grant every tool of the server/);
  const every = rightState();
  every.agentAfter.spec.tools.push("mcp__*");
  assert.match(judgeBuild(every).join("\n"), /grant every tool of the server/);
});

test("a hyphen in the plugin's name stays in its tool names, a dot becomes _", () => {
  assert.equal(toolNamePart("ledger-api"), "ledger-api");
  assert.equal(toolNamePart("ledger.v2"), "ledger_v2");
  const hyphen = rightState();
  hyphen.plugins[0] = { metadata: { slug: "ledger-api" }, status: { mcpServers: [{ name: "ledger-api", http: { url: BUILD.mcpUrl } }] } };
  hyphen.agentAfter.spec.plugins = [{ kind: "plugin", slug: "ledger-api" }];
  hyphen.agentAfter.spec.tools = BUILD.mcpTools.map((tool) => `mcp__plugin_ledger-api_ledger-api__${tool}`);
  assert.deepEqual(judgeBuild(hyphen), []);
});

test("an agent that is gone fails", () => {
  const gone = rightState();
  gone.agentAfter = undefined;
  assert.match(judgeBuild(gone).join("\n"), /is gone/);
});

test("Mondays at 9 read alike however the cron spells them", () => {
  for (const cron of ["0 9 * * 1", "00 09 * * MON", "0 9 * * mon"]) assert.deepEqual(cronFields(cron), BUILD.cron, cron);
  assert.equal(cronFields("@weekly"), undefined);
  assert.equal(cronFields("0 0 9 * * 1"), undefined);
});

test("the flags take numbers and refuse what they do not know", () => {
  assert.deepEqual(parseBuildArgs(["--max-turns=3", "--keep"]), {
    model: "claude-sonnet-5-5",
    maxBudgetUsd: undefined,
    claudeMaxTurns: undefined,
    maxTurns: 3,
    keep: true,
    help: false,
  });
  assert.throws(() => parseBuildArgs(["--max-turns=0"]), /positive number/);
  assert.throws(() => parseBuildArgs(["--app=x"]), /unknown flag/);
});
