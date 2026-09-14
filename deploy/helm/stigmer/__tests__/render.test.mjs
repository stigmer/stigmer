/**
 * Render tests for the chart: the structural facts every profile must hold
 * and the goldens that pin each profile's full render.
 *
 * What these pin, and why each is a rule rather than a snapshot:
 *   - one pod carries the server and the runner (Q-HC-2); `Recreate`, one
 *     replica, `fsGroup` 1000, a numeric `runAsUser` on the server (F13);
 *   - no mount path is a prefix of another in the same container (F11: a
 *     nested mount inside a claim is root-owned, and the server cannot write);
 *   - every claim the chart creates carries `helm.sh/resource-policy: keep`
 *     (Q-HC-16: `helm uninstall` leaves the data);
 *   - every container has resources; no image tag is `latest`;
 *   - the server has three native gRPC probes and the runner has none (F4);
 *   - both Service ports carry `appProtocol`;
 *   - the init container waits for the dependencies compose orders with
 *     `depends_on` (F12, F14);
 *   - every top-level values key is documented in the README.
 *
 * Goldens live in `golden/<profile>.yaml` with the chart version replaced by
 * a placeholder so a release-pin bump does not churn them. Regenerate with
 * `UPDATE_GOLDENS=1` only under a stated reason in the execution record.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CHART_DIR,
  containerNamed,
  findAll,
  findOne,
  helmTemplate,
  podTemplates,
  PROFILES,
  readChart,
  readValues,
  RELEASE,
  renderProfile,
} from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(here, "golden");

for (const profile of PROFILES) {
  test(`[${profile}] one pod carries the server and the runner, Recreate, one replica`, () => {
    const docs = renderProfile(profile);
    const deployment = findOne(docs, "Deployment", RELEASE);
    assert.equal(deployment.spec.replicas, 1);
    assert.equal(deployment.spec.strategy?.type, "Recreate");
    const names = deployment.spec.template.spec.containers
      .map((c) => c.name)
      .sort();
    assert.deepEqual(names, ["runner", "server"]);
    assert.equal(deployment.spec.template.spec.securityContext?.fsGroup, 1000);
    assert.equal(
      deployment.spec.template.spec.automountServiceAccountToken,
      false,
    );
  });

  test(`[${profile}] the server runs as uid 1000 by number (F13); the runner drops every capability`, () => {
    const pod = findOne(renderProfile(profile), "Deployment", RELEASE).spec
      .template.spec;
    const server = containerNamed(pod, "server").securityContext;
    assert.equal(server.runAsNonRoot, true);
    assert.equal(server.runAsUser, 1000);
    assert.equal(server.runAsGroup, 1000);
    assert.equal(server.allowPrivilegeEscalation, false);
    assert.deepEqual(server.capabilities?.drop, ["ALL"]);
    const runner = containerNamed(pod, "runner").securityContext;
    assert.equal(runner.allowPrivilegeEscalation, false);
    assert.deepEqual(runner.capabilities?.drop, ["ALL"]);
  });

  test(`[${profile}] no mount path is a prefix of another in the same container (F11)`, () => {
    for (const { name, spec } of podTemplates(renderProfile(profile))) {
      for (const container of [
        ...(spec.initContainers ?? []),
        ...(spec.containers ?? []),
      ]) {
        const paths = (container.volumeMounts ?? []).map((m) =>
          m.mountPath.replace(/\/+$/, ""),
        );
        for (const a of paths) {
          for (const b of paths) {
            assert.ok(
              a === b || !b.startsWith(`${a}/`),
              `${name}/${container.name}: mount ${b} is nested inside mount ${a}; a nested mount inside a claim is root-owned`,
            );
          }
        }
      }
    }
  });

  test(`[${profile}] every claim the chart creates is kept on uninstall`, () => {
    const claims = findAll(renderProfile(profile), "PersistentVolumeClaim");
    assert.ok(claims.length >= 3, "the stigmer pod alone needs three claims");
    for (const claim of claims) {
      assert.equal(
        claim.metadata.annotations?.["helm.sh/resource-policy"],
        "keep",
        `${claim.metadata.name} would be deleted with the release`,
      );
      assert.deepEqual(claim.spec.accessModes, ["ReadWriteOnce"]);
    }
  });

  test(`[${profile}] every container has resources and no image tag is latest`, () => {
    for (const { name, spec } of podTemplates(renderProfile(profile))) {
      for (const container of [
        ...(spec.initContainers ?? []),
        ...(spec.containers ?? []),
      ]) {
        assert.ok(
          container.resources?.requests,
          `${name}/${container.name} has no resource requests`,
        );
        assert.ok(
          !/:latest$/.test(container.image),
          `${name}/${container.name} runs ${container.image}`,
        );
        assert.ok(
          container.image.includes(":"),
          `${name}/${container.name} has no image tag`,
        );
      }
    }
  });

  test(`[${profile}] the server has three native gRPC probes on 7234; the runner has none (F4)`, () => {
    const pod = findOne(renderProfile(profile), "Deployment", RELEASE).spec
      .template.spec;
    const server = containerNamed(pod, "server");
    for (const probe of ["startupProbe", "readinessProbe", "livenessProbe"]) {
      assert.equal(
        server[probe]?.grpc?.port,
        7234,
        `server ${probe} is not a gRPC probe on 7234`,
      );
    }
    const runner = containerNamed(pod, "runner");
    for (const probe of ["startupProbe", "readinessProbe", "livenessProbe"]) {
      assert.equal(
        runner[probe],
        undefined,
        `the runner has no health surface; a ${probe} would pretend`,
      );
    }
  });

  test(`[${profile}] the Service carries appProtocol on both ports`, () => {
    const service = findOne(renderProfile(profile), "Service", RELEASE);
    const ports = new Map(service.spec.ports.map((p) => [p.port, p]));
    assert.equal(ports.get(7234)?.appProtocol, "grpc");
    assert.equal(ports.get(7235)?.appProtocol, "http");
  });

  test(`[${profile}] the stigmer pod waits for its dependencies before either container starts (F12, F14)`, () => {
    const pod = findOne(renderProfile(profile), "Deployment", RELEASE).spec
      .template.spec;
    const wait = containerNamed(pod, "wait-for-dependencies", { init: true });
    const script = wait.command.join(" ");
    assert.match(
      script,
      /pg_isready/,
      "the init container must wait for Postgres",
    );
    assert.match(
      script,
      /7233/,
      "the init container must wait for Temporal's frontend",
    );
  });

  test(`[${profile}] the render matches its golden`, () => {
    const chart = readChart();
    const rendered = helmTemplate(profile);
    assert.ok(rendered.ok, rendered.stderr);
    const normalized = rendered.stdout
      .split(chart.version)
      .join("<CHART_VERSION>")
      .split(`v${chart.appVersion}`)
      .join("v<APP_VERSION>");
    const goldenPath = join(GOLDEN_DIR, `${profile}.yaml`);
    if (process.env.UPDATE_GOLDENS === "1") {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      writeFileSync(goldenPath, normalized);
    }
    assert.ok(
      existsSync(goldenPath),
      `no golden at ${goldenPath}; run with UPDATE_GOLDENS=1 under a stated reason`,
    );
    assert.equal(
      normalized,
      readFileSync(goldenPath, "utf8"),
      `render drifted from golden/${profile}.yaml`,
    );
  });
}

test("the stigmer pod's Temporal coordinates are always explicit, address and namespace together", () => {
  const pod = findOne(renderProfile("byo"), "Deployment", RELEASE).spec.template
    .spec;
  const server = containerNamed(pod, "server");
  const runner = containerNamed(pod, "runner");
  const names = (c) => new Set((c.env ?? []).map((e) => e.name));
  assert.ok(
    names(server).has("TEMPORAL_HOST_PORT") &&
      names(server).has("TEMPORAL_NAMESPACE"),
  );
  assert.ok(
    names(runner).has("TEMPORAL_SERVICE_ADDRESS") &&
      names(runner).has("TEMPORAL_NAMESPACE"),
  );
});

test("the bundled Temporal is Ready only when the default namespace exists (stigmer#904)", () => {
  const docs = renderProfile("bundled");
  const temporal = findOne(docs, "Deployment", `${RELEASE}-temporal`).spec
    .template.spec;
  const container = containerNamed(temporal, "temporal");
  assert.match(
    container.readinessProbe.exec.command.join(" "),
    /temporal operator namespace describe -n default/,
  );
});

test("the byo profile renders no bundled Postgres or Temporal", () => {
  const docs = renderProfile("byo");
  assert.equal(findAll(docs, "StatefulSet").length, 0);
  assert.equal(findAll(docs, "Deployment", `${RELEASE}-temporal`).length, 0);
});

test("every top-level values key is documented in the chart README", () => {
  const readme = readFileSync(join(CHART_DIR, "README.md"), "utf8");
  for (const key of Object.keys(readValues())) {
    assert.ok(
      readme.includes(`\`${key}`),
      `values key '${key}' is not documented in README.md`,
    );
  }
});

test("Chart.yaml pins the Kubernetes floor and the GHCR source linkage", () => {
  const chart = readChart();
  assert.equal(
    chart.version,
    chart.appVersion,
    "the chart version is the release version (the fourth release pin)",
  );
  assert.match(chart.kubeVersion ?? "", />=\s*1\.27/);
  assert.deepEqual(chart.sources, ["https://github.com/stigmer/stigmer"]);
});
