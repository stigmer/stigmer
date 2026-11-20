/**
 * What a platform engineer brings to a cluster before exposing Stigmer at
 * one hostname, for test/install/smoke-operator.mjs's `exposed` profile:
 *
 *   - a front door controller: Traefik, from its chart, serving both
 *     Ingresses and Gateway API routes (the Gateway API definitions are
 *     installed from their release first), its HTTPS entry point on a node
 *     port the kind cluster maps to this host's 443, so
 *     https://stigmer.localtest.me (which public DNS resolves to 127.0.0.1)
 *     reaches it;
 *   - cert-manager and a certificate authority made here, as a ClusterIssuer
 *     the Stigmer names, created only when the test says (so the front door
 *     can be seen waiting for its certificate first); the CA's certificate
 *     is written to a file the test's clients trust;
 *   - a Gateway with an HTTPS listener for the hostname, its certificate
 *     issued by the same CA, for the Gateway arm;
 *   - a mail catcher, Mailpit, that the bundled sign-in sends verification
 *     mail to, read back through its API over a port-forward.
 *
 * Inside the cluster the hostname resolves to the pod itself, so nothing in
 * the cluster can reach Stigmer at its public name: a sign-in that works
 * proves the server fetched its issuer's documents in-cluster.
 *
 * Plain node and the kubectl and helm CLIs (through the kind cluster's
 * driver), no dependencies.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { installCertManager } from "./object-store.mjs";
import { pollUntil } from "./stigmer-smoke.mjs";

/** The one name the exposed install answers at. */
export const HOSTNAME = "stigmer.localtest.me";
export const PUBLIC_URL = `https://${HOSTNAME}`;
/** Traefik's HTTPS node port, mapped to the host's 443 (kindConfig). */
const HTTPS_NODE_PORT = 30443;
const TRAEFIK_CHART = { repo: "https://traefik.github.io/charts", name: "traefik", version: "42.3.0" };
const GATEWAY_API_RELEASE = "https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.6.3/standard-install.yaml";
const MAILPIT_IMAGE = "axllent/mailpit:v1.34.0";
/** The ClusterIssuer the Stigmer names. */
export const CA_ISSUER = "smoke-ca";
/** The Gateway the Gateway arm attaches to. */
export const GATEWAY = { name: "public", namespace: "front-door", sectionName: "https" };
/** The mail server the bundled sign-in sends through. */
export const MAIL = { namespace: "mail", host: "mailpit.mail.svc.cluster.local", port: 1025 };
/** Traefik's word to speak h2c (gRPC) to the server, on the server's Service. */
export const TRAEFIK_H2C = { "traefik.ingress.kubernetes.io/service.serversscheme": "h2c" };

/** The kind configuration that maps Traefik's HTTPS node port to this host's 443. */
export function kindConfig() {
  return {
    kind: "Cluster",
    apiVersion: "kind.x-k8s.io/v1alpha4",
    nodes: [{ role: "control-plane", extraPortMappings: [{ containerPort: HTTPS_NODE_PORT, hostPort: 443, listenAddress: "127.0.0.1" }] }],
  };
}

export function createFrontDoor(cluster, { log, workDir }) {
  const apply = (objects) => cluster.kubectl(["apply", "-f", "-"], { input: JSON.stringify({ apiVersion: "v1", kind: "List", items: objects }) });

  return {
    /** Traefik, the Gateway API, cert-manager with a CA (no issuer yet), the Gateway and Mailpit. */
    install() {
      log(`installing the Gateway API definitions (${GATEWAY_API_RELEASE})`);
      cluster.kubectl(["apply", "--server-side", "-f", GATEWAY_API_RELEASE], { stdio: "inherit" });
      log(`installing Traefik ${TRAEFIK_CHART.version} (chart) with its Ingress and Gateway providers`);
      cluster.helm(
        [
          "upgrade", "--install", "traefik", TRAEFIK_CHART.name,
          "--repo", TRAEFIK_CHART.repo, "--version", TRAEFIK_CHART.version,
          "--namespace", "traefik", "--create-namespace",
          "--set", "service.type=NodePort",
          "--set", `ports.websecure.nodePort=${HTTPS_NODE_PORT}`,
          "--set", "providers.kubernetesGateway.enabled=true",
          "--set", "gateway.enabled=false",
          "--set", "gatewayClass.enabled=true",
          "--wait", "--timeout", "5m",
        ],
        { stdio: "inherit" },
      );
      installCertManager(cluster, { log });
      log("making a certificate authority (cert-manager self-signed root)");
      apply([
        { apiVersion: "cert-manager.io/v1", kind: "ClusterIssuer", metadata: { name: "smoke-root" }, spec: { selfSigned: {} } },
        {
          apiVersion: "cert-manager.io/v1",
          kind: "Certificate",
          metadata: { name: "smoke-ca", namespace: "cert-manager" },
          spec: { isCA: true, commonName: "stigmer smoke CA", secretName: "smoke-ca", issuerRef: { name: "smoke-root", kind: "ClusterIssuer" } },
        },
      ]);
      cluster.kubectl(["-n", "cert-manager", "wait", "certificate/smoke-ca", "--for=condition=Ready", "--timeout=3m"], { stdio: "inherit" });

      log(`the Gateway ${GATEWAY.namespace}/${GATEWAY.name}, its listener's certificate from the same CA`);
      cluster.kubectl(["create", "namespace", GATEWAY.namespace]);
      log(`Mailpit (${MAILPIT_IMAGE}) in namespace ${MAIL.namespace}`);
      cluster.kubectl(["create", "namespace", MAIL.namespace]);
      apply(mailpit());
      cluster.kubectl(["-n", MAIL.namespace, "rollout", "status", "deployment/mailpit", "--timeout=3m"], { stdio: "inherit" });
    },

    /** The ClusterIssuer the Stigmer names, from the CA; then the Gateway, whose certificate it issues. */
    createIssuer() {
      apply([{ apiVersion: "cert-manager.io/v1", kind: "ClusterIssuer", metadata: { name: CA_ISSUER }, spec: { ca: { secretName: "smoke-ca" } } }]);
      apply(gateway());
    },

    /** The CA's certificate in a file, for NODE_EXTRA_CA_CERTS and https's `ca`. */
    caFile() {
      const secret = cluster.kubectlJson(["-n", "cert-manager", "get", "secret", "smoke-ca"]);
      const file = join(workDir, "smoke-ca.crt");
      writeFileSync(file, Buffer.from(secret.data["ca.crt"] ?? secret.data["tls.crt"], "base64"));
      return file;
    },

    /** Wait for the Gateway's listener to be programmed with its certificate. */
    async waitGateway() {
      cluster.kubectl(["-n", GATEWAY.namespace, "wait", "certificate/gateway-tls", "--for=condition=Ready", "--timeout=3m"], { stdio: "inherit" });
      await pollUntil("the Gateway's listener to be programmed", 180_000, () => {
        const gw = cluster.kubectlJson(["-n", GATEWAY.namespace, "get", "gateway", GATEWAY.name]);
        const listener = (gw.status?.listeners ?? []).find((l) => l.name === GATEWAY.sectionName);
        return (listener?.conditions ?? []).some((c) => c.type === "Programmed" && c.status === "True");
      });
    },

    /** Mailpit's API, through a port-forward the caller ends. */
    async mailbox() {
      const port = 18025;
      const forward = cluster.spawnKubectl(["-n", MAIL.namespace, "port-forward", "svc/mailpit", `${port}:8025`], { stdio: "ignore" });
      const base = `http://127.0.0.1:${port}`;
      await pollUntil("Mailpit's port-forward", 30_000, async () => (await fetch(`${base}/api/v1/info`).catch(() => undefined))?.ok === true);
      return {
        /** The text of the newest message to `to`, once one arrives. */
        async newestTo(to, timeoutMs = 120_000) {
          return pollUntil(`mail to ${to}`, timeoutMs, async () => {
            const list = await (await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
            const id = list.messages?.[0]?.ID;
            if (id === undefined) return false;
            return (await (await fetch(`${base}/api/v1/message/${id}`)).json()).Text;
          });
        },
        stop: () => forward.kill(),
      };
    },
  };
}

function gateway() {
  return [
    {
      apiVersion: "cert-manager.io/v1",
      kind: "Certificate",
      metadata: { name: "gateway-tls", namespace: GATEWAY.namespace },
      spec: { secretName: "gateway-tls", dnsNames: [HOSTNAME], issuerRef: { name: CA_ISSUER, kind: "ClusterIssuer" } },
    },
    {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "Gateway",
      metadata: { name: GATEWAY.name, namespace: GATEWAY.namespace },
      spec: {
        gatewayClassName: "traefik",
        listeners: [
          {
            name: GATEWAY.sectionName,
            protocol: "HTTPS",
            port: 8443,
            hostname: HOSTNAME,
            tls: { mode: "Terminate", certificateRefs: [{ kind: "Secret", name: "gateway-tls" }] },
            allowedRoutes: { namespaces: { from: "All" } },
          },
        ],
      },
    },
  ];
}

function mailpit() {
  const labels = { app: "mailpit" };
  return [
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "mailpit", namespace: MAIL.namespace },
      spec: {
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            containers: [
              {
                name: "mailpit",
                image: MAILPIT_IMAGE,
                ports: [
                  { name: "smtp", containerPort: 1025 },
                  { name: "http", containerPort: 8025 },
                ],
              },
            ],
          },
        },
      },
    },
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "mailpit", namespace: MAIL.namespace },
      spec: {
        selector: labels,
        ports: [
          { name: "smtp", port: 1025, targetPort: "smtp" },
          { name: "http", port: 8025, targetPort: "http" },
        ],
      },
    },
  ];
}
