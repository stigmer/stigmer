"use client";

import { Select } from "@base-ui/react/select";
import { useModelRegistry } from "./useModelRegistry";
import type { Provider } from "./registry";

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  ollama: "Ollama",
};

const COST_TIER_INDICATOR: Record<string, string> = {
  economy: "$",
  standard: "$$",
  premium: "$$$",
};

/** Props for {@link ModelSelector}. */
export interface ModelSelectorProps {
  /** Currently selected model ID. Falls back to {@link DEFAULT_MODEL_ID} when omitted. */
  readonly value?: string;
  /** Called when the user picks a different model. Receives the new `modelId`. */
  readonly onValueChange: (modelId: string) => void;
  /** Additional CSS class names for the trigger button. */
  readonly className?: string;
  /** When true, disables the selector. */
  readonly disabled?: boolean;
}

/**
 * Theme-able model picker built on `@base-ui/react` Select for
 * accessible keyboard navigation and ARIA.
 *
 * Consumes {@link useModelRegistry} internally. Groups models by
 * provider and shows a subtle cost-tier indicator.
 *
 * All visual properties flow through `--stgm-*` tokens — no
 * hardcoded colors or sizes.
 *
 * Platform builders who need different rendering use
 * `useModelRegistry()` directly.
 *
 * @example
 * ```tsx
 * function ComposerHeader() {
 *   const [modelId, setModelId] = useState<string>();
 *
 *   return <ModelSelector value={modelId} onValueChange={setModelId} />;
 * }
 * ```
 */
export function ModelSelector({
  value,
  onValueChange,
  className,
  disabled,
}: ModelSelectorProps) {
  const { byProvider, defaultModel, providers } = useModelRegistry();

  return (
    <Select.Root
      value={value ?? defaultModel.modelId}
      onValueChange={(v) => { if (v !== null) onValueChange(v); }}
      disabled={disabled}
    >
      <Select.Trigger
        className={[
          "inline-flex items-center gap-1.5 rounded-md border border-border",
          "bg-background px-2.5 py-1.5 text-xs text-foreground",
          "hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          "transition-colors max-w-[14rem] max-sm:max-w-[8rem]",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Select.Value placeholder="Select model" className="truncate" />
        <Select.Icon className="text-muted-foreground">
          <ChevronIcon />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Positioner sideOffset={4}>
          <Select.Popup
            className={[
              "z-popover max-h-72 min-w-[var(--anchor-width)] overflow-auto",
              "rounded-lg border border-border bg-popover p-1 shadow-md",
              "text-popover-foreground",
            ].join(" ")}
          >
            {providers.map((provider) => {
              const models = byProvider.get(provider);
              if (!models?.length) return null;

              return (
                <Select.Group key={provider}>
                  <Select.GroupLabel className="px-2 py-1.5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                    {PROVIDER_LABELS[provider]}
                  </Select.GroupLabel>
                  {models.map((model) => (
                    <Select.Item
                      key={model.modelId}
                      value={model.modelId}
                      className={[
                        "flex cursor-pointer items-center justify-between gap-2",
                        "rounded-md px-2 py-1.5 text-xs outline-none",
                        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                        "data-[selected]:font-medium",
                      ].join(" ")}
                    >
                      <Select.ItemText>{model.displayName}</Select.ItemText>
                      <span className="text-[0.6rem] text-muted-foreground">
                        {COST_TIER_INDICATOR[model.costTier]}
                      </span>
                    </Select.Item>
                  ))}
                </Select.Group>
              );
            })}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 3.75L5 6.25L7.5 3.75" />
    </svg>
  );
}
