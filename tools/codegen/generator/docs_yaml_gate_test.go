package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
	descriptorpb "google.golang.org/protobuf/types/descriptorpb"
)

func mustBuildRegistries(t *testing.T) *docsYamlRegistries {
	t.Helper()
	reg, err := buildDocsYamlRegistries()
	if err != nil {
		t.Fatalf("buildDocsYamlRegistries: %v", err)
	}
	return reg
}

func TestDocsYamlRegistriesDeriveFromDescriptors(t *testing.T) {
	reg := mustBuildRegistries(t)

	wantKinds := map[string]string{
		"Workflow":     "agentic.stigmer.ai/v1",
		"Agent":        "agentic.stigmer.ai/v1",
		"Skill":        "agentic.stigmer.ai/v1",
		"IamPolicy":    "iam.stigmer.ai/v1",
		"Organization": "tenancy.stigmer.ai/v1",
	}
	for kind, apiVersion := range wantKinds {
		info, ok := reg.manifestKinds[kind]
		if !ok {
			t.Errorf("manifest kind %q not derived from descriptors", kind)
			continue
		}
		if info.apiVersion != apiVersion {
			t.Errorf("kind %q: apiVersion const %q, want %q", kind, info.apiVersion, apiVersion)
		}
	}

	for _, variant := range []string{"wait", "llm_call", "fork", "http_call"} {
		if _, ok := reg.variantTypes[variant]; !ok {
			t.Errorf("variant %q not derived from discriminator_value options", variant)
		}
	}
}

// TestDocsYamlManifestRegistryCompleteness guards the blank-import list in
// docs_yaml_gate.go: every resource kind registered in the ApiResourceKind
// enum's kind_meta must resolve to a linked message, unless it is explicitly
// excluded here with a reason. A new resource kind added without a matching
// import fails this test instead of silently reporting "unknown kind" in docs.
func TestDocsYamlManifestRegistryCompleteness(t *testing.T) {
	// Kinds that intentionally have no manifest message linked. Add entries
	// only with a reason.
	excluded := map[string]string{
		"Platform":           "kind_meta enum entry only; no authorable resource message exists in apis/",
		"ApiResourceVersion": "internal version-history record; no authorable resource message exists in apis/",
	}

	reg := mustBuildRegistries(t)

	values := apiresourcekind.ApiResourceKind(0).Descriptor().Values()
	for i := 0; i < values.Len(); i++ {
		val := values.Get(i)
		if val.Number() == 0 {
			continue
		}
		opts, ok := val.Options().(*descriptorpb.EnumValueOptions)
		if !ok || opts == nil || !proto.HasExtension(opts, apiresourcekind.E_KindMeta) {
			continue
		}
		meta, ok := proto.GetExtension(opts, apiresourcekind.E_KindMeta).(*apiresourcekind.ApiResourceKindMeta)
		if !ok || meta == nil || meta.Name == "" {
			continue
		}
		if reason, skip := excluded[meta.Name]; skip {
			t.Logf("kind %q excluded: %s", meta.Name, reason)
			continue
		}
		if _, ok := reg.manifestKinds[meta.Name]; !ok {
			t.Errorf("kind %q has kind_meta but no linked resource message — add its stub package to the blank imports in docs_yaml_gate.go (or exclude it here with a reason)", meta.Name)
		}
	}
}

func TestClassifyAndValidateFence(t *testing.T) {
	reg := mustBuildRegistries(t)

	cases := []struct {
		name      string
		meta      string
		body      string
		wantClass docsYamlBlockClass
		wantErr   string // substring at least one problem must contain; "" means no problems
	}{
		{
			name: "valid workflow manifest",
			body: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: ticket-triage
spec:
  tasks:
    - name: pause
      kind: wait
      task_config:
        duration:
          seconds: 30
`,
			wantClass: blockManifest,
		},
		{
			name: "manifest catches garbage inside task_config through Struct recursion",
			body: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: ticket-triage
spec:
  tasks:
    - name: pause
      kind: wait
      task_config:
        duraton: "30s"
`,
			wantErr: `unknown field "duraton"`,
		},
		{
			name: "manifest with unknown spec field is rejected",
			body: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: ticket-triage
spec:
  not_a_field: true
`,
			wantErr: `unknown field "not_a_field"`,
		},
		{
			name: "manifest with wrong apiVersion is rejected",
			body: `apiVersion: wrong.example.com/v99
kind: Workflow
metadata:
  name: ticket-triage
`,
			wantErr: `apiVersion is "wrong.example.com/v99", want "agentic.stigmer.ai/v1"`,
		},
		{
			name: "manifest with typo'd kind gets a suggestion",
			body: `apiVersion: agentic.stigmer.ai/v1
kind: Workflw
metadata:
  name: x
`,
			wantErr: `unknown resource kind "Workflw" (did you mean "Workflow"?)`,
		},
		{
			name: "manifest task with missing kind fails variant resolution",
			body: `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: x
spec:
  tasks:
    - name: pause
      task_config:
        duration:
          seconds: 30
`,
			wantErr: "no typed variant registered",
		},
		{
			name: "multi-document manifest block validates every document",
			body: `apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: staging
---
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: production
`,
			wantClass: blockManifest,
		},
		{
			name: "valid task list",
			body: `- name: pause
  kind: wait
  task_config:
    duration:
      seconds: 30
`,
			wantClass: blockTaskList,
		},
		{
			name: "task list with unknown config field is rejected",
			body: `- name: notify
  kind: notification
  task_config:
    channel: slack
    message: "done"
`,
			wantErr: `unknown field "message"`,
		},
		{
			name: "nested task inside a fork branch is validated",
			body: `- name: parallel
  kind: fork
  task_config:
    branches:
      - name: a
        do:
          - name: pause
            kind: wait
            task_config:
              duraton: "30s"
`,
			wantErr: `unknown field "duraton"`,
		},
		{
			name: "task list with typo'd kind gets a suggestion",
			body: `- name: pause
  kind: waiit
  task_config: {}
`,
			wantErr: `unknown task kind "waiit" (did you mean "wait"?)`,
		},
		{
			name: "task without name is rejected",
			body: `- kind: wait
  task_config:
    duration:
      seconds: 30
`,
			wantErr: "task name is required",
		},
		{
			name: "task without task_config is rejected",
			body: `- name: pause
  kind: wait
`,
			wantErr: "task_config is required",
		},
		{
			name: "internal DSL form is unclassified",
			body: `- pause:
    wait:
      seconds: 30
`,
			wantErr: "unclassified yaml block",
		},
		{
			name: "bare field fragment is unclassified",
			body: `export:
  as: "${ .structured }"
`,
			wantErr: "unclassified yaml block",
		},
		{
			name: "anchored spec fragment validates",
			meta: `validate-as="Workflow.spec"`,
			body: `tasks:
  - name: pause
    kind: wait
    task_config:
      duration:
        seconds: 30
`,
			wantClass: blockAnchored,
		},
		{
			name: "anchored fragment catches unknown fields",
			meta: `validate-as="Workflow.spec"`,
			body: `env:
  TOPIC:
    description: "topic"
    required: true
`,
			wantErr: `unknown field "required"`,
		},
		{
			name: "anchored fragment recurses into task_config",
			meta: `validate-as="Workflow.spec"`,
			body: `tasks:
  - name: pause
    kind: wait
    task_config:
      duraton: "30s"
`,
			wantErr: `unknown field "duraton"`,
		},
		{
			name:      "task anchor validates export and flow snippets",
			meta:      `validate-as="task"`,
			body:      "export:\n  as: \"${ .structured }\"\n",
			wantClass: blockAnchored,
		},
		{
			name:      "task-config anchor validates a config snippet",
			meta:      `validate-as="task-config:llm_call"`,
			body:      "prompt: \"Summarize: ${ $context.fetch_data.body }\"\n",
			wantClass: blockAnchored,
		},
		{
			name:    "task-config anchor with typo'd kind is rejected",
			meta:    `validate-as="task-config:waiit"`,
			body:    "duration:\n  seconds: 30\n",
			wantErr: `unknown task kind "waiit" (did you mean "wait"?)`,
		},
		{
			name:    "anchor with unknown resource kind is rejected",
			meta:    `validate-as="Workflw.spec"`,
			body:    "tasks: []\n",
			wantErr: `unknown resource kind "Workflw" (did you mean "Workflow"?)`,
		},
		{
			name:    "anchor with bad field path is rejected",
			meta:    `validate-as="Workflow.not_a_field"`,
			body:    "tasks: []\n",
			wantErr: `has no singular message field "not_a_field"`,
		},
		{
			name:    "anchor with list body is rejected",
			meta:    `validate-as="Workflow.spec"`,
			body:    "- name: x\n",
			wantErr: "expects mapping documents",
		},
		{
			name:    "empty validate-as marker is rejected",
			meta:    "validate-as",
			body:    "tasks: []\n",
			wantErr: "requires an anchor",
		},
		{
			name:    "contradictory markers are rejected",
			meta:    `no-validate="x" validate-as="Workflow.spec"`,
			body:    "tasks: []\n",
			wantErr: "cannot carry both",
		},
		{
			name:      "no-validate marker with reason is skipped",
			meta:      `no-validate="fragment: illustrates the export field"`,
			body:      "export:\n  as: anything\n",
			wantClass: blockSkipped,
		},
		{
			name:    "no-validate marker without reason is rejected",
			meta:    `no-validate=""`,
			body:    "export: {}\n",
			wantErr: "requires a reason",
		},
		{
			name:    "malformed no-validate marker is rejected",
			meta:    "no-validate",
			body:    "export: {}\n",
			wantErr: "requires a reason",
		},
		{
			name:    "empty block is rejected",
			body:    "\n",
			wantErr: "empty yaml block",
		},
		{
			name:    "invalid yaml is rejected",
			body:    "foo: [unclosed\n",
			wantErr: "invalid YAML",
		},
		{
			name: "duplicate mapping keys are rejected",
			body: `- name: pause
  kind: wait
  task_config:
    duration:
      seconds: 30
      seconds: 60
`,
			wantErr: "invalid YAML",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fence := codeFence{Path: "test.mdx", Line: 1, Lang: "yaml", Meta: tc.meta, Body: tc.body}
			class, problems := classifyAndValidateFence(fence, reg)
			if tc.wantErr == "" {
				if len(problems) > 0 {
					t.Fatalf("expected valid, got problems: %v", problems)
				}
				if class != tc.wantClass {
					t.Fatalf("class = %d, want %d", class, tc.wantClass)
				}
				return
			}
			if len(problems) == 0 {
				t.Fatalf("expected a problem containing %q, got none", tc.wantErr)
			}
			joined := strings.Join(problems, "\n")
			if !strings.Contains(joined, tc.wantErr) {
				t.Fatalf("problems %q do not contain %q", joined, tc.wantErr)
			}
		})
	}
}

// TestCheckDocsYamlOnFixtureTree runs the whole gate over a synthetic docs
// tree: valid blocks, a skipped block, an offending block, a non-yaml fence,
// and an _archive file that must be excluded.
func TestCheckDocsYamlOnFixtureTree(t *testing.T) {
	dir := t.TempDir()
	writeFixture := func(rel, content string) {
		t.Helper()
		path := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	writeFixture("guide.mdx", "# Guide\n\n```yaml\napiVersion: agentic.stigmer.ai/v1\nkind: Environment\nmetadata:\n  name: staging\n```\n\n```yaml\n- name: pause\n  kind: wait\n  task_config:\n    duration:\n      seconds: 30\n```\n\n```bash\necho not-yaml\n```\n")
	writeFixture("fragment.md", "```yaml no-validate=\"fragment: illustrates one field\"\nexport:\n  as: anything\n```\n")
	writeFixture("anchored.mdx", "```yaml validate-as=\"Workflow.spec\"\nbudget:\n  max_cost_micros: 2000000\n```\n")
	writeFixture("broken.mdx", "```yaml\nexport:\n  as: unmarked-fragment\n```\n")
	writeFixture("_archive/old.mdx", "```yaml\ntotally: [broken\n```\n")

	summary, problems, _, err := checkDocsYaml(dir, ruleModeOff)
	if err != nil {
		t.Fatalf("checkDocsYaml: %v", err)
	}

	if summary.Files != 4 {
		t.Errorf("Files = %d, want 4 (archive must be excluded)", summary.Files)
	}
	if summary.Blocks != 5 {
		t.Errorf("Blocks = %d, want 5 (bash fence must not count)", summary.Blocks)
	}
	if summary.Manifests != 1 || summary.TaskLists != 1 || summary.Anchored != 1 || summary.Skipped != 1 {
		t.Errorf("summary = %+v, want 1 manifest / 1 task list / 1 anchored / 1 skipped", summary)
	}
	if len(problems) != 1 {
		t.Fatalf("got %d problems, want exactly 1: %+v", len(problems), problems)
	}
	if !strings.HasSuffix(problems[0].Path, "broken.mdx") || !strings.Contains(problems[0].Msg, "unclassified") {
		t.Errorf("unexpected problem: %+v", problems[0])
	}
}

func TestCheckDeadExpressionNamespace(t *testing.T) {
	problems := checkDeadExpressionNamespace("guide.mdx",
		"Env vars live at `${ $env.TOPIC }`.\nNever `${ $context.env.TOPIC }`.\nAlso bad: $context.env.OTHER\n")
	if len(problems) != 2 {
		t.Fatalf("expected 2 problems, got %v", problems)
	}
	if problems[0].Line != 2 || problems[1].Line != 3 {
		t.Errorf("expected lines 2 and 3, got %d and %d", problems[0].Line, problems[1].Line)
	}
	if !strings.Contains(problems[0].Msg, "$env.<VAR>") {
		t.Errorf("problem should point at the $env namespace, got: %s", problems[0].Msg)
	}
}

func TestCheckAuthoringDirsOnFixtureTree(t *testing.T) {
	dir := t.TempDir()

	// A manifest a real apply rejects (string duration) plus the dead
	// namespace — both must be flagged (the stigmer/stigmer#778 classes).
	badManifest := `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: bad
spec:
  description: bad fixture
  document:
    dsl: "1.0.0"
    namespace: examples
    name: bad
    version: "1.0.0"
  tasks:
    - name: pause
      kind: wait
      task_config:
        duration: "5s"
`
	goodManifest := `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: good
spec:
  description: good fixture
  document:
    dsl: "1.0.0"
    namespace: examples
    name: good
    version: "1.0.0"
  tasks:
    - name: pause
      kind: wait
      task_config:
        duration:
          seconds: 5
`
	// Not a manifest (no apiVersion): namespace-scanned only, never
	// manifest-validated — the seedpack-tile shape.
	tileYaml := "name: some-tile\nprompt: \"uses ${ $context.env.TOPIC }\"\n"
	skillDoc := "# Skill\nUse `${ $env.TOPIC }` — but this file says $context.env.TOPIC once.\n"

	writeFixture := func(rel, content string) {
		path := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	writeFixture("workflows/bad.yaml", badManifest)
	writeFixture("workflows/good.yaml", goodManifest)
	writeFixture("tiles/tile.yaml", tileYaml)
	writeFixture("skills/SKILL.md", skillDoc)

	reg := mustBuildRegistries(t)
	var err error
	reg.rules, err = newDocsYamlRuleEval(ruleModeOff)
	if err != nil {
		t.Fatal(err)
	}

	summary, problems, err := checkAuthoringDirs([]string{dir}, reg)
	if err != nil {
		t.Fatalf("checkAuthoringDirs: %v", err)
	}
	if summary.Files != 4 {
		t.Errorf("expected 4 files scanned, got %d", summary.Files)
	}
	if summary.Manifests != 2 {
		t.Errorf("expected 2 manifests validated (the tile has no apiVersion), got %d", summary.Manifests)
	}

	var durationProblem, tileProblem, skillProblem bool
	for _, p := range problems {
		if strings.Contains(p.Msg, "WaitTaskConfig") && strings.HasSuffix(p.Path, "bad.yaml") {
			durationProblem = true
		}
		if strings.Contains(p.Msg, "$env.<VAR>") && strings.HasSuffix(p.Path, "tile.yaml") {
			tileProblem = true
		}
		if strings.Contains(p.Msg, "$env.<VAR>") && strings.HasSuffix(p.Path, "SKILL.md") {
			skillProblem = true
		}
		if strings.HasSuffix(p.Path, "good.yaml") {
			t.Errorf("good manifest should not be flagged: %s", p.Msg)
		}
	}
	if !durationProblem {
		t.Errorf("string duration in a raw manifest should be flagged, got %v", problems)
	}
	if !tileProblem || !skillProblem {
		t.Errorf("dead namespace should be flagged in both YAML and markdown files, got %v", problems)
	}
}

func TestGeneratedDocHint(t *testing.T) {
	cases := []struct {
		rel  string
		want string // substring; "" means no hint
	}{
		{"sdk/resources/agent.mdx", "gen-proto-sdk-docs"},
		{"guides/workflows/task-types/wait.mdx", "gen-task-docs"},
		{"cli/commands/connect.mdx", "gen-cli-docs"},
		{"guides/workflows/authoring.mdx", ""},
	}
	for _, tc := range cases {
		got := generatedDocHint("docs", filepath.Join("docs", tc.rel))
		if tc.want == "" && got != "" {
			t.Errorf("%s: expected no hint, got %q", tc.rel, got)
		}
		if tc.want != "" && !strings.Contains(got, tc.want) {
			t.Errorf("%s: hint %q does not contain %q", tc.rel, got, tc.want)
		}
	}
}

func TestDidYouMean(t *testing.T) {
	kinds := []string{"wait", "llm_call", "fork"}
	if got := didYouMean("waiit", kinds); !strings.Contains(got, `"wait"`) {
		t.Errorf("waiit: got %q", got)
	}
	if got := didYouMean("completely-different", kinds); got != "" {
		t.Errorf("distant input should give no suggestion, got %q", got)
	}
	if got := didYouMean("", kinds); got != "" {
		t.Errorf("empty input should give no suggestion, got %q", got)
	}
}
