/**
 * The audit's two outputs from its verdicts; pure.
 *
 * `audit.md` is for the maintainer who decides: one table per catalogue
 * with the verdict and every reason beside each entry, then the lists that
 * ask for a word (personal-account flags, endpoints to author, login
 * servers that refuse registration, servers whose answer needs a look), so
 * a decision is one name struck from one list. `audit.json` is for the
 * tooling that follows (the re-vendoring reads the commits and the vendor
 * set from it) and for the next audit to diff against: every fact and every
 * probe's raw evidence, in the order the catalogues were read, with the
 * run's time in one field so two runs at the same commits differ only
 * there.
 *
 * Nothing here knows where the files go or what a maintainer will call
 * them; `main.ts` writes them where `--out` says.
 */

import type { CatalogueFacts, EntryFacts } from "./entries.js";
import type { AuditVerdicts, EntryVerdict, ServerJudgement } from "./classify.js";
import { describeReachability, isReachable } from "./classify.js";
import type { ProbeResult } from "./probe.js";

export interface AuditRun {
  readonly generatedAt: string;
  readonly catalogues: readonly CatalogueFacts[];
  readonly verdicts: AuditVerdicts;
  readonly probes: readonly ProbeResult[];
}

/** The machine-readable output: the run whole, indented for a readable diff. */
export function renderJson(run: AuditRun): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}

/** The maintainer's report. */
export function renderMarkdown(run: AuditRun): string {
  const lines: string[] = [];
  const out = (line = ""): void => {
    lines.push(line);
  };
  const byName = new Map(run.verdicts.entries.map((judged) => [`${judged.entry.source.name}/${judged.entry.name}`, judged]));
  const judgementOf = (entry: EntryFacts): EntryVerdict => {
    const judged = byName.get(`${entry.source.name}/${entry.name}`);
    if (judged === undefined) throw new Error(`no verdict for ${entry.source.name}/${entry.name}`);
    return judged;
  };

  out("# Vendor catalogue audit");
  out();
  out(`Generated ${run.generatedAt}. The rubric is the "Inclusion rubric" in \`plugins/README.md\`; a verdict lists every rule an entry fails. Strike a name from any list below by saying so; the vendoring that follows reads the vendor set from \`audit.json\` minus what was struck.`);
  out();

  out("## Summary");
  out();
  out("| Catalogue | Commit | Listed | Dropped by the reader | Vendor | Exclude |");
  out("|---|---|---|---|---|---|");
  for (const catalogue of run.catalogues) {
    const judged = catalogue.entries.map(judgementOf);
    const vendor = judged.filter((j) => j.verdict.kind === "vendor").length;
    out(`| ${catalogue.source.name} (\`${catalogue.source.repo}\`) | \`${catalogue.commit.slice(0, 7)}\` | ${catalogue.entries.length} | ${catalogue.dropped.length} | ${vendor} | ${judged.length - vendor} |`);
  }
  out();
  const outcomes = new Map<string, number>();
  for (const probe of run.probes) outcomes.set(probe.outcome.kind, (outcomes.get(probe.outcome.kind) ?? 0) + 1);
  out(`Hosted servers probed: ${run.probes.length} distinct URLs. Outcomes: ${[...outcomes.entries()].sort().map(([kind, count]) => `${kind} ${count}`).join(", ") || "none"}.`);
  out();
  out("What the probe measures: an anonymous `initialize`, then an anonymous `tools/list`, then the OAuth metadata behind any 401 (the 401 rule is the runner's). It never calls a tool. `open` therefore means the handshake and the tool listing need no credential; a server that asks for one only at `tools/call` reads as `open` here.");
  out(`Endpoints to author: ${run.verdicts.authoredCandidates.length}. Login servers refusing dynamic registration: ${run.verdicts.preRegisteredVendors.length}.`);
  out();
  out("Exclusions by rule (an entry counts under every rule it fails):");
  out();
  const byRule = new Map<string, number>();
  for (const judged of run.verdicts.entries) {
    if (judged.verdict.kind !== "exclude") continue;
    for (const rule of new Set(judged.verdict.failures.map((f) => f.rule))) byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
  }
  for (const [rule, count] of [...byRule.entries()].sort()) out(`- ${rule}: ${count}`);
  out();

  for (const catalogue of run.catalogues) {
    out(`## ${catalogue.source.name}: \`${catalogue.source.repo}\` at \`${catalogue.commit}\``);
    out();
    out(`Marketplace file \`${catalogue.marketplacePath}\` (${catalogue.dialect} dialect). Repository licence: ${describeLicenceFact(catalogue.rootLicence)}.`);
    out();
    out("| Entry | Becomes | Servers | Licence | Verdict | Reasons |");
    out("|---|---|---|---|---|---|");
    for (const entry of catalogue.entries) {
      const judged = judgementOf(entry);
      out(`| \`${entry.name}\` | ${becomes(entry)} | ${servers(judged)} | ${entry.licence.licence} | **${judged.verdict.kind}** | ${reasons(judged)} |`);
    }
    out();
    if (catalogue.dropped.length > 0) {
      out("Entries the reader does not offer (the product drops these with the same sentence):");
      out();
      for (const dropped of catalogue.dropped) out(`- ${dropped.subject === undefined ? "" : `\`${dropped.subject}\`: `}${dropped.finding.message}`);
      out();
    }
  }

  const personal = run.verdicts.entries.filter((judged) => judged.flags.personalAccount);
  out("## Rule 5 flags: excluded on a word, for you to move");
  out();
  if (personal.length === 0) out("None.");
  for (const judged of personal) out(`- \`${judged.entry.source.name}/${judged.entry.name}\`${otherFailures(judged, "5-not-personal-account")}`);
  out();

  out("## Endpoints to author");
  out();
  out("Reachable servers of entries that fail only the licence rule, minus URLs a vendored entry already brings. A Stigmer-authored plugin names the URL; no vendor text is copied.");
  out();
  if (run.verdicts.authoredCandidates.length === 0) out("None.");
  else {
    out("| URL | Reachability | Named by |");
    out("|---|---|---|");
    for (const candidate of run.verdicts.authoredCandidates) {
      out(`| ${candidate.url} | ${candidate.reachability} | ${candidate.namedBy.map((n) => `\`${n.source}/${n.entry}\` (${n.server})`).join(", ")} |`);
    }
  }
  out();

  out("## Login servers that refuse dynamic registration (rule 6)");
  out();
  out("Sign in cannot complete against these without an OAuth app registered with the vendor. The list a platform-registration programme starts from.");
  out();
  if (run.verdicts.preRegisteredVendors.length === 0) out("None.");
  for (const vendor of run.verdicts.preRegisteredVendors) {
    out(`- ${vendor.issuer} (metadata: ${vendor.metadataUrl})`);
    for (const server of vendor.servers) out(`  - \`${server.source}/${server.entry}\` ${server.server}: ${server.url}`);
  }
  out();

  out("## Servers whose answer needs a look");
  out();
  out("Every probe that did not end in `open`, `oauth` or a declared key, with what the wire said. The runner shows a user the \"requires OAuth\" sentence only for `oauth-unresolvable`; the others surface as an opaque connection error today.");
  out();
  const attention = run.verdicts.entries.flatMap((judged) =>
    judged.servers
      .filter((s) => s.server.transport === "http" && !isReachable(s.reachability) && s.reachability !== "stdio")
      .map((s) => ({ judged, s })),
  );
  if (attention.length === 0) out("None.");
  for (const { judged, s } of attention) {
    out(`- \`${judged.entry.source.name}/${judged.entry.name}\` ${s.server.name} (${s.reachability}): ${describeReachability(s)}`);
    for (const step of s.probe?.evidence ?? []) {
      const status = step.status === undefined ? `error ${step.error ?? ""}` : `HTTP ${step.status}`;
      out(`  - ${step.method} ${step.url}${step.retry === true ? " (retry)" : ""}: ${status}${step.wwwAuthenticate === undefined ? "" : `; WWW-Authenticate: \`${step.wwwAuthenticate}\``}`);
    }
  }
  out();

  out("## Data-quality flags");
  out();
  const inferred = run.verdicts.entries.filter((judged) => judged.flags.inferredVariables.length > 0);
  out(`Entries whose variables the reader had to infer (the install asks for them without a description): ${inferred.length === 0 ? "none" : ""}`);
  for (const judged of inferred) out(`- \`${judged.entry.source.name}/${judged.entry.name}\`: ${judged.flags.inferredVariables.map((v) => `\`${v}\``).join(", ")}`);
  out();
  const hinted = run.verdicts.entries.filter((judged) => judged.flags.vendorAuthHint);
  out(`Entries carrying the vendor's own \`auth\` block, which the reader ignores: ${hinted.length === 0 ? "none" : ""}`);
  for (const judged of hinted) out(`- \`${judged.entry.source.name}/${judged.entry.name}\``);
  out();

  return `${lines.join("\n")}\n`;
}

function becomes(entry: EntryFacts): string {
  const read = entry.read;
  if (!read.ok) return read.kind === "refused" ? "refused by the reader" : "over the size cap";
  const parts: string[] = [];
  if (read.skills.length > 0) parts.push(`${read.skills.length} skill${read.skills.length === 1 ? "" : "s"}`);
  if (read.subAgents.length > 0) parts.push(`${read.subAgents.length} sub-agent${read.subAgents.length === 1 ? "" : "s"}`);
  if (read.servers.length > 0) parts.push(`${read.servers.length} server${read.servers.length === 1 ? "" : "s"}`);
  if (parts.length === 0) {
    const ignored = [...new Set(read.ignored.map((component) => component.kind))].sort();
    return ignored.length === 0 ? "nothing" : `nothing (${ignored.join(", ")})`;
  }
  return parts.join(", ");
}

/**
 * One line per server. A declared key, an unwired credential or a proxied
 * host is judged from the declaration, so the wire's own answer is shown
 * beside it: a maintainer should see that a key-taking server also speaks
 * OAuth, that an unwired one is worth authoring, or that a proxy answered
 * nothing useful.
 */
function servers(judged: EntryVerdict): string {
  if (judged.servers.length === 0) return "";
  return judged.servers
    .map((s: ServerJudgement) => {
      const declared = s.reachability === "api-key" || s.reachability === "credential-unwired" || s.reachability === "proxy";
      const wire = declared && s.probe !== undefined ? ` (wire: ${s.probe.outcome.kind})` : "";
      return `${s.server.name}: ${s.reachability}${wire}`;
    })
    .join("<br>");
}

function reasons(judged: EntryVerdict): string {
  if (judged.verdict.kind === "vendor") return "";
  return judged.verdict.failures.map((f) => `${f.rule}: ${f.detail}`).join("<br>");
}

function otherFailures(judged: EntryVerdict, except: string): string {
  if (judged.verdict.kind !== "exclude") return "";
  const others = judged.verdict.failures.filter((f) => f.rule !== except).map((f) => f.rule);
  return others.length === 0 ? " (this is its only failing rule)" : ` (also fails ${others.join(", ")})`;
}

function describeLicenceFact(fact: CatalogueFacts["rootLicence"]): string {
  return fact.path === undefined ? fact.licence : `${fact.licence} (\`${fact.path}\`)`;
}
