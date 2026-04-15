// Package envfile provides parsing and merging of environment files
// for the stigmer run command. It supports the standard .env file format
// with comments, quoted values, and export prefix.
package envfile

import (
	"strconv"

	executioncontextv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/executioncontext/v1"
)

// EnvMap is a convenience type for environment variable maps.
type EnvMap = map[string]*executioncontextv1.ExecutionValue

// ParseError represents an error that occurred while parsing an env file.
type ParseError struct {
	File    string
	Line    int
	Message string
}

// Error implements the error interface.
func (e *ParseError) Error() string {
	if e.File != "" && e.Line > 0 {
		return "failed to parse " + e.File + " at line " + strconv.Itoa(e.Line) + ": " + e.Message
	}
	if e.File != "" {
		return "failed to parse " + e.File + ": " + e.Message
	}
	return e.Message
}
