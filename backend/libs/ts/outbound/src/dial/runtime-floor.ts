/**
 * The Node floor of `@stigmer/outbound/dial`, checked when the entry loads.
 *
 * The library's other entries run on the family floor its `package.json`
 * declares (Node 22.13, or 23.4); only this entry loads undici, whose own
 * floor is higher. undici is an optional peer, so nothing in the library's
 * manifest states that floor any more, and a process on an older Node would
 * meet it as undici's crash at load (on 23.4 to 23.7, a missing
 * `createZstdDecompress`). So the entry states it itself: `./index.ts`
 * imports this module first, and ESM evaluates a module's imports in source
 * order, so the check runs before `pinned-fetch.ts` loads undici and a Node
 * below the floor gets one sentence naming the version to install.
 *
 * The 22.x floor is undici's declared `engines` lower bound; 23.x needs 23.8,
 * where `zlib` gained what undici loads. A missing undici is left to Node's
 * own resolution error, which already names the package.
 *
 * Proven by __tests__/dial-runtime-floor.test.ts, which pins the 22.x floor
 * to the installed undici's declared one.
 */

/** The lowest Node each line this entry runs on accepts; any line above the last runs. */
export const DIAL_NODE_FLOOR = {
  /** Node 22 from 22.19, undici's declared floor. */
  line22: { major: 22, minor: 19 },
  /** Node 23 from 23.8; every later major. */
  above22: { major: 23, minor: 8 },
} as const;

/** The sentence a process on `version` (as `process.versions.node` gives it) is refused with, or `undefined` when it may load the entry. */
export function dialRuntimeRefusal(version: string): string | undefined {
  const [major = Number.NaN, minor = Number.NaN] = version.split(".").map(Number);
  const { line22, above22 } = DIAL_NODE_FLOOR;
  const allowed =
    major === line22.major
      ? minor >= line22.minor
      : major === above22.major
        ? minor >= above22.minor
        : major > above22.major;
  if (allowed) return undefined;
  return (
    `@stigmer/outbound/dial needs Node ${line22.major}.${line22.minor} or newer on ${line22.major}.x, ` +
    `or ${above22.major}.${above22.minor} or newer; this is ${version}.`
  );
}

const refusal = dialRuntimeRefusal(process.versions.node);
if (refusal !== undefined) throw new Error(refusal);
