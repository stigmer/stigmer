/**
 * What a platform engineer brings to a cluster before declaring a bucket:
 * cert-manager (the database's backup plugin mints its certificates through
 * it; the operator detects it and never installs it) and an S3-compatible
 * bucket. Here the bucket is SeaweedFS in its single-container S3 mode, in
 * namespace `object-store`: MinIO no longer publishes an image to pin, and
 * SeaweedFS answers the same S3 calls the server, the runner's signed URLs
 * and the backup plugin make. Used by test/install/smoke-operator.mjs.
 *
 * The bucket is read back as an outsider would read it, by the AWS CLI in a
 * one-shot pod, so a test sees exactly what the bucket holds and nothing the
 * server reports about it.
 *
 * Plain node and the kubectl CLI (through the kind cluster's driver), no
 * dependencies.
 */

/** cert-manager's release, the one the operator's refusal names. */
export const CERT_MANAGER_RELEASE = "https://github.com/cert-manager/cert-manager/releases/download/v1.21.3/cert-manager.yaml";
const SEAWEEDFS_IMAGE = "chrislusf/seaweedfs:4.00";
const AWS_CLI_IMAGE = "amazon/aws-cli:2.31.0";

/** The bucket a Stigmer declares, and how it reaches it from inside the cluster. */
export const BUCKET = "stigmer";
export const OBJECT_STORE_NAMESPACE = "object-store";
export const OBJECT_STORE_ENDPOINT = `http://seaweedfs.${OBJECT_STORE_NAMESPACE}.svc.cluster.local:8333`;
/** Disposable credentials for a store that lives as long as the kind cluster. */
export const ACCESS_KEY_ID = "stigmer-smoke";
export const SECRET_ACCESS_KEY = "stigmer-smoke-secret";

function seaweedfsManifests() {
  const labels = { app: "seaweedfs" };
  const config = {
    identities: [
      {
        name: "stigmer",
        credentials: [{ accessKey: ACCESS_KEY_ID, secretKey: SECRET_ACCESS_KEY }],
        actions: ["Admin", "Read", "Write", "List", "Tagging"],
      },
    ],
  };
  return {
    apiVersion: "v1",
    kind: "List",
    items: [
      {
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: "seaweedfs-s3", namespace: OBJECT_STORE_NAMESPACE },
        stringData: { "s3.json": JSON.stringify(config) },
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "seaweedfs", namespace: OBJECT_STORE_NAMESPACE, labels },
        spec: {
          replicas: 1,
          selector: { matchLabels: labels },
          template: {
            metadata: { labels },
            spec: {
              containers: [
                {
                  name: "seaweedfs",
                  image: SEAWEEDFS_IMAGE,
                  args: ["server", "-s3", "-s3.config=/etc/seaweedfs/s3.json", "-dir=/data", "-ip.bind=0.0.0.0"],
                  ports: [{ name: "s3", containerPort: 8333 }],
                  readinessProbe: { tcpSocket: { port: 8333 }, periodSeconds: 3 },
                  volumeMounts: [
                    { name: "data", mountPath: "/data" },
                    { name: "config", mountPath: "/etc/seaweedfs", readOnly: true },
                  ],
                },
              ],
              volumes: [
                { name: "data", emptyDir: {} },
                { name: "config", secret: { secretName: "seaweedfs-s3" } },
              ],
            },
          },
        },
      },
      {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name: "seaweedfs", namespace: OBJECT_STORE_NAMESPACE },
        spec: { selector: labels, ports: [{ name: "s3", port: 8333, targetPort: "s3" }] },
      },
    ],
  };
}

/** The bucket stack on `cluster`: cert-manager, SeaweedFS and the bucket. Idempotent. */
/**
 * Install cert-manager, once per cluster: the bucket profiles need it for the
 * backup plugin, the front door for its certificate.
 */
export function installCertManager(cluster, { log }) {
  const present = cluster.kubectlQuiet(["-n", "cert-manager", "get", "deployment", "cert-manager-webhook"]);
  if (present.status === 0) return;
  log(`installing cert-manager (${CERT_MANAGER_RELEASE})`);
  cluster.kubectl(["apply", "-f", CERT_MANAGER_RELEASE], { stdio: "inherit" });
  for (const deployment of ["cert-manager", "cert-manager-cainjector", "cert-manager-webhook"]) {
    cluster.kubectl(["-n", "cert-manager", "rollout", "status", `deployment/${deployment}`, "--timeout=5m"], { stdio: "inherit" });
  }
}

export function createObjectStore(cluster, { log }) {
  let installed = false;

  /** Runs the AWS CLI against the store in a one-shot pod; resolves its stdout. */
  function aws(args) {
    const name = `aws-${Math.random().toString(36).slice(2, 8)}`;
    return cluster.kubectl(
      [
        "-n",
        OBJECT_STORE_NAMESPACE,
        "run",
        name,
        "--quiet",
        "--rm",
        "-i",
        "--restart=Never",
        `--image=${AWS_CLI_IMAGE}`,
        `--env=AWS_ACCESS_KEY_ID=${ACCESS_KEY_ID}`,
        `--env=AWS_SECRET_ACCESS_KEY=${SECRET_ACCESS_KEY}`,
        "--env=AWS_DEFAULT_REGION=us-east-1",
        "--command",
        "--",
        "aws",
        "--endpoint-url",
        OBJECT_STORE_ENDPOINT,
        ...args,
      ],
      { input: "" },
    );
  }

  return {
    /** Install cert-manager and the bucket, once. */
    install() {
      if (installed) return;
      installCertManager(cluster, { log });
      log(`installing the bucket: SeaweedFS (${SEAWEEDFS_IMAGE}) in namespace ${OBJECT_STORE_NAMESPACE}`);
      cluster.kubectl(["create", "namespace", OBJECT_STORE_NAMESPACE]);
      cluster.kubectl(["apply", "-f", "-"], { input: JSON.stringify(seaweedfsManifests()) });
      cluster.kubectl(["-n", OBJECT_STORE_NAMESPACE, "rollout", "status", "deployment/seaweedfs", "--timeout=5m"], { stdio: "inherit" });
      aws(["s3", "mb", `s3://${BUCKET}`]);
      log(`bucket ${BUCKET} created at ${OBJECT_STORE_ENDPOINT}`);
      installed = true;
    },
    /** Write the bucket's credentials Secret into `namespace`, as a platform engineer would. */
    writeCredentials(namespace, name = "bucket") {
      cluster.kubectl([
        "-n",
        namespace,
        "create",
        "secret",
        "generic",
        name,
        `--from-literal=ACCESS_KEY_ID=${ACCESS_KEY_ID}`,
        `--from-literal=SECRET_ACCESS_KEY=${SECRET_ACCESS_KEY}`,
      ]);
    },
    /** The declaration's objectStore for this bucket. */
    spec(credentialsSecret = "bucket") {
      return { s3: { bucket: BUCKET, endpoint: OBJECT_STORE_ENDPOINT, credentialsSecret: { name: credentialsSecret } } };
    },
    /** Every key under `prefix`, as the bucket lists them. */
    listKeys(prefix) {
      const out = aws(["s3api", "list-objects-v2", "--bucket", BUCKET, "--prefix", prefix, "--output", "json"]).trim();
      if (out === "") return [];
      return (JSON.parse(out).Contents ?? []).map((o) => o.Key);
    },
  };
}
