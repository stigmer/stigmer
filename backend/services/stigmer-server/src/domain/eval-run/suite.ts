/**
 * Reading an eval's suite: the plugin's archive at the eval's digest,
 * opened through the same gate a push opens it with
 * (domain/plugin/archive.ts), then read by `readEvalSuite`. The archive is
 * authoritative: `PluginStatus.evals` is a summary for the plugin's page
 * and is absent on plugins installed before the library read suites, so
 * create and the eval's workflow both read the archive itself.
 *
 * A digest is accepted only as a version of the eval's plugin (the live
 * head or an archived version, through the version ladder's one reader,
 * pipeline/steps/version-history.ts `loadVersion`): archives are stored by
 * content and shared by every plugin, so a digest alone could name
 * another plugin's archive.
 *
 * Proven by __tests__/suite.test.ts.
 */
import type { EvalSuite, PluginFiles } from "@stigmer/plugin-package";
import { readEvalSuite } from "@stigmer/plugin-package";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ContentAddressedArchiveStore } from "../../archive/content-store.js";
import type { VersionedResourceBinding } from "../../pipeline/steps/version-history.js";
import { loadVersion } from "../../pipeline/steps/version-history.js";
import type { Store } from "../../store/interface.js";
import { openPluginArchive } from "../plugin/archive.js";
import { pluginLiveTag } from "../plugin/push.js";

/** What reading a suite needs: a plugin version's files. */
export interface EvalSuiteSource {
  /**
   * The files of plugin `pluginId` at version `digest`. NOT_FOUND (a
   * ConnectError) when the plugin or the version does not exist; any other
   * failure is an infrastructure fault.
   */
  readArchive(pluginId: string, digest: string): Promise<PluginFiles>;
}

/** A suite with the files it was read from (the graders read baselines from them). */
export interface LoadedEvalSuite {
  files: PluginFiles;
  suite: EvalSuite;
}

export async function loadEvalSuite(
  deps: EvalSuiteSource,
  pluginId: string,
  digest: string,
): Promise<LoadedEvalSuite> {
  const files = await deps.readArchive(pluginId, digest);
  return { files, suite: readEvalSuite(files) };
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

export interface PluginArchiveReaderDeps {
  readonly store: Store;
  /** The plugin archive store (`plugins/<digest>.zip`), the push's own. */
  readonly archives: ContentAddressedArchiveStore;
}

/**
 * The server's `readArchive`: the version's recorded storage key (its
 * content-addressed key when a version recorded none), its bytes, and the
 * push's gate over them.
 */
export function newPluginArchiveReader(
  deps: PluginArchiveReaderDeps,
): EvalSuiteSource {
  return {
    async readArchive(pluginId: string, digest: string): Promise<PluginFiles> {
      const version = await loadVersion(
        deps.store,
        pluginVersionedBinding,
        pluginId,
        digest,
      );
      const recordedKey = version.resource.status?.artifactStorageKey ?? "";
      const key =
        recordedKey !== "" ? recordedKey : deps.archives.getStorageKey(digest);
      const bytes = await deps.archives.get(key);
      const opened = openPluginArchive(bytes);
      if (opened.digest !== digest) {
        throw new Error(
          `plugin archive ${key} does not hash to version ${digest}`,
        );
      }
      return opened.files;
    },
  };
}
