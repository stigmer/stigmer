/**
 * What the operator install test reads of an Agent Substrate the operator
 * installed: its actors, through Substrate's own CLI, kubectl-ate, at the
 * release the operator embeds.
 *
 * kubectl-ate port-forwards to Substrate's API itself and authenticates with
 * a bearer token. The token is minted here for the Stigmer server's own
 * ServiceAccount, for the API's audience: the server is the install's
 * bootstrap owner, so it may read every atespace, and the test needs no
 * identity of its own in Substrate. The binary is the one the release
 * attaches for this host, checked against its published .sha256 before it
 * is run, and cached per release under the system's temporary directory.
 *
 * Plain node and the curl CLI, no dependencies.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const RELEASES = "https://github.com/agent-substrate/substrate/releases/download";
/** The audience Substrate's API accepts tokens for. */
const API_AUDIENCE = "api.ate-system.svc";

/** The Substrate release the operator embeds (deploy/operator/internal/manifests/substrate/images.yaml). */
export function substrateVersion() {
  const pins = readFileSync(join(repoRoot, "deploy", "operator", "internal", "manifests", "substrate", "images.yaml"), "utf8");
  const version = /^version:\s*(v\S+)\s*$/m.exec(pins)?.[1];
  if (version === undefined) throw new Error("the operator's Substrate pins name no version");
  return version;
}

/** kubectl-ate for this host at `version`, downloaded once and checked against its published digest. */
function kubectlAte(version, log) {
  const os = process.platform === "darwin" || process.platform === "linux" ? process.platform : undefined;
  const cpu = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : undefined;
  if (os === undefined || cpu === undefined) throw new Error(`Agent Substrate ${version} publishes no kubectl-ate for ${process.platform}/${process.arch}`);
  const name = `kubectl-ate-${os}-${cpu}`;
  const dir = join(tmpdir(), "stigmer-kubectl-ate", version);
  const binary = join(dir, name);
  if (existsSync(binary)) return binary;
  mkdirSync(dir, { recursive: true });
  const url = `${RELEASES}/${version}/${name}`;
  log(`fetching ${name} ${version}`);
  const download = `${binary}.download`;
  execFileSync("curl", ["-fsSL", "--retry", "3", "-o", download, url]);
  const published = execFileSync("curl", ["-fsSL", "--retry", "3", `${url}.sha256`], { encoding: "utf8" });
  const want = /^([0-9a-f]{64})\b/im.exec(published.trim())?.[1]?.toLowerCase();
  const got = createHash("sha256").update(readFileSync(download)).digest("hex");
  if (want === undefined || want !== got) {
    rmSync(download, { force: true });
    throw new Error(`${name} ${version} does not match its published .sha256 (${want ?? "no digest"} published, ${got} downloaded)`);
  }
  chmodSync(download, 0o755);
  renameSync(download, binary);
  return binary;
}

/**
 * Reads an install's actors as its server's ServiceAccount
 * (`serverNamespace`/`serverAccount`), in `atespace`.
 */
export function createActorReader(cluster, { serverNamespace, serverAccount, atespace, log }) {
  const binary = kubectlAte(substrateVersion(), log);
  const tokenFile = join(cluster.kubeconfig === undefined ? tmpdir() : join(cluster.kubeconfig, ".."), "substrate-token");
  const kubeconfigFlag = cluster.kubeconfig === undefined ? [] : ["--kubeconfig", cluster.kubeconfig];
  return {
    /** Every session actor, by name, with its state (RUNNING, SUSPENDED, ...). */
    actors() {
      const token = cluster.kubectl(["-n", serverNamespace, "create", "token", serverAccount, "--audience", API_AUDIENCE, "--duration", "10m"]).trim();
      writeFileSync(tokenFile, token, { mode: 0o600 });
      const out = execFileSync(binary, [...kubeconfigFlag, "--context", cluster.context, "--token-file", tokenFile, "get", "actors", "-a", atespace, "-o", "json"], {
        encoding: "utf8",
      });
      const parsed = JSON.parse(out);
      const items = Array.isArray(parsed) ? parsed : (parsed.items ?? parsed.actors ?? []);
      return items
        .map((a) => ({ name: a?.metadata?.name, state: String(a?.status?.state ?? "").replace(/^ACTOR_STATE_/, "") }))
        .filter((a) => typeof a.name === "string" && a.name.startsWith("sbx-ses-"));
    },
  };
}
