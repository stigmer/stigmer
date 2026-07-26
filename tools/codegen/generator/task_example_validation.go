package main

import (
	"encoding/json"
	"fmt"
	"strings"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	// Blank import registers the per-kind task config message types
	// (WaitTaskConfig, LlmCallTaskConfig, ...) in protoregistry.GlobalTypes,
	// so validateSidecarExamples can resolve them dynamically from
	// TaskConfigSchema.ProtoType without a hand-maintained kind switch.
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"gopkg.in/yaml.v3"
)

// validateSidecarExamples verifies every yaml_examples entry in the task
// sidecar metadata against the task's typed proto config, using the same
// strict protojson decoding the platform applies when a workflow is created,
// updated, or validated (see unmarshalTaskConfig in
// backend/services/stigmer-server/pkg/domain/workflow/converter/unmarshal.go).
//
// Examples must be written in the authoring form users put under spec.tasks:
//
//	- name: classify_ticket
//	  kind: llm_call
//	  task_config:
//	    model: "gpt-4o-mini"
//
// and NOT in the internal CNCF Serverless Workflow DSL form that the platform
// generates for the runner (`- taskName: { call: llm, with: ... }`). Sidecar
// examples flow verbatim onto the generated docs pages, into
// task-kind-registry.json (embedded in stigmer-server), and into the console
// workflow inspector's Docs tab — every surface that teaches users how to
// author tasks — so an example the platform would reject must fail generation.
//
// The check is deliberately at least as strict as the platform: it does not
// replicate the backend's normalizeEnumShorthands, so enum values in examples
// must use their full proto names. An example this check accepts is one the
// platform accepts; the reverse is not guaranteed, which is the safe direction
// for documentation.
func validateSidecarExamples(schemas []*TaskConfigSchema, sidecars map[string]*SidecarMeta) error {
	var problems []string

	for _, schema := range schemas {
		kind := taskDocsKindString(schema)
		meta := sidecars[kind]
		if meta == nil || len(meta.YamlExamples) == 0 {
			continue
		}

		mt, err := protoregistry.GlobalTypes.FindMessageByName(protoreflect.FullName(schema.ProtoType))
		if err != nil {
			problems = append(problems, fmt.Sprintf(
				"%s: cannot resolve proto message %q (is the stubs package imported?): %v",
				kind, schema.ProtoType, err))
			continue
		}

		for i, example := range meta.YamlExamples {
			if err := validateTaskExample(example, kind, mt); err != nil {
				problems = append(problems, fmt.Sprintf("%s example %d: %v", kind, i+1, err))
			}
		}
	}

	if len(problems) == 0 {
		return nil
	}

	return fmt.Errorf(
		"task sidecar example validation failed (%d problem(s)):\n  - %s\n\n"+
			"yaml_examples must use the authoring form users write under spec.tasks:\n"+
			"  - name: <task_name>\n"+
			"    kind: <kind>\n"+
			"    task_config:\n"+
			"      <task_config fields>\n"+
			"not the internal DSL form (- taskName: { call/set/wait: ... }) that the\n"+
			"platform generates for the runner.\n"+
			"Fix the example in apis/ai/stigmer/agentic/workflow/v1/tasks/meta/<kind>.yaml",
		len(problems), strings.Join(problems, "\n  - "))
}

// validateTaskExample checks one yaml_examples entry: a YAML list of
// authoring-form task entries, each of which must strictly decode as a
// WorkflowTask whose kind matches the sidecar and whose task_config strictly
// decodes as the task's typed config message.
func validateTaskExample(exampleYAML, expectedKind string, configType protoreflect.MessageType) error {
	var entries []map[string]interface{}
	if err := yaml.Unmarshal([]byte(exampleYAML), &entries); err != nil {
		return fmt.Errorf("not a YAML list of task entries: %v", err)
	}
	if len(entries) == 0 {
		return fmt.Errorf("example contains no task entries")
	}

	for i, entry := range entries {
		if err := validateTaskEntry(entry, expectedKind, configType); err != nil {
			if len(entries) == 1 {
				return err
			}
			return fmt.Errorf("task entry %d: %v", i+1, err)
		}
	}
	return nil
}

func validateTaskEntry(entry map[string]interface{}, expectedKind string, configType protoreflect.MessageType) error {
	jsonBytes, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("cannot convert entry to JSON: %v", err)
	}

	// Stage 1: the entry itself must be an authoring-form task. The internal
	// DSL form ({ taskName: { call: ..., with: ... } }) fails here because
	// its single map key is not a WorkflowTask field.
	task := &workflowv1.WorkflowTask{}
	if err := protojson.Unmarshal(jsonBytes, task); err != nil {
		return fmt.Errorf("does not parse as an authoring-form task (name/kind/task_config): %v", err)
	}
	if task.Name == "" {
		return fmt.Errorf("task name is required")
	}
	if got := task.Kind.String(); got != expectedKind {
		return fmt.Errorf("kind is %q, want %q", got, expectedKind)
	}
	if task.TaskConfig == nil {
		return fmt.Errorf("task_config is required")
	}

	// Stage 2: task_config is a Struct at the WorkflowTask level (so stage 1
	// accepts any shape inside it); decode it into the typed config message
	// with protojson's default strictness, exactly as the platform does.
	cfgJSON, err := task.TaskConfig.MarshalJSON()
	if err != nil {
		return fmt.Errorf("cannot re-marshal task_config: %v", err)
	}
	msg := configType.New().Interface()
	if err := protojson.Unmarshal(cfgJSON, msg); err != nil {
		return fmt.Errorf("task_config is not a valid %s: %v", configType.Descriptor().FullName(), err)
	}
	return nil
}
