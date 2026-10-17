/**
 * Holds every write chain to the reference resolver's place
 * (references.ts, the module header): a chain of a kind whose spec carries
 * references runs NormalizeReferences, and no step that reads a reference
 * runs before it, so no step meets a reference in two shapes. What the
 * reference-field inventory does for fields, this does for the chains.
 *
 * The chains are read from the controllers' source: each `newPipeline`
 * literal up to its `.build()`, its name and the step factories it adds,
 * in order. READERS is the hand-kept list of the steps that read a
 * reference, held by their frozen step names (each factory is built here
 * and its name pinned), so a renamed step fails here, and a new reader is
 * added to the list where it is written. WRITE_CHAINS is every create and
 * update chain of a kind whose spec carries references; a chain of such a
 * kind with no resolver fails, and so does a new chain that reads a
 * reference before resolving it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  newPinSubagentsStep,
  newValidateSubagentListStep,
  newValidateSubagentNamesStep,
} from "../../../domain/agent/subagents.js";
import { newValidatePluginListStep } from "../../../domain/agent/steps.js";
import {
  newResolveChannelDefaultsStep,
  newValidateChannelUpdateStep,
} from "../../../domain/channel/steps.js";
import { newResolveRunAgentStep } from "../../../domain/run/resolve-run-agent.js";
import {
  newResolveRoutineDefaultsStep,
  newValidateRoutineUpdateStep,
} from "../../../domain/routine/steps.js";
import { newResolveSessionAgentStep } from "../../../domain/session/resolve-session-agent.js";
import { newVaultAttachmentsStep } from "../../../domain/vault/attachments.js";
import { newNormalizeReferencesStep, newValidateReferencesStep } from "../references.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../..");

/** A step factory, built with placeholder dependencies only to read its frozen name. */
type Factory = (...deps: never[]) => { readonly name: string };

/** The steps that read a reference, by factory, with the frozen step name each builds. */
const READERS: ReadonlyArray<{ readonly factory: string; readonly build: Factory; readonly step: string }> = [
  { factory: "newValidateSubagentListStep", build: newValidateSubagentListStep, step: "ValidateSubagentList" },
  { factory: "newValidateSubagentNamesStep", build: newValidateSubagentNamesStep, step: "ValidateSubagentNames" },
  { factory: "newPinSubagentsStep", build: newPinSubagentsStep, step: "PinSubagents" },
  { factory: "newValidatePluginListStep", build: newValidatePluginListStep, step: "ValidatePluginList" },
  { factory: "newResolveRoutineDefaultsStep", build: newResolveRoutineDefaultsStep, step: "ResolveRoutineDefaults" },
  { factory: "newValidateRoutineUpdateStep", build: newValidateRoutineUpdateStep, step: "ValidateRoutineUpdate" },
  { factory: "newResolveChannelDefaultsStep", build: newResolveChannelDefaultsStep, step: "ResolveChannelDefaults" },
  { factory: "newValidateChannelUpdateStep", build: newValidateChannelUpdateStep, step: "ValidateChannelUpdate" },
  { factory: "newVaultAttachmentsStep", build: newVaultAttachmentsStep, step: "VaultAttachments" },
  { factory: "newResolveSessionAgentStep", build: newResolveSessionAgentStep, step: "ResolveSessionAgent" },
  { factory: "newResolveRunAgentStep", build: newResolveRunAgentStep, step: "ResolveRunAgent" },
  { factory: "newValidateReferencesStep", build: newValidateReferencesStep, step: "ValidateReferences" },
];

const RESOLVER = "newNormalizeReferencesStep";

/** Every create and update chain of a kind whose spec carries references, by controller. */
const WRITE_CHAINS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "domain/agent/controller.ts": ["agent-create", "agent-update"],
  "domain/channel/controller.ts": ["channel-create", "channel-update"],
  "domain/organization/controller.ts": ["organization-update-embedding"],
  "domain/eval-run/controller.ts": ["eval-run-create"],
  "domain/run/controller.ts": ["agent-execution-create", "agent-execution-update"],
  "domain/routine/controller.ts": ["routine-create", "routine-update"],
  "domain/session/controller.ts": ["session-create", "session-update"],
};

/** One chain as its source writes it: its name and the step factories it adds, in order. */
interface Chain {
  readonly name: string;
  readonly factories: ReadonlyArray<string>;
}

/** The chains a controller's source builds. */
function chainsOf(source: string): Chain[] {
  const chains: Chain[] = [];
  const starts = [...source.matchAll(/newPipeline</g)].map((m) => m.index);
  for (const [i, start] of starts.entries()) {
    const end = Math.min(
      source.indexOf(".build()", start) === -1 ? source.length : source.indexOf(".build()", start),
      starts[i + 1] ?? source.length,
    );
    const text = source.slice(start, end);
    const name = /"([a-z-]+)"/.exec(text)?.[1] ?? "";
    const factories = [...text.matchAll(/\.addStep\(\s*([A-Za-z0-9_]+)\s*[<(]/g)].map((m) => m[1]!);
    chains.push({ name, factories });
  }
  return chains;
}

/** What is wrong with a chain's order, as sentences; empty when the resolver runs before every reader. */
function orderFaults(file: string, chain: Chain): string[] {
  const readers = new Set(READERS.map((r) => r.factory));
  const resolverAt = chain.factories.indexOf(RESOLVER);
  const faults: string[] = [];
  for (const [at, factory] of chain.factories.entries()) {
    if (readers.has(factory) && (resolverAt === -1 || at < resolverAt)) {
      faults.push(`${file} ${chain.name}: ${factory} reads a reference before ${RESOLVER} resolves it`);
    }
  }
  return faults;
}

function controllerChains(): Map<string, Chain[]> {
  const out = new Map<string, Chain[]>();
  for (const file of Object.keys(WRITE_CHAINS)) {
    out.set(file, chainsOf(readFileSync(path.join(SRC, file), "utf8")));
  }
  return out;
}

describe("every write chain resolves references before any step reads one", () => {
  it("each reader factory builds the step its frozen name says", () => {
    for (const reader of READERS) {
      expect(reader.build(...([] as never[])).name, reader.factory).toBe(reader.step);
    }
    expect(newNormalizeReferencesStep({} as never).name).toBe("NormalizeReferences");
  });

  it("every create and update chain of a kind whose spec carries references runs the resolver", () => {
    const missing: string[] = [];
    for (const [file, chains] of controllerChains()) {
      for (const wanted of WRITE_CHAINS[file]!) {
        const chain = chains.find((c) => c.name === wanted);
        if (chain === undefined) {
          missing.push(`${file}: no chain named ${wanted}`);
        } else if (!chain.factories.includes(RESOLVER)) {
          missing.push(`${file} ${wanted}: no ${RESOLVER}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("no chain in these controllers runs a reader before the resolver", () => {
    const faults: string[] = [];
    for (const [file, chains] of controllerChains()) {
      for (const chain of chains) {
        faults.push(...orderFaults(file, chain));
      }
    }
    expect(faults).toEqual([]);
  });

  it("the order check bites: a reader moved ahead of the resolver, and a chain without one, are faults", () => {
    const good: Chain = {
      name: "x-create",
      factories: ["newValidateProtoStep", RESOLVER, "newResolveChannelDefaultsStep", "newValidateReferencesStep"],
    };
    expect(orderFaults("f", good)).toEqual([]);
    expect(
      orderFaults("f", { ...good, factories: ["newResolveChannelDefaultsStep", RESOLVER, "newValidateReferencesStep"] }),
    ).toHaveLength(1);
    expect(orderFaults("f", { ...good, factories: ["newValidateReferencesStep"] })).toHaveLength(1);
  });
});
