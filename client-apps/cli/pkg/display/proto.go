package display

import (
	"fmt"
	"io"
	"os"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"gopkg.in/yaml.v3"
)

var protoMarshalOptions = protojson.MarshalOptions{
	Indent:          "  ",
	UseProtoNames:   true,
	EmitUnpopulated: false,
}

// RenderProtoJSON marshals a proto message as pretty-printed JSON and writes
// it to w followed by a newline. The marshaling options are consistent across
// all CLI display paths (proto field names, 2-space indent, no unpopulated).
func RenderProtoJSON(w io.Writer, msg proto.Message) error {
	jsonBytes, err := protoMarshalOptions.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal to JSON: %w", err)
	}
	_, err = fmt.Fprintln(w, string(jsonBytes))
	return err
}

// RenderProtoYAML marshals a proto message as YAML and writes it to w.
// It round-trips through JSON (via protojson) to respect proto field naming
// conventions, then converts to YAML for human-friendly output.
func RenderProtoYAML(w io.Writer, msg proto.Message) error {
	jsonBytes, err := protoMarshalOptions.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal to JSON: %w", err)
	}

	var intermediate map[string]interface{}
	if err := yaml.Unmarshal(jsonBytes, &intermediate); err != nil {
		return fmt.Errorf("failed to parse JSON for YAML conversion: %w", err)
	}

	yamlBytes, err := yaml.Marshal(intermediate)
	if err != nil {
		return fmt.Errorf("failed to marshal to YAML: %w", err)
	}
	_, err = fmt.Fprint(w, string(yamlBytes))
	return err
}

// DisplayProto is a convenience dispatcher for the standard get/list display
// pattern. For "yaml" and "json" formats it renders the proto message to
// stdout using the shared marshaling utilities. For any other format
// (including the default "table") it delegates to tableFunc.
//
// Marshaling errors are written to stderr. This function intentionally does
// not return an error — it matches the fire-and-forget signature used by
// all DisplayGetResult / DisplayListResult functions.
func DisplayProto(msg proto.Message, format string, tableFunc func()) {
	switch format {
	case "yaml":
		if err := RenderProtoYAML(os.Stdout, msg); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		}
	case "json":
		if err := RenderProtoJSON(os.Stdout, msg); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		}
	default:
		tableFunc()
	}
}
