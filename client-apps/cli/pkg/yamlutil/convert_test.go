package yamlutil

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMapToJSON_StringKeys(t *testing.T) {
	input := map[string]interface{}{
		"name":    "test",
		"version": 1,
		"nested": map[string]interface{}{
			"key": "value",
		},
	}

	data, err := MapToJSON(input)
	require.NoError(t, err)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &result))
	assert.Equal(t, "test", result["name"])
	assert.Equal(t, float64(1), result["version"])
	assert.Equal(t, "value", result["nested"].(map[string]interface{})["key"])
}

func TestMapToJSON_InterfaceKeys(t *testing.T) {
	input := map[string]interface{}{
		"outer": map[interface{}]interface{}{
			"inner_key": "inner_value",
			42:          "numeric_key",
		},
	}

	data, err := MapToJSON(input)
	require.NoError(t, err)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &result))
	outer := result["outer"].(map[string]interface{})
	assert.Equal(t, "inner_value", outer["inner_key"])
	assert.Equal(t, "numeric_key", outer["42"])
}

func TestMapToJSON_Slices(t *testing.T) {
	input := map[string]interface{}{
		"items": []interface{}{
			"a",
			map[string]interface{}{"nested": true},
			map[interface{}]interface{}{"yaml_key": "yaml_val"},
		},
	}

	data, err := MapToJSON(input)
	require.NoError(t, err)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &result))
	items := result["items"].([]interface{})
	assert.Len(t, items, 3)
	assert.Equal(t, "a", items[0])
	assert.Equal(t, true, items[1].(map[string]interface{})["nested"])
	assert.Equal(t, "yaml_val", items[2].(map[string]interface{})["yaml_key"])
}

func TestMapToJSON_Empty(t *testing.T) {
	data, err := MapToJSON(map[string]interface{}{})
	require.NoError(t, err)
	assert.Equal(t, "{}", string(data))
}

func TestConvertValue_Primitives(t *testing.T) {
	assert.Equal(t, "hello", ConvertValue("hello"))
	assert.Equal(t, 42, ConvertValue(42))
	assert.Equal(t, true, ConvertValue(true))
	assert.Nil(t, ConvertValue(nil))
	assert.Equal(t, 3.14, ConvertValue(3.14))
}

func TestConvertValue_DeeplyNested(t *testing.T) {
	input := map[interface{}]interface{}{
		"level1": map[interface{}]interface{}{
			"level2": map[interface{}]interface{}{
				"value": "deep",
			},
		},
	}

	result := ConvertValue(input).(map[string]interface{})
	l1 := result["level1"].(map[string]interface{})
	l2 := l1["level2"].(map[string]interface{})
	assert.Equal(t, "deep", l2["value"])
}
