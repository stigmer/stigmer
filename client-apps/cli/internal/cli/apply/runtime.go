// Package apply provides SDK synthesis execution for the stigmer apply command.
package apply

import (
	"fmt"
	"path/filepath"
	"strings"
)

// Runtime identifies the language runtime used to execute an SDK entry point.
//
// This is a CLI-local type that replaces the removed ProjectRuntime proto enum.
// The runtime is inferred from the entry_point file extension rather than being
// declared explicitly by the user.
type Runtime string

const (
	RuntimeGo     Runtime = "go"
	RuntimePython Runtime = "python"
	RuntimeNode   Runtime = "node"
)

// extensionToRuntime maps file extensions to their SDK runtime.
// Keep in sync with supportedEntryPointExtensions in project/validator.go.
var extensionToRuntime = map[string]Runtime{
	".go":  RuntimeGo,
	".py":  RuntimePython,
	".ts":  RuntimeNode,
	".js":  RuntimeNode,
	".mts": RuntimeNode,
	".mjs": RuntimeNode,
}

// InferRuntime determines the SDK runtime from an entry point's file extension.
// Returns an error with supported extensions listed if the extension is unrecognized.
func InferRuntime(entryPoint string) (Runtime, error) {
	ext := strings.ToLower(filepath.Ext(entryPoint))
	if rt, ok := extensionToRuntime[ext]; ok {
		return rt, nil
	}

	supported := make([]string, 0, len(extensionToRuntime))
	for ext := range extensionToRuntime {
		supported = append(supported, ext)
	}

	return "", fmt.Errorf(
		"cannot infer runtime from entry point %q (extension %q)\n\n"+
			"Supported extensions: %s",
		entryPoint, ext, strings.Join(supported, ", "),
	)
}
