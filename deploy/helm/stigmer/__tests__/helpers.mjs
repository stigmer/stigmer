/**
 * Shared machinery for the chart's render tests: run `helm template` over a
 * values profile, parse the rendered documents, and read the compose file
 * the chart translates. Plain node plus the `yaml` package (a root dev
 * dependency: the compose file uses anchors, which `JSON.parse` cannot read
 * and a hand-rolled parser would get wrong).
 *
 * Every helper takes the chart directory and the profile explicitly so the
 * same code renders a profile for a golden, for the parity test and for a
 * schema negative. Nothing here asserts; the test files do.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, parseAllDocuments } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));

/** The chart under test (`deploy/helm/stigmer`). */
export const CHART_DIR = resolve(here, "..");
/** The repository root: `deploy/helm/stigmer/__tests__` is four levels down. */
export const REPO_ROOT = resolve(here, "..", "..", "..", "..");
/** The compose file the chart is a translation of. */
export const COMPOSE_FILE = join(REPO_ROOT, "docker-compose.yml");
/** The release name every test renders under; the fullname follows it. */
export const RELEASE = "stigmer";

/** The values profiles CI installs; each is `ci/values-<name>.yaml`. */
export const PROFILES = ["bundled", "byo", "ingress-oidc"];

export function profileValuesPath(profile) {
  return join(CHART_DIR, "ci", `values-${profile}.yaml`);
}

/**
 * `helm template` for a profile, plus optional `--set` overrides and extra
 * values files. Returns `{ ok, stdout, stderr }` rather than throwing so a
 * schema negative can assert on the refusal text.
 */
export function helmTemplate(profile, { sets = [], valuesFiles = [] } = {}) {
  const args = [
    "template",
    RELEASE,
    CHART_DIR,
    "-f",
    profileValuesPath(profile),
  ];
  for (const file of valuesFiles) {
    args.push("-f", file);
  }
  for (const set of sets) {
    args.push("--set", set);
  }
  const result = spawnSync("helm", args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(
      `helm is required to run the chart tests: ${result.error.message}`,
    );
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Renders a profile and parses every document; throws on a failed render. */
export function renderProfile(profile, options) {
  const result = helmTemplate(profile, options);
  if (!result.ok) {
    throw new Error(
      `helm template failed for profile '${profile}':\n${result.stderr}`,
    );
  }
  return parseAllDocuments(result.stdout)
    .map((doc) => doc.toJS())
    .filter((doc) => doc !== null && typeof doc === "object");
}

/** The rendered documents of one kind, optionally one name. */
export function findAll(docs, kind, name) {
  return docs.filter(
    (doc) =>
      doc.kind === kind && (name === undefined || doc.metadata?.name === name),
  );
}

export function findOne(docs, kind, name) {
  const matches = findAll(docs, kind, name);
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one ${kind}${name ? ` named '${name}'` : ""}, found ${matches.length}`,
    );
  }
  return matches[0];
}

/** Every pod template in the render: Deployments and StatefulSets. */
export function podTemplates(docs) {
  return docs
    .filter((doc) => doc.kind === "Deployment" || doc.kind === "StatefulSet")
    .map((doc) => ({
      kind: doc.kind,
      name: doc.metadata.name,
      spec: doc.spec.template.spec,
    }));
}

/** A named container out of a pod spec (init containers included when asked). */
export function containerNamed(podSpec, name, { init = false } = {}) {
  const list = init
    ? (podSpec.initContainers ?? [])
    : (podSpec.containers ?? []);
  const container = list.find((c) => c.name === name);
  if (!container) {
    throw new Error(
      `no ${init ? "init " : ""}container named '${name}' (have: ${list.map((c) => c.name).join(", ")})`,
    );
  }
  return container;
}

/** The env list of a container as a map of name to `{ value }` or `{ secretKeyRef }`. */
export function envMap(container) {
  const map = new Map();
  for (const entry of container.env ?? []) {
    map.set(entry.name, entry);
  }
  return map;
}

/** The compose file as parsed YAML with anchors resolved. */
export function readCompose() {
  return parse(readFileSync(COMPOSE_FILE, "utf8"));
}

/** The chart's `Chart.yaml`. */
export function readChart() {
  return parse(readFileSync(join(CHART_DIR, "Chart.yaml"), "utf8"));
}

/** The chart's `values.yaml`. */
export function readValues() {
  return parse(readFileSync(join(CHART_DIR, "values.yaml"), "utf8"));
}
