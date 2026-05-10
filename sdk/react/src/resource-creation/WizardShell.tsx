"use client";

import { cn } from "@stigmer/theme";
import type { WizardShellProps } from "./types";
import { StepIndicator } from "./StepIndicator";
import { WizardNav } from "./WizardNav";

/**
 * Reusable multi-step wizard layout for resource creation flows.
 *
 * Renders three zones:
 * 1. **Step indicator sidebar** — vertical progress showing all steps
 * 2. **Content area** — the active step's form content (via `children`)
 * 3. **Navigation footer** — Back / Next / Create buttons
 *
 * This component is resource-agnostic. It accepts step definitions for
 * the indicator, delegates content rendering to the consumer, and
 * emits navigation events. The consumer (e.g., `AgentCreationWizard`)
 * manages form state via `useWizardState` and renders the appropriate
 * step component as `children`.
 *
 * Layout:
 * - **Desktop** (>= 640px): Sidebar (200px) + content (flex-1) side by side
 * - **Mobile** (< 640px): Step indicator as compact top bar, content below
 *
 * All visual properties via `--stgm-*` tokens. Zero Console or
 * framework dependencies — works in any React host.
 *
 * @example
 * ```tsx
 * <WizardShell
 *   steps={steps}
 *   currentStepIndex={wizard.currentStepIndex}
 *   submitLabel="Create agent"
 *   isSubmitting={isCreating}
 *   canGoNext={wizard.canGoNext}
 *   canGoBack={wizard.canGoBack}
 *   onNext={wizard.goNext}
 *   onBack={wizard.goBack}
 *   onCancel={handleCancel}
 * >
 *   {renderCurrentStep()}
 * </WizardShell>
 * ```
 */
export function WizardShell({
  steps,
  currentStepIndex,
  children,
  submitLabel,
  isSubmitting,
  canGoNext = true,
  canGoBack = false,
  onNext,
  onBack,
  onGoToStep,
  onCancel,
  className,
}: WizardShellProps) {
  const isLastStep = currentStepIndex === steps.length - 1;
  const nextLabel = isLastStep ? submitLabel : "Next";

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background",
        className,
      )}
    >
      {/* Mobile step indicator (visible < sm) */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 sm:hidden">
        <MobileProgress current={currentStepIndex + 1} total={steps.length} />
        <span className="text-sm font-medium text-foreground">
          {steps[currentStepIndex]?.label}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Step indicator sidebar (visible >= sm) */}
        <aside className="hidden w-52 shrink-0 border-r border-border bg-muted-faint px-3 py-6 sm:block">
          <StepIndicator
            steps={steps}
            currentStepIndex={currentStepIndex}
            onStepClick={onGoToStep}
          />
        </aside>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          {children}
        </main>
      </div>

      {/* Navigation footer */}
      <WizardNav
        showBack={canGoBack}
        nextLabel={nextLabel}
        nextDisabled={!canGoNext}
        isSubmitting={isSubmitting}
        onBack={onBack}
        onNext={onNext}
        onCancel={onCancel}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile progress (compact step display)
// ---------------------------------------------------------------------------

function MobileProgress({
  current,
  total,
}: {
  readonly current: number;
  readonly total: number;
}) {
  return (
    <span className="inline-flex items-center justify-center rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
      {current}/{total}
    </span>
  );
}
