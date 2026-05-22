/**
 * CallEval Temporal activity — executes LLM-as-judge evaluation for
 * workflow `call: eval` tasks.
 *
 * Ported from the deleted Go EvalActivity (task_builder_eval_activities.go).
 *
 * Supports three scoring modes:
 * - EVAL_PASS_FAIL: binary pass/fail with reasoning
 * - EVAL_NUMERIC_SCORE: 0.0-1.0 score with optional threshold
 * - EVAL_MULTI_CRITERIA: per-criterion scores with weighted average
 *
 * Uses callLlmAction for the underlying LLM call, keeping proxy/auth
 * handling in one place.
 */

import { ApplicationFailure } from "@temporalio/activity";
import { callLlmAction } from "./call-llm.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface EvalCriterion {
  readonly name: string;
  readonly description?: string;
  readonly weight?: number;
}

export interface EvalConfig {
  readonly model: string;
  readonly subject: unknown;
  readonly rubric: string;
  readonly scoring_mode?: string;
  readonly threshold?: number;
  readonly on_fail?: string;
  readonly fallback_task?: string;
  readonly criteria?: EvalCriterion[];
  readonly system_prompt?: string;
  readonly max_cost_micros?: number;
}

interface CriterionResult {
  name: string;
  score: number;
  reasoning: string;
}

export interface EvalResult {
  pass: boolean;
  score?: number;
  reasoning: string;
  criteria?: CriterionResult[];
  model_used: string;
  subject: unknown;
}

// ─── Judge Prompt Builders ───────────────────────────────────────────────

function buildPassFailPrompt(rubric: string, subject: string): string {
  return `You are an expert evaluator. Assess the following subject according to the rubric.

## Rubric
${rubric}

## Subject
${subject}

## Instructions
Evaluate the subject against the rubric. Respond with ONLY a JSON object in this exact format:
{"pass": true/false, "reasoning": "your explanation"}

Do not include any text outside the JSON object.`;
}

function buildNumericScorePrompt(rubric: string, subject: string): string {
  return `You are an expert evaluator. Score the following subject according to the rubric.

## Rubric
${rubric}

## Subject
${subject}

## Instructions
Score the subject from 0.0 (worst) to 1.0 (best) according to the rubric. Respond with ONLY a JSON object in this exact format:
{"score": 0.0, "reasoning": "your explanation"}

The score must be a number between 0.0 and 1.0. Do not include any text outside the JSON object.`;
}

function buildMultiCriteriaPrompt(
  rubric: string,
  subject: string,
  criteria: EvalCriterion[],
): string {
  const criteriaDesc = criteria
    .map((c) => `- **${c.name}**: ${c.description ?? "(no description)"}`)
    .join("\n");

  return `You are an expert evaluator. Score the following subject on multiple criteria.

## Rubric
${rubric}

## Criteria
${criteriaDesc}

## Subject
${subject}

## Instructions
Score the subject on each criterion from 0.0 (worst) to 1.0 (best). Respond with ONLY a JSON object in this exact format:
{"criteria": [{"name": "criterion_name", "score": 0.0, "reasoning": "explanation"}, ...]}

Each criterion must have name, score (0.0-1.0), and reasoning. Do not include any text outside the JSON object.`;
}

// ─── Response Parsing ────────────────────────────────────────────────────

function extractJSON(text: string): string {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : text;
}

function parsePassFailResponse(text: string): { pass: boolean; reasoning: string } {
  try {
    const parsed = JSON.parse(extractJSON(text));
    return {
      pass: Boolean(parsed.pass),
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    const lowerText = text.toLowerCase();
    const pass = lowerText.includes('"pass": true') || lowerText.includes('"pass":true');
    return {
      pass,
      reasoning: `Failed to parse judge response as JSON. Raw: ${text.slice(0, 500)}`,
    };
  }
}

function parseNumericResponse(text: string): { score: number; reasoning: string } {
  try {
    const parsed = JSON.parse(extractJSON(text));
    const score = typeof parsed.score === "number" ? parsed.score : 0;
    return {
      score: Math.max(0, Math.min(1, score)),
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return {
      score: 0,
      reasoning: `Failed to parse judge response as JSON. Raw: ${text.slice(0, 500)}`,
    };
  }
}

function parseMultiCriteriaResponse(text: string): CriterionResult[] {
  try {
    const parsed = JSON.parse(extractJSON(text));
    const criteria = Array.isArray(parsed.criteria) ? parsed.criteria : [];
    return criteria.map((c: Record<string, unknown>) => ({
      name: typeof c.name === "string" ? c.name : "unknown",
      score: Math.max(0, Math.min(1, typeof c.score === "number" ? c.score : 0)),
      reasoning: typeof c.reasoning === "string" ? c.reasoning : "",
    }));
  } catch {
    return [];
  }
}

function computeWeightedScore(
  results: CriterionResult[],
  configCriteria: EvalCriterion[],
): number {
  if (results.length === 0) return 0;

  const weightMap = new Map<string, number>();
  for (const c of configCriteria) {
    weightMap.set(c.name, c.weight ?? 1.0);
  }

  let totalWeight = 0;
  let weightedSum = 0;
  for (const r of results) {
    const w = weightMap.get(r.name) ?? 1.0;
    weightedSum += r.score * w;
    totalWeight += w;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ─── On-Fail Policy ──────────────────────────────────────────────────────

function applyOnFailPolicy(
  result: EvalResult,
  config: EvalConfig,
): EvalResult & { __stigmer_branch_override?: string } {
  if (result.pass) return result;

  const policy = config.on_fail ?? "EVAL_FAIL_WARN";

  switch (policy) {
    case "EVAL_FAIL_RAISE":
      throw ApplicationFailure.nonRetryable(
        `Eval failed: ${result.reasoning}`,
        "EVAL_FAILED",
        result,
      );
    case "EVAL_FAIL_BRANCH":
      if (config.fallback_task) {
        return { ...result, __stigmer_branch_override: config.fallback_task };
      }
      return result;
    case "EVAL_FAIL_WARN":
    default:
      return result;
  }
}

// ─── Main Action ─────────────────────────────────────────────────────────

export async function callEvalAction(
  config: EvalConfig,
  runtimeEnv: Record<string, unknown>,
  executionId: string,
): Promise<EvalResult & { __stigmer_branch_override?: string }> {
  if (!config.model) {
    throw ApplicationFailure.nonRetryable("Eval requires 'model' in config", "EVAL_MISSING_MODEL");
  }
  if (!config.rubric) {
    throw ApplicationFailure.nonRetryable("Eval requires 'rubric' in config", "EVAL_MISSING_RUBRIC");
  }
  if (config.subject === undefined || config.subject === null) {
    throw ApplicationFailure.nonRetryable("Eval requires 'subject' in config", "EVAL_MISSING_SUBJECT");
  }

  const subjectStr = typeof config.subject === "string"
    ? config.subject
    : JSON.stringify(config.subject, null, 2);

  const scoringMode = config.scoring_mode ?? "EVAL_PASS_FAIL";
  const threshold = config.threshold ?? 0.5;

  let prompt: string;
  switch (scoringMode) {
    case "EVAL_PASS_FAIL":
      prompt = buildPassFailPrompt(config.rubric, subjectStr);
      break;
    case "EVAL_NUMERIC_SCORE":
      prompt = buildNumericScorePrompt(config.rubric, subjectStr);
      break;
    case "EVAL_MULTI_CRITERIA":
      if (!config.criteria || config.criteria.length === 0) {
        throw ApplicationFailure.nonRetryable(
          "EVAL_MULTI_CRITERIA requires 'criteria' list",
          "EVAL_MISSING_CRITERIA",
        );
      }
      prompt = buildMultiCriteriaPrompt(config.rubric, subjectStr, config.criteria);
      break;
    default:
      throw ApplicationFailure.nonRetryable(
        `Unknown scoring_mode '${scoringMode}'. Supported: EVAL_PASS_FAIL, EVAL_NUMERIC_SCORE, EVAL_MULTI_CRITERIA`,
        "EVAL_UNKNOWN_SCORING_MODE",
      );
  }

  const llmResult = await callLlmAction(
    {
      model: config.model,
      prompt,
      system_prompt: config.system_prompt,
      response_schema: { type: "object" },
    },
    runtimeEnv,
    executionId,
  );

  const responseText = typeof llmResult.result === "string"
    ? llmResult.result
    : JSON.stringify(llmResult.result);

  let evalResult: EvalResult;

  switch (scoringMode) {
    case "EVAL_PASS_FAIL": {
      const parsed = parsePassFailResponse(responseText);
      evalResult = {
        pass: parsed.pass,
        reasoning: parsed.reasoning,
        model_used: llmResult.model,
        subject: config.subject,
      };
      break;
    }
    case "EVAL_NUMERIC_SCORE": {
      const parsed = parseNumericResponse(responseText);
      evalResult = {
        pass: parsed.score >= threshold,
        score: parsed.score,
        reasoning: parsed.reasoning,
        model_used: llmResult.model,
        subject: config.subject,
      };
      break;
    }
    case "EVAL_MULTI_CRITERIA": {
      const criteriaResults = parseMultiCriteriaResponse(responseText);
      const score = computeWeightedScore(criteriaResults, config.criteria ?? []);
      evalResult = {
        pass: score >= threshold,
        score,
        reasoning: criteriaResults.map((c) => `${c.name}: ${c.reasoning}`).join("; "),
        criteria: criteriaResults,
        model_used: llmResult.model,
        subject: config.subject,
      };
      break;
    }
    default:
      throw ApplicationFailure.nonRetryable(`Unhandled scoring_mode: ${scoringMode}`, "EVAL_INTERNAL");
  }

  return applyOnFailPolicy(evalResult, config);
}
