package celeval

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/schema"
	"gopkg.in/yaml.v3"
)

// TestConformanceCorpus runs the cross-edition fixture corpus at
// apis/ai/stigmer/agentic/datastore/v1/conformance/. The Java
// implementation (T04) consumes the same files; a verdict divergence
// here is a contract break, not a test preference.
func TestConformanceCorpus(t *testing.T) {
	corpus := loadCorpus(t)
	if len(corpus.Cases) == 0 {
		t.Fatal("conformance corpus is empty")
	}

	for _, tc := range corpus.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			this, thisColl := tc.activation(t, tc.This)
			var that map[string]any
			if tc.That != nil {
				that, _ = tc.activation(t, tc.That)
			}

			// Compile-error cases must be rejected at apply time.
			if tc.Error == "compile" {
				if err := Compile(tc.Expression, tc.That != nil); err == nil {
					t.Fatalf("expression %q compiled but the corpus requires a compile error", tc.Expression)
				}
				return
			}
			if err := Compile(tc.Expression, tc.That != nil); err != nil {
				t.Fatalf("expression %q failed to compile: %v", tc.Expression, err)
			}

			got, err := EvaluateBool(tc.Expression, this, that, tc.Tz)

			if tc.Error == "eval" {
				if err == nil {
					t.Fatalf("expression %q evaluated to %v but the corpus requires an evaluation error", tc.Expression, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("expression %q failed to evaluate: %v", tc.Expression, err)
			}
			if got != *tc.Want {
				t.Errorf("expression %q = %v, corpus requires %v (this=%v that=%v tz=%q)",
					tc.Expression, got, *tc.Want, this, that, tc.Tz)
			}
			_ = thisColl
		})
	}
}

// --- corpus schema (mirrors conformance/README.md) -----------------------

type corpusFile struct {
	Cases []corpusCase `yaml:"cases"`
}

type corpusCase struct {
	Name       string                 `yaml:"name"`
	Expression string                 `yaml:"expression"`
	Tz         string                 `yaml:"tz"`
	This       map[string]corpusValue `yaml:"this"`
	That       map[string]corpusValue `yaml:"that"`
	Want       *bool                  `yaml:"want"`
	Error      string                 `yaml:"error"` // "", "compile", "eval"
}

type corpusValue struct {
	Type  string `yaml:"type"`
	Value any    `yaml:"value"`
}

var corpusFieldTypes = map[string]datastorev1.FieldType{
	"string":    datastorev1.FieldType_string,
	"integer":   datastorev1.FieldType_integer,
	"number":    datastorev1.FieldType_number,
	"bool":      datastorev1.FieldType_bool,
	"timestamp": datastorev1.FieldType_timestamp,
	"date":      datastorev1.FieldType_date,
	"time":      datastorev1.FieldType_time,
	"json":      datastorev1.FieldType_json,
}

// activation builds the CEL activation for a fixture record through the
// SAME path production uses: caller-shaped values are canonicalized by
// schema.CanonicalizeValue (as every write path does) and then activated
// by ActivationFromRecord — so the corpus exercises the real
// encoding + typing pipeline, not a test-only shortcut.
func (tc corpusCase) activation(t *testing.T, fixture map[string]corpusValue) (map[string]any, *datastorev1.CollectionDeclaration) {
	t.Helper()
	coll := &datastorev1.CollectionDeclaration{Name: "conformance"}
	fields := map[string]any{}
	for name, v := range fixture {
		ft, ok := corpusFieldTypes[v.Type]
		if !ok {
			t.Fatalf("fixture field %q has unknown type %q", name, v.Type)
		}
		field := &datastorev1.FieldDeclaration{Name: name, Type: ft}
		coll.Fields = append(coll.Fields, field)
		if v.Value == nil {
			continue // absent/null: ActivationFromRecord surfaces CEL null
		}
		// YAML integers arrive as int; CanonicalizeValue speaks the
		// structpb value space (float64 for all numbers).
		raw := v.Value
		if i, isInt := raw.(int); isInt {
			raw = float64(i)
		}
		canonical, err := schema.CanonicalizeValue(field, raw)
		if err != nil {
			t.Fatalf("fixture field %q value %v is not canonicalizable: %v", name, v.Value, err)
		}
		fields[name] = canonical
	}
	return ActivationFromRecord(coll, fields), coll
}

func loadCorpus(t *testing.T) corpusFile {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve test file path")
	}
	// celeval/ → datastore/ → domain/ → pkg/ → stigmer-server/ →
	// services/ → backend/ → repo root.
	repoRoot := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "..", "..", "..", "..")
	path := filepath.Join(repoRoot, "apis", "ai", "stigmer", "agentic", "datastore", "v1", "conformance", "expressions.yaml")

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read conformance corpus at %s: %v", path, err)
	}
	var corpus corpusFile
	if err := yaml.Unmarshal(data, &corpus); err != nil {
		t.Fatalf("failed to parse conformance corpus: %v", err)
	}
	for _, tc := range corpus.Cases {
		if tc.Error == "" && tc.Want == nil {
			t.Fatalf("case %q declares neither want nor error", tc.Name)
		}
	}
	return corpus
}
