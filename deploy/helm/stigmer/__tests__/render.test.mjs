/**
 * Render tests for the chart: the structural facts every profile must hold
 * and the goldens that pin each profile's full render.
 *
 * What these pin, and why each is a rule rather than a snapshot:
 *   - one pod carries the server and the runner; `Recreate`, one
 *     replica, `fsGroup` 1000, a numeric `runAsUser` on the server;
 *   - no mount path is a prefix of another in the same container (a
 *     nested mount inside a claim is root-owned, and the server cannot write);
 *   - every claim the chart creates carries `helm.sh/resource-policy: keep`
 *     (`helm uninstall` leaves the data);
 *   - every container has resources; no image tag is `latest`;
 *   - the server has three native gRPC probes and the runner has none;
 *   - both Service ports carry `appProtocol`;
 *   - the init container waits for the dependencies compose orders with
 *     `depends_on`;
 *   - every top-level values key is documented in the README;
 *   - the bundled Temporal's NetworkPolicy admits the stigmer pod on the
 *     frontend port and Temporal itself, and nothing else; it is absent
 *     when turned off or when Temporal is external;
 *   - an authenticated external Temporal reaches both containers as the
 *     STIGMER_TEMPORAL_* settings, every secret by secretKeyRef and no
 *     volume, while a plaintext install carries none of those names;
 *   - with the issuer set and no runner key named, the pod is the server
 *     alone, and the runner's claim is still created (stigmer/stigmer#1169:
 *     only someone signed in can create the key, so sign-in comes first);
 *   - the notes `helm install` prints tell that operator the runner is
 *     waiting for its key and how to give it one, and say nothing of it once
 *     the key is named or when there is no sign-in (stigmer/stigmer#1468).
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
  envMap,
  findAll,
  findOne,
  helmTemplate,
  podTemplates,
  PROFILES,
  readChart,
  readValues,
  RELEASE,
  renderNotes,
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

  test(`[${profile}] the server runs as uid 1000 by number; the runner drops every capability`, () => {
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

  test(`[${profile}] no mount path is a prefix of another in the same container`, () => {
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

  test(`[${profile}] the server has three native gRPC probes on 7234; the runner has none`, () => {
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

  test(`[${profile}] the stigmer pod waits for its dependencies before either container starts`, () => {
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

test("with the issuer set and no runner key, the pod is the server alone until the key is named (stigmer/stigmer#1169)", () => {
  const signInFirst = renderProfile("ingress-oidc", {
    sets: ["runner.stigmerToken.existingSecret="],
  });
  const pod = findOne(signInFirst, "Deployment", RELEASE).spec.template.spec;
  assert.deepEqual(
    pod.containers.map((c) => c.name),
    ["server"],
  );
  assert.deepEqual(
    pod.volumes.map((v) => v.name).sort(),
    ["artifacts", "server-data"],
  );
  assert.equal(
    findAll(signInFirst, "PersistentVolumeClaim", `${RELEASE}-runner-data`)
      .length,
    1,
    "the runner's claim stays, so its data survives the upgrade that adds it",
  );

  const named = findOne(renderProfile("ingress-oidc"), "Deployment", RELEASE)
    .spec.template.spec;
  assert.deepEqual(named.containers.map((c) => c.name).sort(), [
    "runner",
    "server",
  ]);
});

test("the notes tell a sign-in install that the runner waits for its key, and only then (stigmer/stigmer#1468)", () => {
  const RUNNER_WAITS = "The runner is not running yet.";
  const signInFirst = renderNotes("ingress-oidc", {
    sets: ["runner.stigmerToken.existingSecret="],
  });
  assert.ok(
    signInFirst.includes("Authentication is on (issuer https://issuer.example.com)."),
    `the notes name the issuer:\n${signInFirst}`,
  );
  assert.ok(
    signInFirst.includes(RUNNER_WAITS),
    `the notes say the runner waits for its key:\n${signInFirst}`,
  );
  assert.ok(
    signInFirst.includes(
      "kubectl -n default create secret generic stigmer-runner-token --from-literal=STIGMER_TOKEN=stk_...",
    ),
    `the notes show how to store the key:\n${signInFirst}`,
  );
  assert.ok(
    signInFirst.includes(
      `helm upgrade ${RELEASE} oci://ghcr.io/stigmer/charts/stigmer -n default --reuse-values --set runner.stigmerToken.existingSecret=stigmer-runner-token`,
    ),
    `the notes show the upgrade that names the key:\n${signInFirst}`,
  );

  const named = renderNotes("ingress-oidc");
  assert.ok(
    named.includes("Authentication is on"),
    `a named key keeps the sign-in notes:\n${named}`,
  );
  assert.ok(
    !named.includes(RUNNER_WAITS),
    `a named key leaves the runner nothing to wait for:\n${named}`,
  );

  const open = renderNotes("bundled");
  assert.ok(
    open.includes("There is no authentication"),
    `no issuer says so:\n${open}`,
  );
  assert.ok(
    !open.includes(RUNNER_WAITS),
    `no issuer means the runner runs at once:\n${open}`,
  );
});

test("the byo profile renders no bundled Postgres or Temporal", () => {
  const docs = renderProfile("byo");
  assert.equal(findAll(docs, "StatefulSet").length, 0);
  assert.equal(findAll(docs, "Deployment", `${RELEASE}-temporal`).length, 0);
});

test("the bundled Temporal is fenced to the stigmer pod", () => {
  const policy = findOne(renderProfile("bundled"), "NetworkPolicy", `${RELEASE}-temporal`);
  assert.equal(policy.spec.podSelector.matchLabels["app.kubernetes.io/component"], "temporal");
  assert.deepEqual(policy.spec.policyTypes, ["Ingress"]);
  const [fromStigmer, fromTemporal] = policy.spec.ingress;
  assert.equal(policy.spec.ingress.length, 2);
  assert.equal(
    fromStigmer.from[0].podSelector.matchLabels["app.kubernetes.io/component"],
    "stigmer",
  );
  assert.deepEqual(fromStigmer.ports, [{ protocol: "TCP", port: "frontend" }]);
  assert.equal(
    fromTemporal.from[0].podSelector.matchLabels["app.kubernetes.io/component"],
    "temporal",
  );
  // The stigmer pod's selector labels are exactly what its pods carry.
  const pod = findOne(renderProfile("bundled"), "Deployment", RELEASE).spec.template.metadata.labels;
  for (const [key, value] of Object.entries(fromStigmer.from[0].podSelector.matchLabels)) {
    assert.equal(pod[key], value, `the stigmer pod carries ${key}`);
  }
});

test("the Temporal fence is absent when turned off or when Temporal is external", () => {
  const off = renderProfile("bundled", { sets: ["temporal.networkPolicy.enabled=false"] });
  assert.equal(findAll(off, "NetworkPolicy").length, 0);
  assert.equal(findAll(renderProfile("byo"), "NetworkPolicy").length, 0);
});

const AUTHENTICATED_TEMPORAL = [
  "externalTemporal.tls.enabled=true",
  "externalTemporal.tls.serverName=temporal.internal",
  "externalTemporal.tls.existingSecret=temporal-tls",
  "externalTemporal.tls.caKey=ca.crt",
  "externalTemporal.tls.certKey=tls.crt",
  "externalTemporal.tls.keyKey=tls.key",
  "externalTemporal.apiKey.existingSecret=temporal-api-key",
];

test("an authenticated external Temporal reaches both containers by secretKeyRef, with no volume", () => {
  const deployment = findOne(renderProfile("byo", { sets: AUTHENTICATED_TEMPORAL }), "Deployment", RELEASE);
  const spec = deployment.spec.template.spec;
  const fromSecret = {
    STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_DATA: { name: "temporal-tls", key: "ca.crt" },
    STIGMER_TEMPORAL_TLS_CLIENT_CERT_DATA: { name: "temporal-tls", key: "tls.crt" },
    STIGMER_TEMPORAL_TLS_CLIENT_KEY_DATA: { name: "temporal-tls", key: "tls.key" },
    STIGMER_TEMPORAL_API_KEY: { name: "temporal-api-key", key: "STIGMER_TEMPORAL_API_KEY" },
  };
  for (const name of ["server", "runner"]) {
    const env = envMap(containerNamed(spec, name));
    assert.equal(env.get("STIGMER_TEMPORAL_TLS")?.value, "true", `${name}: TLS on`);
    assert.equal(env.get("STIGMER_TEMPORAL_TLS_SERVER_NAME")?.value, "temporal.internal");
    for (const [setting, ref] of Object.entries(fromSecret)) {
      assert.equal(env.get(setting)?.value, undefined, `${name}: ${setting} is never a plain value`);
      assert.deepEqual(env.get(setting)?.valueFrom?.secretKeyRef, ref, `${name}: ${setting}`);
    }
  }
  const volumeNames = (spec.volumes ?? []).map((volume) => volume.name);
  assert.ok(
    !volumeNames.some((volume) => volume.includes("temporal")),
    "the Temporal settings are env, not mounts",
  );
});

test("a plaintext install carries no STIGMER_TEMPORAL_* setting", () => {
  for (const profile of PROFILES) {
    const spec = findOne(renderProfile(profile), "Deployment", RELEASE).spec.template.spec;
    for (const name of ["server", "runner"]) {
      const names = [...envMap(containerNamed(spec, name)).keys()];
      assert.deepEqual(
        names.filter((env) => env.startsWith("STIGMER_TEMPORAL_")),
        [],
        `[${profile}] ${name}`,
      );
    }
  }
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
