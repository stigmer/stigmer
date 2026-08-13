package main

// Protovalidate rule evaluation for the docs YAML gate (--rules flag).
//
// The gate's baseline strictness is "platform decode strictness": strict
// protojson, full enum names, apiVersion consts (see docs_yaml_gate.go and
// design record DD-03 of the docs redesign project). Whether docs examples
// must ALSO satisfy protovalidate rules (required fields, in:/enum lists,
// CEL) was deliberately deferred as a separately-measured decision, because
// teaching examples elide fields on purpose and blanket enforcement could
// force every fragment into a verbose full manifest (stigmer/stigmer#305).
//
// This file is that measurement instrument and, if the ruling lands on
// enforcement, the enforcement mechanism — one implementation, three modes:
//
//   - off (default): rules are not evaluated; the gate behaves exactly as
//     before this file existed.
//   - report: rules are evaluated and violations are printed as a bucketed
//     report (rule family × block class × file), but the gate's pass/fail
//     result is unchanged. This is the #305 dry-run mode.
//   - enforce: violations join the regular problem stream and fail the gate
//     like any decode error.
//
// Anchored fragments (validate-as blocks) are NEVER rule-evaluated in any
// mode: a fragment is a deliberately partial instance — `required` would
// fail it by construction, which is elision, not drift. Auto-classified
// manifests and task lists are complete documents, so rules apply there.
//
// Evaluation happens at every TYPED decode point, not just the block's top
// level: task_config fields are google.protobuf.Struct on their parent
// message (rules-invisible to protovalidate), so each discriminated-Struct
// recursion level evaluates the typed variant it just decoded — mirroring
// how the decode checks themselves descend.

import (
	"fmt"
	"sort"
	"strings"

	protovalidate "buf.build/go/protovalidate"
	"google.golang.org/protobuf/proto"
)

// docsYamlRuleMode is the --rules flag's parsed value.
type docsYamlRuleMode string

const (
	ruleModeOff     docsYamlRuleMode = "off"
	ruleModeReport  docsYamlRuleMode = "report"
	ruleModeEnforce docsYamlRuleMode = "enforce"
)

func parseDocsYamlRuleMode(s string) (docsYamlRuleMode, error) {
	switch docsYamlRuleMode(s) {
	case ruleModeOff, ruleModeReport, ruleModeEnforce:
		return docsYamlRuleMode(s), nil
	}
	return "", fmt.Errorf("invalid --rules %q: expected off, report, or enforce", s)
}

// docsYamlRuleViolation is one protovalidate finding located to its docs
// block — the unit the report mode buckets and the categorization pass
// (real drift vs intentional teaching elision) works from.
type docsYamlRuleViolation struct {
	Path string
	Line int
	// BlockClass is "manifest" or "task list" — the two auto-classified,
	// complete-document classes rules apply to.
	BlockClass string
	// At is the gate's context path for the evaluated message (the resource
	// kind, `task "name"`, or a discriminated-Struct recursion path).
	At string
	// MessageType is the fully-qualified proto message that was evaluated.
	MessageType string
	// Field is the dotted field path within that message, "" for
	// message-level CEL rules.
	Field string
	// RuleID is protovalidate's rule identity (e.g. "required",
	// "enum.defined_only", "string.min_len", or a custom CEL id).
	RuleID string
	Msg    string
}

// ruleFamily buckets a rule id into the families the #305 measurement is
// scoped to: "required", the in-list family (string/enum in, not_in,
// defined_only — all "the value must be one of these" rules), and "other"
// (everything else protovalidate evaluates: min_len, patterns, CEL, ...).
func ruleFamily(ruleID string) string {
	switch {
	case ruleID == "required":
		return "required"
	case strings.HasSuffix(ruleID, ".in"), strings.HasSuffix(ruleID, ".not_in"),
		ruleID == "enum.defined_only":
		return "in-list"
	default:
		return "other"
	}
}

// docsYamlRuleEval carries the protovalidate validator plus the per-fence
// evaluation context. It rides on docsYamlRegistries (the object every
// validator already receives — `reg` doubles as the gate's per-run context),
// and is nil when --rules=off: every method is nil-receiver safe, so call
// sites stay unconditional.
//
// The context setters lean on the walk being single-threaded, exactly like
// the summary counters in checkDocsYaml.
type docsYamlRuleEval struct {
	mode      docsYamlRuleMode
	validator protovalidate.Validator

	// Current fence location, set by beginFence before classification.
	path string
	line int
	// Current block class ("manifest" / "task list"); "" suppresses
	// evaluation — the anchored-fragment and skipped states.
	blockClass string

	violations []docsYamlRuleViolation
}

// newDocsYamlRuleEval returns nil for off — the no-op evaluator.
func newDocsYamlRuleEval(mode docsYamlRuleMode) (*docsYamlRuleEval, error) {
	if mode == ruleModeOff {
		return nil, nil
	}
	v, err := protovalidate.New()
	if err != nil {
		return nil, fmt.Errorf("building protovalidate validator: %v", err)
	}
	return &docsYamlRuleEval{mode: mode, validator: v}, nil
}

// beginFence locates subsequent findings and resets the class to suppressed
// until the classifier identifies a rule-evaluable block.
func (e *docsYamlRuleEval) beginFence(path string, line int) {
	if e == nil {
		return
	}
	e.path = path
	e.line = line
	e.blockClass = ""
}

// setBlockClass arms evaluation for the current document ("manifest" or
// "task list"). Anchored fragments never call this, so they stay suppressed.
func (e *docsYamlRuleEval) setBlockClass(class string) {
	if e == nil {
		return
	}
	e.blockClass = class
}

// evaluate runs protovalidate over one typed message decoded from the current
// block. In report mode findings are accumulated and nothing is returned; in
// enforce mode they come back as gate problems in the house error voice.
// Compilation/runtime errors from the evaluator itself are always returned as
// problems — a rule that cannot be evaluated is a contract bug, not a docs
// finding.
func (e *docsYamlRuleEval) evaluate(msg proto.Message, at string) []string {
	if e == nil || e.blockClass == "" {
		return nil
	}
	err := e.validator.Validate(msg)
	if err == nil {
		return nil
	}
	valErr, ok := err.(*protovalidate.ValidationError)
	if !ok {
		return []string{fmt.Sprintf("%s: protovalidate could not evaluate %s: %v",
			at, msg.ProtoReflect().Descriptor().FullName(), err)}
	}

	var problems []string
	for _, v := range valErr.Violations {
		finding := docsYamlRuleViolation{
			Path:        e.path,
			Line:        e.line,
			BlockClass:  e.blockClass,
			At:          at,
			MessageType: string(msg.ProtoReflect().Descriptor().FullName()),
			Field:       protovalidate.FieldPathString(v.Proto.GetField()),
			RuleID:      v.Proto.GetRuleId(),
			Msg:         v.Proto.GetMessage(),
		}
		switch e.mode {
		case ruleModeReport:
			e.violations = append(e.violations, finding)
		case ruleModeEnforce:
			problems = append(problems, finding.problemString())
		}
	}
	return problems
}

// problemString renders a finding in the gate's problem voice, parallel to
// the decode errors ("X manifest does not validate against Y: ...").
func (f docsYamlRuleViolation) problemString() string {
	field := f.Field
	if field == "" {
		field = "(message)"
	}
	return fmt.Sprintf("%s: %s: %s (rule: %s)", f.At, field, f.Msg, f.RuleID)
}

// printRuleReport writes the report-mode summary: totals by rule family and
// block class, then every finding grouped by fence in tree order. The exact
// rule ids are printed so the drift-vs-elision categorization can cite them.
func (e *docsYamlRuleEval) printRuleReport() {
	if e == nil || e.mode != ruleModeReport {
		return
	}
	if len(e.violations) == 0 {
		fmt.Printf("✓ docs YAML rule report: protovalidate rules produced no violations\n")
		return
	}

	families := map[string]int{}
	classes := map[string]int{}
	fences := map[string]bool{}
	for _, f := range e.violations {
		families[ruleFamily(f.RuleID)]++
		classes[f.BlockClass]++
		fences[fmt.Sprintf("%s:%d", f.Path, f.Line)] = true
	}
	fmt.Printf("docs YAML rule report: %d violation(s) in %d block(s) — required: %d, in-list: %d, other: %d · manifests: %d, task lists: %d\n\n",
		len(e.violations), len(fences),
		families["required"], families["in-list"], families["other"],
		classes["manifest"], classes["task list"])

	sorted := make([]docsYamlRuleViolation, len(e.violations))
	copy(sorted, e.violations)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Path != sorted[j].Path {
			return sorted[i].Path < sorted[j].Path
		}
		return sorted[i].Line < sorted[j].Line
	})

	lastFence := ""
	for _, f := range sorted {
		fence := fmt.Sprintf("%s:%d", f.Path, f.Line)
		if fence != lastFence {
			fmt.Printf("  %s [%s]\n", fence, f.BlockClass)
			lastFence = fence
		}
		fmt.Printf("    %s\n", f.problemString())
	}
	fmt.Printf("\nreport mode never fails the build — see stigmer/stigmer#305 for the enforcement decision\n")
}
