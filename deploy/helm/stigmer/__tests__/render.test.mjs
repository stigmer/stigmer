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
 *     as the strings they were;
 *   - a license Secret runs the Enterprise image at the server's one tag and
 *     hands the server the key by secretKeyRef and its three settings, every
 *     name present whichever settings are filled (an empty one reads as
 *     unset), the retention a whole number however a values file spells it;
 *     an open-source profile carries none of those names and the
 *     open-source image;
 *   - the outbound fence selects the stigmer pod and opens exactly DNS, the
 *     bundled dependencies on their ports, every public address (the private,
 *     shared, link-local and loopback ranges excepted, both families) and the
 *     operator's allowedCidrs; it renders under a strict license or on
 *     request, never on an open-source profile by default or under a relaxed
 *     license, and wherever it renders the runner's fetch guard refuses
 *     private addresses;
 *   - a release upgraded with --reuse-values from a chart without the
 *     Enterprise values renders as before, and gains them, at their
 *     defaults, from the one value that licenses it;
 *   - a values file copied from an earlier chart, carrying the retired
 *     reserved keys at their off values, renders as if it did not;
 *   - the notes name the edition and the fence, and tell a fenced install
 *     whose dependencies are its own how to let them through.
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
  OPEN_SOURCE_PROFILES,
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

const LICENSE = ["enterprise.license.existingSecret=stigmer-license"];
const SIGN_IN = ["server.oidc.issuer=https://issuer.example.com", "server.oidc.audience=https://stigmer.example.com"];
const ENTERPRISE_NAMES = [
  "STIGMER_LICENSE_KEY",
  "STIGMER_OUTBOUND_EGRESS",
  "STIGMER_ORGANIZATION_CREATORS",
  "STIGMER_ACCESS_HISTORY_RETENTION_DAYS",
];
const FENCE = `${RELEASE}-egress`;

function stigmerPod(docs) {
  return findOne(docs, "Deployment", RELEASE).spec.template.spec;
}

test("a license runs the Enterprise image at the server's one tag; the runner's image is unchanged", () => {
  const { appVersion } = readChart();
  const pod = stigmerPod(renderProfile("enterprise"));
  assert.equal(containerNamed(pod, "server").image, `ghcr.io/stigmer/stigmer-server-ee:v${appVersion}`);
  assert.equal(containerNamed(pod, "runner").image, `ghcr.io/stigmer/stigmer-runner:v${appVersion}`);

  const pinned = stigmerPod(
    renderProfile("enterprise", {
      sets: ["image.server.tag=v9.9.9", "image.registry=mirror.example.com/stigmer", "image.server.enterpriseRepository=ee"],
    }),
  );
  assert.equal(containerNamed(pinned, "server").image, "mirror.example.com/stigmer/ee:v9.9.9");

  for (const profile of OPEN_SOURCE_PROFILES) {
    const open = stigmerPod(renderProfile(profile));
    assert.equal(containerNamed(open, "server").image, `ghcr.io/stigmer/stigmer-server:v${appVersion}`, profile);
  }
});

test("a license hands the server its key by secretKeyRef and its three settings", () => {
  const env = envMap(containerNamed(stigmerPod(renderProfile("enterprise")), "server"));
  assert.deepEqual(env.get("STIGMER_LICENSE_KEY"), {
    name: "STIGMER_LICENSE_KEY",
    valueFrom: { secretKeyRef: { name: "stigmer-license", key: "STIGMER_LICENSE_KEY" } },
  });
  assert.equal(env.get("STIGMER_OUTBOUND_EGRESS")?.value, "strict");
  assert.equal(env.get("STIGMER_ORGANIZATION_CREATORS")?.value, "ida_01jq3v8k6m2n4p5r7s9t0v1w2x");
  assert.equal(env.get("STIGMER_ACCESS_HISTORY_RETENTION_DAYS")?.value, "365");

  const two = envMap(
    containerNamed(
      stigmerPod(
        renderProfile("enterprise", {
          sets: [
            "enterprise.license.key=key",
            "enterprise.organizationCreators={ida_01jq3v8k6m2n4p5r7s9t0v1w2x,ida_7zzzzzzzzzzzzzzzzzzzzzzzzz}",
            "enterprise.outboundEgress=relaxed",
          ],
        }),
      ),
      "server",
    ),
  );
  assert.equal(two.get("STIGMER_LICENSE_KEY")?.valueFrom?.secretKeyRef?.key, "key");
  assert.equal(
    two.get("STIGMER_ORGANIZATION_CREATORS")?.value,
    "ida_01jq3v8k6m2n4p5r7s9t0v1w2x,ida_7zzzzzzzzzzzzzzzzzzzzzzzzz",
  );
  assert.equal(two.get("STIGMER_OUTBOUND_EGRESS")?.value, "relaxed");
});

test("a licensed pod carries every Enterprise name whichever settings are filled, an unfilled one empty", () => {
  const bare = envMap(
    containerNamed(
      stigmerPod(
        renderProfile("enterprise", {
          sets: ["enterprise.organizationCreators=null", "enterprise.accessHistoryRetentionDays=null"],
        }),
      ),
      "server",
    ),
  );
  for (const name of ENTERPRISE_NAMES) {
    assert.ok(bare.has(name), name);
  }
  assert.equal(bare.get("STIGMER_ORGANIZATION_CREATORS")?.value, "");
  assert.equal(bare.get("STIGMER_ACCESS_HISTORY_RETENTION_DAYS")?.value, "");
});

test("the retention renders as the whole number a values file wrote, never in a float's spelling", () => {
  const scratch = mkdtempSync(join(tmpdir(), "stigmer-chart-values-"));
  try {
    const values = join(scratch, "values.yaml");
    writeFileSync(values, "enterprise:\n  accessHistoryRetentionDays: 1000000\n");
    const env = envMap(containerNamed(stigmerPod(renderProfile("enterprise", { valuesFiles: [values] })), "server"));
    assert.equal(env.get("STIGMER_ACCESS_HISTORY_RETENTION_DAYS")?.value, "1000000");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("an open-source profile carries no Enterprise name and no fence", () => {
  for (const profile of OPEN_SOURCE_PROFILES) {
    const docs = renderProfile(profile);
    const pod = stigmerPod(docs);
    const names = [...envMap(containerNamed(pod, "server")).keys()];
    for (const name of ENTERPRISE_NAMES) {
      assert.ok(!names.includes(name), `[${profile}] ${name}`);
    }
    assert.equal(findAll(docs, "NetworkPolicy", FENCE).length, 0, `[${profile}] no fence unless asked`);
    assert.ok(!envMap(containerNamed(pod, "runner")).has("STIGMER_WEB_FETCH_ALLOW_PRIVATE"), `[${profile}]`);
  }
});

const PRIVATE_V4 = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "127.0.0.0/8"];
const PRIVATE_V6 = ["fc00::/7", "fe80::/10", "::1/128"];

function selectorOf(docs, workload) {
  return findOne(docs, workload.kind, workload.name).spec.template.metadata.labels;
}

test("the fence opens exactly DNS, the bundled dependencies, the public internet and nothing private", () => {
  const docs = renderProfile("enterprise");
  const policy = findOne(docs, "NetworkPolicy", FENCE);
  assert.equal(policy.metadata.labels["app.kubernetes.io/component"], "stigmer");
  assert.deepEqual(policy.spec.policyTypes, ["Egress"]);
  assert.equal(policy.spec.ingress, undefined, "the fence holds egress only");
  // It selects the stigmer pod by exactly the labels its pods carry.
  const podLabels = selectorOf(docs, { kind: "Deployment", name: RELEASE });
  for (const [key, value] of Object.entries(policy.spec.podSelector.matchLabels)) {
    assert.equal(podLabels[key], value, key);
  }
  assert.equal(policy.spec.podSelector.matchLabels["app.kubernetes.io/component"], "stigmer");

  const [dns, postgres, temporal, internet, ...rest] = policy.spec.egress;
  assert.deepEqual(rest, [], "no rule beyond the four");
  assert.deepEqual(dns, {
    ports: [
      { protocol: "UDP", port: 53 },
      { protocol: "TCP", port: 53 },
    ],
  });
  for (const [rule, component, port, workload] of [
    [postgres, "postgres", 5432, { kind: "StatefulSet", name: `${RELEASE}-postgres` }],
    [temporal, "temporal", 7233, { kind: "Deployment", name: `${RELEASE}-temporal` }],
  ]) {
    assert.deepEqual(rule.ports, [{ protocol: "TCP", port }], component);
    assert.equal(rule.to.length, 1, component);
    const labels = selectorOf(docs, workload);
    for (const [key, value] of Object.entries(rule.to[0].podSelector.matchLabels)) {
      assert.equal(labels[key], value, `${component} carries ${key}`);
    }
    assert.equal(rule.to[0].podSelector.matchLabels["app.kubernetes.io/component"], component);
  }
  assert.deepEqual(internet, {
    to: [
      { ipBlock: { cidr: "0.0.0.0/0", except: PRIVATE_V4 } },
      { ipBlock: { cidr: "::/0", except: PRIVATE_V6 } },
    ],
  });
});

test("the fence opens the operator's allowedCidrs, and the bundled rules leave with the bundled dependencies", () => {
  const docs = renderProfile("byo", {
    sets: ["egressPolicy.enabled=true", "egressPolicy.allowedCidrs={10.20.0.0/16,fd00:1::/64}"],
  });
  const rules = findOne(docs, "NetworkPolicy", FENCE).spec.egress;
  assert.equal(rules.length, 3, "DNS, the public internet, the operator's CIDRs");
  assert.ok(!rules.some((rule) => rule.to?.some((peer) => peer.podSelector)), "nothing bundled to admit");
  assert.deepEqual(rules[2], { to: [{ ipBlock: { cidr: "10.20.0.0/16" } }, { ipBlock: { cidr: "fd00:1::/64" } }] });
});

test("the fence renders under a strict license or on request, and the runner's fetch guard follows it", () => {
  const fenced = (sets, profile = "bundled") => {
    const docs = renderProfile(profile, { sets });
    const runner = envMap(containerNamed(stigmerPod(docs), "runner"));
    return {
      fence: findAll(docs, "NetworkPolicy", FENCE).length === 1,
      flag: runner.get("STIGMER_WEB_FETCH_ALLOW_PRIVATE")?.value,
    };
  };
  assert.deepEqual(fenced([], "enterprise"), { fence: true, flag: "false" });
  assert.deepEqual(fenced(["enterprise.outboundEgress=relaxed"], "enterprise"), { fence: false, flag: undefined });
  assert.deepEqual(
    fenced(["enterprise.outboundEgress=relaxed", "egressPolicy.enabled=true"], "enterprise"),
    { fence: true, flag: "false" },
  );
  assert.deepEqual(fenced(["egressPolicy.enabled=true"]), { fence: true, flag: "false" });
  assert.deepEqual(fenced([]), { fence: false, flag: undefined });
});

test("a license with the server alone (no runner key yet) is still fenced, and the server's settings stand", () => {
  const docs = renderProfile("enterprise", { sets: ["runner.stigmerToken.existingSecret="] });
  const pod = stigmerPod(docs);
  assert.deepEqual(pod.containers.map((c) => c.name), ["server"]);
  assert.equal(findAll(docs, "NetworkPolicy", FENCE).length, 1);
  assert.ok(envMap(containerNamed(pod, "server")).has("STIGMER_LICENSE_KEY"));
});

test("a release upgraded with --reuse-values from a chart without the Enterprise values renders as before, and one value licenses it", () => {
  const OLD_VALUES = ["enterprise=null", "egressPolicy=null", "image.server.enterpriseRepository=null"];
  const before = helmTemplate("bundled", { sets: OLD_VALUES });
  assert.ok(before.ok, before.stderr);
  assert.equal(before.stdout, helmTemplate("bundled").stdout, "nothing changes for an open-source release");

  const { appVersion } = readChart();
  const licensed = renderProfile("bundled", {
    sets: [
      "enterprise.license.key=null",
      "enterprise.outboundEgress=null",
      "enterprise.organizationCreators=null",
      "enterprise.accessHistoryRetentionDays=null",
      "egressPolicy=null",
      "image.server.enterpriseRepository=null",
      ...SIGN_IN,
      ...LICENSE,
    ],
  });
  const server = containerNamed(stigmerPod(licensed), "server");
  assert.equal(server.image, `ghcr.io/stigmer/stigmer-server-ee:v${appVersion}`);
  const env = envMap(server);
  assert.equal(env.get("STIGMER_LICENSE_KEY")?.valueFrom?.secretKeyRef?.key, "STIGMER_LICENSE_KEY");
  assert.equal(env.get("STIGMER_OUTBOUND_EGRESS")?.value, "strict");
  assert.equal(findAll(licensed, "NetworkPolicy", FENCE).length, 1, "strict by default, so fenced");
});

test("a values file copied from an earlier chart, with the retired keys off, renders as if it did not carry them", () => {
  const scratch = mkdtempSync(join(tmpdir(), "stigmer-chart-values-"));
  try {
    const values = join(scratch, "values.yaml");
    writeFileSync(
      values,
      'openfga:\n  enabled: false\nredis:\n  enabled: false\nopenbao:\n  enabled: false\nlicenseKeySecret: ""\n',
    );
    const copied = helmTemplate("bundled", { valuesFiles: [values] });
    assert.ok(copied.ok, copied.stderr);
    assert.equal(copied.stdout, helmTemplate("bundled").stdout);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("the notes name the edition and the fence, and only where they hold", () => {
  const FENCED = "The stigmer pod's outbound network is fenced";
  const enterprise = renderNotes("enterprise");
  assert.ok(enterprise.startsWith(`Stigmer Enterprise ${readChart().appVersion} is installed`), enterprise);
  assert.ok(enterprise.includes(FENCED), enterprise);
  assert.ok(!enterprise.includes("One trust domain: stdio MCP servers run inside the runner container and can reach its filesystem and network."), enterprise);

  const open = renderNotes("bundled");
  assert.ok(open.startsWith(`Stigmer ${readChart().appVersion} is installed`), open);
  assert.ok(!open.includes("Enterprise"), open);
  assert.ok(!open.includes(FENCED), open);

  const relaxed = renderNotes("enterprise", { sets: ["enterprise.outboundEgress=relaxed"] });
  assert.ok(relaxed.startsWith("Stigmer Enterprise"), relaxed);
  assert.ok(!relaxed.includes(FENCED), relaxed);
});

test("the notes tell a fenced install with its own Postgres or Temporal how to let them through", () => {
  const HINT = "egressPolicy.allowedCidrs";
  const byo = renderNotes("byo", { sets: ["egressPolicy.enabled=true"] });
  assert.ok(byo.includes(HINT), byo);
  assert.ok(byo.includes("byo-postgres.byo-infra.svc.cluster.local"), byo);
  assert.ok(byo.includes("byo-temporal.byo-infra.svc.cluster.local:7233"), byo);
  assert.ok(!renderNotes("byo").includes(HINT), "no fence, nothing to let through");
  assert.ok(!renderNotes("bundled", { sets: ["egressPolicy.enabled=true"] }).includes(`your Postgres`), "bundled is admitted by the fence itself");
});
