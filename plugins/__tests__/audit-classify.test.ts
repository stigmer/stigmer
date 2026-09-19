/**
 * The rubric as code, one case per rule and per verdict arm.
 *
 * Pins: an entry that passes every rule is `vendor`; each of the six rules
 * excludes on its own and all failing rules are listed together; a licence
 * that cannot be read is a failure, never a pass; a hooks-only plugin fails
 * "becomes something" with the components it does carry named; a declared
 * key makes a server reachable without a probe, and a declared variable no
 * header or URL sends makes it unreachable as declared, with the variables
 * named; a login server without dynamic registration is reachable for rule
 * 3 and fails rule 6, and is listed for the registration programme; a
 * proxied host fails rule 3 whatever the wire said; the personal-account
 * word is a flag beside the failure; endpoints to author come only from
 * entries whose every failure authoring cures (the licence, an unwired
 * credential), judged on the wire alone, minus URLs a vendored entry
 * already brings, one per URL.
 */

import type { PluginVariable } from "@stigmer/plugin-package";
import { describe, expect, it } from "vitest";

import { classifyCatalogues, describeReachability, judgeEntry, judgeServer, PERSONAL_ACCOUNT_TOKENS, PROXY_HOSTS, unwiredVariables } from "../scripts/audit/classify.js";
import type { CatalogueFacts, EntryFacts, EntryRead, EntryServer } from "../scripts/audit/entries.js";
import type { LicenceClass } from "../scripts/audit/licence.js";
import type { AuthorizationServerFacts, ProbeResult } from "../scripts/audit/probe.js";
import type { AuditSource } from "../scripts/audit/sources.js";

const SOURCE: AuditSource = { name: "cursor-plugins", repo: "cursor/plugins" };
const OTHER_SOURCE: AuditSource = { name: "codex-plugins", repo: "openai/plugins" };

const http = (name: string, url: string, env: readonly string[] = []): EntryServer => ({
  name,
  transport: "http",
  url,
  headers: env.length === 0 ? {} : { Authorization: `Bearer \${${env[0]}}` },
  env,
});
const stdio = (name: string): EntryServer => ({ name, transport: "stdio", command: "npx", env: [] });

const readOk = (overrides: Partial<Extract<EntryRead, { ok: true }>> = {}): EntryRead => ({
  ok: true,
  dialect: "cursor",
  skills: ["do-things"],
  subAgents: [],
  servers: [],
  variables: [],
  ignored: [],
  warnings: [],
  digest: "0".repeat(64),
  filesIncluded: 3,
  ...overrides,
});

function entry(name: string, read: EntryRead, licence: LicenceClass = "mit", source: AuditSource = SOURCE): EntryFacts {
  return {
    source,
    commit: "a".repeat(40),
    name,
    dir: name,
    licence: licence === "none" ? { licence } : { licence, path: `${name}/LICENSE` },
    read,
  };
}

const login = (dynamicRegistration: boolean, origin = "https://login.vendor.example"): AuthorizationServerFacts => ({
  metadataUrl: `${origin}/.well-known/oauth-authorization-server`,
  issuer: origin,
  authorizationEndpoint: `${origin}/oauth/authorize`,
  tokenEndpoint: `${origin}/oauth/token`,
  dynamicRegistration,
  loginOrigin: "other",
  pkceS256: true,
  scopesSupported: [],
});

const probes = (results: Record<string, ProbeResult["outcome"]>): ReadonlyMap<string, ProbeResult> =>
  new Map(Object.entries(results).map(([url, outcome]) => [url, { url, outcome, evidence: [] }]));

const OPEN = "https://open.vendor.example/mcp";
const OAUTH = "https://oauth.vendor.example/mcp";
const PRE_REGISTERED = "https://slack.vendor.example/mcp";
const BROKEN = "https://broken.vendor.example/mcp";
const OPEN_OUTCOME: ProbeResult["outcome"] = { kind: "open", status: 200, via: "post", tools: { kind: "listed", count: 3 } };
const PROBES = probes({
  [OPEN]: OPEN_OUTCOME,
  [OAUTH]: { kind: "oauth", challengedAt: "initialize", challenge: 'Bearer realm="OAuth"', authorizationServer: login(true) },
  [PRE_REGISTERED]: { kind: "oauth", challengedAt: "initialize", challenge: 'Bearer realm="OAuth"', authorizationServer: login(false, "https://slack.example") },
  [BROKEN]: { kind: "http-other", status: 500, via: "post" },
});

const failuresOf = (judged: ReturnType<typeof judgeEntry>): string[] => (judged.verdict.kind === "exclude" ? judged.verdict.failures.map((f) => f.rule) : []);

describe("judgeEntry", () => {
  it("an MIT plugin with a skill and an open server is vendored", () => {
    const judged = judgeEntry(entry("linear", readOk({ servers: [http("linear", OPEN)] })), PROBES);
    expect(judged.verdict).toEqual({ kind: "vendor" });
    expect(judged.servers.map((s) => s.reachability)).toEqual(["open"]);
  });

  it("rule 1: no licence, all rights reserved and an unrecognised text each exclude; the detail names the file", () => {
    for (const licence of ["none", "all-rights-reserved", "unrecognised"] as const) {
      const judged = judgeEntry(entry("x", readOk(), licence), PROBES);
      expect(failuresOf(judged)).toEqual(["1-redistributable"]);
    }
    const judged = judgeEntry(entry("x", readOk(), "all-rights-reserved"), PROBES);
    expect(judged.verdict.kind === "exclude" && judged.verdict.failures[0]?.detail).toBe("x/LICENSE reserves all rights");
  });

  it("rule 2: a plugin of hooks and commands only fails with those components named", () => {
    const read = readOk({ skills: [], ignored: [{ kind: "hooks", path: "hooks" }, { kind: "commands", path: "commands" }, { kind: "hooks", path: "hooks/other" }] });
    const judged = judgeEntry(entry("hooks-only", read), PROBES);
    expect(failuresOf(judged)).toEqual(["2-becomes-something"]);
    expect(judged.verdict.kind === "exclude" && judged.verdict.failures[0]?.detail).toBe("it carries only commands, hooks, which Stigmer does not install");
  });

  it("rule 2: an entry the reader refuses fails with the reader's sentence", () => {
    const read: EntryRead = { ok: false, kind: "refused", errors: [{ kind: "no-manifest", message: "no plugin manifest found" }], warnings: [] };
    const judged = judgeEntry(entry("broken", read), PROBES);
    expect(failuresOf(judged)).toEqual(["2-becomes-something"]);
    expect(judged.verdict.kind === "exclude" && judged.verdict.failures[0]?.detail).toBe("the reader refuses it: no plugin manifest found");
  });

  it("rule 3: a server the wire refuses fails, naming the server and what it answered", () => {
    const judged = judgeEntry(entry("x", readOk({ servers: [http("api", BROKEN)] })), PROBES);
    expect(failuresOf(judged)).toEqual(["3-servers-reachable"]);
    expect(judged.verdict.kind === "exclude" && judged.verdict.failures[0]?.detail).toBe(`'api' at ${BROKEN}: answers HTTP 500 (post)`);
  });

  it("rule 3: a server with no probe result is not assumed reachable", () => {
    const judged = judgeEntry(entry("x", readOk({ servers: [http("api", "https://never.probed.example/mcp")] })), PROBES);
    expect(failuresOf(judged)).toEqual(["3-servers-reachable"]);
    expect(judged.servers[0]?.reachability).toBe("not-probed");
  });

  it("rule 3: a proxied host fails whatever the wire said", () => {
    const url = `https://${[...PROXY_HOSTS][0]}/mcp/gong`;
    const judged = judgeEntry(entry("gong", readOk({ servers: [http("gong", url)] })), probes({ [url]: OPEN_OUTCOME }));
    expect(judged.servers[0]?.reachability).toBe("proxy");
    expect(failuresOf(judged)).toEqual(["3-servers-reachable"]);
  });

  it("a declared key makes a server reachable without a probe, and the verdict is vendor", () => {
    const judged = judgeEntry(entry("github", readOk({ servers: [http("github", "https://api.github.example/mcp", ["GITHUB_TOKEN"])] })), PROBES);
    expect(judged.servers[0]?.reachability).toBe("api-key");
    expect(judged.verdict).toEqual({ kind: "vendor" });
  });

  it("rule 3: a declared variable no header or URL sends is unwired, and the entry is out with the variables named", () => {
    // Cursor's `auth` block, once the reader drops it, leaves exactly this:
    // two variables on `env` and nothing on the wire that carries them.
    const unwired: EntryServer = { name: "gong", transport: "http", url: OAUTH, headers: {}, env: ["CLIENT_ID", "CLIENT_SECRET"], vendorAuthHint: {} };
    const judged = judgeEntry(entry("gong", readOk({ servers: [unwired] })), PROBES);
    expect(judged.servers[0]?.reachability).toBe("credential-unwired");
    expect(failuresOf(judged)).toEqual(["3-servers-reachable"]);
    expect(judged.verdict.kind === "exclude" && judged.verdict.failures[0]?.detail).toBe(
      `'gong' at ${OAUTH}: declares \${CLIENT_ID}, \${CLIENT_SECRET} that no header sends (the vendor's own sign-in, which Stigmer does not read); an install would ask for the value and never use it`,
    );
    // A variable the URL carries is wired; only the header-less one is named.
    const half: EntryServer = { name: "api", transport: "http", url: "https://api.vendor.example/${REGION}/mcp", headers: {}, env: ["REGION", "TOKEN"] };
    expect(unwiredVariables(half)).toEqual(["TOKEN"]);
  });

  it("rule 4: a stdio server fails, and rule 3 is not also charged for it", () => {
    const judged = judgeEntry(entry("local", readOk({ servers: [stdio("fs")] })), PROBES);
    expect(failuresOf(judged)).toEqual(["4-no-stdio"]);
  });

  it("rule 5: a personal-account word excludes and raises the flag", () => {
    expect(PERSONAL_ACCOUNT_TOKENS.has("gmail")).toBe(true);
    const judged = judgeEntry(entry("gmail", readOk({ servers: [http("gmail", OPEN)] })), PROBES);
    expect(failuresOf(judged)).toEqual(["5-not-personal-account"]);
    expect(judged.flags.personalAccount).toBe(true);
    const team = judgeEntry(entry("linear", readOk({ servers: [http("linear", OPEN)] })), PROBES);
    expect(team.flags.personalAccount).toBe(false);
  });

  it("rule 6: a login server without dynamic registration is reachable for rule 3 and fails rule 6", () => {
    const judged = judgeEntry(entry("slack", readOk({ servers: [http("slack", PRE_REGISTERED)] })), PROBES);
    expect(judged.servers[0]?.reachability).toBe("oauth-pre-registered");
    expect(failuresOf(judged)).toEqual(["6-dynamic-registration"]);
  });

  it("every failing rule is listed, not the first", () => {
    const judged = judgeEntry(entry("mail-local", readOk({ servers: [stdio("mail"), http("api", BROKEN)] }), "none"), PROBES);
    expect(failuresOf(judged)).toEqual(["1-redistributable", "4-no-stdio", "3-servers-reachable", "5-not-personal-account"]);
  });

  it("flags the variables the reader inferred and the vendor's own auth block", () => {
    const variables: PluginVariable[] = [
      { name: "API_KEY", isSecret: true, optional: false, declaredBy: "inferred" },
      { name: "REGION", isSecret: false, optional: true, declaredBy: "cursor" },
    ];
    const server: EntryServer = { name: "api", transport: "http", url: OPEN, headers: {}, env: [], vendorAuthHint: { type: "oauth" } };
    const judged = judgeEntry(entry("x", readOk({ variables, servers: [server] })), PROBES);
    expect(judged.flags.inferredVariables).toEqual(["API_KEY"]);
    expect(judged.flags.vendorAuthHint).toBe(true);
  });
});

describe("judgeServer", () => {
  it("maps each probe outcome to its reachability", () => {
    const at = (url: string): string => judgeServer(http("s", url), PROBES).reachability;
    expect(at(OPEN)).toBe("open");
    expect(at(OAUTH)).toBe("oauth");
    expect(at(PRE_REGISTERED)).toBe("oauth-pre-registered");
    expect(at(BROKEN)).toBe("http-other");
    const rest = probes({
      "https://a/": { kind: "oauth-unresolvable", challengedAt: "initialize", challenge: 'Bearer realm="OAuth"', reason: "x" },
      "https://b/": { kind: "challenge-not-oauth", challengedAt: "tools/list", challenge: "Bearer" },
      "https://c/": { kind: "unreachable", error: "ENOTFOUND" },
      "https://d/": { kind: "handshake-rejected", status: 200, message: "Unsupported protocol version" },
    });
    expect(judgeServer(http("s", "https://a/"), rest).reachability).toBe("oauth-unresolvable");
    expect(judgeServer(http("s", "https://b/"), rest).reachability).toBe("challenge-not-oauth");
    expect(judgeServer(http("s", "https://c/"), rest).reachability).toBe("unreachable");
    expect(judgeServer(http("s", "https://d/"), rest).reachability).toBe("handshake-rejected");
    expect(judgeServer(stdio("s"), rest).reachability).toBe("stdio");
  });

  it("an OAuth challenge drawn at tools/list after an open handshake is oauth, and the reason says where it was asked", () => {
    const google = probes({
      "https://g/": { kind: "oauth", challengedAt: "tools/list", challenge: 'Bearer realm="OAuth"', authorizationServer: login(true, "https://accounts.google.example") },
    });
    const judged = judgeServer(http("gmail", "https://g/"), google);
    expect(judged.reachability).toBe("oauth");
    expect(describeReachability(judged)).toBe("standard OAuth asked for at tools/list after an open handshake; the login server registers clients");
  });
});

describe("classifyCatalogues", () => {
  const catalogue = (source: AuditSource, entries: readonly EntryFacts[]): CatalogueFacts => ({
    source,
    commit: "a".repeat(40),
    marketplacePath: "marketplace.json",
    dialect: "cursor",
    entries,
    dropped: [],
    rootLicence: { licence: "none" },
  });

  it("proposes endpoints to author from entries whose only failure is the licence, minus URLs a vendored entry brings, one per URL", () => {
    const cursor = catalogue(SOURCE, [entry("linear", readOk({ servers: [http("linear", OPEN)] }))]);
    const codex = catalogue(OTHER_SOURCE, [
      // Same endpoint Cursor vendors: not a candidate.
      entry("linear", readOk({ servers: [http("linear", OPEN)] }), "none", OTHER_SOURCE),
      // Two entries naming one new endpoint: one candidate, both named.
      entry("notion", readOk({ servers: [http("notion", OAUTH)] }), "none", OTHER_SOURCE),
      entry("notion-too", readOk({ servers: [http("notion", OAUTH)] }), "none", OTHER_SOURCE),
      // Fails the licence AND has a stdio server: not a candidate.
      entry("mixed", readOk({ servers: [http("api", OAUTH), stdio("local")] }), "none", OTHER_SOURCE),
      // Pre-registered: reachable, but not something we can author a working plugin for yet.
      entry("slack", readOk({ servers: [http("slack", PRE_REGISTERED)] }), "none", OTHER_SOURCE),
    ]);
    const verdicts = classifyCatalogues([cursor, codex], PROBES);
    expect(verdicts.authoredCandidates).toEqual([
      {
        url: OAUTH,
        reachability: "oauth",
        namedBy: [
          { source: "codex-plugins", entry: "notion", server: "notion" },
          { source: "codex-plugins", entry: "notion-too", server: "notion" },
        ],
      },
    ]);
  });

  it("an MIT entry whose only fault is an unwired credential is a candidate on what the wire says; one the wire refuses is not", () => {
    const GONG = "https://gong.vendor.example/mcp";
    const DEAD = "https://dead.vendor.example/mcp";
    const unwired = (name: string, url: string): EntryServer => ({ name, transport: "http", url, headers: {}, env: ["CLIENT_ID"], vendorAuthHint: {} });
    const cursor = catalogue(SOURCE, [
      entry("gong", readOk({ servers: [unwired("gong", GONG)] })),
      entry("dead", readOk({ servers: [unwired("dead", DEAD)] })),
      // Unwired AND a stdio server: the stdio failure is not cured by authoring.
      entry("mixed", readOk({ servers: [unwired("api", OAUTH), stdio("local")] })),
    ]);
    const verdicts = classifyCatalogues(
      [cursor],
      probes({
        [GONG]: { kind: "oauth", challengedAt: "initialize", challenge: 'Bearer realm="OAuth"', authorizationServer: login(true) },
        [DEAD]: { kind: "http-other", status: 403, via: "sse" },
        [OAUTH]: { kind: "oauth", challengedAt: "initialize", challenge: 'Bearer realm="OAuth"', authorizationServer: login(true) },
      }),
    );
    expect(verdicts.entries.map((judged) => judged.verdict.kind)).toEqual(["exclude", "exclude", "exclude"]);
    expect(verdicts.authoredCandidates).toEqual([{ url: GONG, reachability: "oauth", namedBy: [{ source: "cursor-plugins", entry: "gong", server: "gong" }] }]);
  });

  it("an unwired server whose login server refuses registration is neither a candidate nor forgotten: it is on the programme's list", () => {
    const HUBSPOT = "https://hubspot.vendor.example/mcp";
    const unwired: EntryServer = { name: "hubspot", transport: "http", url: HUBSPOT, headers: {}, env: ["CLIENT_ID"], vendorAuthHint: {} };
    const verdicts = classifyCatalogues(
      [catalogue(SOURCE, [entry("hubspot", readOk({ servers: [unwired] }))])],
      probes({ [HUBSPOT]: { kind: "oauth", challengedAt: "initialize", challenge: 'Bearer realm="OAuth"', authorizationServer: login(false, "https://hubspot.example") } }),
    );
    expect(verdicts.authoredCandidates).toEqual([]);
    expect(verdicts.preRegisteredVendors.map((vendor) => vendor.issuer)).toEqual(["https://hubspot.example"]);
  });

  it("lists every login server that refuses dynamic registration, with the servers behind it", () => {
    const verdicts = classifyCatalogues(
      [catalogue(SOURCE, [entry("slack", readOk({ servers: [http("slack", PRE_REGISTERED)] })), entry("slack-2", readOk({ servers: [http("s", PRE_REGISTERED)] }))])],
      PROBES,
    );
    expect(verdicts.preRegisteredVendors).toEqual([
      {
        issuer: "https://slack.example",
        metadataUrl: "https://slack.example/.well-known/oauth-authorization-server",
        servers: [
          { source: "cursor-plugins", entry: "slack", server: "slack", url: PRE_REGISTERED },
          { source: "cursor-plugins", entry: "slack-2", server: "s", url: PRE_REGISTERED },
        ],
      },
    ]);
  });
});
