// The RPC contract: every RPC the API declares is proven by a conformance test
// that carries its `[rpc:<Service>.<method>]` tag, or carries a written waiver.
// Domain: conformance inventory (the RPC contract).
//
// Three inputs, one pure computation:
// - The declared set, read from the committed generated TypeScript sources of
//   `@stigmer/protos` (`apis/stubs/ts/ai/**/*_pb.ts`), never from a hand list
//   and never from the built `dist`: `tsc` never prunes its outputs, so a
//   checkout that once built another branch's protos keeps their modules in
//   `dist`, and a count over it includes RPCs this checkout does not declare.
//   The sources are what the codegen lane holds equal to the protos.
// - The tags, scanned from the suite sources with the one grammar the call
//   verdict also reads (rpc-tag.ts). A tag must appear literally in the
//   source; a title built at runtime is judged by the verdict alone.
// - The waivers in `inventory/rpc-waivers.yaml`: a `gap` names the open issue
//   that owns the missing test; `proven-elsewhere` names a test file in
//   another layer of the repository that carries the same tag. Nothing else.
//
// Every problem is its own kind, so a failure names its fix. Static like the
// cloud-capability inventory beside it (inventory.ts): it reads files and
// never boots a target.
import type { DescService } from "@bufbuild/protobuf";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "js-yaml";
import { z } from "zod";
import { listTestFiles } from "./inventory";
import { extractRpcTags, RPC_KEY_PATTERN, rpcKey } from "./rpc-tag";

// The API's own services; the TS plugin also generates gRPC health and the
// google.rpc error details, which are not Stigmer's contract.
const API_TYPE_NAME_PREFIX = "ai.stigmer.";

export interface DeclaredRpc {
  // `<Service>.<method>`, the form tags and waivers use.
  readonly key: string;
  readonly service: string;
  readonly method: string;
  // The service's fully qualified proto type name.
  readonly typeName: string;
}

// The stubs package's root, found through its own specifier (the anchor idiom
// of the server's wire-permissions test): an anchor module resolves into
// `<root>/dist/`, and the committed sources sit beside `dist`.
function stubsRoot(): string {
  const anchor = "ai/stigmer/iam/v1/enum_pb";
  const require = createRequire(import.meta.url);
  let resolved: string;
  try {
    resolved = require.resolve(`@stigmer/protos/${anchor}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot locate @stigmer/protos (build the stubs: make build-ts-stubs): ${reason}`);
  }
  const distAnchor = join("dist", `${anchor}.js`);
  if (!resolved.endsWith(distAnchor)) {
    throw new Error(`@stigmer/protos resolved ${anchor} to ${resolved}, not under its dist/`);
  }
  return resolved.slice(0, resolved.length - distAnchor.length);
}

// Every RPC of every API service the committed sources declare, sorted by key.
export async function declaredRpcs(): Promise<DeclaredRpc[]> {
  const root = stubsRoot();
  const sources = (await readdir(join(root, "ai"), { recursive: true, encoding: "utf8" }))
    .filter((file) => file.endsWith("_pb.ts"))
    .sort();
  const rpcs: DeclaredRpc[] = [];
  for (const source of sources) {
    const loaded: Record<string, unknown> = await import(pathToFileURL(join(root, "ai", source)).href);
    for (const value of Object.values(loaded)) {
      if (!isService(value) || !value.typeName.startsWith(API_TYPE_NAME_PREFIX)) continue;
      for (const method of value.methods) {
        const key = rpcKey(value.typeName, method.name);
        rpcs.push({ key, service: key.slice(0, key.indexOf(".")), method: method.name, typeName: value.typeName });
      }
    }
  }
  return rpcs.sort((a, b) => a.key.localeCompare(b.key));
}

function isService(value: unknown): value is DescService {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "service" &&
    "typeName" in value &&
    typeof value.typeName === "string" &&
    "methods" in value &&
    Array.isArray(value.methods)
  );
}

export interface RpcTagOccurrence {
  readonly key: string;
  readonly file: string;
}

// Scans every suite file (Class A and Class B) under the given roots.
export async function collectRpcTags(suiteRoots: readonly string[], cwd: string): Promise<RpcTagOccurrence[]> {
  const tags: RpcTagOccurrence[] = [];
  for (const root of suiteRoots) {
    for (const file of await listTestFiles(root)) {
      const source = await readFile(file, "utf8");
      for (const key of extractRpcTags(source)) tags.push({ key, file: relative(cwd, file) });
    }
  }
  return tags;
}

const rpcKeySchema = z.string().regex(RPC_KEY_PATTERN, "rpc must be <Service>.<method>, as the descriptors spell it");
const reasonSchema = z.string().trim().min(1, "a waiver says why in its reason");

const gapWaiverSchema = z
  .object({
    rpc: rpcKeySchema,
    kind: z.literal("gap"),
    // The open issue that owns the missing test.
    issue: z.number().int().positive(),
    reason: reasonSchema,
  })
  .strict();

const provenElsewhereWaiverSchema = z
  .object({
    rpc: rpcKeySchema,
    kind: z.literal("proven-elsewhere"),
    // Repository-relative path of a test file in another layer; it must exist
    // and carry the same `[rpc:...]` tag.
    proven_by: z
      .string()
      .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.test\.tsx?$/, "proven_by is a repository-relative *.test.ts path"),
    reason: reasonSchema,
  })
  .strict();

const waiverSchema = z.discriminatedUnion("kind", [gapWaiverSchema, provenElsewhereWaiverSchema]);

const waiverFileSchema = z.object({ waivers: z.array(waiverSchema) }).strict();

export type RpcWaiver = z.infer<typeof waiverSchema>;
type GapWaiver = z.infer<typeof gapWaiverSchema>;

export interface RpcContractProblem {
  readonly kind:
    | "schema"
    | "untested-rpc"
    | "unknown-rpc-tag"
    | "stale-waiver"
    | "waived-and-tagged"
    | "proof-missing"
    | "duplicate-waiver"
    | "service-name-collision";
  readonly message: string;
}

export function parseRpcWaivers(yamlText: string): { waivers: RpcWaiver[]; problems: RpcContractProblem[] } {
  const parsed = waiverFileSchema.safeParse(load(yamlText));
  if (!parsed.success) {
    return {
      waivers: [],
      problems: parsed.error.issues.map((issue) => ({ kind: "schema", message: `${issue.path.join(".")}: ${issue.message}` })),
    };
  }
  return { waivers: parsed.data.waivers, problems: [] };
}

export interface RpcContractInput {
  readonly declared: readonly DeclaredRpc[];
  readonly tags: readonly RpcTagOccurrence[];
  readonly waivers: readonly RpcWaiver[];
  // The contents of a repository-relative file, or undefined when it does not
  // exist: the filesystem in the CLI, a map in the unit arms.
  readonly readProof: (repoPath: string) => string | undefined;
}

export interface RpcContract {
  readonly problems: RpcContractProblem[];
  readonly declared: number;
  readonly tagged: number;
  readonly gaps: number;
  readonly gapIssues: number;
  readonly provenElsewhere: number;
}

// The contract's invariants, each a distinct problem kind: a declared RPC is
// tagged or waived, never neither and never both; a tag and a waiver name a
// declared RPC; an RPC is waived once; a proven-elsewhere proof exists and
// carries the tag; and no two services share the short name tags rely on.
export function computeRpcContract(input: RpcContractInput): RpcContract {
  const problems: RpcContractProblem[] = [];
  const declaredKeys = new Set(input.declared.map((rpc) => rpc.key));

  const typeNamesByService = new Map<string, Set<string>>();
  for (const rpc of input.declared) {
    const typeNames = typeNamesByService.get(rpc.service) ?? new Set<string>();
    typeNames.add(rpc.typeName);
    typeNamesByService.set(rpc.service, typeNames);
  }
  for (const [service, typeNames] of typeNamesByService) {
    if (typeNames.size > 1) {
      problems.push({
        kind: "service-name-collision",
        message: `${[...typeNames].sort().join(" and ")} share the short name ${service}, which [rpc:${service}.<method>] cannot tell apart`,
      });
    }
  }

  const tagFiles = new Map<string, Set<string>>();
  for (const tag of input.tags) {
    if (!declaredKeys.has(tag.key)) {
      problems.push({ kind: "unknown-rpc-tag", message: `${tag.file} tags ${tag.key}, which no declared service has` });
      continue;
    }
    const files = tagFiles.get(tag.key) ?? new Set<string>();
    files.add(tag.file);
    tagFiles.set(tag.key, files);
  }

  const waiverByKey = new Map<string, RpcWaiver>();
  for (const waiver of input.waivers) {
    if (waiverByKey.has(waiver.rpc)) {
      problems.push({ kind: "duplicate-waiver", message: `${waiver.rpc} is waived more than once` });
      continue;
    }
    waiverByKey.set(waiver.rpc, waiver);
    if (!declaredKeys.has(waiver.rpc)) {
      problems.push({ kind: "stale-waiver", message: `${waiver.rpc} is waived, but no declared service has it` });
      continue;
    }
    const taggedIn = tagFiles.get(waiver.rpc);
    if (taggedIn !== undefined) {
      problems.push({
        kind: "waived-and-tagged",
        message: `${waiver.rpc} is waived as ${waiver.kind} yet tagged in ${[...taggedIn].sort().join(", ")}; keep the tag and drop the waiver`,
      });
    }
    if (waiver.kind === "proven-elsewhere") {
      const proof = input.readProof(waiver.proven_by);
      if (proof === undefined) {
        problems.push({ kind: "proof-missing", message: `${waiver.rpc} is proven by ${waiver.proven_by}, which does not exist` });
      } else if (!extractRpcTags(proof).includes(waiver.rpc)) {
        problems.push({ kind: "proof-missing", message: `${waiver.rpc} is proven by ${waiver.proven_by}, which carries no [rpc:${waiver.rpc}] tag` });
      }
    }
  }

  let tagged = 0;
  for (const rpc of input.declared) {
    const isTagged = tagFiles.has(rpc.key);
    if (isTagged) tagged += 1;
    if (!isTagged && !waiverByKey.has(rpc.key)) {
      problems.push({ kind: "untested-rpc", message: `${rpc.key} has no [rpc:${rpc.key}] tag on a conformance test and no waiver` });
    }
  }

  const declaredWaivers = [...waiverByKey.values()].filter((waiver) => declaredKeys.has(waiver.rpc));
  const gaps = declaredWaivers.filter((waiver): waiver is GapWaiver => waiver.kind === "gap");
  return {
    problems,
    declared: input.declared.length,
    tagged,
    gaps: gaps.length,
    gapIssues: new Set(gaps.map((waiver) => waiver.issue)).size,
    provenElsewhere: declaredWaivers.length - gaps.length,
  };
}

export function formatRpcSummary(contract: RpcContract, problemCount: number): string {
  return (
    `rpc contract: ${contract.declared} RPCs; ${contract.tagged} tagged, ${contract.gaps} gap (${contract.gapIssues} issues), ` +
    `${contract.provenElsewhere} proven elsewhere; ${problemCount} problem(s)`
  );
}
