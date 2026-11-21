// Holds the build walk's judge (lib/coding-agent-build.mjs): the right
// state passes; a routine switched on or already started, a schedule on the
// wrong day or zone, no routine or two, an Environment without the package
// or not named by the agent, and an agent whose instructions or skills were
// replaced each fail, naming what is wrong; cron spellings of Mondays at 9
// read alike; and the flags refuse what they do not know.

import assert from "node:assert/strict";
import { test } from "node:test";

import { BUILD, cronFields, judgeBuild, parseBuildArgs } from "./coding-agent-build.mjs";

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
    agentAfter: { spec: { ...structuredClone(agentBefore.spec), environment_ref: { kind: "environment", slug: "invoice-checker-env" } } },
    routines: [
      {
        routine: {
          metadata: { slug: "monday-invoice-check" },
          spec: { cron: "0 9 * * 1", time_zone: "Europe/Berlin", agent: { agent_ref: { kind: "agent", slug: BUILD.agent }, message: "Check this week's invoices." } },
        },
        fires: 0,
      },
    ],
    environments: [{ metadata: { slug: "invoice-checker-env" }, spec: { packages: { pip: ["pdfplumber"] } } }],
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

test("an Environment without the package, one the agent does not name, or one that is missing fails", () => {
  const noPackage = rightState();
  noPackage.environments[0].spec.packages.pip = ["pdfminer.six"];
  assert.match(judgeBuild(noPackage).join("\n"), /lists no pdfplumber/);
  const unnamed = rightState();
  delete unnamed.agentAfter.spec.environment_ref;
  assert.match(judgeBuild(unnamed).join("\n"), /names no Environment/);
  const missing = rightState();
  missing.environments = [];
  assert.match(judgeBuild(missing).join("\n"), /which does not exist/);
  const pinned = rightState();
  pinned.environments[0].spec.packages.pip = ["pdfplumber==0.11.4"];
  assert.deepEqual(judgeBuild(pinned), []);
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
