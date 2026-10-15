/**
 * Reading an eval run's suites: a case source's archive at the version the
 * eval run stamped, opened through the same gate a push opens it with
 * (archive/open-files.ts), then read by the library's reader for its kind:
 * `readEvalSuite` for a plugin's evals/ folder, `readEvalFolder` for an
 * Eval, whose suite is its archive's root. The archive is authoritative:
 * `PluginStatus.evals` and `EvalStatus` are summaries for their pages, so
 * create and the eval run's workflow both read the archive itself.
 *
 * A digest is accepted only as a version of the source it names (the live
 * head or an archived version, through the version ladder's one reader,
 * pipeline/steps/version-history.ts `loadVersion`): archives are stored by
 * content and shared, so a digest alone could name another resource's
 * archive. This is the server's own read: the eval run's create already
 * asked whether its caller may view each Eval it names.
 *
 * Proven by __tests__/suite.test.ts.
 */
import type { EvalSuite, PluginFiles } from "@stigmer/plugin-package";
import { readEvalFolder, readEvalSuite } from "@stigmer/plugin-package";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ContentAddressedArchiveStore } from "../../archive/content-store.js";
import type { VersionedResourceBinding } from "../../pipeline/steps/version-history.js";
import { loadVersion } from "../../pipeline/steps/version-history.js";
import type { Store } from "../../store/interface.js";
import { openArchiveFiles } from "../../archive/open-files.js";
import { pluginLiveTag } from "../plugin/push.js";
import { evalVersionBinding } from "../eval/versions.js";

/** Where an eval run's cases come from, at the version it stamped. */
export interface CaseSourceRef {
  readonly kind: "plugin" | "eval";
  /** The plugin's or the Eval's id. */
  readonly id: string;
  /** The stamped version: the archive's digest. */
  readonly digest: string;
}

/** What reading a suite needs: a case source's files at a version. */
export interface EvalSuiteSource {
  /**
   * The files of the source at its version. NOT_FOUND (a ConnectError)
   * when the source or the version does not exist; any other failure is an
   * infrastructure fault.
   */
  readArchive(source: CaseSourceRef): Promise<PluginFiles>;
}

/** A suite with the files it was read from (the graders read baselines from them). */
export interface LoadedEvalSuite {
  files: PluginFiles;
  suite: EvalSuite;
}

/** The source's suite, read by its kind's reader. */
export async function loadEvalSuite(
  deps: EvalSuiteSource,
  source: CaseSourceRef,
): Promise<LoadedEvalSuite> {
  const files = await deps.readArchive(source);
  return { files, suite: source.kind === "plugin" ? readEvalSuite(files) : readEvalFolder(files) };
}

/** The plugin as the version ladder reads it: its digest is its version. */
export const pluginVersionedBinding: VersionedResourceBinding<
  typeof PluginSchema
> = {
  kind: ApiResourceKind.plugin,
  schema: PluginSchema,
  noun: "plugin",
  headHashOf: (plugin) => plugin.status?.digest ?? "",
  liveTagOf: pluginLiveTag,
};

export interface CaseArchiveReaderDeps {
  readonly store: Store;
  /** The plugin archive store (`plugins/<digest>.zip`), the plugin push's own. */
  readonly plugins: ContentAddressedArchiveStore;
  /** The Eval archive store (`evals/<digest>.zip`), the Eval push's own. */
  readonly evals: ContentAddressedArchiveStore;
}

/**
 * The server's `readArchive`: the version, its bytes from its kind's store
 * (a plugin version's recorded storage key, else its content-addressed key;
 * an Eval's is always its content-addressed key), and the push's gate over
 * them, which must hash to the version.
 */
export function newCaseArchiveReader(deps: CaseArchiveReaderDeps): EvalSuiteSource {
  return {
    async readArchive(source: CaseSourceRef): Promise<PluginFiles> {
      let key: string;
      if (source.kind === "plugin") {
        const version = await loadVersion(deps.store, pluginVersionedBinding, source.id, source.digest);
        const recordedKey = version.resource.status?.artifactStorageKey ?? "";
        key = recordedKey !== "" ? recordedKey : deps.plugins.getStorageKey(source.digest);
      } else {
        await loadVersion(deps.store, evalVersionBinding, source.id, source.digest);
        key = deps.evals.getStorageKey(source.digest);
      }
      const bytes = await (source.kind === "plugin" ? deps.plugins : deps.evals).get(key);
      const opened = openArchiveFiles(bytes, source.kind);
      if (opened.digest !== source.digest) {
        throw new Error(`${source.kind} archive ${key} does not hash to version ${source.digest}`);
      }
      return opened.files;
    },
  };
}
