package workflow

import (
	"fmt"
	"time"
)

const (
	// SDKLanguage is the programming language used for this workflow definition
	SDKLanguage = "go"

	// SDKVersion is the version of the Go SDK
	// TODO: Read from version file or embed during build
	SDKVersion = "0.1.0"

	// Annotation keys for SDK metadata
	AnnotationSDKLanguage    = "stigmer.ai/sdk.language"
	AnnotationSDKVersion     = "stigmer.ai/sdk.version"
	AnnotationSDKGeneratedAt = "stigmer.ai/sdk.generated-at"
)

// SDKAnnotations returns a map of SDK metadata annotations to be added to resource metadata.
//
// These annotations track that the resource was created by the Go SDK and when.
// The CLI and platform use these annotations for telemetry and debugging.
//
// Returns:
//
//	map[string]string{
//	    "stigmer.ai/sdk.language":    "go",
//	    "stigmer.ai/sdk.version":     "0.1.0",
//	    "stigmer.ai/sdk.generated-at": "1706789123",  // Unix timestamp
//	}
func SDKAnnotations() map[string]string {
	return map[string]string{
		AnnotationSDKLanguage:    SDKLanguage,
		AnnotationSDKVersion:     SDKVersion,
		AnnotationSDKGeneratedAt: fmt.Sprintf("%d", time.Now().Unix()),
	}
}

// MergeAnnotations merges SDK annotations with user-provided annotations.
//
// User annotations take precedence over SDK annotations if keys conflict
// (though users should never override SDK annotation keys).
//
// Example:
//
//	userAnnotations := map[string]string{
//	    "app.example.com/team": "backend",
//	    "app.example.com/env":  "prod",
//	}
//	allAnnotations := workflow.MergeAnnotations(userAnnotations)
//	// Returns: user annotations + SDK annotations
func MergeAnnotations(userAnnotations map[string]string) map[string]string {
	result := SDKAnnotations()
	for k, v := range userAnnotations {
		result[k] = v
	}
	return result
}
