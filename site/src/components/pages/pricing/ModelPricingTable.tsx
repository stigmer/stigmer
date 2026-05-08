"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { ModelPricingEntry } from "./types";
import { formatUsdRate } from "./types";

interface ModelPricingTableProps {
  entries: ModelPricingEntry[];
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  meta: "Meta",
  mistral: "Mistral",
  cursor: "Cursor",
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function harnessLabel(harness: string): string {
  return harness === "native" ? "Native" : harness === "cursor" ? "Cursor" : harness;
}

function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function ModelPricingTable({ entries }: ModelPricingTableProps) {
  const grouped = React.useMemo(() => {
    const map = new Map<string, ModelPricingEntry[]>();
    for (const entry of entries) {
      const key = entry.harness;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return map;
  }, [entries]);

  return (
    <div className="space-y-8">
      {Array.from(grouped.entries()).map(([harness, models]) => (
        <div key={harness}>
          <h3 className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
            {harnessLabel(harness)} Harness
          </h3>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-card">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Model
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">
                      Provider
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">
                      Tier
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                      Input / 1M
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                      Output / 1M
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model, idx) => (
                    <tr
                      key={model.modelId}
                      className={cn(
                        "border-b border-border last:border-b-0",
                        idx % 2 === 0 ? "bg-background" : "bg-card/50",
                      )}
                    >
                      <td className="px-4 py-3 text-foreground font-medium">
                        {model.displayName || model.modelId}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                        {providerLabel(model.provider)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                        {tierLabel(model.costTier)}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground font-mono text-xs">
                        {formatUsdRate(model.inputPriceMicrosPerMillion)}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground font-mono text-xs">
                        {formatUsdRate(model.outputPriceMicrosPerMillion)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export { ModelPricingTable };
