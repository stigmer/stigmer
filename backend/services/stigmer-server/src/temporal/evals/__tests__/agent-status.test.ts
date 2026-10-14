/**
 * Pins the agent eval's status book (agent-status.ts), over a real store
 * and real suites read by `readEvalSuite`:
 *
 *   - a read answers the stored phase and the threshold (the default when
 *     the spec names none), undefined for a row gone, and throws any other
 *     store fault so the activity is retried;
 *   - a write that answers SKIP_WRITE leaves the row as it was, its audit
 *     included; a write to a row gone writes nothing and does not throw;
 *     any other store fault is thrown;
 *   - the eval reads as planned once its skeleton is written, and not
 *     before;
 *   - a case that names a model, in an eval that runs the agent as it runs
 *     (no targets named), carries the note that the agent's own model ran,
 *     and carries none once a target is named;
 *   - a planned case with no source to place it in is left out of every
 *     plugin's block.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EvalRunPhase } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import { DEFAULT_THRESHOLD } from "../../../domain/eval-run/scoring.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { agentModelNote, agentStatusBook } from "../agent-status.js";
import { newEvalContextLoader } from "../context.js";
import type { AgentEvalContext } from "../context.js";
import { SKIP_WRITE } from "../status-book.js";
import {
  AGENT_EVAL_ID,
  MODEL,
  SUITE_FILES,
  catalog,
  readAgentEval,
  seedAgent,
  seedAgentEval,
  seedPlugin,
  suiteFiles,
  suiteSource,
} from "./support.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

function storeFailing(method: "getResource" | "updateResource"): Store {
  return new Proxy(temp.store, {
    get(target, property, receiver) {
      if (property === method) {
        return () => Promise.reject(new Error("the database is unreachable"));
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The seeded agent eval's context, over `files` as the plugin's suite. */
async function contextOf(files = SUITE_FILES): Promise<AgentEvalContext> {
  const context = await newEvalContextLoader({
    store: temp.store,
    suites: suiteSource(suiteFiles(files)),
    catalog,
  })(AGENT_EVAL_ID);
  if (context?.kind !== "agent") {
    throw new Error("expected the agent eval's context");
  }
  return context;
}

async function seeded(options: Parameters<typeof seedAgentEval>[1] = {}): Promise<void> {
  await seedAgent(temp.store);
  await seedPlugin(temp.store);
  await seedAgentEval(temp.store, options);
}

describe("the agent status book's read", () => {
  it("answers the phase and the threshold, the default when the spec names none", async () => {
    await seeded({ phase: EvalRunPhase.running });
    expect(await agentStatusBook.read(temp.store, AGENT_EVAL_ID)).toEqual({
      phase: EvalRunPhase.running,
      threshold: DEFAULT_THRESHOLD,
    });
  });

  it("answers undefined for a row gone, and throws any other store fault", async () => {
    expect(await agentStatusBook.read(temp.store, AGENT_EVAL_ID)).toBeUndefined();
    await seeded();
    await expect(agentStatusBook.read(storeFailing("getResource"), AGENT_EVAL_ID)).rejects.toThrow(
      "the database is unreachable",
    );
  });
});

describe("the agent status book's write", () => {
  it("leaves the row as it was when the write answers SKIP_WRITE", async () => {
    await seeded();
    const before = await readAgentEval(temp.store);
    await agentStatusBook.write(temp.store, AGENT_EVAL_ID, ({ status }) => {
      status.phase = EvalRunPhase.failed;
      return SKIP_WRITE;
    });
    expect(await readAgentEval(temp.store)).toEqual(before);
  });

  it("writes nothing to a row gone, and throws any other store fault", async () => {
    await expect(
      agentStatusBook.write(temp.store, AGENT_EVAL_ID, ({ status }) => {
        status.phase = EvalRunPhase.failed;
      }),
    ).resolves.toBeUndefined();
    await seeded();
    await expect(agentStatusBook.write(storeFailing("updateResource"), AGENT_EVAL_ID, () => undefined)).rejects.toThrow(
      "the database is unreachable",
    );
  });

  it("reads as planned once its skeleton is written, and not before", async () => {
    await seeded();
    const context = await contextOf();
    const planned: boolean[] = [];
    await agentStatusBook.write(temp.store, AGENT_EVAL_ID, (view) => {
      planned.push(view.planned());
      view.skeleton(context);
      planned.push(view.planned());
    });
    expect(planned).toEqual([false, true]);
    const status = (await readAgentEval(temp.store)).status;
    expect(status?.phase).toBe(EvalRunPhase.running);
    expect(status?.plugins[0]?.cases.map((evalCase) => evalCase.caseName)).toEqual(["first-case", "other-plugin"]);
  });
});

describe("the agent eval's skeleton", () => {
  const NAMES_A_MODEL = {
    ...SUITE_FILES,
    "evals/first-case/prompt.md": `---\nmodel: ${MODEL}\ntimeout_seconds: 120\n---\n\nWrite me a commit message.\n`,
  };

  it("notes that the agent's own model ran on a case that names one, while no target is named", async () => {
    await seeded();
    const context = await contextOf(NAMES_A_MODEL);
    await agentStatusBook.write(temp.store, AGENT_EVAL_ID, (view) => view.skeleton(context));
    const cases = (await readAgentEval(temp.store)).status?.plugins[0]?.cases ?? [];
    expect(cases[0]?.notes).toContain(agentModelNote(MODEL));
    expect(agentModelNote(MODEL)).toBe(`model '${MODEL}' is the case's; the eval runs the agent's own model`);
    expect(cases.flatMap((evalCase) => evalCase.notes).filter((note) => note === agentModelNote(MODEL))).toHaveLength(1);
  });

  it("carries no such note once the eval names a target", async () => {
    await seeded({ targets: [{ harness: Harness.NATIVE, modelName: MODEL }] });
    const context = await contextOf(NAMES_A_MODEL);
    await agentStatusBook.write(temp.store, AGENT_EVAL_ID, (view) => view.skeleton(context));
    const cases = (await readAgentEval(temp.store)).status?.plugins[0]?.cases ?? [];
    expect(cases[0]?.notes).not.toContain(agentModelNote(MODEL));
  });

  it("leaves out a planned case with no source to place it in", async () => {
    await seeded();
    const context = await contextOf();
    const sourceless: AgentEvalContext = { ...context, caseSources: [0] };
    await agentStatusBook.write(temp.store, AGENT_EVAL_ID, (view) => view.skeleton(sourceless));
    const status = (await readAgentEval(temp.store)).status;
    expect(status?.plugins[0]?.cases.map((evalCase) => evalCase.caseName)).toEqual(["first-case"]);
    expect(status?.triesTotal).toBe(context.matrix.cells.length);
  });
});
