"use client";

/**
 * The slugs of every plugin installed in an organization, for the
 * marketplace catalog's "Installed" marks. A card is marked by membership,
 * so the lookup needs the whole set: it walks every page of the plugin
 * list, and an organization installs few enough plugins that the SDK's
 * walk cap is far off.
 *
 * Internal to the plugin module.
 */
import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { ListPluginsRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX, readEveryPage } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";

const NO_SLUGS: readonly string[] = [];

/** The installed plugins' slugs; empty while loading, on error, or with no `org`. */
export function useInstalledPluginSlugs(org: string | null): ReadonlySet<string> {
  const stigmer = useStigmer();
  const { data: slugs } = useFetch(
    org
      ? async (): Promise<readonly string[]> => {
          const plugins = await readEveryPage((pageToken) =>
            stigmer.plugin.list(
              create(ListPluginsRequestSchema, { org, pageSize: LIST_PAGE_MAX, pageToken }),
            ),
          );
          return plugins.map((plugin) => plugin.metadata?.slug ?? "");
        }
      : null,
    [org, stigmer],
    NO_SLUGS,
  );
  return useMemo(() => new Set(slugs), [slugs]);
}
