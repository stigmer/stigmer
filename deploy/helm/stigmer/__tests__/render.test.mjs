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
 *     `depends_on`, reading their addresses from env, never from shell text
 *     the chart splices values into;
 *   - every bundled container (Postgres, Temporal, the init containers) runs
 *     as its image's own user by number, non-root, with nothing to escalate
 *     to, every capability dropped and the runtime's seccomp profile; the
 *     Postgres pod's fsGroup is that user's group, re-owned only on a root
 *     mismatch, and a context set to null (a cluster that assigns its own
 *     UIDs) renders with neither;
 *   - the server's DATABASE_URL names no password and no database (they
 *     arrive as PGPASSWORD by secretKeyRef and PGDATABASE), and its user is
 *     percent-encoded the way node-postgres decodes it;
 *   - a Secret name from values renders as the string it was, never a YAML
 *     number or boolean;
 *   - every top-level values key is documented in the README;
 *   - the bundled Temporal's NetworkPolicy admits the stigmer pod on the
 *     frontend port and Temporal itself, and nothing else; it is absent
 *     when turned off or when Temporal is external; the bundled Postgres's
 *     admits the stigmer and Temporal pods on its port alone, likewise;
 *   - an authenticated external Temporal reaches both containers as the
 *     STIGMER_TEMPORAL_* settings, every secret by secretKeyRef and no
 *     volume, while a plaintext install carries none of those names; the
 *     server name reaches them with an API key alone, which implies TLS;
 *   - with the issuer set and no runner key named, the pod is the server
 *     alone, and the runner's claim is still created (stigmer/stigmer#1169:
 *     only someone signed in can create the key, so sign-in comes first);
 *   - the notes `helm install` prints tell that operator the runner is
 *     waiting for its key and how to give it one, and say nothing of it once
 *     the key is named or when there is no sign-in (stigmer/stigmer#1468);
 *   - an install that states its unauthenticated exposure on purpose is told,
 *     in the notes, that whoever reaches it controls Stigmer;
 *   - the notes' upgrade names this chart's version, so `--reuse-values`
 *     reuses the values with the chart they were written for;
 *   - sign-in whose public URL is plain HTTP on a host other than localhost
 *     is warned of in the notes, never refused (TLS may end in front of the
 *     Ingress);
 *   - Temporal's address splits at its last colon, an IPv6 literal's
 *     brackets dropped, and hosts, class names and storage classes render
 *     as the strings they were.
 *
 * Goldens live in `golden/<profile>.yaml` with the chart version replaced by
 * a placeholder so a release-pin bump does not churn them. Regenerate with
 * `UPDATE_GOLDENS=1` only under a stated reason in the execution record.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

  test(`[${profile}] the server runs as uid 1000 by number; the runner drops every capability but the five that run its agent user`, () => {
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
    assert.deepEqual(runner.capabilities?.add, ["SETUID", "SETGID", "CHOWN", "KILL", "DAC_OVERRIDE"]);
    const runnerEnv = containerNamed(pod, "runner").env;
    assert.deepEqual(
      runnerEnv.find((e) => e.name === "STIGMER_AGENT_HOME"),
      { name: "STIGMER_AGENT_HOME", value: "/data/agent" },
      "the agent's home persists on the runner's volume, beside its own state",
    );
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
      /\/dev\/tcp\/\$\{TEMPORAL_HOST\}\/\$\{TEMPORAL_PORT\}/,
      "the init container must wait for Temporal's frontend",
    );
    assert.equal(
      envMap(wait).get("TEMPORAL_PORT")?.value,
      "7233",
      "the init container must wait for Temporal's frontend",
    );
  });

  test(`[${profile}] every bundled container runs as its image's user, unprivileged`, () => {
    const expected = {
      [`${RELEASE}-postgres/postgres`]: 999,
      [`${RELEASE}-temporal/temporal`]: 1000,
      [`${RELEASE}-temporal/wait-for-postgres`]: 999,
      [`${RELEASE}/wait-for-dependencies`]: 999,
    };
    const seen = [];
    for (const { name, spec } of podTemplates(renderProfile(profile))) {
      for (const container of [
        ...(spec.initContainers ?? []),
        ...(spec.containers ?? []),
      ]) {
        const key = `${name}/${container.name}`;
        if (!(key in expected)) continue;
        seen.push(key);
        const context = container.securityContext ?? {};
        assert.equal(context.runAsNonRoot, true, `${key} runs as root`);
        assert.equal(context.runAsUser, expected[key], `${key}'s uid`);
        assert.equal(context.allowPrivilegeEscalation, false, key);
        assert.deepEqual(context.capabilities?.drop, ["ALL"], key);
        assert.equal(context.seccompProfile?.type, "RuntimeDefault", key);
      }
      if (name === `${RELEASE}-postgres`) {
        assert.equal(
          spec.securityContext?.fsGroup,
          999,
          "a fresh Postgres claim must be writable by its user",
        );
        assert.equal(spec.securityContext?.fsGroupChangePolicy, "OnRootMismatch");
      }
    }
    // Every expected container whose workload this profile renders was seen,
    // so a rename cannot make the case pass on nothing.
    const workloads = new Set(podTemplates(renderProfile(profile)).map((p) => p.name));
    for (const key of Object.keys(expected)) {
      if (workloads.has(key.split("/")[0])) {
        assert.ok(seen.includes(key), `${key} was not checked`);
      }
    }
    assert.ok(
      seen.includes(`${RELEASE}/wait-for-dependencies`),
      "the stigmer pod's init container was checked",
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
      `helm upgrade ${RELEASE} oci://ghcr.io/stigmer/charts/stigmer -n default --version ${readChart().version} --reuse-values --set runner.stigmerToken.existingSecret=stigmer-runner-token`,
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

test("the server's DATABASE_URL names no password; the password is PGPASSWORD from its Secret", () => {
  for (const profile of PROFILES) {
    const pod = findOne(renderProfile(profile), "Deployment", RELEASE).spec
      .template.spec;
    const env = envMap(containerNamed(pod, "server"));
    const url = new URL(env.get("DATABASE_URL")?.value ?? "");
    assert.equal(url.password, "", `[${profile}] DATABASE_URL carries a password`);
    assert.ok(
      !env.get("DATABASE_URL").value.includes("$("),
      `[${profile}] DATABASE_URL expands nothing into itself`,
    );
    assert.deepEqual(
      env.get("PGPASSWORD")?.valueFrom?.secretKeyRef,
      { name: "stigmer-secrets", key: "POSTGRES_PASSWORD" },
      `[${profile}] PGPASSWORD`,
    );
    assert.equal(url.pathname, "", `[${profile}] DATABASE_URL names no database`);
    assert.equal(env.get("PGDATABASE")?.value, "stigmer", `[${profile}] PGDATABASE`);
    assert.equal(env.has("POSTGRES_PASSWORD"), false, `[${profile}]`);
  }
});

test("the database user and name reach node-postgres exactly, whatever their characters", () => {
  const user = "team a@ops:1/+";
  const database = "stig/mer+1@x:y";
  const pod = findOne(
    renderProfile("byo", {
      sets: [`externalDatabase.user=${user}`, `externalDatabase.database=${database}`],
    }),
    "Deployment",
    RELEASE,
  ).spec.template.spec;
  const env = envMap(containerNamed(pod, "server"));
  const url = new URL(env.get("DATABASE_URL").value);
  // node-postgres (pg-connection-string) reads the user with
  // decodeURIComponent, so the user rides the URL percent-encoded; it reads a
  // URL's database with decodeURI, which keeps reserved escapes, so the
  // database never rides the URL and arrives as PGDATABASE instead.
  assert.equal(decodeURIComponent(url.username), user);
  assert.equal(url.host, "byo-postgres.byo-infra.svc.cluster.local:5432");
  assert.equal(url.pathname, "");
  assert.equal(env.get("PGDATABASE")?.value, database);
});

test("a release upgraded with --reuse-values from a chart without the new keys renders, fenced by default", () => {
  // --reuse-values replaces the new chart's defaults with the old release's
  // values; --set <key>=null removes a key the same way.
  const OLD_VALUES = [
    "postgres.networkPolicy=null",
    "postgres.securityContext=null",
    "temporal.securityContext=null",
    "waitForDependencies.securityContext=null",
    "server.allowUnauthenticatedExposure=null",
  ];
  const docs = renderProfile("bundled", { sets: OLD_VALUES });
  assert.equal(findAll(docs, "NetworkPolicy", `${RELEASE}-postgres`).length, 1);
  assert.ok(
    renderNotes("bundled", { sets: OLD_VALUES }).includes("The bundled Postgres admits only the stigmer and Temporal pods"),
  );
});

test("a postgres securityContext set to null renders, with no pod fsGroup", () => {
  const docs = renderProfile("bundled", { sets: ["postgres.securityContext=null"] });
  const postgres = findOne(docs, "StatefulSet", `${RELEASE}-postgres`).spec.template.spec;
  assert.equal(postgres.securityContext, undefined);
  assert.equal(containerNamed(postgres, "postgres").securityContext, null);
});

test("the init containers read the dependencies' addresses from env, never from spliced shell text", () => {
  const host = "db.internal;touch /tmp/pwned";
  const docs = renderProfile("byo", { sets: [`externalDatabase.host=${host}`] });
  const pod = findOne(docs, "Deployment", RELEASE).spec.template.spec;
  const wait = containerNamed(pod, "wait-for-dependencies", { init: true });
  assert.ok(
    !wait.command.join(" ").includes("pwned"),
    "a value reached the shell script's text",
  );
  assert.equal(envMap(wait).get("PGHOST")?.value, host);
});

test("a Secret name from values renders as the string it was", () => {
  const scratch = mkdtempSync(join(tmpdir(), "stigmer-chart-values-"));
  try {
    const values = join(scratch, "values.yaml");
    writeFileSync(
      values,
      'secrets:\n  existingSecret: "0123"\nrunner:\n  llm:\n    existingSecret: "true"\n',
    );
    const docs = renderProfile("bundled", { valuesFiles: [values] });
    const pod = findOne(docs, "Deployment", RELEASE).spec.template.spec;
    const server = envMap(containerNamed(pod, "server"));
    assert.equal(
      server.get("STIGMER_ENCRYPTION_KEY")?.valueFrom?.secretKeyRef?.name,
      "0123",
    );
    assert.equal(
      server.get("PGPASSWORD")?.valueFrom?.secretKeyRef?.name,
      "0123",
    );
    const runner = envMap(containerNamed(pod, "runner"));
    assert.equal(
      runner.get("ANTHROPIC_API_KEY")?.valueFrom?.secretKeyRef?.name,
      "true",
    );
    const postgres = findOne(docs, "StatefulSet", `${RELEASE}-postgres`).spec
      .template.spec;
    assert.equal(
      envMap(containerNamed(postgres, "postgres")).get("POSTGRES_PASSWORD")
        ?.valueFrom?.secretKeyRef?.name,
      "0123",
    );

    writeFileSync(
      values,
      'ingress:\n  api:\n    tlsSecretName: "0123"\n  artifacts:\n    tlsSecretName: "true"\n',
    );
    const ingresses = findAll(
      renderProfile("ingress-oidc", { valuesFiles: [values] }),
      "Ingress",
    );
    assert.deepEqual(
      ingresses.map((ingress) => ingress.spec.tls[0].secretName).sort(),
      ["0123", "true"],
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("the notes warn an install that states its unauthenticated exposure on purpose, and only it", () => {
  const WARNING = "reachable from outside the cluster with no sign-in";
  const exposed = renderNotes("bundled", {
    sets: ["service.type=LoadBalancer", "server.allowUnauthenticatedExposure=true"],
  });
  assert.ok(exposed.includes(WARNING), `the notes warn:\n${exposed}`);
  assert.ok(exposed.includes("(service.type is LoadBalancer)"), `the notes name the exposure:\n${exposed}`);
  assert.ok(exposed.includes("Whoever reaches it controls Stigmer"), exposed);

  const flagOnly = renderNotes("bundled", { sets: ["server.allowUnauthenticatedExposure=true"] });
  assert.ok(!flagOnly.includes(WARNING), `nothing is exposed, so nothing to warn of:\n${flagOnly}`);
  assert.ok(!renderNotes("bundled").includes(WARNING));
  assert.ok(!renderNotes("ingress-oidc").includes(WARNING), "sign-in is on");
});

test("the notes warn a sign-in install whose public URL is plain HTTP, and only it", () => {
  const WARNING = "Sign-in runs over plain HTTP";
  const plain = renderNotes("ingress-oidc", { sets: ["ingress.api.tlsSecretName="] });
  assert.equal(
    plain.split("\n").find((line) => line.startsWith(WARNING)),
    "Sign-in runs over plain HTTP: the public URL is http://stigmer.example.com, so tokens and the redirect URI " +
      "cross the network unencrypted, and most identity providers refuse an http redirect URI on any host but " +
      "localhost. Give the API's Ingress a TLS Secret (ingress.api.tlsSecretName), or, when TLS ends in front of " +
      "the Ingress, set server.publicUrl to the https URL people use.",
    `the notes warn, naming the plain public URL:\n${plain}`,
  );
  const plainUrl = renderNotes("ingress-oidc", { sets: ["server.publicUrl=http://stigmer.internal"] });
  assert.ok(plainUrl.includes(WARNING), `a plain public URL set by hand is warned of too:\n${plainUrl}`);

  assert.ok(!renderNotes("ingress-oidc").includes(WARNING), "the API lane has TLS");
  const local = renderNotes("bundled", {
    sets: ["server.oidc.issuer=https://issuer.example.com", "server.oidc.audience=https://stigmer.example.com"],
  });
  assert.ok(local.includes("Authentication is on"), local);
  assert.ok(!local.includes(WARNING), `localhost is the providers' own exception:\n${local}`);
  assert.ok(!renderNotes("bundled").includes(WARNING), "no sign-in, no redirect URI");
});

test("Temporal's address splits at its last colon, an IPv6 literal's brackets dropped", () => {
  const coordinates = (hostPort) => {
    const pod = findOne(
      renderProfile("byo", { sets: [`externalTemporal.hostPort=${hostPort}`] }),
      "Deployment",
      RELEASE,
    ).spec.template.spec;
    const env = envMap(containerNamed(pod, "wait-for-dependencies", { init: true }));
    return [env.get("TEMPORAL_HOST")?.value, env.get("TEMPORAL_PORT")?.value];
  };
  assert.deepEqual(coordinates("temporal.internal:7233"), ["temporal.internal", "7233"]);
  assert.deepEqual(coordinates("[fd00::1]:7233"), ["fd00::1", "7233"]);
  const bundled = envMap(
    containerNamed(
      findOne(renderProfile("bundled"), "Deployment", RELEASE).spec.template.spec,
      "wait-for-dependencies",
      { init: true },
    ),
  );
  assert.deepEqual(
    [bundled.get("TEMPORAL_HOST")?.value, bundled.get("TEMPORAL_PORT")?.value],
    [`${RELEASE}-temporal`, "7233"],
  );
});

test("hosts, the ingress class and storage classes render as the strings they were", () => {
  const scratch = mkdtempSync(join(tmpdir(), "stigmer-chart-values-"));
  try {
    const values = join(scratch, "values.yaml");
    writeFileSync(
      values,
      [
        "ingress:",
        '  className: "0123"',
        "  api:",
        '    host: "*.stigmer.example.com"',
        "  artifacts:",
        '    host: "true"',
        "artifacts:",
        "  persistence:",
        '    storageClass: "0123"',
        "postgres:",
        "  persistence:",
        '    storageClass: "true"',
        "",
      ].join("\n"),
    );
    const docs = renderProfile("ingress-oidc", { valuesFiles: [values] });
    const ingresses = findAll(docs, "Ingress");
    assert.deepEqual(ingresses.map((ingress) => ingress.spec.ingressClassName), ["0123", "0123"]);
    assert.deepEqual(
      ingresses.map((ingress) => ingress.spec.rules[0].host).sort(),
      ["*.stigmer.example.com", "true"],
    );
    assert.deepEqual(
      ingresses.map((ingress) => ingress.spec.tls[0].hosts[0]).sort(),
      ["*.stigmer.example.com", "true"],
    );
    const claims = findAll(docs, "PersistentVolumeClaim");
    assert.ok(
      claims.some((claim) => claim.spec.storageClassName === "0123"),
      "the artifacts claim keeps its storage class as a string",
    );
    const postgres = findOne(docs, "StatefulSet", `${RELEASE}-postgres`);
    assert.equal(postgres.spec.volumeClaimTemplates[0].spec.storageClassName, "true");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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
  assert.equal(findAll(off, "NetworkPolicy", `${RELEASE}-temporal`).length, 0);
  assert.equal(findAll(renderProfile("byo"), "NetworkPolicy").length, 0);
});

test("the bundled Postgres is fenced to the stigmer and Temporal pods, on its port alone", () => {
  const docs = renderProfile("bundled");
  const policy = findOne(docs, "NetworkPolicy", `${RELEASE}-postgres`);
  assert.equal(policy.spec.podSelector.matchLabels["app.kubernetes.io/component"], "postgres");
  assert.deepEqual(policy.spec.policyTypes, ["Ingress"]);
  assert.equal(policy.spec.ingress.length, 1);
  const [rule] = policy.spec.ingress;
  assert.deepEqual(rule.ports, [{ protocol: "TCP", port: "postgres" }]);
  assert.deepEqual(
    rule.from.map((peer) => peer.podSelector.matchLabels["app.kubernetes.io/component"]),
    ["stigmer", "temporal"],
  );
  // Each admitted selector is exactly what its pods carry.
  for (const [peer, workload] of [
    [rule.from[0], findOne(docs, "Deployment", RELEASE)],
    [rule.from[1], findOne(docs, "Deployment", `${RELEASE}-temporal`)],
  ]) {
    for (const [key, value] of Object.entries(peer.podSelector.matchLabels)) {
      assert.equal(workload.spec.template.metadata.labels[key], value, `${workload.metadata.name} carries ${key}`);
    }
  }
  // The named port is the one the Postgres container declares.
  const postgres = findOne(docs, "StatefulSet", `${RELEASE}-postgres`).spec.template.spec;
  assert.deepEqual(containerNamed(postgres, "postgres").ports, [{ name: "postgres", containerPort: 5432 }]);
});

test("the Postgres fence is absent when turned off or when Postgres is external", () => {
  const off = renderProfile("bundled", { sets: ["postgres.networkPolicy.enabled=false"] });
  assert.equal(findAll(off, "NetworkPolicy", `${RELEASE}-postgres`).length, 0);
  assert.equal(findAll(off, "NetworkPolicy", `${RELEASE}-temporal`).length, 1);
  assert.equal(findAll(renderProfile("byo"), "NetworkPolicy", `${RELEASE}-postgres`).length, 0);
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

test("the Temporal server name reaches both containers with an API key alone, which implies TLS", () => {
  const spec = findOne(
    renderProfile("byo", {
      sets: [
        "externalTemporal.tls.serverName=temporal.internal",
        "externalTemporal.apiKey.existingSecret=temporal-api-key",
      ],
    }),
    "Deployment",
    RELEASE,
  ).spec.template.spec;
  for (const name of ["server", "runner"]) {
    const env = envMap(containerNamed(spec, name));
    assert.equal(env.get("STIGMER_TEMPORAL_TLS_SERVER_NAME")?.value, "temporal.internal", name);
    assert.equal(env.has("STIGMER_TEMPORAL_TLS"), false, `${name}: the flag stays the operator's`);
  }
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
