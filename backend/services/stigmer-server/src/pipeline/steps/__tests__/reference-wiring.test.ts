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
 *
 * WRITE_CHAINS is hand-kept too, so it is held to the reference-field
 * inventory (docs/reference-fields.md): every kind whose spec reaches a
 * message holding a manifest reference (read through the generated
 * schemas' field tree) is one an entry declares, and every create and
 * update chain that entry's controller builds is listed. A new reference
 * field on a kind with no resolving chain fails there by name, which is
 * how an organization's default Environment once slipped: the inventory
 * listed it while the list named only the organization's embedding chain.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DescField, DescMessage } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceGroup } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_group_pb";
import {
  ApiResourceKind,
  ApiResourceKindSchema,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

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
import { getKindMeta } from "../../apiresource-meta.js";
import { newNormalizeReferencesStep, newValidateReferencesStep } from "../references.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../..");
const INVENTORY_DOC = path.resolve(SRC, "../docs/reference-fields.md");

/** The kinds that name no stored resource message: the audit record and the platform singleton. */
const NO_RESOURCE_MESSAGE: ReadonlySet<ApiResourceKind> = new Set([
  ApiResourceKind.api_resource_kind_unknown,
  ApiResourceKind.api_resource_version,
  ApiResourceKind.platform,
]);

/**
 * Every kind's resource message, found from its `kind_meta` in the
 * generated module that declares it, so a new kind is read without a list
 * to keep.
 */
async function resourceSchemas(): Promise<ReadonlyMap<ApiResourceKind, DescMessage>> {
  const out = new Map<ApiResourceKind, DescMessage>();
  for (const value of ApiResourceKindSchema.values) {
    const kind = value.number as ApiResourceKind;
    if (NO_RESOURCE_MESSAGE.has(kind)) {
      continue;
    }
    const meta = getKindMeta(kind);
    const specifier = `@stigmer/apis/ai/stigmer/${ApiResourceGroup[meta.group]}/${meta.name.toLowerCase()}/v1/api_pb`;
    const generated = (await import(specifier)) as Record<string, unknown>;
    const schema = generated[`${meta.name}Schema`] as DescMessage | undefined;
    if (schema === undefined) {
      throw new Error(`${specifier} declares no ${meta.name}Schema`);
    }
    out.set(kind, schema);
  }
  return out;
}

const RESOURCE_SCHEMAS = await resourceSchemas();

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
  "domain/organization/controller.ts": ["organization-create", "organization-update", "organization-update-embedding"],
  "domain/eval-run/controller.ts": ["eval-run-create"],
  "domain/run/controller.ts": ["agent-execution-create", "agent-execution-update"],
  "domain/routine/controller.ts": ["routine-create", "routine-update"],
  "domain/session/controller.ts": ["session-create", "session-update"],
};

/** The kind each WRITE_CHAINS controller writes. */
const CONTROLLER_KINDS: Readonly<Record<string, ApiResourceKind>> = {
  "domain/agent/controller.ts": ApiResourceKind.agent,
  "domain/channel/controller.ts": ApiResourceKind.channel,
  "domain/organization/controller.ts": ApiResourceKind.organization,
  "domain/eval-run/controller.ts": ApiResourceKind.eval_run,
  "domain/run/controller.ts": ApiResourceKind.run,
  "domain/routine/controller.ts": ApiResourceKind.routine,
  "domain/session/controller.ts": ApiResourceKind.session,
};

/** A chain that creates or updates a row a person writes: `<kind>-create` or `<kind>-update`. */
const WRITE_CHAIN_NAME = /-(create|update)$/;

/** The message a field holds, when it holds one. */
function childOf(field: DescField): DescMessage | undefined {
  if (field.fieldKind === "message" || (field.fieldKind === "list" && field.listKind === "message")) {
    return field.message;
  }
  if (field.fieldKind === "map" && field.mapKind === "message") {
    return field.message;
  }
  return undefined;
}

/** Every message a kind's spec reaches, by type name, read transitively. */
function specMessagesOf(resource: DescMessage): Set<string> {
  const seen = new Set<string>();
  const visit = (message: DescMessage): void => {
    if (seen.has(message.typeName)) {
      return;
    }
    seen.add(message.typeName);
    for (const field of message.fields) {
      const child = childOf(field);
      if (child !== undefined) {
        visit(child);
      }
    }
  };
  const spec = resource.fields.find((field) => field.name === "spec");
  const message = spec === undefined ? undefined : childOf(spec);
  if (message !== undefined) {
    visit(message);
  }
  return seen;
}

/** The inventory's manifest references: `Message.field` rows classed `manifest reference`. */
function manifestReferences(): string[] {
  const rows: string[] = [];
  for (const line of readFileSync(INVENTORY_DOC, "utf8").split("\n")) {
    const m = /^\| `([A-Za-z0-9_.]+)` \| manifest reference \|$/.exec(line);
    if (m !== null) {
      rows.push(m[1]!);
    }
  }
  return rows;
}

/** Every kind whose spec reaches a message holding a manifest reference, with the fields that put it there. */
function kindsCarryingReferences(): Map<ApiResourceKind, string[]> {
  const out = new Map<ApiResourceKind, string[]>();
  const reach = [...RESOURCE_SCHEMAS].map(([kind, schema]) => [kind, specMessagesOf(schema)] as const);
  for (const field of manifestReferences()) {
    const message = field.slice(0, field.lastIndexOf("."));
    for (const [kind, messages] of reach) {
      if (messages.has(message)) {
        out.set(kind, [...(out.get(kind) ?? []), field]);
      }
    }
  }
  return out;
}

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

  it("every kind the inventory gives a manifest reference has its create and update chains listed", () => {
    const carrying = kindsCarryingReferences();
    // The walk finds what the inventory names: a sanity floor, so an
    // unreadable doc or an empty schema map cannot pass by finding nothing.
    expect(carrying.get(ApiResourceKind.organization)).toContain(
      "ai.stigmer.tenancy.organization.v1.OrganizationPreferences.default_environment_ref",
    );
    const declared = new Map(Object.entries(CONTROLLER_KINDS).map(([file, kind]) => [kind, file]));
    expect(Object.keys(CONTROLLER_KINDS).sort()).toEqual(Object.keys(WRITE_CHAINS).sort());
    const faults: string[] = [];
    for (const [kind, fields] of carrying) {
      const file = declared.get(kind);
      if (file === undefined) {
        faults.push(`${ApiResourceKind[kind]} carries ${fields.join(", ")} and no WRITE_CHAINS entry writes it`);
        continue;
      }
      const built = chainsOf(readFileSync(path.join(SRC, file), "utf8"))
        .map((chain) => chain.name)
        .filter((name) => WRITE_CHAIN_NAME.test(name));
      for (const name of built) {
        if (!WRITE_CHAINS[file]!.includes(name)) {
          faults.push(`${file} ${name} writes ${ApiResourceKind[kind]} rows, which carry ${fields.join(", ")}: list it in WRITE_CHAINS`);
        }
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
