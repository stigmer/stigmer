/**
 * The inclusion rubric applied to what was read and measured; pure.
 *
 * `plugins/README.md` states the rubric in prose; this module is the same
 * six rules as code, one predicate per rule, and a verdict per entry that
 * carries EVERY rule the entry fails, not the first. A maintainer reading
 * the report should never learn a second reason only after fixing the
 * first. The rule identifiers here are the README's numbering, so the two
 * are read side by side.
 *
 * Two of the rules are judgments this module refuses to make alone. Rule 5
 * (personal-account tools) is a flag from a short explicit word list over
 * an entry's names and hosts, excluded in the draft verdict and listed in
 * its own section for a maintainer to move; a "mail" in a marketing tool's
 * name is exactly the false positive the section exists to catch. Rule 3's
 * reading of a Cursor-proxied host is likewise a fact about a vendor, not
 * about the wire, and is flagged beside the probe's own outcome.
 *
 * Two lists fall out of the verdicts beyond include and exclude. A vendor
 * whose licence forbids copying may still name a public MCP endpoint that
 * Stigmer can author its own plugin for; those endpoints, deduplicated by
 * URL and minus the ones a vendorable entry already brings, are the
 * candidates to author. And every login server that refuses dynamic
 * registration is the list a platform-registration programme starts from.
 */

import type { PluginVariable } from "@stigmer/plugin-package";

import type { CatalogueFacts, EntryFacts, EntryServer } from "./entries.js";
import { isRedistributable } from "./licence.js";
import type { ProbeResult, ToolsListOutcome } from "./probe.js";

/** The README's rules, by their number there. */
export type RubricRule = "1-redistributable" | "2-becomes-something" | "3-servers-reachable" | "4-no-stdio" | "5-not-personal-account" | "6-dynamic-registration";

export interface RubricFailure {
  readonly rule: RubricRule;
  /** What failed, in the report's words: the server, the licence, the component. */
  readonly detail: string;
}

/** Hosts a plugin's server may point at that need a vendor's own credential, not an open standard. */
export const PROXY_HOSTS: ReadonlySet<string> = new Set(["api.cursor.com"]);

/** Name and host tokens that mark a tool of a person's own account rather than a team's system. */
export const PERSONAL_ACCOUNT_TOKENS: ReadonlySet<string> = new Set([
  "gmail",
  "mail",
  "calendar",
  "gcal",
  "drive",
  "gdrive",
  "onedrive",
  "outlook",
  "icloud",
  "contacts",
]);

/** How one server stands with Stigmer, from the wire and the declaration together. */
export type Reachability =
  /** Completes the handshake without a credential. */
  | "open"
  /** Answers, but refuses the handshake itself (a protocol the server does not speak, a malformed request); its words are kept. */
  | "handshake-rejected"
  /** Declares a variable in its headers; the user supplies a key. */
  | "api-key"
  /** Standard OAuth whose login server registers clients; Sign in can complete. */
  | "oauth"
  /** Standard OAuth whose login server needs a pre-registered app (rule 6). */
  | "oauth-pre-registered"
  /** The user is told "requires OAuth" but the metadata cannot be followed. */
  | "oauth-unresolvable"
  /** A 401 that is not OAuth and no key is declared. */
  | "challenge-not-oauth"
  /** A host that wants a vendor's own credential (`PROXY_HOSTS`). */
  | "proxy"
  | "http-other"
  | "unreachable"
  | "stdio"
  /** No probe result was supplied for the URL. */
  | "not-probed";

export interface ServerJudgement {
  readonly server: EntryServer;
  readonly probe?: ProbeResult;
  readonly reachability: Reachability;
}

export type Verdict =
  /** Copy into the catalogue at the pinned commit, with licence and notice. */
  | { readonly kind: "vendor" }
  | { readonly kind: "exclude"; readonly failures: readonly RubricFailure[] };

export interface EntryVerdict {
  readonly entry: EntryFacts;
  readonly servers: readonly ServerJudgement[];
  readonly verdict: Verdict;
  readonly flags: {
    /** Rule 5 matched a token; listed for the maintainer to move. */
    readonly personalAccount: boolean;
    /** Variables the reader had to infer: the install will ask for them without a description. */
    readonly inferredVariables: readonly string[];
    /** A server carries the vendor's own `auth` block. */
    readonly vendorAuthHint: boolean;
  };
}

/** A public endpoint Stigmer could author a plugin for, with the vendor entries that name it. */
export interface AuthoredCandidate {
  readonly url: string;
  readonly reachability: Reachability;
  readonly namedBy: readonly { readonly source: string; readonly entry: string; readonly server: string }[];
}

/** A login server that refuses dynamic registration, with the servers behind it. */
export interface PreRegisteredVendor {
  readonly issuer: string;
  readonly metadataUrl: string;
  readonly servers: readonly { readonly source: string; readonly entry: string; readonly server: string; readonly url: string }[];
}

export interface AuditVerdicts {
  readonly entries: readonly EntryVerdict[];
  readonly authoredCandidates: readonly AuthoredCandidate[];
  readonly preRegisteredVendors: readonly PreRegisteredVendor[];
}

/** Judge every entry of every catalogue against the rubric, given the probes by URL. */
export function classifyCatalogues(catalogues: readonly CatalogueFacts[], probes: ReadonlyMap<string, ProbeResult>): AuditVerdicts {
  const entries = catalogues.flatMap((catalogue) => catalogue.entries.map((entry) => judgeEntry(entry, probes)));
  return {
    entries,
    authoredCandidates: authoredCandidates(entries),
    preRegisteredVendors: preRegisteredVendors(entries),
  };
}

export function judgeEntry(entry: EntryFacts, probes: ReadonlyMap<string, ProbeResult>): EntryVerdict {
  const read = entry.read;
  const servers: ServerJudgement[] = read.ok ? read.servers.map((server) => judgeServer(server, probes)) : [];
  const failures: RubricFailure[] = [];

  if (!isRedistributable(entry.licence.licence)) {
    failures.push({ rule: "1-redistributable", detail: describeLicence(entry) });
  }

  if (!read.ok) {
    const detail =
      read.kind === "refused"
        ? `the reader refuses it: ${read.errors.map((e) => e.message).join("; ")}`
        : `its files total ${read.selectedBytes} bytes, over the ${read.maxBytes} cap`;
    failures.push({ rule: "2-becomes-something", detail });
  } else if (read.skills.length === 0 && read.subAgents.length === 0 && read.servers.length === 0) {
    const ignored = [...new Set(read.ignored.map((component) => component.kind))].sort();
    failures.push({
      rule: "2-becomes-something",
      detail: ignored.length === 0 ? "it carries no skill, sub-agent or MCP server" : `it carries only ${ignored.join(", ")}, which Stigmer does not install`,
    });
  }

  for (const judged of servers) {
    if (judged.server.transport === "stdio") {
      failures.push({ rule: "4-no-stdio", detail: `'${judged.server.name}' runs '${judged.server.command}' locally` });
      continue;
    }
    if (!isReachable(judged.reachability)) {
      failures.push({ rule: "3-servers-reachable", detail: `'${judged.server.name}' at ${judged.server.url}: ${describeReachability(judged)}` });
    }
    if (judged.reachability === "oauth-pre-registered") {
      failures.push({ rule: "6-dynamic-registration", detail: `'${judged.server.name}' signs in at a login server that does not register clients dynamically` });
    }
  }

  const personalAccount = looksPersonal(entry);
  if (personalAccount) failures.push({ rule: "5-not-personal-account", detail: "its name or a host names a person's own mail, calendar, drive or contacts" });

  const inferredVariables = read.ok ? read.variables.filter((variable: PluginVariable) => variable.declaredBy === "inferred").map((variable) => variable.name) : [];
  return {
    entry,
    servers,
    verdict: failures.length === 0 ? { kind: "vendor" } : { kind: "exclude", failures },
    flags: {
      personalAccount,
      inferredVariables,
      vendorAuthHint: read.ok && read.servers.some((server) => server.transport === "http" && server.vendorAuthHint !== undefined),
    },
  };
}

export function judgeServer(server: EntryServer, probes: ReadonlyMap<string, ProbeResult>): ServerJudgement {
  if (server.transport === "stdio") return { server, reachability: "stdio" };
  const probe = probes.get(server.url);
  const withProbe = probe === undefined ? {} : { probe };
  if (PROXY_HOSTS.has(hostOf(server.url))) return { server, ...withProbe, reachability: "proxy" };
  if (server.env.length > 0) return { server, ...withProbe, reachability: "api-key" };
  if (probe === undefined) return { server, reachability: "not-probed" };
  return { server, probe, reachability: reachabilityOf(probe) };
}

function reachabilityOf(probe: ProbeResult): Reachability {
  const outcome = probe.outcome;
  switch (outcome.kind) {
    case "open":
      return "open";
    case "handshake-rejected":
      return "handshake-rejected";
    case "oauth":
      return outcome.authorizationServer.dynamicRegistration ? "oauth" : "oauth-pre-registered";
    case "oauth-unresolvable":
      return "oauth-unresolvable";
    case "challenge-not-oauth":
      return "challenge-not-oauth";
    case "http-other":
      return "http-other";
    case "unreachable":
      return "unreachable";
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** Rule 3: whether Stigmer can connect, credentials permitting. Rule 6 is judged apart. */
export function isReachable(reachability: Reachability): boolean {
  switch (reachability) {
    case "open":
    case "api-key":
    case "oauth":
    case "oauth-pre-registered":
      return true;
    case "handshake-rejected":
    case "oauth-unresolvable":
    case "challenge-not-oauth":
    case "proxy":
    case "http-other":
    case "unreachable":
    case "stdio":
    case "not-probed":
      return false;
    default: {
      const exhaustive: never = reachability;
      return exhaustive;
    }
  }
}

/** One sentence per reachability, for the report's reason column. */
export function describeReachability(judged: ServerJudgement): string {
  const outcome = judged.probe?.outcome;
  switch (judged.reachability) {
    case "open":
      return outcome?.kind === "open"
        ? `completes the handshake without a credential and ${describeTools(outcome.tools)}; whether a tool call asks for one is not measured`
        : "completes the handshake without a credential";
    case "handshake-rejected":
      return `answers, but refuses the handshake${outcome?.kind === "handshake-rejected" ? `: ${outcome.message}` : ""}`;
    case "api-key":
      return `takes a key through ${judged.server.transport === "http" ? judged.server.env.map((v) => `\${${v}}`).join(", ") : "its environment"}`;
    case "oauth":
      return `standard OAuth${challengedAt(outcome)}; the login server registers clients`;
    case "oauth-pre-registered":
      return `standard OAuth${challengedAt(outcome)}; the login server needs a pre-registered app`;
    case "oauth-unresolvable":
      return `the user is told it requires OAuth, but its metadata cannot be followed (${outcome?.kind === "oauth-unresolvable" ? outcome.reason : "no detail"})`;
    case "challenge-not-oauth":
      return "answers 401 with a challenge that is not OAuth, and declares no key";
    case "proxy":
      return `a ${hostOf(judged.server.transport === "http" ? judged.server.url : "")} endpoint that wants the vendor's own credential`;
    case "http-other":
      return outcome?.kind === "http-other" ? `answers HTTP ${outcome.status} (${outcome.via})` : "answers an HTTP error";
    case "unreachable":
      return outcome?.kind === "unreachable" ? `no HTTP answer (${outcome.error})` : "no HTTP answer";
    case "stdio":
      return "runs a local process";
    case "not-probed":
      return "was not probed";
    default: {
      const exhaustive: never = judged.reachability;
      return exhaustive;
    }
  }
}

/** ", at tools/list" when the handshake was open and the credential was asked for one step later; nothing for the usual case. */
function challengedAt(outcome: ProbeResult["outcome"] | undefined): string {
  if (outcome === undefined) return "";
  switch (outcome.kind) {
    case "oauth":
    case "oauth-unresolvable":
    case "challenge-not-oauth":
      return outcome.challengedAt === "tools/list" ? " asked for at tools/list after an open handshake" : "";
    case "open":
    case "handshake-rejected":
    case "http-other":
    case "unreachable":
      return "";
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

function describeTools(tools: ToolsListOutcome): string {
  switch (tools.kind) {
    case "listed":
      return `lists ${tools.count} tool${tools.count === 1 ? "" : "s"} anonymously`;
    case "refused":
      return `refuses tools/list (${tools.message})`;
    case "not-asked":
      return "tools not asked (event-stream endpoint)";
    default: {
      const exhaustive: never = tools;
      return exhaustive;
    }
  }
}

function describeLicence(entry: EntryFacts): string {
  const { licence, path } = entry.licence;
  switch (licence) {
    case "none":
      return "no licence file in its folder or at the repository root";
    case "all-rights-reserved":
      return `${path ?? "its licence"} reserves all rights`;
    case "unrecognised":
      return `${path ?? "its licence"} is not a licence this audit recognises; read it`;
    case "mit":
    case "apache-2.0":
    case "bsd":
      return `${path ?? "its licence"} is ${licence}`;
    default: {
      const exhaustive: never = licence;
      return exhaustive;
    }
  }
}

function looksPersonal(entry: EntryFacts): boolean {
  const words = new Set(tokens(entry.name));
  if (entry.read.ok) {
    for (const server of entry.read.servers) {
      for (const token of tokens(server.name)) words.add(token);
      if (server.transport === "http") for (const token of tokens(hostOf(server.url))) words.add(token);
    }
  }
  for (const word of words) if (PERSONAL_ACCOUNT_TOKENS.has(word)) return true;
  return false;
}

function tokens(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== "");
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * Endpoints worth authoring: reachable servers of entries that fail ONLY
 * the licence rule (everything else about them passes), minus the URLs a
 * vendorable entry already brings, one candidate per URL.
 */
function authoredCandidates(entries: readonly EntryVerdict[]): readonly AuthoredCandidate[] {
  const vendored = new Set<string>();
  for (const judged of entries) {
    if (judged.verdict.kind !== "vendor") continue;
    for (const server of judged.servers) if (server.server.transport === "http") vendored.add(server.server.url);
  }
  const byUrl = new Map<string, { reachability: Reachability; namedBy: AuthoredCandidate["namedBy"][number][] }>();
  for (const judged of entries) {
    if (judged.verdict.kind !== "exclude") continue;
    if (!judged.verdict.failures.every((failure) => failure.rule === "1-redistributable")) continue;
    for (const server of judged.servers) {
      if (server.server.transport !== "http" || vendored.has(server.server.url)) continue;
      if (!isReachable(server.reachability) || server.reachability === "oauth-pre-registered") continue;
      const candidate = byUrl.get(server.server.url) ?? { reachability: server.reachability, namedBy: [] };
      candidate.namedBy.push({ source: judged.entry.source.name, entry: judged.entry.name, server: server.server.name });
      byUrl.set(server.server.url, candidate);
    }
  }
  return [...byUrl.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([url, candidate]) => ({ url, ...candidate }));
}

function preRegisteredVendors(entries: readonly EntryVerdict[]): readonly PreRegisteredVendor[] {
  const byIssuer = new Map<string, { metadataUrl: string; servers: PreRegisteredVendor["servers"][number][] }>();
  for (const judged of entries) {
    for (const server of judged.servers) {
      if (server.reachability !== "oauth-pre-registered" || server.server.transport !== "http") continue;
      const outcome = server.probe?.outcome;
      if (outcome?.kind !== "oauth") continue;
      const issuer = outcome.authorizationServer.issuer || new URL(outcome.authorizationServer.authorizationEndpoint).origin;
      const vendor = byIssuer.get(issuer) ?? { metadataUrl: outcome.authorizationServer.metadataUrl, servers: [] };
      vendor.servers.push({ source: judged.entry.source.name, entry: judged.entry.name, server: server.server.name, url: server.server.url });
      byIssuer.set(issuer, vendor);
    }
  }
  return [...byIssuer.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([issuer, vendor]) => ({ issuer, ...vendor }));
}
