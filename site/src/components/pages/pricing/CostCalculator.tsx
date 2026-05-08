"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { ModelPricingEntry } from "./types";
import { estimateCostMicros, formatUsd } from "./types";

interface CostCalculatorProps {
  models: ModelPricingEntry[];
}

interface CalculatorRow {
  id: string;
  modelId: string;
  preset: PresetKey;
  customInput: string;
  customOutput: string;
}

type PresetKey = "light" | "moderate" | "heavy" | "custom";

const PRESETS: Record<PresetKey, { label: string; input: number; output: number }> = {
  light: { label: "Light", input: 1_000_000, output: 200_000 },
  moderate: { label: "Moderate", input: 10_000_000, output: 2_000_000 },
  heavy: { label: "Heavy", input: 100_000_000, output: 20_000_000 },
  custom: { label: "Custom", input: 0, output: 0 },
};

function formatTokenCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

let rowCounter = 0;
function nextRowId(): string {
  return `row-${++rowCounter}`;
}

function CostCalculator({ models }: CostCalculatorProps) {
  const [rows, setRows] = React.useState<CalculatorRow[]>(() => [
    {
      id: nextRowId(),
      modelId: models[0]?.modelId ?? "",
      preset: "moderate",
      customInput: "",
      customOutput: "",
    },
  ]);

  const modelMap = React.useMemo(() => {
    const map = new Map<string, ModelPricingEntry>();
    for (const m of models) map.set(m.modelId, m);
    return map;
  }, [models]);

  function addRow() {
    if (rows.length >= 5) return;
    const unused = models.find((m) => !rows.some((r) => r.modelId === m.modelId));
    setRows((prev) => [
      ...prev,
      {
        id: nextRowId(),
        modelId: unused?.modelId ?? models[0]?.modelId ?? "",
        preset: "moderate",
        customInput: "",
        customOutput: "",
      },
    ]);
  }

  function removeRow(id: string) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  }

  function updateRow(id: string, patch: Partial<CalculatorRow>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  function getTokens(row: CalculatorRow): { input: number; output: number } {
    if (row.preset === "custom") {
      return {
        input: parseTokenInput(row.customInput),
        output: parseTokenInput(row.customOutput),
      };
    }
    return PRESETS[row.preset];
  }

  const rowCosts = rows.map((row) => {
    const model = modelMap.get(row.modelId);
    if (!model) return 0;
    const { input, output } = getTokens(row);
    return estimateCostMicros(
      input,
      output,
      model.inputPriceMicrosPerMillion,
      model.outputPriceMicrosPerMillion,
    );
  });

  const totalCostMicros = rowCosts.reduce((sum, c) => sum + c, 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="divide-y divide-border">
        {rows.map((row, idx) => {
          const _model = modelMap.get(row.modelId);
          const tokens = getTokens(row);
          return (
            <div key={row.id} className="p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-mono uppercase tracking-wider text-subtle mb-2">
                    Model
                  </label>
                  <select
                    value={row.modelId}
                    onChange={(e) =>
                      updateRow(row.id, { modelId: e.target.value })
                    }
                    className={cn(
                      "w-full rounded border border-border bg-background px-3 py-2",
                      "text-sm text-foreground",
                      "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
                    )}
                  >
                    {models.map((m) => (
                      <option key={m.modelId} value={m.modelId}>
                        {m.displayName || m.modelId}
                      </option>
                    ))}
                  </select>
                </div>

                {rows.length > 1 && (
                  <button
                    onClick={() => removeRow(row.id)}
                    className="mt-5 p-2 text-subtle hover:text-foreground transition-colors"
                    aria-label="Remove model"
                  >
                    <Icon name="x" size="sm" />
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-subtle mb-2">
                  Monthly volume
                </label>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => updateRow(row.id, { preset: key })}
                      className={cn(
                        "px-3 py-1.5 text-xs rounded border transition-colors",
                        row.preset === key
                          ? "border-foreground bg-foreground text-background"
                          : "border-border text-muted-foreground hover:border-foreground/50",
                      )}
                    >
                      {PRESETS[key].label}
                      {key !== "custom" && (
                        <span className="ml-1 opacity-60">
                          ({formatTokenCount(PRESETS[key].input)}
                          {" in"})
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {row.preset === "custom" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-subtle mb-1">
                      Input tokens / month
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.customInput}
                      onChange={(e) =>
                        updateRow(row.id, { customInput: e.target.value })
                      }
                      placeholder="e.g. 5000000"
                      className={cn(
                        "w-full rounded border border-border bg-background px-3 py-2",
                        "text-sm text-foreground placeholder:text-subtle",
                        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
                      )}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-subtle mb-1">
                      Output tokens / month
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.customOutput}
                      onChange={(e) =>
                        updateRow(row.id, { customOutput: e.target.value })
                      }
                      placeholder="e.g. 1000000"
                      className={cn(
                        "w-full rounded border border-border bg-background px-3 py-2",
                        "text-sm text-foreground placeholder:text-subtle",
                        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
                      )}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {formatTokenCount(tokens.input)} input +{" "}
                  {formatTokenCount(tokens.output)} output
                </span>
                <span className="font-mono font-semibold text-foreground">
                  {formatUsd(rowCosts[idx])}
                  <span className="font-normal text-subtle"> / mo</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add model button */}
      {rows.length < 5 && (
        <div className="px-4 sm:px-6 py-3 border-t border-border">
          <button
            onClick={addRow}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            + Add another model
          </button>
        </div>
      )}

      {/* Total */}
      <div className="px-4 sm:px-6 py-4 border-t border-border bg-card">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">
            Estimated monthly cost
          </span>
          <span className="text-2xl font-bold font-mono text-foreground">
            {formatUsd(totalCostMicros)}
          </span>
        </div>
        <div className="mt-4">
          <Button asChild className="w-full sm:w-auto">
            <a href={SITE_CONFIG.cloudSignupUrl}>Start Free</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

function parseTokenInput(value: string): number {
  const cleaned = value.replace(/[,\s]/g, "");
  const n = parseInt(cleaned, 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

export { CostCalculator };
