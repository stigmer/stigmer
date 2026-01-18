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

package validation

import (
	"fmt"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// MarshalTaskConfig marshals a typed proto message to google.protobuf.Struct.
//
// This is the reverse of UnmarshalTaskConfig and is useful for:
// - Testing (construct typed proto, marshal to Struct)
// - SDK synthesis (convert Go structs to Struct)
// - Any scenario where you have typed proto and need generic Struct
//
// The marshaling process:
// 1. Marshal typed proto to JSON (using protojson)
// 2. Unmarshal JSON to google.protobuf.Struct
//
// This ensures proto field names (snake_case) are preserved in the Struct.
//
// Example:
//
//	httpConfig := &tasks.HttpCallTaskConfig{
//	    Method: tasks.HttpMethod_HTTP_METHOD_GET,
//	    Endpoint: &tasks.HttpEndpoint{Uri: "https://api.com"},
//	    TimeoutSeconds: 30,
//	}
//	taskConfig, err := MarshalTaskConfig(httpConfig)
//	if err != nil {
//	    return fmt.Errorf("failed to marshal: %w", err)
//	}
//	// taskConfig is now google.protobuf.Struct with proto field names
func MarshalTaskConfig(typed proto.Message) (*structpb.Struct, error) {
	if typed == nil {
		return nil, fmt.Errorf("typed proto cannot be nil")
	}

	// Marshal proto to JSON bytes (preserves proto field names)
	jsonBytes, err := protojson.Marshal(typed)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal proto to JSON: %w", err)
	}

	// Unmarshal JSON to Struct
	var result structpb.Struct
	if err := protojson.Unmarshal(jsonBytes, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON to Struct: %w", err)
	}

	return &result, nil
}
