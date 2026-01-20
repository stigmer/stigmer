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
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/serverlessworkflow/sdk-go/v3/model"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

func init() {
	activitiesRegistry = append(activitiesRegistry, &RunActivities{})
}

type RunActivities struct{}

func (r *RunActivities) CallScriptActivity(ctx context.Context, task *model.RunTask, input any, runtimeEnv map[string]any) (any, error) {
	command := make([]string, 0)
	var file string

	logger := activity.GetLogger(ctx)
	logger.Debug("Running call script activity")

	// **CRITICAL SECURITY**: Resolve runtime placeholders just-in-time (JIT)
	// This ensures secrets in script arguments and environment variables are resolved
	// at execution time, not stored in Temporal history.
	if runtimeEnv != nil && len(runtimeEnv) > 0 {
		logger.Debug("Resolving runtime placeholders in script task", "env_count", len(runtimeEnv))
		
		resolvedInterface, err := ResolveObject(task, runtimeEnv)
		if err != nil {
			logger.Error("Failed to resolve runtime placeholders", "error", err)
			return nil, fmt.Errorf("failed to resolve runtime placeholders: %w", err)
		}
		
		var ok bool
		task, ok = resolvedInterface.(*model.RunTask)
		if !ok {
			logger.Error("Type assertion failed after runtime resolution")
			return nil, fmt.Errorf("type assertion failed after runtime resolution")
		}
		
		logger.Debug("Runtime placeholders resolved successfully")
	}

	logger.Debug("Creating temporary directory")
	dir, err := os.MkdirTemp("", "script")
	if err != nil {
		logger.Error("Error making temp dir", "error", err)
		return nil, fmt.Errorf("error making temp dir: %w", err)
	}
	defer func() {
		if err := os.RemoveAll(dir); err != nil {
			logger.Warn("Generated script not deleted", "dir", dir, "error", err)
		}
	}()

	lang := task.Run.Script.Language
	logger.Debug("Detecting script language", "language", lang)
	switch lang {
	case "js":
		command = append(command, "node")
		file = "script.js"
	case "python":
		command = append(command, "python")
		file = "script.py"
	default:
		logger.Error("Unknown script language", "language", lang)
		return nil, fmt.Errorf("unknown script language: %s", lang)
	}

	fname := filepath.Join(dir, file)
	logger.Debug("Writing script to disk", "file", fname)
	command = append(command, fname)
	if err := os.WriteFile(fname, []byte(*task.Run.Script.InlineCode), 0o600); err != nil {
		logger.Error("Error writing script to disk", "file", fname, "error", err)
		return nil, fmt.Errorf("error writing code to script: %w", err)
	}

	result, err := r.runExecCommand(
		ctx,
		command,
		task.Run.Script.Arguments,
		task.Run.Script.Environment,
		dir,
	)
	
	if err != nil {
		return nil, err
	}
	
	// **SECURITY**: Sanitize output for potential secret leakage
	if runtimeEnv != nil && len(runtimeEnv) > 0 {
		warnings := SanitizeOutput(result, runtimeEnv)
		for _, warning := range warnings {
			logger.Warn("Potential secret leakage detected in script output", "warning", warning)
		}
	}
	
	return result, nil
}

func (r *RunActivities) CallShellActivity(ctx context.Context, task *model.RunTask, input any, runtimeEnv map[string]any) (any, error) {
	logger := activity.GetLogger(ctx)
	logger.Debug("Running call shell activity")

	// **CRITICAL SECURITY**: Resolve runtime placeholders just-in-time (JIT)
	// This ensures secrets in shell command, arguments, and environment variables
	// are resolved at execution time, not stored in Temporal history.
	if runtimeEnv != nil && len(runtimeEnv) > 0 {
		logger.Debug("Resolving runtime placeholders in shell task", "env_count", len(runtimeEnv))
		
		resolvedInterface, err := ResolveObject(task, runtimeEnv)
		if err != nil {
			logger.Error("Failed to resolve runtime placeholders", "error", err)
			return nil, fmt.Errorf("failed to resolve runtime placeholders: %w", err)
		}
		
		var ok bool
		task, ok = resolvedInterface.(*model.RunTask)
		if !ok {
			logger.Error("Type assertion failed after runtime resolution")
			return nil, fmt.Errorf("type assertion failed after runtime resolution")
		}
		
		logger.Debug("Runtime placeholders resolved successfully")
	}

	result, err := r.runExecCommand(
		ctx,
		[]string{task.Run.Shell.Command},
		task.Run.Shell.Arguments,
		task.Run.Shell.Environment,
		"",
	)
	
	if err != nil {
		return nil, err
	}
	
	// **SECURITY**: Sanitize output for potential secret leakage
	if runtimeEnv != nil && len(runtimeEnv) > 0 {
		warnings := SanitizeOutput(result, runtimeEnv)
		for _, warning := range warnings {
			logger.Warn("Potential secret leakage detected in shell output", "warning", warning)
		}
	}
	
	return result, nil
}

// runExecCommand a general purpose function to build and execute a command in an activity
func (r *RunActivities) runExecCommand(
	ctx context.Context,
	command []string,
	args *model.RunArguments,
	env map[string]string,
	dir string,
) (any, error) {
	logger := activity.GetLogger(ctx)

	if args == nil {
		args = &model.RunArguments{}
	}
	if env == nil {
		env = map[string]string{}
	}

	// Arguments are already evaluated in workflow context
	// Cast the arg to a string
	for _, v := range args.AsSlice() {
		command = append(command, fmt.Sprintf("%v", v))
	}

	envvars := os.Environ()
	for k, v := range env {
		envvars = append(envvars, fmt.Sprintf("%s=%v", k, v))
	}

	var stderr bytes.Buffer
	var stdout bytes.Buffer
	//nolint:gosec // Allow dynamic commands
	cmd := exec.CommandContext(ctx, command[0], command[1:]...)
	cmd.Env = envvars
	cmd.Stderr = &stderr
	cmd.Stdout = &stdout

	if dir != "" {
		cmd.Dir = dir
	}

	logger.Info("Running command on worker", "command", command)
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			// The command received an exit code above 0 - return as-is
			logger.Error("Shell error",
				"error", err,
				"command", command,
				"stderr", r.stdToString(stdout),
				"stdout", r.stdToString(stdout),
			)
			return nil, temporal.NewApplicationErrorWithCause(
				"Error calling command",
				"command",
				exitErr,
				map[string]any{
					"command": command,
					"stderr":  r.stdToString(stderr),
					"stdout":  r.stdToString(stdout),
				},
			)
		}
		logger.Error("Error running command", "error", err)
		return nil, fmt.Errorf("error running command: %w", err)
	}

	return r.stdToString(stdout), nil
}

func (r *RunActivities) stdToString(std bytes.Buffer) string {
	return strings.TrimSpace(std.String())
}
