"use client";

import { useCallback, useMemo } from "react";
import type { WizardStepDef } from "../resource-creation/types.js";
import { useWizardState } from "../resource-creation/useWizardState.js";
import { WizardShell } from "../resource-creation/WizardShell.js";
import { useCreateAgent } from "./useCreateAgent.js";
import { IdentityStep } from "./steps/IdentityStep.js";
import { CapabilitiesStep } from "./steps/CapabilitiesStep.js";
import { ReviewStep, buildAgentInput } from "./steps/ReviewStep.js";
import { createInitialWizardData } from "./steps/types.js";
import type { AgentWizardData } from "./steps/types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Result passed to `onComplete` after successful agent creation. */
export interface AgentCreationResult {
  /** Organization slug of the created agent. */
  readonly org: string;
  /** Agent slug (for URL construction). */
  readonly slug: string;
  /** Agent display name. */
  readonly name: string;
}

/** Props for {@link AgentCreationWizard}. */
export interface AgentCreationWizardProps {
  /** Organization to create the agent in. */
  readonly org: string;
  /**
   * Optional partial data to pre-fill the wizard with.
   *
   * Merged with defaults via `{ ...createInitialWizardData(), ...initialData }`.
   * Use this for template-based creation, resource duplication, or any
   * flow that starts the wizard with pre-populated fields.
   */
  readonly initialData?: Partial<AgentWizardData>;
  /** Called after the agent is successfully created. */
  readonly onComplete: (result: AgentCreationResult) => void;
  /** Called when the user cancels the wizard. */
  readonly onCancel?: () => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEPS: WizardStepDef<AgentWizardData>[] = [
  {
    id: "identity",
    label: "Identity & Instructions",
    validate: (data) => {
      if (!data.name.trim()) return "Name is required";
      return null;
    },
  },
  {
    id: "capabilities",
    label: "Capabilities",
  },
  {
    id: "review",
    label: "Review & Create",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Multi-step wizard for creating a new agent blueprint.
 *
 * Three condensed steps:
 * 1. **Identity & Instructions** — name, slug, description, visibility, system prompt
 * 2. **Capabilities** — MCP servers + tools, skills, env var declarations (all optional)
 * 3. **Review & Create** — YAML preview + submission
 *
 * Uses the shared `WizardShell` layout and `useWizardState` hook for
 * navigation. Form data accumulates in the wizard state; on the final
 * step the user reviews and confirms creation.
 *
 * This component is an SDK-first, embeddable wizard with zero Console
 * dependencies. Platform builders can mount it anywhere.
 *
 * @example
 * ```tsx
 * <AgentCreationWizard
 *   org="acme"
 *   onComplete={({ org, slug }) => navigate(`/agents/${org}/${slug}`)}
 *   onCancel={() => navigate("/agents")}
 * />
 * ```
 */
export function AgentCreationWizard({
  org,
  initialData,
  onComplete,
  onCancel,
  className,
}: AgentCreationWizardProps) {
  const mergedInitialData = useMemo(
    () => ({ ...createInitialWizardData(), ...initialData }),
    // initialData is consumed once at mount — not reactive by design
    [initialData],
  );

  const wizard = useWizardState({
    steps: STEPS,
    initialData: mergedInitialData,
  });

  const { create, isCreating, error, clearError } = useCreateAgent();

  const handleNext = useCallback(() => {
    if (wizard.isLastStep) {
      handleSubmit();
    } else {
      clearError();
      wizard.goNext();
    }
  }, [wizard.isLastStep, wizard.goNext, clearError]);

  const handleSubmit = useCallback(async () => {
    clearError();
    const input = buildAgentInput(org, wizard.data);

    try {
      const agent = await create(input);
      onComplete({
        org: agent.metadata?.org ?? org,
        slug: agent.metadata?.slug ?? input.slug ?? input.name,
        name: agent.metadata?.name ?? input.name,
      });
    } catch {
      // Error is captured by useCreateAgent and displayed in ReviewStep
    }
  }, [org, wizard.data, create, clearError, onComplete]);

  const currentStepContent = useMemo(() => {
    switch (wizard.currentStep.id) {
      case "identity":
        return (
          <IdentityStep
            data={wizard.data}
            updateData={wizard.updateData}
            validationError={wizard.validationError}
          />
        );
      case "capabilities":
        return (
          <CapabilitiesStep
            org={org}
            data={wizard.data}
            updateData={wizard.updateData}
          />
        );
      case "review":
        return (
          <ReviewStep
            org={org}
            data={wizard.data}
            isCreating={isCreating}
            error={error}
          />
        );
      default:
        return null;
    }
  }, [
    wizard.currentStep.id,
    wizard.data,
    wizard.updateData,
    wizard.validationError,
    org,
    isCreating,
    error,
  ]);

  return (
    <WizardShell
      steps={STEPS}
      currentStepIndex={wizard.currentStepIndex}
      submitLabel="Create agent"
      isSubmitting={isCreating}
      canGoNext={wizard.canGoNext}
      canGoBack={wizard.canGoBack}
      onNext={handleNext}
      onBack={wizard.goBack}
      onGoToStep={wizard.goToStep}
      onCancel={onCancel}
      className={className}
    >
      {currentStepContent}
    </WizardShell>
  );
}
