/**
 * Pins the eval run's status book (run-status.ts), over a real store and
 * real suites read by `readEvalSuite`:
 *
 *   - a read answers the stored phase and the threshold (the default when
 *     the spec names none), undefined for a row gone, and throws any other
 *     store fault so the activity is retried;
 *   - a write that answers SKIP_WRITE leaves the row as it was, its audit
 *     included; a write to a row gone writes nothing and does not throw;
 *     any other store fault is thrown;
 *   - the eval run reads as planned once its skeleton is written, and not
 *     before;
 *   - a case that names a model, on an agent run as it runs (no targets
 *     named), carries the note that the agent's own model ran, and carries
 *     none once a target is named;
 *   - comparing a plugin writes both arms' pending tries;
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
import { agentModelNote, evalRunStatusBook } from "../run-status.js";
import { newEvalContextLoader } from "../context.js";
import type { EvalContext } from "../context.js";
import { SKIP_WRITE } from "../status-book.js";
import {
  EVAL_RUN_ON_AGENT_ID,
  MODEL,
  SUITE_FILES,
  catalog,
  readEvalRunOnAgent,
  seedAgent,
  seedEvalRunOnAgent,
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

/** The seeded eval run on an agent's context, over `files` as the plugin's suite. */
async function contextOf(files = SUITE_FILES): Promise<EvalContext> {
  const context = await newEvalContextLoader({
    store: temp.store,
    suites: suiteSource(suiteFiles(files)),
    catalog,
  })(EVAL_RUN_ON_AGENT_ID);
  if (context === undefined) {
    throw new Error("expected the eval run's context");
  }
  return context;
}

async function seeded(options: Parameters<typeof seedEvalRunOnAgent>[1] = {}): Promise<void> {
  await seedAgent(temp.store);
  await seedPlugin(temp.store);
  await seedEvalRunOnAgent(temp.store, options);
}

describe("the eval run status book's read", () => {
  it("answers the phase and the threshold, the default when the spec names none", async () => {
    await seeded({ phase: EvalRunPhase.running });
    expect(await evalRunStatusBook.read(temp.store, EVAL_RUN_ON_AGENT_ID)).toEqual({
      phase: EvalRunPhase.running,
      threshold: DEFAULT_THRESHOLD,
    });
  });

  it("answers undefined for a row gone, and throws any other store fault", async () => {
    expect(await evalRunStatusBook.read(temp.store, EVAL_RUN_ON_AGENT_ID)).toBeUndefined();
    await seeded();
    await expect(evalRunStatusBook.read(storeFailing("getResource"), EVAL_RUN_ON_AGENT_ID)).rejects.toThrow(
      "the database is unreachable",
    );
  });
});

describe("the eval run status book's write", () => {
  it("leaves the row as it was when the write answers SKIP_WRITE", async () => {
    await seeded();
    const before = await readEvalRunOnAgent(temp.store);
    await evalRunStatusBook.write(temp.store, EVAL_RUN_ON_AGENT_ID, ({ status }) => {
      status.phase = EvalRunPhase.failed;
      return SKIP_WRITE;
    });
    expect(await readEvalRunOnAgent(temp.store)).toEqual(before);
  });

  it("writes nothing to a row gone, and throws any other store fault", async () => {
    await expect(
      evalRunStatusBook.write(temp.store, EVAL_RUN_ON_AGENT_ID, ({ status }) => {
        status.phase = EvalRunPhase.failed;
      }),
    ).resolves.toBeUndefined();
    await seeded();
    await expect(evalRunStatusBook.write(storeFailing("updateResource"), EVAL_RUN_ON_AGENT_ID, () => undefined)).rejects.toThrow(
      "the database is unreachable",
    );
  });

  it("reads as planned once its skeleton is written, and not before", async () => {
    await seeded();
    const context = await contextOf();
    const planned: boolean[] = [];
    await evalRunStatusBook.write(temp.store, EVAL_RUN_ON_AGENT_ID, (view) => {
      planned.push(view.planned());
      view.skeleton(context);
      planned.push(view.planned());
    });
    expect(planned).toEqual([false, true]);
    const status = (await readEvalRunOnAgent(temp.store)).status;
    expect(status?.phase).toBe(EvalRunPhase.running);
    expect(status?.plugins[0]?.cases.map((evalCase) => evalCase.caseName)).toEqual(["first-case", "other-plugin"]);
  });
});

describe("the eval run's skeleton", () => {
  const NAMES_A_MODEL = {
    ...SUITE_FILES,
    "evals/first-case/prompt.md": `---\nmodel: ${MODEL}\ntimeout_seconds: 120\n---\n\nWrite me a commit message.\n`,
  };

  it("notes that the agent's own model ran on a case that names one, while no target is named", async () => {
    await seeded();
    const context = await contextOf(NAMES_A_MODEL);
    await evalRunStatusBook.write(temp.store, EVAL_RUN_ON_AGENT_ID, (view) => view.skeleton(context));
    const cases = (await readEvalRunOnAgent(temp.store)).status?.plugins[0]?.cases ?? [];
    expect(cases[0]?.notes).toContain(agentModelNote(MODEL));
    expect(agentModelNote(MODEL)).toBe(`model '${MODEL}' is the case's; the eval run runs the agent's own model`);
    expect(cases.flatMap((evalCase) => evalCase.notes).filter((note) => note === agentModelNote(MODEL))).toHaveLength(1);
  });

  it("writes both arms' pending tries when it compares a plugin, and only the with arm otherwise", async () => {
    await seeded({ compared: true });
    const compared = await contextOf();
    await evalRunStatusBook.write(temp.store, EVAL_RUN_ON_AGENT_ID, (view) => view.skeleton(compared));
    const target = (await readEvalRunOnAgent(temp.store)).status?.plugins[0]?.cases[0]?.targets[0];
    expect(target?.withPlugin?.tries.length).toBeGreaterThan(0);
    expect(target?.withoutPlugin?.tries.length).toBe(target?.withPlugin?.tries.length);
  });

  it("carries no such note once the eval names a target", async () => {
    await seeded({ targets: [{ harness: Harness.NATIVE, modelName: MODEL }] });
    const context = await contextOf(NAMES_A_MODEL);
    await evalRunStatusBook.write(temp.store, EVAL_RUN_ON_AGENT_ID, (view) => view.skeleton(context));
    const cases = (await readEvalRunOnAgent(temp.store)).status?.plugins[0]?.cases ?? [];
    expect(cases[0]?.notes).not.toContain(agentModelNote(MODEL));
  });

  it("leaves out a planned case with no source to place it in", async () => {
    await seeded();
    const context = await contextOf();
    const sourceless: EvalContext = { ...context, caseSources: [0] };
    await evalRunStatusBook.write(temp.store, EVAL_RUN_ON_AGENT_ID, (view) => view.skeleton(sourceless));
    const status = (await readEvalRunOnAgent(temp.store)).status;
    expect(status?.plugins[0]?.cases.map((evalCase) => evalCase.caseName)).toEqual(["first-case"]);
    expect(status?.triesTotal).toBe(context.matrix.cells.length);
  });
});
