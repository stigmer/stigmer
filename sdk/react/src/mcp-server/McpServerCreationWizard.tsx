"use client";

import { useCallback, useMemo } from "react";
import type { WizardStepDef } from "../resource-creation/types";
import { useWizardState } from "../resource-creation/useWizardState";
import { WizardShell } from "../resource-creation/WizardShell";
import { useCreateMcpServer } from "./useCreateMcpServer";
import { IdentityTransportStep } from "./steps/IdentityTransportStep";
import { EnvironmentAuthStep } from "./steps/EnvironmentAuthStep";
import { ReviewStep, buildMcpServerInput } from "./steps/ReviewStep";
import { createInitialMcpServerWizardData } from "./steps/types";
import type { McpServerWizardData } from "./steps/types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Result passed to `onComplete` after successful MCP server creation. */
export interface McpServerCreationResult {
  /** Organization slug of the created MCP server. */
  readonly org: string;
  /** MCP server slug (for URL construction). */
  readonly slug: string;
  /** MCP server display name. */
  readonly name: string;
}

/** Props for {@link McpServerCreationWizard}. */
export interface McpServerCreationWizardProps {
  /** Organization to create the MCP server in. */
  readonly org: string;
  /**
   * Optional partial data to pre-fill the wizard with.
   *
   * Merged with defaults via `{ ...createInitialMcpServerWizardData(), ...initialData }`.
   * Use this for template-based creation, resource duplication, or any
   * flow that starts the wizard with pre-populated fields.
   */
  readonly initialData?: Partial<McpServerWizardData>;
  /** Called after the MCP server is successfully created. */
  readonly onComplete: (result: McpServerCreationResult) => void;
  /** Called when the user cancels the wizard. */
  readonly onCancel?: () => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEPS: WizardStepDef<McpServerWizardData>[] = [
  {
    id: "identity-transport",
    label: "Identity & Transport",
    validate: (data) => {
      if (!data.name.trim()) return "Name is required";
      if (data.transportType === "http" && !data.httpUrl.trim()) {
        return "HTTP URL is required";
      }
      if (data.transportType === "stdio" && !data.stdioCommand.trim()) {
        return "Stdio command is required";
      }
      return null;
    },
  },
  {
    id: "environment-auth",
    label: "Environment & Auth",
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
 * Multi-step wizard for creating a new MCP server blueprint.
 *
 * Three steps:
 * 1. **Identity & Transport** — name, slug, description, visibility, transport config
 * 2. **Environment & Auth** — env var declarations, OAuth auth configuration (all optional)
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
 * <McpServerCreationWizard
 *   org="acme"
 *   onComplete={({ org, slug }) => navigate(`/mcp-servers/${org}/${slug}`)}
 *   onCancel={() => navigate("/mcp-servers")}
 * />
 * ```
 */
export function McpServerCreationWizard({
  org,
  initialData,
  onComplete,
  onCancel,
  className,
}: McpServerCreationWizardProps) {
  const mergedInitialData = useMemo(
    () => ({ ...createInitialMcpServerWizardData(), ...initialData }),
    // initialData is consumed once at mount — not reactive by design
    [initialData],
  );

  const wizard = useWizardState({
    steps: STEPS,
    initialData: mergedInitialData,
  });

  const { create, isCreating, error, clearError } = useCreateMcpServer();

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
    const input = buildMcpServerInput(org, wizard.data);

    try {
      const server = await create(input);
      onComplete({
        org: server.metadata?.org ?? org,
        slug: server.metadata?.slug ?? input.slug ?? input.name,
        name: server.metadata?.name ?? input.name,
      });
    } catch {
      // Error is captured by useCreateMcpServer and displayed in ReviewStep
    }
  }, [org, wizard.data, create, clearError, onComplete]);

  const currentStepContent = useMemo(() => {
    switch (wizard.currentStep.id) {
      case "identity-transport":
        return (
          <IdentityTransportStep
            data={wizard.data}
            updateData={wizard.updateData}
            validationError={wizard.validationError}
          />
        );
      case "environment-auth":
        return (
          <EnvironmentAuthStep
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
      submitLabel="Create MCP server"
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
