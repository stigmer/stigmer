// Unit arms for the RPC contract: the tag grammar, the waiver schema, each of
// the contract's problem kinds, and the declared set (as keys and as method
// descriptors) read from the committed stub sources. Pure but for the last
// group, which reads the real sources and the real waiver file (no target,
// no network).
// Domain: conformance inventory (the RPC contract).
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectRpcTags,
  computeRpcContract,
  declaredMethods,
  declaredRpcs,
  formatRpcSummary,
  parseRpcWaivers,
  type DeclaredRpc,
  type RpcContractInput,
  type RpcTagOccurrence,
  type RpcWaiver,
} from "../rpc-contract";
import { extractRpcTags, RPC_KEY_PATTERN, rpcKey } from "../rpc-tag";

function rpc(key: string, typeName = `ai.stigmer.test.v1.${key.split(".")[0]}`): DeclaredRpc {
  const [service = "", method = ""] = key.split(".");
  return { key, service, method, typeName };
}

const DECLARED = [rpc("AgentCommandController.create"), rpc("AgentQueryController.get")];

function contract(overrides: Partial<RpcContractInput>): ReturnType<typeof computeRpcContract> {
  return computeRpcContract({
    declared: DECLARED,
    tags: [],
    waivers: [],
    readProof: () => undefined,
    ...overrides,
  });
}

function kinds(result: ReturnType<typeof computeRpcContract>): string[] {
  return result.problems.map((problem) => problem.kind);
}

const TAGGED: RpcTagOccurrence[] = [
  { key: "AgentCommandController.create", file: "src/suites/agent.conformance.test.ts" },
  { key: "AgentQueryController.get", file: "src/suites/agent.conformance.test.ts" },
];

describe("the tag grammar", () => {
  it("finds every [rpc:Service.method] tag in a title, in order, repeats included", () => {
    const title = `[rpc:AgentCommandController.create] [rpc:AgentQueryController.get] then [rpc:AgentCommandController.create] again`;
    expect(extractRpcTags(title)).toEqual([
      "AgentCommandController.create",
      "AgentQueryController.get",
      "AgentCommandController.create",
    ]);
  });

  it("ignores the cloud-capability row tags and malformed rpc tags", () => {
    const source = `it("[billing.rpc.adjust-credits.owner-can-adjust] [rpc:agentCommand.create] [rpc:AgentCommandController] [rpc: A.b]")`;
    expect(extractRpcTags(source)).toEqual([]);
  });

  it("keys an RPC by its service's short name and its method name", () => {
    expect(rpcKey("ai.stigmer.agentic.agent.v1.AgentCommandController", "create")).toBe("AgentCommandController.create");
    expect(RPC_KEY_PATTERN.test("AgentCommandController.create")).toBe(true);
    expect(RPC_KEY_PATTERN.test("AgentCommandController.Create")).toBe(false);
  });
});

describe("parseRpcWaivers", () => {
  const GAP = `
waivers:
  - rpc: AgentQueryController.get
    kind: gap
    issue: 1026
    reason: Declared but routed by no edition.
`;
  const ELSEWHERE = `
waivers:
  - rpc: AgentQueryController.get
    kind: proven-elsewhere
    proven_by: backend/services/runner/src/__tests__/status.test.ts
    reason: Only the runner sends it.
`;

  it("accepts a gap and a proven-elsewhere waiver", () => {
    expect(parseRpcWaivers(GAP)).toEqual({
      waivers: [{ rpc: "AgentQueryController.get", kind: "gap", issue: 1026, reason: "Declared but routed by no edition." }],
      problems: [],
    });
    expect(parseRpcWaivers(ELSEWHERE).problems).toEqual([]);
  });

  it("refuses a gap without an issue and a proven-elsewhere without a proof", () => {
    expect(parseRpcWaivers(GAP.replace("    issue: 1026\n", "")).problems).not.toEqual([]);
    expect(parseRpcWaivers(ELSEWHERE.replace(/ {4}proven_by: .*\n/, "")).problems).not.toEqual([]);
  });

  it("refuses any other kind, an unknown field and an empty reason", () => {
    expect(parseRpcWaivers(GAP.replace("kind: gap", "kind: internal")).problems).not.toEqual([]);
    expect(parseRpcWaivers(GAP.replace("    reason:", "    owner: me\n    reason:")).problems).not.toEqual([]);
    expect(parseRpcWaivers(GAP.replace("Declared but routed by no edition.", '" "')).problems).not.toEqual([]);
  });

  it("refuses a proof that is not a repository-relative test file, and an rpc that is not a key", () => {
    for (const path of ["/abs/x.test.ts", "../x.test.ts", "a/../../x.test.ts", "backend/x.ts"]) {
      expect(parseRpcWaivers(ELSEWHERE.replace(/proven_by: .*/, `proven_by: ${path}`)).problems, path).not.toEqual([]);
    }
    expect(parseRpcWaivers(GAP.replace("AgentQueryController.get", "agentQuery.get")).problems).not.toEqual([]);
  });
});

describe("computeRpcContract", () => {
  it("passes when every declared RPC is tagged, and counts it", () => {
    const result = contract({ tags: TAGGED });
    expect(result.problems).toEqual([]);
    expect(formatRpcSummary(result, 0)).toBe("rpc contract: 2 RPCs; 2 tagged, 0 gap (0 issues), 0 proven elsewhere; 0 problem(s)");
  });

  it("passes a gap and a proven-elsewhere waiver whose proof carries the tag", () => {
    const waivers: RpcWaiver[] = [
      { rpc: "AgentCommandController.create", kind: "gap", issue: 7, reason: "r" },
      { rpc: "AgentQueryController.get", kind: "proven-elsewhere", proven_by: "x/y.test.ts", reason: "r" },
    ];
    const result = contract({ waivers, readProof: (path) => (path === "x/y.test.ts" ? `it("[rpc:AgentQueryController.get] …")` : undefined) });
    expect(result.problems).toEqual([]);
    expect([result.tagged, result.gaps, result.gapIssues, result.provenElsewhere]).toEqual([0, 1, 1, 1]);
  });

  it("names a declared RPC with neither a tag nor a waiver: untested-rpc", () => {
    const result = contract({ tags: TAGGED.slice(0, 1) });
    expect(kinds(result)).toEqual(["untested-rpc"]);
    expect(result.problems[0]?.message).toContain("AgentQueryController.get");
  });

  it("names a tag no declared service has: unknown-rpc-tag", () => {
    const result = contract({ tags: [...TAGGED, { key: "AgentQueryController.gone", file: "src/suites/a.test.ts" }] });
    expect(kinds(result)).toEqual(["unknown-rpc-tag"]);
    expect(result.problems[0]?.message).toContain("src/suites/a.test.ts");
  });

  it("names a waiver for an RPC no declared service has: stale-waiver", () => {
    const result = contract({ tags: TAGGED, waivers: [{ rpc: "AgentQueryController.gone", kind: "gap", issue: 1, reason: "r" }] });
    expect(kinds(result)).toEqual(["stale-waiver"]);
  });

  it("names an RPC both waived and tagged: waived-and-tagged", () => {
    const result = contract({ tags: TAGGED, waivers: [{ rpc: "AgentQueryController.get", kind: "gap", issue: 1, reason: "r" }] });
    expect(kinds(result)).toEqual(["waived-and-tagged"]);
  });

  it("names a proof that is absent or lacks the tag: proof-missing", () => {
    const waivers: RpcWaiver[] = [{ rpc: "AgentQueryController.get", kind: "proven-elsewhere", proven_by: "x/y.test.ts", reason: "r" }];
    const tags = TAGGED.slice(0, 1);
    expect(kinds(contract({ tags, waivers }))).toEqual(["proof-missing"]);
    expect(kinds(contract({ tags, waivers, readProof: () => `it("[rpc:AgentCommandController.create] …")` }))).toEqual([
      "proof-missing",
    ]);
  });

  it("names an RPC waived twice: duplicate-waiver", () => {
    const waiver: RpcWaiver = { rpc: "AgentQueryController.get", kind: "gap", issue: 1, reason: "r" };
    expect(kinds(contract({ tags: TAGGED.slice(0, 1), waivers: [waiver, waiver] }))).toEqual(["duplicate-waiver"]);
  });

  it("names two services sharing a short name: service-name-collision", () => {
    const declared = [...DECLARED, rpc("AgentQueryController.list", "ai.stigmer.other.v1.AgentQueryController")];
    const result = contract({ declared, tags: [...TAGGED, { key: "AgentQueryController.list", file: "f.test.ts" }] });
    expect(kinds(result)).toEqual(["service-name-collision"]);
  });
});

describe("collectRpcTags", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("scans every *.test.ts under the roots and names the file, relative to cwd", async () => {
    dir = await mkdtemp(join(tmpdir(), "rpc-tags-"));
    await mkdir(join(dir, "suites", "nested"), { recursive: true });
    await writeFile(join(dir, "suites", "nested", "a.conformance.test.ts"), `it("[rpc:AgentQueryController.get] x", () => {});`);
    await writeFile(join(dir, "suites", "helper.ts"), `// [rpc:AgentCommandController.create] in a non-test file`);
    expect(await collectRpcTags([join(dir, "suites")], dir)).toEqual([
      { key: "AgentQueryController.get", file: join("suites", "nested", "a.conformance.test.ts") },
    ]);
  });
});

describe("the declared set and the waiver file, as committed", () => {
  it("reads only API services, every RPC keyed by the tag grammar, with no key or short name repeated", async () => {
    const declared = await declaredRpcs();
    expect(declared.length).toBeGreaterThan(0);
    for (const entry of declared) {
      expect(entry.typeName.startsWith("ai.stigmer."), entry.typeName).toBe(true);
      expect(RPC_KEY_PATTERN.test(entry.key), entry.key).toBe(true);
    }
    expect(new Set(declared.map((entry) => entry.key)).size).toBe(declared.length);
    const collisions = computeRpcContract({ declared, tags: [], waivers: [], readProof: () => undefined }).problems.filter(
      (problem) => problem.kind === "service-name-collision",
    );
    expect(collisions).toEqual([]);
  });

  it("answers each declared method with its descriptor, keyed exactly as the declared RPCs are", async () => {
    const [methods, rpcs] = await Promise.all([declaredMethods(), declaredRpcs()]);
    expect(methods.map((entry) => entry.key)).toEqual(rpcs.map((entry) => entry.key));
    const create = methods.find((entry) => entry.key === "AgentCommandController.create");
    expect(create, "AgentCommandController.create is declared").toBeDefined();
    expect(create?.method.input.typeName).toBe("ai.stigmer.agentic.agent.v1.Agent");
  });

  it("parses the committed waiver file with no problem", async () => {
    const text = await readFile(new URL("../../../inventory/rpc-waivers.yaml", import.meta.url), "utf8");
    expect(parseRpcWaivers(text).problems).toEqual([]);
  });
});
