package stigmer

// Regression coverage for issue #342: the generated toProto methods
// discarded structpb conversion errors, so a structpb-unsupported value in
// a struct-kind input field (e.g. a []map[string]any of human_input
// outcomes — a natural way to build a list of outcome objects) silently
// applied an EMPTY task config. The workflow was accepted and the gate
// lost its prompt, ui_hint, and outcomes with no failure until a human
// noticed at runtime.
//
// The fix is normalize-then-error: values structpb rejects are normalized
// through a JSON round-trip (so natural typed slices/maps just work), and
// only values JSON cannot represent either surface a structured
// CodeInvalidArgument error from the mutation call, naming the field path.
//
// Like workspace_source_roundtrip_test.go (#254), these tests exercise the
// *checked-in generated code* against the real proto stubs through the
// public Apply call, capturing the exact wire message with an in-memory
// gRPC server. They live at the SDK root because internal/gen is wiped and
// regenerated wholesale.

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/test/bufconn"
)

type workflowCaptureServer struct {
	workflowv1.UnimplementedWorkflowCommandControllerServer
	lastWorkflow *workflowv1.Workflow
}

func (s *workflowCaptureServer) Apply(_ context.Context, req *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	s.lastWorkflow = req
	return req, nil
}

func newWorkflowCaptureClient(t *testing.T) (*Client, *workflowCaptureServer) {
	t.Helper()

	capture := &workflowCaptureServer{}
	lis := bufconn.Listen(1024 * 1024)
	srv := grpc.NewServer()
	workflowv1.RegisterWorkflowCommandControllerServer(srv, capture)

	go func() { _ = srv.Serve(lis) }()

	client, err := NewClient(
		WithBaseURL("passthrough:///bufnet"),
		WithInsecure(),
		WithDialOptions(grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(ctx)
		})),
	)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	t.Cleanup(func() {
		_ = client.Close()
		srv.Stop()
		_ = lis.Close()
	})

	return client, capture
}

func reviewGateInput(taskConfig map[string]any) *WorkflowInput {
	return &WorkflowInput{
		Org:  "acme",
		Name: "review-flow",
		Tasks: []*WorkflowTaskInput{{
			Name:       "review",
			Kind:       workflowv1.WorkflowTaskKind_human_input,
			TaskConfig: taskConfig,
		}},
	}
}

// assertReviewGateWire fails unless the wire task_config carries the full
// gate configuration. An empty/nil task_config is the exact #342 regression.
func assertReviewGateWire(t *testing.T, wf *workflowv1.Workflow) {
	t.Helper()
	tasks := wf.GetSpec().GetTasks()
	if len(tasks) != 1 {
		t.Fatalf("wire tasks = %d, want 1", len(tasks))
	}
	tc := tasks[0].GetTaskConfig()
	if tc == nil || len(tc.GetFields()) == 0 {
		t.Fatal("task_config empty on the wire (regression #342)")
	}
	got := tc.AsMap()
	if got["prompt"] != "Review this" {
		t.Errorf("prompt = %v, want %q", got["prompt"], "Review this")
	}
	if got["ui_hint"] != "my-renderer" {
		t.Errorf("ui_hint = %v, want %q", got["ui_hint"], "my-renderer")
	}
	outcomes, ok := got["outcomes"].([]any)
	if !ok || len(outcomes) != 1 {
		t.Fatalf("outcomes = %#v, want one-element list", got["outcomes"])
	}
	outcome, ok := outcomes[0].(map[string]any)
	if !ok || outcome["name"] != "approve" || outcome["label"] != "Approve" {
		t.Errorf("outcome = %#v, want {name: approve, label: Approve}", outcomes[0])
	}
}

func TestTaskConfigConversion_TypedSliceNormalizes(t *testing.T) {
	// The issue #342 repro verbatim: []map[string]any is not in structpb's
	// supported set, so this task config used to arrive EMPTY.
	client, capture := newWorkflowCaptureClient(t)

	_, err := client.Workflow.Apply(context.Background(), reviewGateInput(map[string]any{
		"prompt":   "Review this",
		"ui_hint":  "my-renderer",
		"outcomes": []map[string]any{{"name": "approve", "label": "Approve"}},
	}))
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	assertReviewGateWire(t, capture.lastWorkflow)
}

func TestTaskConfigConversion_FastPathUnchanged(t *testing.T) {
	// []any is structpb-native and must keep converting exactly as before
	// (the normalization fallback never runs for it).
	client, capture := newWorkflowCaptureClient(t)

	_, err := client.Workflow.Apply(context.Background(), reviewGateInput(map[string]any{
		"prompt":   "Review this",
		"ui_hint":  "my-renderer",
		"outcomes": []any{map[string]any{"name": "approve", "label": "Approve"}},
	}))
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	assertReviewGateWire(t, capture.lastWorkflow)
}

func TestTaskConfigConversion_UnrepresentableValueFailsLoud(t *testing.T) {
	// A value neither structpb nor JSON can represent must fail the Apply
	// with a structured CodeInvalidArgument error naming the field path —
	// never apply with a silently-empty config.
	client, capture := newWorkflowCaptureClient(t)

	_, err := client.Workflow.Apply(context.Background(), reviewGateInput(map[string]any{
		"prompt":  "Review this",
		"blocked": make(chan int),
	}))
	if err == nil {
		t.Fatal("Apply accepted an unrepresentable task config value")
	}

	var sErr *Error
	if !errors.As(err, &sErr) {
		t.Fatalf("error is %T, want *stigmer.Error: %v", err, err)
	}
	if sErr.Code != CodeInvalidArgument {
		t.Errorf("code = %v, want CodeInvalidArgument", sErr.Code)
	}
	if !strings.Contains(sErr.Message, "Tasks[0]: TaskConfig:") {
		t.Errorf("message %q does not locate the offending field (want prefix \"Tasks[0]: TaskConfig:\")", sErr.Message)
	}

	if capture.lastWorkflow != nil {
		t.Error("request reached the server despite the conversion failure")
	}
}
