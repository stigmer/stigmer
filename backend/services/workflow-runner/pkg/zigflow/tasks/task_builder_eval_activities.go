/*
 * Copyright 2026 Leftbin/Stigmer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"go.temporal.io/sdk/activity"
)

func init() {
	activitiesRegistry = append(activitiesRegistry, &EvalActivities{})
}

type EvalActivities struct{}

// EvalActivity uses an LLM judge to evaluate the semantic quality of
// workflow data against a rubric. Constructs a judge prompt, calls the
// LLM with structured output enforcement, and applies the threshold.
func (a *EvalActivities) EvalActivity(
	ctx context.Context,
	config *workflowtasks.EvalTaskConfig,
	subject any,
	workflowExecutionId string,
) (any, error) {
	logger := activity.GetLogger(ctx)

	judgePrompt, err := buildJudgePrompt(config, subject)
	if err != nil {
		return nil, fmt.Errorf("failed to build judge prompt: %w", err)
	}

	llmConfig := &workflowtasks.LlmCallTaskConfig{
		Model:        config.Model,
		SystemPrompt: judgePrompt.systemPrompt,
		Prompt:       judgePrompt.userPrompt,
	}

	llmActivities := &CallLlmActivities{}
	llmResult, err := llmActivities.CallLlmActivity(ctx, llmConfig, workflowExecutionId)
	if err != nil {
		return nil, fmt.Errorf("eval LLM call failed: %w", err)
	}

	resultMap, ok := llmResult.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("unexpected LLM result type: %T", llmResult)
	}

	evalResult, err := parseJudgeResponse(config, resultMap, subject)
	if err != nil {
		logger.Warn("Failed to parse judge response, treating as failure",
			"error", err, "model", config.Model)
		evalResult = &evalOutput{
			Pass:      false,
			Score:     0,
			Reasoning: fmt.Sprintf("Judge response could not be parsed: %s", err),
			ModelUsed: config.Model,
			Subject:   subject,
		}
	}

	// Apply cost metadata for budget tracking
	output := evalResult.toMap()
	if inputTokens, ok := resultMap["input_tokens"]; ok {
		output["__stigmer_input_tokens"] = inputTokens
	}
	if outputTokens, ok := resultMap["output_tokens"]; ok {
		output["__stigmer_output_tokens"] = outputTokens
	}
	if costMicros, ok := resultMap["__stigmer_cost_micros"]; ok {
		output["__stigmer_cost_micros"] = costMicros
	}

	if !evalResult.Pass {
		switch config.OnFail {
		case workflowtasks.EvalFailPolicy_EVAL_FAIL_RAISE,
			workflowtasks.EvalFailPolicy_EVAL_FAIL_POLICY_UNSPECIFIED:
			return nil, fmt.Errorf("evaluation failed (score: %.2f, threshold: %.2f): %s",
				evalResult.Score, config.Threshold, evalResult.Reasoning)

		case workflowtasks.EvalFailPolicy_EVAL_FAIL_BRANCH:
			if config.FallbackTask != "" {
				output["__stigmer_branch_override"] = config.FallbackTask
			} else {
				return nil, fmt.Errorf("evaluation failed with BRANCH policy but no fallback_task set")
			}

		case workflowtasks.EvalFailPolicy_EVAL_FAIL_WARN:
			logger.Warn("Evaluation failed (warn policy)",
				"score", evalResult.Score, "threshold", config.Threshold)
		}
	}

	return output, nil
}

type judgePrompt struct {
	systemPrompt string
	userPrompt   string
}

func buildJudgePrompt(config *workflowtasks.EvalTaskConfig, subject any) (*judgePrompt, error) {
	if config.SystemPrompt != "" {
		subjectJSON, err := marshalSubject(subject)
		if err != nil {
			return nil, err
		}
		return &judgePrompt{
			systemPrompt: config.SystemPrompt,
			userPrompt:   fmt.Sprintf("Evaluate the following:\n\n%s", subjectJSON),
		}, nil
	}

	var systemPrompt string
	switch config.ScoringMode {
	case workflowtasks.EvalScoringMode_EVAL_PASS_FAIL,
		workflowtasks.EvalScoringMode_EVAL_SCORING_MODE_UNSPECIFIED:
		systemPrompt = buildPassFailSystemPrompt(config.Rubric)

	case workflowtasks.EvalScoringMode_EVAL_NUMERIC_SCORE:
		systemPrompt = buildNumericScoreSystemPrompt(config.Rubric)

	case workflowtasks.EvalScoringMode_EVAL_MULTI_CRITERIA:
		systemPrompt = buildMultiCriteriaSystemPrompt(config.Rubric, config.Criteria)

	default:
		systemPrompt = buildPassFailSystemPrompt(config.Rubric)
	}

	subjectJSON, err := marshalSubject(subject)
	if err != nil {
		return nil, err
	}

	return &judgePrompt{
		systemPrompt: systemPrompt,
		userPrompt:   fmt.Sprintf("Evaluate the following:\n\n%s", subjectJSON),
	}, nil
}

func buildPassFailSystemPrompt(rubric string) string {
	return fmt.Sprintf(`You are an evaluation judge. Your task is to evaluate content against a rubric and determine if it passes or fails.

RUBRIC:
%s

You MUST respond with a JSON object in exactly this format:
{"pass": true, "reasoning": "Brief explanation of your judgment"}

- "pass" must be a boolean (true or false)
- "reasoning" must be a concise explanation (1-3 sentences)

Respond ONLY with the JSON object, no other text.`, rubric)
}

func buildNumericScoreSystemPrompt(rubric string) string {
	return fmt.Sprintf(`You are an evaluation judge. Your task is to score content on a scale from 0.0 to 1.0 based on a rubric.

RUBRIC:
%s

You MUST respond with a JSON object in exactly this format:
{"score": 0.85, "reasoning": "Brief explanation of your score"}

- "score" must be a number between 0.0 (worst) and 1.0 (best)
- "reasoning" must be a concise explanation (1-3 sentences)

Respond ONLY with the JSON object, no other text.`, rubric)
}

func buildMultiCriteriaSystemPrompt(rubric string, criteria []*workflowtasks.EvalCriterion) string {
	var criteriaDesc strings.Builder
	for i, c := range criteria {
		if i > 0 {
			criteriaDesc.WriteString("\n")
		}
		criteriaDesc.WriteString(fmt.Sprintf("- %s: %s", c.Name, c.Description))
		if c.Weight > 0 {
			criteriaDesc.WriteString(fmt.Sprintf(" (weight: %.1f)", c.Weight))
		}
	}

	criteriaNames := make([]string, len(criteria))
	for i, c := range criteria {
		criteriaNames[i] = fmt.Sprintf(`{"name": "%s", "score": 0.85, "reasoning": "..."}`, c.Name)
	}

	return fmt.Sprintf(`You are an evaluation judge. Your task is to evaluate content against multiple criteria, scoring each from 0.0 to 1.0.

OVERALL CONTEXT:
%s

CRITERIA:
%s

You MUST respond with a JSON object in exactly this format:
{"criteria": [%s]}

- Each criterion must have "name" (string), "score" (0.0-1.0), and "reasoning" (1-3 sentences)
- Score every criterion listed above

Respond ONLY with the JSON object, no other text.`, rubric, criteriaDesc.String(), strings.Join(criteriaNames, ", "))
}

func marshalSubject(subject any) (string, error) {
	switch v := subject.(type) {
	case string:
		return v, nil
	default:
		bytes, err := json.Marshal(v)
		if err != nil {
			return "", fmt.Errorf("failed to marshal subject: %w", err)
		}
		return string(bytes), nil
	}
}

type evalOutput struct {
	Pass      bool               `json:"pass"`
	Score     float64            `json:"score,omitempty"`
	Reasoning string             `json:"reasoning"`
	Criteria  []criterionResult  `json:"criteria,omitempty"`
	ModelUsed string             `json:"model_used"`
	Subject   any                `json:"subject"`
}

type criterionResult struct {
	Name      string  `json:"name"`
	Score     float64 `json:"score"`
	Reasoning string  `json:"reasoning"`
}

func (e *evalOutput) toMap() map[string]any {
	m := map[string]any{
		"pass":       e.Pass,
		"reasoning":  e.Reasoning,
		"model_used": e.ModelUsed,
		"subject":    e.Subject,
	}
	if e.Score > 0 || len(e.Criteria) > 0 {
		m["score"] = e.Score
	}
	if len(e.Criteria) > 0 {
		criteria := make([]map[string]any, len(e.Criteria))
		for i, c := range e.Criteria {
			criteria[i] = map[string]any{
				"name":      c.Name,
				"score":     c.Score,
				"reasoning": c.Reasoning,
			}
		}
		m["criteria"] = criteria
	}
	return m
}

func parseJudgeResponse(
	config *workflowtasks.EvalTaskConfig,
	llmResult map[string]any,
	subject any,
) (*evalOutput, error) {
	rawResult := llmResult["result"]

	var parsed map[string]any

	switch v := rawResult.(type) {
	case map[string]any:
		parsed = v
	case string:
		if err := json.Unmarshal([]byte(v), &parsed); err != nil {
			return nil, fmt.Errorf("failed to parse judge JSON response: %w", err)
		}
	default:
		return nil, fmt.Errorf("unexpected judge result type: %T", rawResult)
	}

	output := &evalOutput{
		ModelUsed: config.Model,
		Subject:   subject,
	}

	switch config.ScoringMode {
	case workflowtasks.EvalScoringMode_EVAL_PASS_FAIL,
		workflowtasks.EvalScoringMode_EVAL_SCORING_MODE_UNSPECIFIED:
		pass, _ := parsed["pass"].(bool)
		reasoning, _ := parsed["reasoning"].(string)
		output.Pass = pass
		output.Reasoning = reasoning
		if pass {
			output.Score = 1.0
		}

	case workflowtasks.EvalScoringMode_EVAL_NUMERIC_SCORE:
		score := extractFloat(parsed["score"])
		reasoning, _ := parsed["reasoning"].(string)
		output.Score = score
		output.Reasoning = reasoning
		output.Pass = score >= config.Threshold

	case workflowtasks.EvalScoringMode_EVAL_MULTI_CRITERIA:
		criteriaRaw, ok := parsed["criteria"]
		if !ok {
			return nil, fmt.Errorf("judge response missing 'criteria' field")
		}
		criteriaList, ok := criteriaRaw.([]any)
		if !ok {
			return nil, fmt.Errorf("judge 'criteria' field is not an array")
		}

		var totalWeight, weightedSum float64
		for _, cRaw := range criteriaList {
			cMap, ok := cRaw.(map[string]any)
			if !ok {
				continue
			}
			name, _ := cMap["name"].(string)
			score := extractFloat(cMap["score"])
			reasoning, _ := cMap["reasoning"].(string)

			output.Criteria = append(output.Criteria, criterionResult{
				Name:      name,
				Score:     score,
				Reasoning: reasoning,
			})

			weight := findCriterionWeight(config.Criteria, name)
			if weight <= 0 {
				weight = 1.0
			}
			totalWeight += weight
			weightedSum += score * weight
		}

		if totalWeight > 0 {
			output.Score = weightedSum / totalWeight
		}
		output.Reasoning = fmt.Sprintf("Weighted average across %d criteria", len(output.Criteria))
		output.Pass = output.Score >= config.Threshold
	}

	return output, nil
}

func extractFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	default:
		return 0
	}
}

func findCriterionWeight(criteria []*workflowtasks.EvalCriterion, name string) float64 {
	for _, c := range criteria {
		if c.Name == name {
			return c.Weight
		}
	}
	return 1.0
}
