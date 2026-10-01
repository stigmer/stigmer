/**
 * Whether a published release can be an install's upgrade base: only once
 * every artifact that install pulls at that version is published. The
 * release (.github/workflows/release.npm-libs.yaml) puts the npm packages up
 * first, and the images, the all-in-one image and the Helm chart later, each
 * after its own smokes. So while a release runs, and for good when one of its
 * later pushes is held, the newest version on npm has no image or chart yet.
 * The upgrade rehearsal (test/install/rehearse-upgrade.mjs) picks its base with
 * this rule, not from the npm version list alone.
 *
 * Read from the public registries without credentials: ghcr.io's anonymous
 * token and a manifest HEAD for an image or a chart, and npm's install
 * document for a package (`installGap`, scripts/publish-standalone.mjs).
 * "Not published" is an answer; a registry that cannot be read is not, and
 * throws, so an outage never quietly moves the base to an older release.
 *
 * Plain node and fetch, no dependencies, like its neighbours.
 */

import { configuredRegistry, installGap } from "../../../scripts/publish-standalone.mjs";
import { ALL_IN_ONE_REPOSITORY } from "./install-all-in-one.mjs";
import { PUBLISHED_CHART } from "./install-helm.mjs";

/** The server's and the runner's published image repositories. */
export const PUBLISHED_IMAGES = Object.freeze({
  server: "ghcr.io/stigmer/stigmer-server",
  runner: "ghcr.io/stigmer/stigmer-runner",
});

/** What a CLI install acquires at its version: the CLI, then the two runtimes its `up` installs. */
export const CLI_PACKAGES = Object.freeze(["@stigmer/cli", "@stigmer/server-slim", "@stigmer/runner-slim"]);

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * What an install of `artifact` pulls at release `version`: ghcr.io
 * references (images are tagged `v<version>`, the chart `<version>`) and npm
 * package names.
 */
export function releaseArtifacts(artifact, version) {
  const images = [`${PUBLISHED_IMAGES.server}:v${version}`, `${PUBLISHED_IMAGES.runner}:v${version}`];
  switch (artifact) {
    case "compose":
      return { oci: images, npm: [] };
    case "all-in-one":
      return { oci: [`${ALL_IN_ONE_REPOSITORY}:v${version}`], npm: [] };
    case "helm":
      return { oci: [`${PUBLISHED_CHART.replace(/^oci:\/\//, "")}:${version}`, ...images], npm: [] };
    case "cli":
      return { oci: [], npm: [...CLI_PACKAGES] };
    default:
      throw new Error(`no published artifacts are known for ${JSON.stringify(artifact)}`);
  }
}

/**
 * Whether ghcr.io serves `reference` (`ghcr.io/<repository>:<tag>`): true, or
 * false for a manifest that answers 404. Anything else throws.
 */
export async function ociPublished(reference, { fetchImpl = fetch } = {}) {
  const match = reference.match(/^ghcr\.io\/([a-z0-9][a-z0-9._/-]*):([A-Za-z0-9._-]+)$/);
  if (match === null) throw new Error(`not a ghcr.io image reference: ${reference}`);
  const [, repository, tag] = match;
  const tokenResponse = await fetchImpl(`https://ghcr.io/token?scope=repository:${repository}:pull`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!tokenResponse.ok) throw new Error(`ghcr.io refused an anonymous token for ${repository}: HTTP ${tokenResponse.status}`);
  const { token } = await tokenResponse.json();
  if (typeof token !== "string" || token === "") throw new Error(`ghcr.io answered no token for ${repository}`);
  const manifest = await fetchImpl(`https://ghcr.io/v2/${repository}/manifests/${tag}`, {
    method: "HEAD",
    headers: { authorization: `Bearer ${token}`, accept: MANIFEST_ACCEPT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (manifest.status === 404) return false;
  if (!manifest.ok) throw new Error(`ghcr.io answered HTTP ${manifest.status} for ${reference}`);
  return true;
}

/**
 * Whether npm serves `name` at `version`: true, or false when its install
 * document does not list the version. Any other gap `installGap` names (the
 * registry unreachable, a missing tarball) throws.
 */
export async function npmPublished(name, version, { gapOf = (n, v) => installGap(n, v, { registry: configuredRegistry() }) } = {}) {
  const gap = await gapOf(name, version);
  if (gap === null) return true;
  if (gap === "not listed in its install document") return false;
  throw new Error(`npm cannot say whether ${name}@${version} is published: ${gap}`);
}

/**
 * The first artifact of `artifact` at `version` that is not published, as
 * text, or undefined when every one is. A registry that cannot be read throws.
 */
export async function unpublishedArtifact(artifact, version, { oci = ociPublished, npm = npmPublished } = {}) {
  const wanted = releaseArtifacts(artifact, version);
  for (const reference of wanted.oci) {
    if (!(await oci(reference))) return reference;
  }
  for (const name of wanted.npm) {
    if (!(await npm(name, version))) return `${name}@${version}`;
  }
  return undefined;
}
