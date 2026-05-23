package validation

import (
	"fmt"
	"strings"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// CheckExpressionWarnings scans all task configs for expressions that reference
// $context.env.* which is a common authoring mistake. Environment variables are
// accessed via $env.*, not $context.env.* ($context holds accumulated exported
// task outputs, not environment variables).
func CheckExpressionWarnings(spec *workflowv1.WorkflowSpec) []string {
	if spec == nil || len(spec.Tasks) == 0 {
		return nil
	}

	var warnings []string

	for _, task := range spec.Tasks {
		config := task.GetTaskConfig()
		if config == nil {
			continue
		}

		hits := findContextEnvRefs(config)
		for _, hit := range hits {
			envKey := hit
			warnings = append(warnings, fmt.Sprintf(
				"task '%s': expression references '$context.env.%s' which resolves to null. "+
					"Environment variables are accessed via '$env.%s', not '$context.env.%s'. "+
					"$context holds accumulated task outputs, not environment variables.",
				task.Name, envKey, envKey, envKey,
			))
		}
	}

	return warnings
}

// findContextEnvRefs scans a Struct value for strings containing "$context.env.".
// Returns the env key names referenced (e.g., "NOTIFICATION_DATE").
func findContextEnvRefs(s *structpb.Struct) []string {
	if s == nil {
		return nil
	}
	var keys []string
	for _, v := range s.Fields {
		keys = append(keys, findContextEnvRefsInValue(v)...)
	}
	return keys
}

func findContextEnvRefsInValue(v *structpb.Value) []string {
	if v == nil {
		return nil
	}

	switch k := v.GetKind().(type) {
	case *structpb.Value_StringValue:
		return extractContextEnvKeys(k.StringValue)
	case *structpb.Value_StructValue:
		return findContextEnvRefs(k.StructValue)
	case *structpb.Value_ListValue:
		var keys []string
		for _, elem := range k.ListValue.GetValues() {
			keys = append(keys, findContextEnvRefsInValue(elem)...)
		}
		return keys
	default:
		return nil
	}
}

// extractContextEnvKeys extracts env key names from expressions like
// "${ $context.env.NOTIFICATION_DATE }".
func extractContextEnvKeys(s string) []string {
	const pattern = "$context.env."
	var keys []string

	for {
		idx := strings.Index(s, pattern)
		if idx < 0 {
			break
		}
		rest := s[idx+len(pattern):]
		keyEnd := 0
		for keyEnd < len(rest) && isEnvKeyChar(rest[keyEnd]) {
			keyEnd++
		}
		if keyEnd > 0 {
			keys = append(keys, rest[:keyEnd])
		}
		s = rest[keyEnd:]
	}

	return keys
}

func isEnvKeyChar(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_'
}
