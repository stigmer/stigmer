/*
 * Copyright 2025 - 2026 Zigflow authors <https://github.com/stigmer/stigmer/backend/services/workflow-runner/graphs/contributors>
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
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/rs/zerolog/log"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func NewForTaskBuilder(
	temporalWorker worker.Worker,
	task *model.ForTask,
	taskName string,
	doc *model.Workflow,
) (*ForTaskBuilder, error) {
	return &ForTaskBuilder{
		builder: builder[*model.ForTask]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

var errForkIterationStop = fmt.Errorf("fork iteration stop")

type ForTaskBuilder struct {
	builder[*model.ForTask]

	childWorkflowName string
	childWorkflowFunc TemporalWorkflowFunc
	concurrencyConfig *forConcurrencyConfig
}

// forConcurrencyConfig holds the parsed T17 concurrency configuration.
// All zero values mean sequential execution (backward compatible).
type forConcurrencyConfig struct {
	maxParallelism int
	batchSize      int
	onError        tasksv1.ForEachErrorPolicy
}

func (c *forConcurrencyConfig) isParallel() bool {
	return c != nil && c.maxParallelism > 0
}

func (t *ForTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	t.parseConcurrencyConfig()

	builder, err := t.createBuilder()
	if err != nil {
		return nil, err
	}
	if builder == nil {
		return nil, nil
	}

	wf, err := builder.Build()
	if err != nil {
		log.Error().Str("task", t.childWorkflowName).Err(err).Msg("Error building for workflow")
		return nil, fmt.Errorf("error building for workflow: %w", err)
	}

	t.childWorkflowFunc = wf

	return t.exec()
}

func (t *ForTaskBuilder) PostLoad() error {
	builder, err := t.createBuilder()
	if err != nil {
		return err
	}
	if builder == nil {
		return nil
	}

	if err := builder.PostLoad(); err != nil {
		log.Error().Str("task", t.childWorkflowName).Err(err).Msg("Error building for workflow postload")
		return fmt.Errorf("error building for workflow postload: %w", err)
	}

	return nil
}

func (t *ForTaskBuilder) createBuilder() (TaskBuilder, error) {
	if t.task.Do == nil || len(*t.task.Do) == 0 {
		log.Warn().Str("task", t.GetTaskName()).Msg("No do tasks detected in for task")
		return nil, nil
	}

	t.childWorkflowName = utils.GenerateChildWorkflowName("for", t.GetTaskName())

	builder, err := NewDoTaskBuilder(t.temporalWorker, &model.DoTask{Do: t.task.Do}, t.childWorkflowName, t.doc, DoTaskOpts{
		DisableRegisterWorkflow: true,
	})
	if err != nil {
		log.Error().Str("task", t.childWorkflowName).Err(err).Msg("Error creating the for task builder")
		return nil, fmt.Errorf("error creating the for task builder: %w", err)
	}

	return builder, nil
}

// parseConcurrencyConfig extracts T17 concurrency fields from the ForTask's
// metadata. The CNCF Serverless Workflow SDK model does not have native fields
// for max_parallelism/batch_size/on_error, so we read them from the task's
// "with" arguments passed via the ForTask's custom metadata.
func (t *ForTaskBuilder) parseConcurrencyConfig() {
	cfg := &forConcurrencyConfig{}

	// The ForTask from the CNCF SDK does not carry our custom fields natively.
	// In the proto→YAML→model pipeline, custom fields (max_parallelism, etc.)
	// are preserved in the ForTask's metadata map.
	if t.task.Metadata != nil {
		if v, ok := t.task.Metadata["max_parallelism"]; ok {
			if n, ok := toInt(v); ok {
				cfg.maxParallelism = n
			}
		}
		if v, ok := t.task.Metadata["batch_size"]; ok {
			if n, ok := toInt(v); ok {
				cfg.batchSize = n
			}
		}
		if v, ok := t.task.Metadata["on_error"]; ok {
			if s, ok := v.(string); ok {
				cfg.onError = parseForEachErrorPolicy(s)
			}
		}
	}

	// Also try parsing from the task's With map (for YAML that directly
	// sets these as top-level for: fields).
	if t.task.For.In != "" {
		raw := struct {
			MaxParallelism int    `json:"max_parallelism"`
			BatchSize      int    `json:"batch_size"`
			OnError        string `json:"on_error"`
		}{}

		if b, err := json.Marshal(t.task); err == nil {
			var taskMap map[string]any
			if json.Unmarshal(b, &taskMap) == nil {
				if forBlock, ok := taskMap["for"]; ok {
					if forBytes, err := json.Marshal(forBlock); err == nil {
						if json.Unmarshal(forBytes, &raw) == nil {
							if raw.MaxParallelism > 0 {
								cfg.maxParallelism = raw.MaxParallelism
							}
							if raw.BatchSize > 0 {
								cfg.batchSize = raw.BatchSize
							}
							if raw.OnError != "" {
								cfg.onError = parseForEachErrorPolicy(raw.OnError)
							}
						}
					}
				}
			}
		}
	}

	t.concurrencyConfig = cfg
}

func (t *ForTaskBuilder) exec() (TemporalWorkflowFunc, error) {
	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		logger := workflow.GetLogger(ctx)

		data, err := utils.EvaluateString(t.task.For.In, nil, state)
		if err != nil {
			logger.Error("Error parsing for task data list", "data", t.task.For.In, "task", t.GetTaskName())
			return nil, fmt.Errorf("error parsing for task data list: %w", err)
		}

		logger.Debug("For task evaluated data", "task", t.GetTaskName(), "data", data, "type", fmt.Sprintf("%T", data))

		items, err := t.toIterableSlice(data)
		if err != nil {
			logger.Error("For task data is not iterable", "task", t.GetTaskName(), "error", err)
			return nil, err
		}

		if t.concurrencyConfig.isParallel() {
			logger.Info("Executing for_each in parallel mode",
				"task", t.GetTaskName(),
				"items", len(items),
				"max_parallelism", t.concurrencyConfig.maxParallelism,
				"batch_size", t.concurrencyConfig.batchSize,
				"on_error", t.concurrencyConfig.onError.String())
			return t.executeParallel(ctx, items, state)
		}

		return t.executeSequential(ctx, items, state)
	}, nil
}

// toIterableSlice normalizes the evaluated data into a slice of {key, value} pairs.
func (t *ForTaskBuilder) toIterableSlice(data any) ([]iterItem, error) {
	switch v := data.(type) {
	case []any:
		items := make([]iterItem, len(v))
		for i, val := range v {
			items[i] = iterItem{key: i, value: val}
		}
		return items, nil
	case map[string]any:
		items := make([]iterItem, 0, len(v))
		for key, val := range v {
			items = append(items, iterItem{key: key, value: val})
		}
		return items, nil
	case int:
		items := make([]iterItem, v)
		for i := range v {
			items[i] = iterItem{key: i, value: i}
		}
		return items, nil
	default:
		return nil, fmt.Errorf("for task data is not iterable: expected map, array, or int, got %T: %v", data, data)
	}
}

type iterItem struct {
	key   any
	value any
}

type iterResult struct {
	index int
	data  any
	err   error
}

// executeSequential preserves the pre-T17 behavior exactly.
func (t *ForTaskBuilder) executeSequential(ctx workflow.Context, items []iterItem, state *utils.State) (any, error) {
	output := make([]any, 0, len(items))
	for _, item := range items {
		res, err := t.iterator(ctx, item.key, item.value, state.Clone().ClearOutput())
		if err != nil {
			if errors.Is(err, errForkIterationStop) {
				break
			}
			return nil, err
		}
		output = append(output, res)
	}
	return output, nil
}

// executeParallel runs iterations concurrently with bounded concurrency.
// Results are always reassembled in original input order.
func (t *ForTaskBuilder) executeParallel(ctx workflow.Context, items []iterItem, state *utils.State) (any, error) {
	logger := workflow.GetLogger(ctx)
	cfg := t.concurrencyConfig

	if cfg.batchSize > 0 {
		return t.executeBatched(ctx, items, state)
	}

	maxPar := cfg.maxParallelism
	if maxPar > len(items) {
		maxPar = len(items)
	}

	// Semaphore: buffered channel limits concurrent goroutines
	sem := workflow.NewChannel(ctx)
	resultCh := workflow.NewChannel(ctx)

	results := make([]any, len(items))
	var errs []error
	var mu sync.Mutex

	// Feeder: sends tokens into sem up to maxPar
	workflow.Go(ctx, func(gCtx workflow.Context) {
		for i := 0; i < len(items); i++ {
			sem.Send(gCtx, true)
		}
	})

	// Launch workers
	for idx, item := range items {
		i := idx
		it := item
		workflow.Go(ctx, func(gCtx workflow.Context) {
			// Acquire semaphore slot
			var token interface{}
			sem.Receive(gCtx, &token)

			res, err := t.iterator(gCtx, it.key, it.value, state.Clone().ClearOutput())
			resultCh.Send(gCtx, iterResult{index: i, data: res, err: err})
		})
	}

	// Collect results
	for collected := 0; collected < len(items); collected++ {
		var r iterResult
		resultCh.Receive(ctx, &r)

		mu.Lock()
		if r.err != nil {
			if errors.Is(r.err, errForkIterationStop) {
				mu.Unlock()
				continue
			}
			switch cfg.onError {
			case tasksv1.ForEachErrorPolicy_FOR_EACH_CONTINUE:
				errs = append(errs, fmt.Errorf("item %d: %w", r.index, r.err))
				results[r.index] = map[string]any{
					"__error": r.err.Error(),
					"__index": r.index,
				}
			case tasksv1.ForEachErrorPolicy_FOR_EACH_SKIP:
				results[r.index] = nil
			default:
				mu.Unlock()
				return nil, fmt.Errorf("for_each iteration %d failed: %w", r.index, r.err)
			}
		} else {
			results[r.index] = r.data
		}
		mu.Unlock()
	}

	// For SKIP policy, remove nil entries
	if cfg.onError == tasksv1.ForEachErrorPolicy_FOR_EACH_SKIP {
		filtered := make([]any, 0, len(results))
		for _, r := range results {
			if r != nil {
				filtered = append(filtered, r)
			}
		}
		results = filtered
	}

	if len(errs) > 0 {
		logger.Warn("for_each completed with errors (continue policy)",
			"task", t.GetTaskName(),
			"total", len(items),
			"errors", len(errs))
	}

	return results, nil
}

// executeBatched processes items in chunks, each chunk running in parallel.
func (t *ForTaskBuilder) executeBatched(ctx workflow.Context, items []iterItem, state *utils.State) (any, error) {
	logger := workflow.GetLogger(ctx)
	cfg := t.concurrencyConfig

	allResults := make([]any, 0, len(items))

	for batchStart := 0; batchStart < len(items); batchStart += cfg.batchSize {
		batchEnd := batchStart + cfg.batchSize
		if batchEnd > len(items) {
			batchEnd = len(items)
		}
		batch := items[batchStart:batchEnd]

		logger.Debug("Processing batch",
			"task", t.GetTaskName(),
			"batch_start", batchStart,
			"batch_size", len(batch))

		batchResults, err := t.executeParallelChunk(ctx, batch, state)
		if err != nil {
			return nil, fmt.Errorf("batch starting at %d failed: %w", batchStart, err)
		}

		allResults = append(allResults, batchResults...)
	}

	return allResults, nil
}

// executeParallelChunk runs a single chunk of items in parallel.
func (t *ForTaskBuilder) executeParallelChunk(ctx workflow.Context, items []iterItem, state *utils.State) ([]any, error) {
	cfg := t.concurrencyConfig

	maxPar := cfg.maxParallelism
	if maxPar > len(items) {
		maxPar = len(items)
	}

	sem := workflow.NewChannel(ctx)
	resultCh := workflow.NewChannel(ctx)

	results := make([]any, len(items))

	workflow.Go(ctx, func(gCtx workflow.Context) {
		for i := 0; i < len(items); i++ {
			sem.Send(gCtx, true)
		}
	})

	for idx, item := range items {
		i := idx
		it := item
		workflow.Go(ctx, func(gCtx workflow.Context) {
			var token interface{}
			sem.Receive(gCtx, &token)

			res, err := t.iterator(gCtx, it.key, it.value, state.Clone().ClearOutput())
			resultCh.Send(gCtx, iterResult{index: i, data: res, err: err})
		})
	}

	var errs []error
	for collected := 0; collected < len(items); collected++ {
		var r iterResult
		resultCh.Receive(ctx, &r)

		if r.err != nil {
			if errors.Is(r.err, errForkIterationStop) {
				continue
			}
			switch cfg.onError {
			case tasksv1.ForEachErrorPolicy_FOR_EACH_CONTINUE:
				errs = append(errs, fmt.Errorf("item %d: %w", r.index, r.err))
				results[r.index] = map[string]any{
					"__error": r.err.Error(),
					"__index": r.index,
				}
			case tasksv1.ForEachErrorPolicy_FOR_EACH_SKIP:
				results[r.index] = nil
			default:
				return nil, fmt.Errorf("for_each iteration %d failed: %w", r.index, r.err)
			}
		} else {
			results[r.index] = r.data
		}
	}

	if cfg.onError == tasksv1.ForEachErrorPolicy_FOR_EACH_SKIP {
		filtered := make([]any, 0, len(results))
		for _, r := range results {
			if r != nil {
				filtered = append(filtered, r)
			}
		}
		return filtered, nil
	}

	return results, nil
}

func (t *ForTaskBuilder) iterator(ctx workflow.Context, key, value any, state *utils.State) (any, error) {
	logger := workflow.GetLogger(ctx)

	keyVar := t.task.For.At
	if keyVar == "" {
		keyVar = "index"
	}
	valueVar := t.task.For.Each
	if valueVar == "" {
		valueVar = "item"
	}

	state.AddData(map[string]any{
		keyVar:   key,
		valueVar: value,
	})

	if shouldRun, err := t.checkWhile(ctx, state); err != nil {
		logger.Error("Error checking for while", "error", err, "key", key, "task", t.GetTaskName())
		return nil, fmt.Errorf("error checking for while: %w", err)
	} else if !shouldRun {
		logger.Debug("For while responded false - stopping iteration", "key", key, "task", t.GetTaskName())
		return nil, errForkIterationStop
	}

	logger.Debug("Executing for iteration inline", "key", key, "task", t.GetTaskName())

	var res any
	var err error

	if t.childWorkflowFunc != nil {
		res, err = t.childWorkflowFunc(ctx, state.Input, state)
	} else if t.childWorkflowName != "" {
		err = workflow.ExecuteChildWorkflow(ctx, t.childWorkflowName, state.Input, state).Get(ctx, &res)
	} else {
		return nil, fmt.Errorf("no child workflow function or name configured")
	}

	if err != nil {
		logger.Error("Error executing for iteration", "error", err, "key", key, "task", t.GetTaskName())
		return nil, fmt.Errorf("error executing for iteration: %w", err)
	}

	return res, nil
}

func (t *ForTaskBuilder) checkWhile(ctx workflow.Context, state *utils.State) (res bool, err error) {
	logger := workflow.GetLogger(ctx)
	logger.Debug("Checking the while response", "value", t.task.While, "task", t.GetTaskName())

	if t.task.While == "" {
		res = true
		return
	}

	whileRes, err := utils.EvaluateString(t.task.While, nil, state)
	if err != nil {
		logger.Error("Error parsing for task while", "data", t.task.While, "task", t.GetTaskName())
		err = fmt.Errorf("error parsing for task data list: %w", err)
		return
	}

	if v, ok := whileRes.(bool); ok {
		logger.Debug("Task while has resolved", "response", v)
		res = v
		return
	}

	logger.Warn("Task while has resolved to a non-boolean - responding with false", "response", whileRes)

	return
}

func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int32:
		return int(n), true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	case float32:
		return int(n), true
	default:
		return 0, false
	}
}

func parseForEachErrorPolicy(s string) tasksv1.ForEachErrorPolicy {
	if v, ok := tasksv1.ForEachErrorPolicy_value[s]; ok {
		return tasksv1.ForEachErrorPolicy(v)
	}
	return tasksv1.ForEachErrorPolicy_FOR_EACH_ERROR_POLICY_UNSPECIFIED
}

// normalizeEnumShorthandsForEach rewrites user-friendly enum values for
// for_each on_error to the full proto names. This is used during unmarshal.
func normalizeEnumShorthandsForEach(jsonBytes []byte) []byte {
	var m map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &m); err != nil {
		return jsonBytes
	}

	changed := false
	if v, ok := m["on_error"]; ok {
		if s, isStr := v.(string); isStr {
			switch s {
			case "fail_fast":
				m["on_error"] = "FOR_EACH_FAIL_FAST"
				changed = true
			case "continue":
				m["on_error"] = "FOR_EACH_CONTINUE"
				changed = true
			case "skip":
				m["on_error"] = "FOR_EACH_SKIP"
				changed = true
			}
		}
	}

	if !changed {
		return jsonBytes
	}

	out, err := json.Marshal(m)
	if err != nil {
		return jsonBytes
	}
	return out
}
