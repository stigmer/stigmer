/**
 * The operator install test's command line (test/install/smoke-operator.mjs),
 * kept apart from the script so a unit test can pin it: the script runs its
 * install the moment it is imported.
 *
 * Three ways to run it, by what is installed:
 *   - from source (no flags): the operator, the server and the runner built
 *     from this checkout, the operator installed from the checkout's chart;
 *   - a packaged chart (--chart=<dir|.tgz>): the same source-built images,
 *     the operator installed from the chart given, as `helm package` leaves
 *     it, which is how the release's chart is proven before any image is
 *     pushed;
 *   - a published release (--published --version=vX.Y.Z --chart=<.tgz>):
 *     nothing built; the release's packaged chart, the operator image at the
 *     tag its appVersion names, and every Stigmer image the operator pulls at
 *     that version from the registry. The release lane runs it against the
 *     images it has just pushed, before the chart is pushed. Only the
 *     profiles that need nothing built here run this way.
 *
 * Plain node, no dependencies, like its neighbours.
 */

import { parseFakeModelArg } from "./fake-model.mjs";

/** Every profile, in the order they run: upgrade last, since it leaves the operator at its second build. */
export const PROFILES = Object.freeze(["bundled", "byo", "enterprise", "bucket", "exposed", "agent-sandbox", "substrate", "upgrade"]);

/**
 * The profiles a published release runs: the ones that install Stigmer and
 * run an agent on images pulled from the registry alone. The rest build an
 * image of their own (the Enterprise image, the per-session runner), stamp
 * the operator twice (upgrade) or bring their own front door and bucket,
 * which the source-built run already proves.
 */
export const PUBLISHED_PROFILES = Object.freeze(["bundled", "byo"]);

const RELEASE = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?)$/;

/**
 * The command line as `{ profiles, cluster, keep, fakeModel, chart,
 * published }`: `chart` is the chart to install or undefined for the
 * checkout's, `published` is `{ tag }` (the release's image tag, `vX.Y.Z`)
 * or undefined for a source build. Throws a sentence on anything else.
 */
export function parseSmokeOperatorArgs(argv) {
  const args = { profiles: ["bundled", "byo"], cluster: "", keep: false, fakeModel: "reply", chart: undefined, published: undefined };
  let publishedFlag = false;
  let version;
  for (const arg of argv) {
    let m;
    const fakeModelMode = parseFakeModelArg(arg);
    if (fakeModelMode !== undefined) args.fakeModel = fakeModelMode;
    else if ((m = arg.match(/^--profiles=(.+)$/)) !== null) args.profiles = m[1].split(",");
    else if ((m = arg.match(/^--cluster=(.+)$/)) !== null) args.cluster = m[1];
    else if ((m = arg.match(/^--chart=(.+)$/)) !== null) args.chart = m[1];
    else if ((m = arg.match(/^--version=(.+)$/)) !== null) version = m[1];
    else if (arg === "--published") publishedFlag = true;
    else if (arg === "--keep") args.keep = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  for (const profile of args.profiles) {
    if (!PROFILES.includes(profile)) throw new Error(`unknown profile '${profile}' (one of ${PROFILES.join(", ")})`);
  }
  if (version !== undefined && !publishedFlag) throw new Error("--version names a published release: pass it with --published");
  if (publishedFlag) {
    const m = version === undefined ? null : RELEASE.exec(version);
    if (m === null) throw new Error(`--published needs --version=vX.Y.Z, the release to install (got ${JSON.stringify(version ?? "")})`);
    if (args.chart === undefined) throw new Error("--published needs --chart=<the release's packaged chart>: a release is proven before its chart is pushed");
    const needSource = args.profiles.filter((profile) => !PUBLISHED_PROFILES.includes(profile));
    if (needSource.length > 0) {
      throw new Error(`--published runs only ${PUBLISHED_PROFILES.join(", ")}: ${needSource.join(", ")} need a source build`);
    }
    args.published = { tag: `v${m[1]}` };
  }
  return args;
}
