// Package yamlutil provides utilities for converting YAML-decoded data
// structures to JSON-compatible formats suitable for protojson unmarshaling.
//
// Go's yaml.v3 decoder produces map[string]interface{} for mappings, but
// older YAML libraries and certain edge cases produce map[interface{}]interface{}.
// JSON marshaling requires map[string]interface{} keys exclusively.
// This package handles the recursive conversion.
package yamlutil

import (
	"encoding/json"
	"fmt"
)

// MapToJSON converts a YAML-decoded map to JSON bytes.
// It recursively converts any map[interface{}]interface{} nodes
// (produced by some YAML decoders) to map[string]interface{} so
// the result is valid for json.Marshal.
func MapToJSON(m map[string]interface{}) ([]byte, error) {
	converted := ConvertValue(m)
	return json.Marshal(converted)
}

// ConvertValue recursively converts YAML values to JSON-compatible values.
// Specifically, it handles:
//   - map[interface{}]interface{} -> map[string]interface{} (YAML-specific key types)
//   - map[string]interface{} -> recursively converted copy
//   - []interface{} -> recursively converted copy
//   - all other types pass through unchanged
func ConvertValue(v interface{}) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		result := make(map[string]interface{}, len(val))
		for k, v := range val {
			result[k] = ConvertValue(v)
		}
		return result
	case map[interface{}]interface{}:
		result := make(map[string]interface{}, len(val))
		for k, v := range val {
			result[fmt.Sprintf("%v", k)] = ConvertValue(v)
		}
		return result
	case []interface{}:
		result := make([]interface{}, len(val))
		for i, v := range val {
			result[i] = ConvertValue(v)
		}
		return result
	default:
		return val
	}
}
