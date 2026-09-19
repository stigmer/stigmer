"use client";

import { useRouter } from "next/navigation";
import { MarketplaceCatalog, useActiveOrgSlug } from "@stigmer/react";

/**
 * The Marketplace: where a user finds and installs plugins.
 *
 * Mounted at `/marketplace`, a top-level page beside the Library (what you
 * can get, beside what you have). Renders the SDK's `MarketplaceCatalog`
 * and routes to the installed plugin's page on completion, from a card or
 * from the Upload tile alike; everything else (the sources, the search,
 * the grid, the preview, the upload, the push) is the SDK's.
 */
export function MarketplacePage() {
  const org = useActiveOrgSlug();
  const router = useRouter();

  if (!org) return null;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">Marketplace</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Plugins you can install into {org}: from Stigmer&apos;s catalogue, from your computer, or from a catalogue you
          add. A plugin installs as an agent, as tools for your agents, or both.
        </p>
      </div>
      <MarketplaceCatalog
        org={org}
        onInstalled={({ plugin }) =>
          router.push(`/library/plugins/${plugin.metadata?.org}/${plugin.metadata?.slug}`)
        }
      />
    </div>
  );
}
