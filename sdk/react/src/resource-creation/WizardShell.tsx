"use client";

import { cn } from "@stigmer/theme";
import type { WizardShellProps } from "./types.js";
import { StepIndicator } from "./StepIndicator.js";
import { WizardNav } from "./WizardNav.js";

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
        "stg:flex stg:min-h-0 stg:flex-col stg:overflow-hidden stg:rounded-lg stg:border stg:border-border stg:bg-background",
        className,
      )}
    >
      {/* Mobile step indicator (visible < sm) */}
      <div className="stg:flex stg:items-center stg:gap-2 stg:border-b stg:border-border stg:px-4 stg:py-3 stg:sm:hidden">
        <MobileProgress current={currentStepIndex + 1} total={steps.length} />
        <span className="stg:text-sm stg:font-medium stg:text-foreground">
          {steps[currentStepIndex]?.label}
        </span>
      </div>

      <div className="stg:flex stg:min-h-0 stg:flex-1">
        {/* Step indicator sidebar (visible >= sm) */}
        <aside className="stg:hidden stg:w-52 stg:shrink-0 stg:border-r stg:border-border stg:bg-muted-faint stg:px-3 stg:py-6 stg:sm:block">
          <StepIndicator
            steps={steps}
            currentStepIndex={currentStepIndex}
            onStepClick={onGoToStep}
          />
        </aside>

        {/* Content area */}
        <main className="stg:flex-1 stg:overflow-y-auto stg:px-6 stg:py-6 stg:sm:px-8">
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
    <span className="stg:inline-flex stg:items-center stg:justify-center stg:rounded-full stg:bg-primary stg:px-2 stg:py-0.5 stg:text-[10px] stg:font-semibold stg:text-primary-foreground">
      {current}/{total}
    </span>
  );
}
