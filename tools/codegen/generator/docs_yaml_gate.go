package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	descriptorpb "google.golang.org/protobuf/types/descriptorpb"
	"gopkg.in/yaml.v3"

	validate "buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go/buf/validate"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"

	// The docs YAML gate resolves every proto message dynamically from
	// protoregistry.GlobalTypes, so each resource package whose manifests may
	// appear in docs must be linked in. A missing import here means the gate
	// reports "unknown kind" for that resource; the registry completeness
	// test (TestDocsYamlManifestRegistryCompleteness) fails loudly when a
	// kind_meta-registered kind has no linked message, so this list cannot
	// silently rot.
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/artifact/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/apikey/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityaccount/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityprovider/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/invitation/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/platformclient/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	_ "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/project/v1"
)

// The docs YAML gate validates every ```yaml code fence under docs/ against
// the proto contract, applying the same strict protojson decoding the
// platform applies to user manifests (see marshalItem in
// client-apps/cli/src/resources/apply/apply.ts and unmarshalTaskConfig in
// backend/services/stigmer-server/pkg/domain/workflow/converter/unmarshal.go).
//
// Every block must fall into exactly one of four classes:
//
//  1. Manifest — the document root has apiVersion/kind. Strictly decoded into
//     the resource message resolved from the kind, then every Struct field
//     marked (apiresource.discriminated_by) is decoded into its typed variant
//     message, recursively.
//  2. Task list — a YAML list of authoring-form tasks (name/kind/task_config)
//     whose kinds are workflow task kinds. Same validation as sidecar
//     yaml_examples (task_example_validation.go), plus recursion into nested
//     tasks (fork branches, for_each bodies, ...).
//  3. Anchored fragment — the fence carries validate-as="<anchor>" in its
//     info string, naming the message the fragment is a partial instance of:
//     a resource kind with an optional field path ("Workflow.spec"), the
//     authoring task itself ("task", for export/flow snippets), or a typed
//     task config ("task-config:llm_call", for config snippets). The body is
//     strictly decoded as that message; absent fields are fine, unknown or
//     misshapen fields are not.
//  4. Explicitly skipped — the fence carries no-validate="reason", for the
//     rare block that is not resource YAML at all (e.g. docs-page
//     frontmatter examples).
//
// Anything else fails the build. That ratchet is the point: no YAML shown to
// users can be silently unvalidated.
//
// Like the sidecar gate, this check is deliberately at least as strict as the
// platform (it does not replicate the backend's normalizeEnumShorthands, so
// enum values must use full proto names). A block this gate accepts is one
// the platform accepts; the reverse is not guaranteed, which is the safe
// direction for documentation.

// noValidateMarkerPattern matches the skip marker in a fence info string:
// ```yaml no-validate="reason". The reason is mandatory — an unexplained
// skip is indistinguishable from a forgotten one.
var noValidateMarkerPattern = regexp.MustCompile(`no-validate="([^"]*)"`)

// validateAsMarkerPattern matches the fragment anchor in a fence info string:
// ```yaml validate-as="Workflow.spec".
var validateAsMarkerPattern = regexp.MustCompile(`validate-as="([^"]*)"`)

// docsYamlRegistries holds the lookup tables the gate derives from proto
// descriptors at startup. Nothing here is hand-maintained: manifest kinds
// come from the protovalidate string.const pinned on every resource's
// kind/api_version fields, and variant types come from the
// (apiresource.discriminator_value) message option.
type docsYamlRegistries struct {
	// manifestKinds maps the YAML `kind:` string (e.g. "Workflow") to its
	// resource message type and the pinned apiVersion.
	manifestKinds map[string]manifestKindInfo
	// variantTypes maps a discriminator value (e.g. "wait") to the typed
	// config message for that variant (e.g. WaitTaskConfig).
	variantTypes map[string]protoreflect.MessageType
	// rules is the optional protovalidate pass (--rules flag); nil when off.
	// Every method on it is nil-safe, so validators call it unconditionally.
	// See docs_yaml_rules.go for the mode semantics and the #305 background.
	rules *docsYamlRuleEval
}

type manifestKindInfo struct {
	msgType    protoreflect.MessageType
	apiVersion string
}

// buildDocsYamlRegistries scans every linked proto message. Duplicate
// discriminator values would make variant resolution ambiguous, so they fail
// construction; if a second discriminated union with overlapping values ever
// appears, resolution must become union-scoped before this gate can support it.
func buildDocsYamlRegistries() (*docsYamlRegistries, error) {
	reg := &docsYamlRegistries{
		manifestKinds: make(map[string]manifestKindInfo),
		variantTypes:  make(map[string]protoreflect.MessageType),
	}

	var buildErr error
	protoregistry.GlobalTypes.RangeMessages(func(mt protoreflect.MessageType) bool {
		desc := mt.Descriptor()

		if dv := messageDiscriminatorValue(desc); dv != "" {
			if existing, dup := reg.variantTypes[dv]; dup {
				buildErr = fmt.Errorf(
					"discriminator value %q is claimed by both %s and %s; variant resolution must become union-scoped",
					dv, existing.Descriptor().FullName(), desc.FullName())
				return false
			}
			reg.variantTypes[dv] = mt
		}

		kindConst := fieldStringConst(desc.Fields().ByName("kind"))
		apiConst := fieldStringConst(desc.Fields().ByName("api_version"))
		if kindConst != "" && apiConst != "" {
			if existing, dup := reg.manifestKinds[kindConst]; dup {
				buildErr = fmt.Errorf("manifest kind %q is claimed by both %s and %s",
					kindConst, existing.msgType.Descriptor().FullName(), desc.FullName())
				return false
			}
			reg.manifestKinds[kindConst] = manifestKindInfo{msgType: mt, apiVersion: apiConst}
		}
		return true
	})
	if buildErr != nil {
		return nil, buildErr
	}
	if len(reg.manifestKinds) == 0 || len(reg.variantTypes) == 0 {
		return nil, fmt.Errorf(
			"descriptor scan found %d manifest kinds and %d variant types; are the resource stub packages imported?",
			len(reg.manifestKinds), len(reg.variantTypes))
	}
	return reg, nil
}

// fieldStringConst returns the protovalidate (buf.validate.field).string.const
// pinned on fd, or "" when absent. Resource protos pin kind and api_version
// this way, which is what makes the manifest registry derivable.
func fieldStringConst(fd protoreflect.FieldDescriptor) string {
	if fd == nil || fd.Kind() != protoreflect.StringKind {
		return ""
	}
	opts, ok := fd.Options().(*descriptorpb.FieldOptions)
	if !ok || opts == nil || !proto.HasExtension(opts, validate.E_Field) {
		return ""
	}
	rules, ok := proto.GetExtension(opts, validate.E_Field).(*validate.FieldRules)
	if !ok || rules == nil {
		return ""
	}
	return rules.GetString().GetConst()
}

// messageDiscriminatorValue returns the (apiresource.discriminator_value)
// message option, or "" when absent.
func messageDiscriminatorValue(desc protoreflect.MessageDescriptor) string {
	opts, ok := desc.Options().(*descriptorpb.MessageOptions)
	if !ok || opts == nil || !proto.HasExtension(opts, apiresource.E_DiscriminatorValue) {
		return ""
	}
	dv, _ := proto.GetExtension(opts, apiresource.E_DiscriminatorValue).(string)
	return dv
}

// fieldDiscriminatedBy returns the (apiresource.discriminated_by) field
// option — the name of the sibling field acting as the discriminator — or ""
// when absent.
func fieldDiscriminatedBy(fd protoreflect.FieldDescriptor) string {
	opts, ok := fd.Options().(*descriptorpb.FieldOptions)
	if !ok || opts == nil || !proto.HasExtension(opts, apiresource.E_DiscriminatedBy) {
		return ""
	}
	db, _ := proto.GetExtension(opts, apiresource.E_DiscriminatedBy).(string)
	return db
}

// ============================================================================
// Validation
// ============================================================================

// validateManifestDoc validates one YAML document that carries apiVersion:
// resolve the message type from kind, check apiVersion against the pinned
// const, strictly protojson-decode the whole document, then recurse into
// discriminated Struct fields.
func validateManifestDoc(doc map[string]interface{}, reg *docsYamlRegistries) []string {
	kindStr, _ := doc["kind"].(string)
	if kindStr == "" {
		return []string{"manifest has apiVersion but no kind"}
	}
	info, ok := reg.manifestKinds[kindStr]
	if !ok {
		return []string{fmt.Sprintf("unknown resource kind %q%s (known kinds: %s)",
			kindStr, didYouMean(kindStr, sortedKeys(reg.manifestKinds)),
			strings.Join(sortedKeys(reg.manifestKinds), ", "))}
	}

	var problems []string
	if apiV, _ := doc["apiVersion"].(string); apiV != info.apiVersion {
		problems = append(problems, fmt.Sprintf("%s manifest: apiVersion is %q, want %q", kindStr, apiV, info.apiVersion))
	}

	jsonBytes, err := json.Marshal(doc)
	if err != nil {
		return append(problems, fmt.Sprintf("cannot convert %s manifest to JSON: %v", kindStr, err))
	}
	msg := info.msgType.New().Interface()
	if err := protojson.Unmarshal(jsonBytes, msg); err != nil {
		return append(problems, fmt.Sprintf("%s manifest does not validate against %s: %v",
			kindStr, info.msgType.Descriptor().FullName(), err))
	}
	problems = append(problems, reg.rules.evaluate(msg, kindStr)...)
	return append(problems, validateDiscriminatedStructs(msg.ProtoReflect(), reg, kindStr)...)
}

// validateAuthoringTaskEntry validates one entry of an authoring-form task
// list: strict decode as WorkflowTask (the internal DSL form fails here
// because its single map key is not a WorkflowTask field), presence checks
// matching the platform contract, then discriminated-Struct recursion, which
// decodes task_config into the typed per-kind config and keeps descending
// into nested tasks (fork branches, for_each bodies, ...).
func validateAuthoringTaskEntry(entry map[string]interface{}, reg *docsYamlRegistries) []string {
	jsonBytes, err := json.Marshal(entry)
	if err != nil {
		return []string{fmt.Sprintf("cannot convert task entry to JSON: %v", err)}
	}
	task := &workflowv1.WorkflowTask{}
	if err := protojson.Unmarshal(jsonBytes, task); err != nil {
		return []string{fmt.Sprintf("does not parse as an authoring-form task (name/kind/task_config): %v", err)}
	}
	if task.Name == "" {
		return []string{"task name is required"}
	}
	if task.TaskConfig == nil {
		return []string{fmt.Sprintf("task %q: task_config is required", task.Name)}
	}
	at := fmt.Sprintf("task %q", task.Name)
	problems := reg.rules.evaluate(task, at)
	return append(problems, validateDiscriminatedStructs(task.ProtoReflect(), reg, at)...)
}

// validateDiscriminatedStructs walks a decoded message tree. For every
// populated google.protobuf.Struct field marked (apiresource.discriminated_by)
// it resolves the typed variant from the sibling discriminator field, strictly
// decodes the Struct contents into it, and recurses into the decoded variant —
// so garbage inside task_config is caught at any nesting depth, which plain
// strict decoding of the parent cannot do (a Struct accepts anything).
func validateDiscriminatedStructs(m protoreflect.Message, reg *docsYamlRegistries, path string) []string {
	var problems []string
	m.Range(func(fd protoreflect.FieldDescriptor, v protoreflect.Value) bool {
		fieldPath := fmt.Sprintf("%s.%s", path, fd.Name())

		if discBy := fieldDiscriminatedBy(fd); discBy != "" && isStructField(fd) {
			problems = append(problems, validateDiscriminatedStruct(m, fd, v, discBy, reg, fieldPath)...)
			return true
		}

		switch {
		case fd.IsMap():
			if fd.MapValue().Kind() == protoreflect.MessageKind {
				v.Map().Range(func(k protoreflect.MapKey, mv protoreflect.Value) bool {
					problems = append(problems, validateDiscriminatedStructs(
						mv.Message(), reg, fmt.Sprintf("%s[%s]", fieldPath, k.String()))...)
					return true
				})
			}
		case fd.IsList():
			if fd.Kind() == protoreflect.MessageKind {
				list := v.List()
				for i := 0; i < list.Len(); i++ {
					problems = append(problems, validateDiscriminatedStructs(
						list.Get(i).Message(), reg, fmt.Sprintf("%s[%d]", fieldPath, i))...)
				}
			}
		case fd.Kind() == protoreflect.MessageKind && !isStructField(fd):
			problems = append(problems, validateDiscriminatedStructs(v.Message(), reg, fieldPath)...)
		}
		return true
	})
	return problems
}

func validateDiscriminatedStruct(
	m protoreflect.Message,
	fd protoreflect.FieldDescriptor,
	v protoreflect.Value,
	discBy string,
	reg *docsYamlRegistries,
	path string,
) []string {
	discFd := m.Descriptor().Fields().ByName(protoreflect.Name(discBy))
	if discFd == nil {
		return []string{fmt.Sprintf("%s: contract bug — discriminated_by names field %q which does not exist on %s",
			path, discBy, m.Descriptor().FullName())}
	}

	var discValue string
	switch discFd.Kind() {
	case protoreflect.EnumKind:
		enumVal := discFd.Enum().Values().ByNumber(m.Get(discFd).Enum())
		if enumVal != nil {
			discValue = string(enumVal.Name())
		}
	case protoreflect.StringKind:
		discValue = m.Get(discFd).String()
	}

	variant, ok := reg.variantTypes[discValue]
	if !ok {
		return []string{fmt.Sprintf("%s: no typed variant registered for %s %q%s (is the task's kind set correctly?)",
			path, discBy, discValue, didYouMean(discValue, sortedVariantKinds(reg)))}
	}

	cfgJSON, err := protojson.Marshal(v.Message().Interface())
	if err != nil {
		return []string{fmt.Sprintf("%s: cannot re-marshal for typed validation: %v", path, err)}
	}
	msg := variant.New().Interface()
	if err := protojson.Unmarshal(cfgJSON, msg); err != nil {
		return []string{fmt.Sprintf("%s is not a valid %s: %v", path, variant.Descriptor().FullName(), err)}
	}
	// Rule evaluation must happen at THIS decode point too: on the parent
	// message the config was an opaque Struct, invisible to protovalidate —
	// only the typed variant decoded here carries the rules.
	problems := reg.rules.evaluate(msg, path)
	return append(problems, validateDiscriminatedStructs(msg.ProtoReflect(), reg, path)...)
}

func isStructField(fd protoreflect.FieldDescriptor) bool {
	return fd.Kind() == protoreflect.MessageKind && fd.Message().FullName() == "google.protobuf.Struct"
}

// resolveAnchor turns a validate-as anchor string into the message type a
// fragment must partially conform to. Three roots are supported, all resolved
// from the descriptor-derived registries:
//
//	<Kind>[.<field>...]   e.g. "Workflow.spec" — a resource kind, optionally
//	                      descending through singular message fields
//	task[.<field>...]     the authoring-form WorkflowTask (export/flow snippets)
//	task-config:<kind>    the typed config of one task kind (config snippets)
func resolveAnchor(anchor string, reg *docsYamlRegistries) (protoreflect.MessageType, error) {
	if kind, ok := strings.CutPrefix(anchor, "task-config:"); ok {
		mt, found := reg.variantTypes[kind]
		if !found {
			return nil, fmt.Errorf("validate-as %q: unknown task kind %q%s (valid kinds: %s)",
				anchor, kind, didYouMean(kind, sortedVariantKinds(reg)), strings.Join(sortedVariantKinds(reg), ", "))
		}
		return mt, nil
	}

	parts := strings.Split(anchor, ".")
	var mt protoreflect.MessageType
	if parts[0] == "task" {
		mt = (&workflowv1.WorkflowTask{}).ProtoReflect().Type()
	} else {
		info, ok := reg.manifestKinds[parts[0]]
		if !ok {
			return nil, fmt.Errorf("validate-as %q: unknown resource kind %q%s (known kinds: %s)",
				anchor, parts[0], didYouMean(parts[0], sortedKeys(reg.manifestKinds)),
				strings.Join(sortedKeys(reg.manifestKinds), ", "))
		}
		mt = info.msgType
	}

	for _, fieldName := range parts[1:] {
		fd := mt.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
		if fd == nil || fd.Kind() != protoreflect.MessageKind || fd.IsMap() || fd.IsList() {
			return nil, fmt.Errorf("validate-as %q: %s has no singular message field %q",
				anchor, mt.Descriptor().FullName(), fieldName)
		}
		sub, err := protoregistry.GlobalTypes.FindMessageByName(fd.Message().FullName())
		if err != nil {
			return nil, fmt.Errorf("validate-as %q: cannot resolve %s: %v", anchor, fd.Message().FullName(), err)
		}
		mt = sub
	}
	return mt, nil
}

// validateAnchoredDoc strictly decodes one fragment document as a partial
// instance of the anchored message type. protojson does not require absent
// fields, so a fragment showing only the fields under discussion validates,
// while an unknown or misshapen field fails exactly as it would in a full
// manifest. Discriminated Struct recursion applies as everywhere else.
func validateAnchoredDoc(doc interface{}, anchorType protoreflect.MessageType, anchor string, reg *docsYamlRegistries) []string {
	mapping, ok := doc.(map[string]interface{})
	if !ok {
		return []string{fmt.Sprintf("validate-as %q expects mapping documents, got %T", anchor, doc)}
	}
	jsonBytes, err := json.Marshal(mapping)
	if err != nil {
		return []string{fmt.Sprintf("cannot convert fragment to JSON: %v", err)}
	}
	msg := anchorType.New().Interface()
	if err := protojson.Unmarshal(jsonBytes, msg); err != nil {
		return []string{fmt.Sprintf("fragment does not validate against %s (anchor %q): %v",
			anchorType.Descriptor().FullName(), anchor, err)}
	}
	return validateDiscriminatedStructs(msg.ProtoReflect(), reg, anchor)
}

// ============================================================================
// Classification
// ============================================================================

type docsYamlBlockClass int

const (
	blockManifest docsYamlBlockClass = iota
	blockTaskList
	blockAnchored
	blockSkipped
	blockInvalid
)

// classifyAndValidateFence decides which class a ```yaml fence belongs to and
// validates it. The returned problems are empty exactly when the block is
// valid (or legitimately skipped).
func classifyAndValidateFence(f codeFence, reg *docsYamlRegistries) (docsYamlBlockClass, []string) {
	// Locate rule findings and reset to suppressed: only the auto-classified
	// branches below arm evaluation, so anchored fragments (deliberately
	// partial — required-elision is their point) and skipped blocks are
	// never rule-evaluated.
	reg.rules.beginFence(f.Path, f.Line)

	hasNoValidate := strings.Contains(f.Meta, "no-validate")
	hasValidateAs := strings.Contains(f.Meta, "validate-as")
	if hasNoValidate && hasValidateAs {
		return blockInvalid, []string{"a fence cannot carry both no-validate and validate-as"}
	}

	if hasNoValidate {
		match := noValidateMarkerPattern.FindStringSubmatch(f.Meta)
		if match == nil || strings.TrimSpace(match[1]) == "" {
			return blockInvalid, []string{`no-validate marker requires a reason: use no-validate="why this block cannot be validated"`}
		}
		return blockSkipped, nil
	}

	if hasValidateAs {
		match := validateAsMarkerPattern.FindStringSubmatch(f.Meta)
		if match == nil || strings.TrimSpace(match[1]) == "" {
			return blockInvalid, []string{`validate-as marker requires an anchor: use validate-as="<Kind>[.<field>]", validate-as="task", or validate-as="task-config:<kind>"`}
		}
		anchor := strings.TrimSpace(match[1])
		anchorType, err := resolveAnchor(anchor, reg)
		if err != nil {
			return blockInvalid, []string{err.Error()}
		}
		docs, err := decodeYamlDocuments(f.Body)
		if err != nil {
			return blockInvalid, []string{fmt.Sprintf("invalid YAML: %v", err)}
		}
		if len(docs) == 0 {
			return blockInvalid, []string{"empty yaml block"}
		}
		var problems []string
		for _, doc := range docs {
			problems = append(problems, validateAnchoredDoc(doc, anchorType, anchor, reg)...)
		}
		if len(problems) > 0 {
			return blockInvalid, problems
		}
		return blockAnchored, nil
	}

	docs, err := decodeYamlDocuments(f.Body)
	if err != nil {
		return blockInvalid, []string{fmt.Sprintf("invalid YAML: %v", err)}
	}
	if len(docs) == 0 {
		return blockInvalid, []string{"empty yaml block"}
	}

	class := blockInvalid
	var problems []string
	for _, doc := range docs {
		switch d := doc.(type) {
		case map[string]interface{}:
			if _, hasAPIVersion := d["apiVersion"]; hasAPIVersion {
				if class == blockInvalid {
					class = blockManifest
				}
				reg.rules.setBlockClass("manifest")
				problems = append(problems, validateManifestDoc(d, reg)...)
				continue
			}
			problems = append(problems, unclassifiedBlockProblem())
		case []interface{}:
			reg.rules.setBlockClass("task list")
			taskProblems, isTaskList := validateTaskListDoc(d, reg)
			if isTaskList {
				if class == blockInvalid {
					class = blockTaskList
				}
				problems = append(problems, taskProblems...)
				continue
			}
			problems = append(problems, taskProblems...)
		default:
			problems = append(problems, unclassifiedBlockProblem())
		}
	}
	if len(problems) > 0 {
		return blockInvalid, problems
	}
	return class, nil
}

// validateTaskListDoc inspects a YAML list document. When every entry is a
// mapping whose kind is a known workflow task kind, it is validated as an
// authoring-form task list and isTaskList is true. A list that clearly tries
// to be a task list but names an unknown kind gets a pointed error instead of
// a generic unclassified failure.
func validateTaskListDoc(entries []interface{}, reg *docsYamlRegistries) (problems []string, isTaskList bool) {
	if len(entries) == 0 {
		return []string{"empty yaml block"}, false
	}

	maps := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		m, ok := e.(map[string]interface{})
		if !ok {
			return []string{unclassifiedBlockProblem()}, false
		}
		maps = append(maps, m)
	}

	looksLikeTasks := false
	for i, m := range maps {
		kind, _ := m["kind"].(string)
		_, name := m["name"]
		if kind == "" && !name {
			return []string{unclassifiedBlockProblem()}, false
		}
		looksLikeTasks = true
		if _, known := reg.variantTypes[kind]; !known {
			return []string{fmt.Sprintf("task entry %d: unknown task kind %q%s (valid kinds: %s)",
				i+1, kind, didYouMean(kind, sortedVariantKinds(reg)),
				strings.Join(sortedVariantKinds(reg), ", "))}, false
		}
	}
	if !looksLikeTasks {
		return []string{unclassifiedBlockProblem()}, false
	}

	for i, m := range maps {
		for _, p := range validateAuthoringTaskEntry(m, reg) {
			if len(maps) == 1 {
				problems = append(problems, p)
			} else {
				problems = append(problems, fmt.Sprintf("task entry %d: %s", i+1, p))
			}
		}
	}
	return problems, true
}

func unclassifiedBlockProblem() string {
	return "unclassified yaml block: not a resource manifest (apiVersion/kind) and not an authoring-form task list; " +
		`anchor it with validate-as="<Kind>[.<field>]" (or "task" / "task-config:<kind>") if it is a contract fragment, ` +
		`or mark it no-validate="reason" if it is not resource YAML at all`
}

func decodeYamlDocuments(body string) ([]interface{}, error) {
	var docs []interface{}
	dec := yaml.NewDecoder(strings.NewReader(body))
	for {
		var doc interface{}
		if err := dec.Decode(&doc); err != nil {
			if errors.Is(err, io.EOF) {
				return docs, nil
			}
			return nil, err
		}
		if doc != nil {
			docs = append(docs, doc)
		}
	}
}

// ============================================================================
// Tree walk and reporting
// ============================================================================

type docsYamlSummary struct {
	Files     int
	Blocks    int
	Manifests int
	TaskLists int
	Anchored  int
	Skipped   int
}

type docsYamlProblem struct {
	Path string
	Line int
	Msg  string
}

// checkDocsYaml scans every .md/.mdx file under docsDir (excluding _archive,
// mirroring the Makefile's DOCS_SOURCES) and validates every yaml fence.
// ruleMode arms the optional protovalidate pass (docs_yaml_rules.go); the
// returned evaluator carries report-mode findings and is nil when off.
func checkDocsYaml(docsDir string, ruleMode docsYamlRuleMode) (docsYamlSummary, []docsYamlProblem, *docsYamlRuleEval, error) {
	reg, err := buildDocsYamlRegistries()
	if err != nil {
		return docsYamlSummary{}, nil, nil, err
	}
	reg.rules, err = newDocsYamlRuleEval(ruleMode)
	if err != nil {
		return docsYamlSummary{}, nil, nil, err
	}

	var summary docsYamlSummary
	var problems []docsYamlProblem

	rules := reg.rules

	walkErr := filepath.WalkDir(docsDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == "_archive" {
				return filepath.SkipDir
			}
			return nil
		}
		ext := filepath.Ext(path)
		if ext != ".md" && ext != ".mdx" {
			return nil
		}

		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		fences, err := scanMarkdownFences(path, string(src))
		if err != nil {
			problems = append(problems, docsYamlProblem{Path: path, Msg: err.Error()})
			return nil
		}

		fileHasYaml := false
		for _, f := range fences {
			if f.Lang != "yaml" && f.Lang != "yml" {
				continue
			}
			fileHasYaml = true
			summary.Blocks++
			class, blockProblems := classifyAndValidateFence(f, reg)
			switch class {
			case blockManifest:
				summary.Manifests++
			case blockTaskList:
				summary.TaskLists++
			case blockAnchored:
				summary.Anchored++
			case blockSkipped:
				summary.Skipped++
			}
			for _, msg := range blockProblems {
				problems = append(problems, docsYamlProblem{Path: f.Path, Line: f.Line, Msg: msg})
			}
		}
		if fileHasYaml {
			summary.Files++
		}
		return nil
	})
	if walkErr != nil {
		return summary, problems, rules, walkErr
	}

	sort.Slice(problems, func(i, j int) bool {
		if problems[i].Path != problems[j].Path {
			return problems[i].Path < problems[j].Path
		}
		return problems[i].Line < problems[j].Line
	})
	return summary, problems, rules, nil
}

// runDocsYamlCheck is the --target=docs-yaml-check entry point.
func runDocsYamlCheck(docsDir string, ruleMode docsYamlRuleMode) error {
	summary, problems, rules, err := checkDocsYaml(docsDir, ruleMode)
	if err != nil {
		return err
	}

	// The report precedes the gate result: in report mode the findings are
	// informational and must print whether or not decode problems fail the
	// build below.
	rules.printRuleReport()

	if len(problems) > 0 {
		fmt.Printf("docs YAML gate found %d problem(s):\n\n", len(problems))
		lastHintedPath := ""
		for _, p := range problems {
			if p.Line > 0 {
				fmt.Printf("  %s:%d\n    %s\n", p.Path, p.Line, p.Msg)
			} else {
				fmt.Printf("  %s\n    %s\n", p.Path, p.Msg)
			}
			if hint := generatedDocHint(docsDir, p.Path); hint != "" && p.Path != lastHintedPath {
				fmt.Printf("    note: %s\n", hint)
				lastHintedPath = p.Path
			}
		}
		fmt.Printf("\nEvery ```yaml block in docs must be a resource manifest (apiVersion/kind),\n" +
			"an authoring-form task list (- name/kind/task_config), an anchored fragment\n" +
			"(validate-as=\"<Kind>[.<field>]\" / \"task\" / \"task-config:<kind>\"), or carry an\n" +
			"explicit no-validate=\"reason\" marker in the fence info string.\n")
		return fmt.Errorf("docs YAML validation failed with %d problem(s)", len(problems))
	}

	fmt.Printf("✓ docs YAML gate: %d blocks across %d files — %d manifests, %d task lists, %d anchored fragments, %d skipped with no-validate, 0 unclassified\n",
		summary.Blocks, summary.Files, summary.Manifests, summary.TaskLists, summary.Anchored, summary.Skipped)
	return nil
}

// generatedDocHint maps generator-owned docs paths to the source that must be
// edited instead, so a failure on a generated page sends the author to the
// right file. The ownership list mirrors the "generator-owned docs files"
// convention documented in the docs redesign project.
func generatedDocHint(docsDir, path string) string {
	rel, err := filepath.Rel(docsDir, path)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	switch {
	case strings.HasPrefix(rel, "sdk/resources/"):
		return "this page is generated — fix the example in the resource's apis/**/docs/overview.md, then run 'make gen-proto-sdk-docs'"
	case strings.HasPrefix(rel, "guides/workflows/task-types/"):
		return "this page is generated — fix apis/ai/stigmer/agentic/workflow/v1/tasks/meta/<kind>.yaml (or the index enrichment template), then run 'make gen-task-docs'"
	case strings.HasPrefix(rel, "cli/commands/"):
		return "this page is generated — fix the CLI source, then run 'make gen-cli-docs'"
	case strings.HasPrefix(rel, "sdk/react/") || strings.HasPrefix(rel, "sdk/ink/reference") || strings.HasPrefix(rel, "sdk/theme/tokens") || strings.HasPrefix(rel, "sdk/theme/presets"):
		return "this page is generated — fix the generator input, not this file (see 'make gen-sdk-docs')"
	}
	return ""
}

// ============================================================================
// Small helpers
// ============================================================================

func sortedKeys(m map[string]manifestKindInfo) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func sortedVariantKinds(reg *docsYamlRegistries) []string {
	kinds := make([]string, 0, len(reg.variantTypes))
	for k := range reg.variantTypes {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	return kinds
}

// didYouMean returns a ` (did you mean "x"?)` suffix when a close match for
// input exists among candidates, keeping typo errors pointed instead of
// dumping only the full kind list.
func didYouMean(input string, candidates []string) string {
	if input == "" {
		return ""
	}
	best, bestDist := "", 3 // suggest only within edit distance 2
	for _, c := range candidates {
		if d := editDistance(input, c); d < bestDist {
			best, bestDist = c, d
		}
	}
	if best == "" {
		return ""
	}
	return fmt.Sprintf(" (did you mean %q?)", best)
}

func editDistance(a, b string) int {
	prev := make([]int, len(b)+1)
	curr := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		curr[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			curr[j] = min(curr[j-1]+1, prev[j]+1, prev[j-1]+cost)
		}
		prev, curr = curr, prev
	}
	return prev[len(b)]
}
