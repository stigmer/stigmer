/**
 * The Cursor harness's disk-backed observer for gitignored file writes — the
 * out-of-process analog of the deep-agent `CasCaptureFilesystemBackend`
 * ({@link ../execute-deep-agent/cas-capture-backend.js}).
 *
 * Deep-agent runs the agent in-process, so it records a gitignored file's
 * pre-turn bytes in an in-memory `CasBeforeMap` at the mutation point (before
 * `super.write`). Cursor runs the agent as an EXTERNAL CLI subprocess whose only
 * pre-write interception is the generated preToolUse bash hook — and each hook
 * invocation is a FRESH, EPHEMERAL process that cannot hold in-memory state
 * across writes. So Cursor's before-map must be DISK-BACKED: the hook stages each
 * first-touched gitignored path into a per-turn "cas-observations" sidecar, and
 * the runner reads it back at the turn boundary.
 *
 * The sidecar lives under the session HITL directory
 * (`~/.stigmer/sessions/{id}/hitl/cas-observations/`), OUTSIDE the user's
 * workspace — so staged before-bytes and secret markers never land in the repo,
 * cannot pollute the captured git diff, and are never pushed. It is reset every
 * turn (alongside the denial ledger) and consumed within the same activity
 * invocation that produced it; resume reconciles from the durable CAS manifest,
 * never this scratch. A Temporal retry re-runs the reset and re-observes.
 *
 * ONE MODULE OWNS THE ON-DISK FORMAT. Both sides live here so they cannot drift:
 *  - the READER ({@link readCasObservations}) the runner boundary calls;
 *  - the WRITER-SCRIPT GENERATOR ({@link buildObservationStagingScript}) whose
 *    output the hook embeds and runs on the runner's own Node binary. The writer
 *    classifies secrets from the SAME {@link isSecretLikePath} pattern arrays the
 *    boundary backstop uses (`shared/filereview/secret-paths.ts`), reconstructed
 *    as byte-identical `RegExp`s — no bash-regex, no divergence.
 *
 * Each observed path becomes one entry:
 *  - `captured`  — a non-secret gitignored write/edit: `{path, kind, existed}`
 *    metadata plus a `.blob` of the pre-turn bytes (omitted for an ADD, where the
 *    file did not exist). First-touch-wins via atomic exclusive-create, so
 *    repeated edits to one path keep the true pre-turn before.
 *  - `secret`    — a secret-like gitignored path the hook hard-blocked (denied,
 *    nothing written): `{path, kind}` only. The boundary authors it as a
 *    content-less `DIFF_UNREVIEWABLE` change; its bytes never reach storage.
 *
 * @since File-Change HITL Redesign (Cursor CAS parity — DD-18)
 */

import { readFile, readdir, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { SECRET_BASENAME_PATTERNS, SECRET_PATH_PATTERNS } from "../../shared/filereview/secret-paths.js";

/** Sidecar directory name under the session HITL dir. */
export const CAS_OBSERVATIONS_DIRNAME = "cas-observations";

/** Suffix of the per-path metadata file (also the atomic first-touch marker). */
const META_SUFFIX = ".meta.json";
/** Suffix of the per-path pre-turn bytes blob (present only for a MODIFY). */
const BLOB_SUFFIX = ".blob";

/** Absolute path of the per-turn cas-observations sidecar dir. */
export function casObservationsDir(hitlDir: string): string {
  return join(hitlDir, CAS_OBSERVATIONS_DIRNAME);
}

/**
 * Truncate the cas-observations sidecar to empty for a fresh turn, returning its
 * path. Called every turn alongside {@link resetDenialLedger} so the boundary
 * only ever reads observations produced by the current run — deterministic across
 * HITL reinvocations and Temporal activity retries.
 */
export async function resetCasObservations(hitlDir: string): Promise<string> {
  const dir = casObservationsDir(hitlDir);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

/** One non-secret gitignored path the hook staged this turn. */
export interface CasObservationCapture {
  /** Workspace-root-relative path. */
  readonly path: string;
  /** Pre-turn bytes; `null` when the file did not exist before (an ADD). */
  readonly before: Uint8Array | null;
}

/** The turn's staged gitignored observations, split by the hook's secret gate. */
export interface CasObservations {
  /** Non-secret paths to capture into CAS (before-bytes in hand). */
  readonly captured: CasObservationCapture[];
  /** Secret-like paths the hook hard-blocked (path-only; bytes withheld). */
  readonly secretPaths: string[];
}

/**
 * Read the cas-observations sidecar the hook wrote during the turn. Missing dir →
 * no observations. Malformed/partial entries are tolerated and skipped (the hook
 * writes the blob before the metadata marker, so a present marker implies a
 * complete blob; a marker whose blob is unexpectedly missing is skipped rather
 * than mis-captured). Entries are returned in a deterministic (sorted) order.
 */
export async function readCasObservations(hitlDir: string): Promise<CasObservations> {
  const dir = casObservationsDir(hitlDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { captured: [], secretPaths: [] };
  }

  const captured: CasObservationCapture[] = [];
  const secretPaths: string[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(META_SUFFIX)) continue;
    let meta: { path?: unknown; kind?: unknown; existed?: unknown };
    try {
      meta = JSON.parse(await readFile(join(dir, name), "utf-8"));
    } catch {
      continue; // partial/garbled marker — tolerate
    }
    if (!meta || typeof meta.path !== "string" || !meta.path) continue;

    if (meta.kind === "secret") {
      secretPaths.push(meta.path);
      continue;
    }
    if (meta.kind === "captured") {
      let before: Uint8Array | null = null;
      if (meta.existed === true) {
        const blobPath = join(dir, name.slice(0, -META_SUFFIX.length) + BLOB_SUFFIX);
        try {
          before = await readFile(blobPath);
        } catch {
          continue; // marker present but blob missing (mid-hook crash) — skip
        }
      }
      captured.push({ path: meta.path, before });
    }
  }
  return { captured, secretPaths };
}

/**
 * Emit a JS `RegExp` constructor byte-identical to a source pattern, safe to
 * embed inside a single-quoted bash string (JSON.stringify emits double quotes;
 * these patterns contain no single quotes).
 */
function regexLiteral(re: RegExp): string {
  return `new RegExp(${JSON.stringify(re.source)},${JSON.stringify(re.flags)})`;
}

/**
 * The JS lines that define `isSecret(p)` inside a hook-embedded script — a
 * byte-identical mirror of {@link isSecretLikePath} generated from the SAME
 * {@link SECRET_BASENAME_PATTERNS}/{@link SECRET_PATH_PATTERNS} arrays.
 *
 * ONE definition, so every hook-side classifier (the capture-mode staging script
 * and the deny-gate classify-only script) agrees with the runner-side classifier
 * by construction — the "no bash-regex, no divergence" invariant this module owns.
 * Authored as single-quoted-bash strings, so the JS must contain no single quotes.
 */
function secretClassifierFragment(): string[] {
  const base = SECRET_BASENAME_PATTERNS.map(regexLiteral).join(",");
  const pathPatterns = SECRET_PATH_PATTERNS.map(regexLiteral).join(",");
  return [
    `const baseName=(p)=>{const n=p.replace(/\\\\/g,"/");const i=n.lastIndexOf("/");return i>=0?n.slice(i+1):n;};`,
    `const BASE=[${base}];const PATHP=[${pathPatterns}];`,
    `const isSecret=(p)=>{if(!p)return true;const nm=p.replace(/\\\\/g,"/");const b=baseName(nm).toLowerCase();for(const r of BASE){if(r.test(b))return true;}const lp=nm.toLowerCase();for(const r of PATHP){if(r.test(lp))return true;}return false;};`,
  ];
}

/**
 * Build a standalone Node.js script that CLASSIFIES a single path as secret-like
 * without staging anything — the deny-gate (no-capture-substrate) counterpart of
 * {@link buildObservationStagingScript}.
 *
 * Invoked as `printf %s "$SALIENT" | node -e '<this>'` — the path rides stdin (no
 * argv escaping). Prints `secret` for a secret-like path, `ok` otherwise. Empty
 * input classifies as `secret` (fail-closed, matching {@link isSecretLikePath}).
 * The Cursor hook uses this to hard-block a secret write on the deny-gate so its
 * content never reaches an approval (DD-26 follow-up #2); it shares the classifier
 * fragment above, so its verdict equals the runner's {@link isSecretLikePath}.
 */
export function buildSecretClassifyScript(): string {
  return [
    `let salient="";try{salient=require("fs").readFileSync(0,"utf8");}catch(e){salient="";}`,
    ...secretClassifierFragment(),
    `process.stdout.write(isSecret(salient)?"secret":"ok");`,
  ].join("");
}

/**
 * Build the standalone Node.js script the hook runs to observe a single
 * gitignored write — the disk-backed mirror of `CasCaptureFilesystemBackend`'s
 * `recordBefore` plus the DD-E secret gate.
 *
 * Invoked as `printf %s "$SALIENT" | node -e '<this>' <workspaceRoot> <obsDir>`
 * — the (arbitrary) salient path arrives on stdin so no argv escaping is needed;
 * the two absolute paths ride argv. Prints one token on stdout for the hook:
 *  - `captured` — non-secret: staged the pre-turn bytes (first-touch-wins), the
 *    hook then ALLOWS the write to flow;
 *  - `secret`   — secret-like: recorded a content-less marker, the hook then
 *    DENIES with the security message (nothing is written);
 *  - `error`    — the path escaped the workspace or a filesystem error occurred,
 *    the hook then fails closed (deny).
 *
 * The secret classifier is generated from the SAME
 * {@link SECRET_BASENAME_PATTERNS}/{@link SECRET_PATH_PATTERNS} the boundary
 * backstop uses, so the hook-side and boundary-side classifications agree by
 * construction (a table test locks the equivalence). Authored as a
 * single-quoted-bash string, so the JS must contain no single quotes.
 */
export function buildObservationStagingScript(): string {
  const metaSuffix = JSON.stringify(META_SUFFIX);
  const blobSuffix = JSON.stringify(BLOB_SUFFIX);
  return [
    `const fs=require("fs");const path=require("path");const crypto=require("crypto");`,
    `const wsRoot=process.argv[1]||"";const obsDir=process.argv[2]||"";`,
    `let salient="";try{salient=fs.readFileSync(0,"utf8");}catch(e){salient="";}`,
    `if(!salient||!obsDir){process.stdout.write("error");process.exit(0);}`,
    // Workspace-relative key, git-consistent: an absolute salient stays put, a
    // relative one resolves against the workspace root. A path that escapes the
    // workspace is treated as an error (fail closed) — it should never be flagged
    // gitignored by `git check-ignore -C <root>` in the first place.
    `const abs=path.resolve(wsRoot,salient);`,
    `let rel=path.relative(wsRoot,abs).split(path.sep).join("/");`,
    `if(!rel||rel===".."||rel.startsWith("../")){process.stdout.write("error");process.exit(0);}`,
    // --- secret classifier: byte-identical mirror of isSecretLikePath ---
    ...secretClassifierFragment(),
    `const key=crypto.createHash("sha256").update(rel,"utf8").digest("hex");`,
    `const metaPath=path.join(obsDir,key+${metaSuffix});const blobPath=path.join(obsDir,key+${blobSuffix});`,
    `try{fs.mkdirSync(obsDir,{recursive:true});}catch(e){}`,
    // Secret: record a content-less marker (idempotent) and signal a hard-block.
    `if(isSecret(rel)){try{fs.writeFileSync(metaPath,JSON.stringify({path:rel,kind:"secret"}),{flag:"wx"});}catch(e){}process.stdout.write("secret");process.exit(0);}`,
    // Non-secret: first-touch-wins. A prior marker means this path is already
    // observed (a later edit) — leave the true pre-turn before intact.
    `if(fs.existsSync(metaPath)){process.stdout.write("captured");process.exit(0);}`,
    // Read the pre-turn bytes NOW (the write has not applied — this is preToolUse
    // and the first touch). Missing file = an ADD (before is null).
    `let existed=false;let before=null;try{before=fs.readFileSync(abs);existed=true;}catch(e){existed=false;}`,
    // Write the blob BEFORE the marker, so a present marker always implies a
    // complete blob. The wx marker is the atomic commit + first-touch lock.
    `try{if(existed){fs.writeFileSync(blobPath,before);}fs.writeFileSync(metaPath,JSON.stringify({path:rel,kind:"captured",existed:existed}),{flag:"wx"});}catch(e){if(e&&e.code==="EEXIST"){process.stdout.write("captured");process.exit(0);}process.stdout.write("error");process.exit(0);}`,
    `process.stdout.write("captured");`,
  ].join("");
}
