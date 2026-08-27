/**
 * In-process workflow-spec validation — ports
 * pkg/domain/workflow/validation/validator.go. Validates a WorkflowSpec
 * entirely in-process: converts the spec to CNCF Serverless Workflow DSL
 * YAML, runs cross-reference validation, the declared task-config
 * constraints (#805), the surface rules, harness-aware model validation,
 * the human-input timeout-policy rule, and produces budget/expression
 * warnings.
 *
 * Verdict states:
 *   - VALID: conversion succeeded, no structural errors
 *   - INVALID: user error (bad structure, missing fields, bad references)
 *   - FAILED: system error (nil spec)
 * The yaml field always carries the generated CNCF YAML when conversion
 * succeeds (even for INVALID), as it aids debugging. A machinery fault
 * (the validation infrastructure itself failing) THROWS — callers surface
 * it as a gRPC internal error, mirroring Go's (nil, err) contract.
 */
import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";

import type { WorkflowSpec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import {
  ServerlessWorkflowValidationSchema,
  ValidationState,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import type { ServerlessWorkflowValidation } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";

import type { Logger } from "../../../boot/logger.js";
import { protoToYaml } from "../converter/converter.js";
import type { ModelCatalogProvider } from "../registry/model-catalog-provider.js";
import { checkBudgetWarnings } from "./budget-warnings.js";
import {
  validateCrossTaskReferences,
  validateTaskConfigSurfaceRules,
  validateTaskKinds,
} from "./crossref.js";
import { checkExpressionWarnings } from "./expression-warnings.js";
import { validateHumanInputTimeoutPolicies } from "./human-input-validation.js";
import { validateModelReferences } from "./model-validation.js";
import { validateTaskConfigConstraints } from "./task-config-constraints.js";

export class InProcessValidator {
  constructor(
    private readonly modelRegistry: ModelCatalogProvider,
    private readonly logger: Logger,
  ) {}

  validate(spec: WorkflowSpec | undefined): ServerlessWorkflowValidation {
    if (spec === undefined) {
      return create(ServerlessWorkflowValidationSchema, {
        state: ValidationState.FAILED,
        errors: ["WorkflowSpec cannot be nil"],
        validatedAt: timestampNow(),
      });
    }

    this.logger.debug("starting in-process workflow validation");

    // Step 0: task kind validation (fail fast for unknown kinds).
    const kindErrors = validateTaskKinds(spec);
    if (kindErrors.length > 0) {
      return create(ServerlessWorkflowValidationSchema, {
        state: ValidationState.INVALID,
        errors: kindErrors,
        validatedAt: timestampNow(),
      });
    }

    // Step 1: convert proto to CNCF YAML.
    let yaml: string;
    try {
      yaml = protoToYaml(spec);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("YAML generation failed", { error: message });
      return create(ServerlessWorkflowValidationSchema, {
        state: ValidationState.INVALID,
        errors: [`Failed to generate YAML: ${message}`],
        validatedAt: timestampNow(),
      });
    }

    this.logger.debug("YAML generation succeeded", { yamlLength: yaml.length });

    const errors: string[] = [];
    const warnings: string[] = [];

    // Step 2: cross-reference validation (unique names, flow.then targets,
    // cycles).
    errors.push(...validateCrossTaskReferences(spec));

    // Step 2b: typed task-config constraint validation — protovalidate over
    // each strict-unmarshaled config, nested tasks included (#805). A
    // throw here is a fault in the validation machinery, not a spec
    // problem, and propagates as a system error.
    errors.push(...validateTaskConfigConstraints(spec));

    // Step 2c: bespoke task-config surface rules (semantics beyond what
    // the config protos can declare).
    errors.push(...validateTaskConfigSurfaceRules(spec));

    // Step 2d: model reference validation (harness-aware).
    errors.push(...validateModelReferences(this.modelRegistry, spec));

    // Step 2e: human-input timeout policy validation (fail closed on
    // policies the runtime cannot honor).
    errors.push(...validateHumanInputTimeoutPolicies(spec));

    // Step 3: budget warnings.
    warnings.push(...checkBudgetWarnings(spec.budget, spec.tasks));

    // Step 4: expression warnings ($context.env.* → should be $env.*).
    warnings.push(...checkExpressionWarnings(spec));

    if (errors.length > 0) {
      this.logger.warn("validation failed (state: INVALID)", {
        errors: errors.length,
        warnings: warnings.length,
      });
      return create(ServerlessWorkflowValidationSchema, {
        state: ValidationState.INVALID,
        yaml,
        errors,
        warnings,
        validatedAt: timestampNow(),
      });
    }

    this.logger.info("validation passed (state: VALID)", {
      warnings: warnings.length,
    });

    return create(ServerlessWorkflowValidationSchema, {
      state: ValidationState.VALID,
      yaml,
      errors,
      warnings,
      validatedAt: timestampNow(),
    });
  }
}
