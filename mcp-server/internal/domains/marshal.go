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

// MarshalJSON serializes a protobuf message to a human-friendly JSON string
// suitable for MCP tool output.
func MarshalJSON(msg proto.Message) (string, error) {
	b, err := MarshalOptions.Marshal(msg)
	if err != nil {
		return "", fmt.Errorf("protojson marshal: %w", err)
	}
	return string(b), nil
}
