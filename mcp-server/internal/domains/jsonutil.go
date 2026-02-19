// Package domains contains shared utilities used by the domain tool packages.
package domains

import (
	"fmt"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// MarshalOptions controls how protobuf messages are serialized to JSON across
// all MCP tool responses. Using protojson rather than encoding/json ensures
// that proto field names are preserved and well-known types like Timestamp are
// rendered as RFC 3339 strings.
var MarshalOptions = protojson.MarshalOptions{
	Multiline:       true,
	Indent:          "  ",
	UseProtoNames:   true,
	EmitUnpopulated: false,
}

// UnmarshalOptions controls how JSON input from MCP tool calls is deserialized
// into protobuf messages. DiscardUnknown is true because AI clients may
// produce fields that don't exist in the current proto schema; rejecting them
// would make the tool unnecessarily brittle.
var UnmarshalOptions = protojson.UnmarshalOptions{
	DiscardUnknown: true,
}

// MarshalJSON serializes a protobuf message to a human-friendly JSON string
// suitable for MCP tool output.
func MarshalJSON(msg proto.Message) (string, error) {
	b, err := MarshalOptions.Marshal(msg)
	if err != nil {
		return "", fmt.Errorf("protojson marshal: %w", err)
	}
	return string(b), nil
}

// UnmarshalJSON deserializes a JSON string into a protobuf message.
// Unknown fields are silently discarded so that AI-generated JSON with extra
// keys does not cause errors.
func UnmarshalJSON(data string, msg proto.Message) error {
	if err := UnmarshalOptions.Unmarshal([]byte(data), msg); err != nil {
		return fmt.Errorf("protojson unmarshal: %w", err)
	}
	return nil
}
