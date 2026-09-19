// The default plugins a backend is bootstrapped with: the `defaults` list of
// the official marketplace, installed in order into the system org as
// public, so the global default-agent lookup and cross-org references find
// them.
//
// Two phases, deliberately separate. Preparing (resolve the official tree,
// which may acquire `@stigmer/plugins` at the CLI's version; walk, zip and
// hash every default) needs no backend and is all-or-nothing: the catalogue
// is ours and validated on CI, so a default that cannot be prepared is a
// release defect, not a condition to install around. Installing pushes the
// prepared archives and is best-effort per entry: one default failing to
// land does not stop the next, and the caller decides how to surface the
// failures. The split lets `stigmer up` hold every replacement in hand
// before it retires what the replacement supersedes (local/bootstrap.ts).
//
// Idempotent by the server's own identity, not a marker file: before each
// push the org's plugin of that name is read back; when its digest equals the
// prepared archive's, it is READY and it is public, there is nothing to do
// and nothing is sent. A second `stigmer up` therefore pushes nothing, and a
// `stigmer up` after an upgrade pushes exactly the entries whose content
// changed. The record is the server, so any machine that reaches the same
// backend sees the same answer.

import { type Stigmer, isNotFound } from "@stigmer/sdk";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { PluginState } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";
import { log } from "../../logger.js";
import { VERSION } from "../../version.js";
import {
  type ResolveOfficialOptions,
  resolveOfficialMarketplace,
} from "../../marketplace/official.js";
import { readMarketplaceTree } from "../../marketplace/read.js";
import { prepareEntry } from "../../marketplace/install.js";
import {
  type PreparedPluginPush,
  count,
  pushPrepared,
} from "../../resources/plugin.js";

/**
 * The command that ran the install, as the plugin's stored version message
 * names it. Two verbs share the one bootstrap function, and a platform
 * operator reading the row a year later must see which one wrote it.
 */
export type InstallingVerb = "stigmer up" | "stigmer bootstrap";

export interface DefaultPluginsDeps {
  /** The client bound to the backend being bootstrapped. */
  readonly stigmer: Stigmer;
  /** Human progress lines (stderr). */
  readonly info: (line: string) => void;
  /** Stamped into each installed plugin's version message. */
  readonly verb: InstallingVerb;
}

/** One default, ready to push: its marketplace name and the prepared archive. */
export interface PreparedDefault {
  readonly name: string;
  readonly push: PreparedPluginPush;
}

export type DefaultPluginOutcome =
  | {
      readonly name: string;
      readonly action: "installed";
      readonly digest: string;
    }
  | {
      readonly name: string;
      readonly action: "up-to-date";
      readonly digest: string;
    }
  | {
      readonly name: string;
      readonly action: "failed";
      readonly error: string;
    };

export interface DefaultPluginsResult {
  readonly outcomes: readonly DefaultPluginOutcome[];
  /** The names that did not land, for the caller's warning. */
  readonly failed: readonly string[];
}

/**
 * Phase 1: every default the official marketplace names, prepared in the
 * marketplace's order. Throws when the tree cannot be resolved, offers less
 * than it lists (the library drops an entry it cannot install with a
 * warning, which for a user's marketplace is `show`'s business and for ours
 * is a broken release), or any default cannot be prepared; nothing is
 * returned half-ready.
 */
export async function prepareDefaultPlugins(
  official?: ResolveOfficialOptions,
): Promise<readonly PreparedDefault[]> {
  const resolved = resolveOfficialMarketplace(official);
  const tree = readMarketplaceTree(resolved.dir, "the official marketplace");
  if (tree.warnings.length > 0) {
    throw new CliExitError(
      `the official marketplace at ${resolved.dir} lists ${count(tree.warnings.length, "plugin")} this CLI cannot install`,
      ExitCode.General,
      tree.warnings.map((finding) => finding.message),
    );
  }
  const prepared: PreparedDefault[] = [];
  for (const name of tree.marketplace.defaults) {
    prepared.push({ name, push: await prepareEntry(tree, name) });
  }
  return prepared;
}

/**
 * Phase 2: install the prepared defaults into `org`, skipping what the
 * backend already holds. Best-effort per entry.
 */
export async function installPreparedDefaults(
  deps: DefaultPluginsDeps,
  prepared: readonly PreparedDefault[],
  org: string,
): Promise<DefaultPluginsResult> {
  const outcomes: DefaultPluginOutcome[] = [];
  for (const { name, push } of prepared) {
    try {
      if (await isAlreadyInstalled(deps.stigmer, org, push)) {
        outcomes.push({ name, action: "up-to-date", digest: push.digest });
        continue;
      }
      deps.info(`Installing default plugin '${name}'…`);
      await pushPrepared(deps.stigmer, push, {
        org,
        visibility: ApiResourceVisibility.visibility_public,
        message: `default plugin, installed by ${deps.verb} (${VERSION})`,
      });
      outcomes.push({ name, action: "installed", digest: push.digest });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("default plugin install failed", { name, error: message });
      outcomes.push({ name, action: "failed", error: message });
    }
  }
  return {
    outcomes,
    failed: outcomes
      .filter((outcome) => outcome.action === "failed")
      .map((outcome) => outcome.name),
  };
}

/**
 * True when the org already holds this exact archive, materialised and
 * public. A plugin that is absent (NOT_FOUND) installs; one that is present
 * with another digest, still installing, failed, or not public is pushed
 * again, which the server treats as an upgrade or a convergence.
 */
async function isAlreadyInstalled(
  stigmer: Stigmer,
  org: string,
  prepared: PreparedPluginPush,
): Promise<boolean> {
  let existing;
  try {
    existing = await stigmer.plugin.getByReference({
      org,
      slug: prepared.plugin.name,
    });
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
  return (
    existing.status?.digest === prepared.digest &&
    existing.status.state === PluginState.READY &&
    existing.metadata?.visibility === ApiResourceVisibility.visibility_public
  );
}
