package stigmer

// Regression coverage for issue #342: the generated toProto methods
// discarded structpb conversion errors, so a structpb-unsupported value in
// a struct-kind input field (e.g. a []map[string]any — a natural way to
// build a list of objects in Go) silently sent an EMPTY struct. The
// request was accepted and the caller's data was lost with no failure
// until someone noticed at runtime.
//
// The fix is normalize-then-error: values structpb rejects are normalized
// through a JSON round-trip (so natural typed slices/maps just work), and
// only values JSON cannot represent either surface a structured
// CodeInvalidArgument error from the mutation call, naming the field path.
//
// The struct-kind input field these tests drive is an agent run's
// structured_output_schema. Like workspace_source_roundtrip_test.go (#254),
// they exercise the *checked-in generated code* against the real proto
// stubs through the public Create call, capturing the exact wire message
// with an in-memory gRPC server. They live at the SDK root because
// internal/gen is wiped and regenerated wholesale.

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"

	runv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/run/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/test/bufconn"
)

type runCaptureServer struct {
	runv1.UnimplementedRunCommandControllerServer
	lastRun *runv1.Run
}

func (s *runCaptureServer) Create(_ context.Context, req *runv1.Run) (*runv1.Run, error) {
	s.lastRun = req
	return req, nil
}

func newRunCaptureClient(t *testing.T) (*Client, *runCaptureServer) {
	t.Helper()

	capture := &runCaptureServer{}
	lis := bufconn.Listen(1024 * 1024)
	srv := grpc.NewServer()
	runv1.RegisterRunCommandControllerServer(srv, capture)

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

func verdictRunInput(schema map[string]any) *RunInput {
	return &RunInput{
		Org:                    "acme",
		SessionId:              "ses-1",
		Message:                "Review this change.",
		StructuredOutputSchema: schema,
	}
}

// assertVerdictSchemaWire fails unless the wire structured_output_schema
// carries the full schema. An empty/nil struct is the exact #342
// regression.
func assertVerdictSchemaWire(t *testing.T, run *runv1.Run) {
	t.Helper()
	schema := run.GetSpec().GetStructuredOutputSchema()
	if schema == nil || len(schema.GetFields()) == 0 {
		t.Fatal("structured_output_schema empty on the wire (regression #342)")
	}
	got := schema.AsMap()
	if got["type"] != "object" {
		t.Errorf("type = %v, want %q", got["type"], "object")
	}
	if got["title"] != "Verdict" {
		t.Errorf("title = %v, want %q", got["title"], "Verdict")
	}
	examples, ok := got["examples"].([]any)
	if !ok || len(examples) != 1 {
		t.Fatalf("examples = %#v, want one-element list", got["examples"])
	}
	example, ok := examples[0].(map[string]any)
	if !ok || example["outcome"] != "approve" || example["label"] != "Approve" {
		t.Errorf("example = %#v, want {outcome: approve, label: Approve}", examples[0])
	}
}

func TestStructConversion_TypedSliceNormalizes(t *testing.T) {
	// The issue #342 shape: []map[string]any is not in structpb's
	// supported set, so this struct used to arrive EMPTY.
	client, capture := newRunCaptureClient(t)

	_, err := client.Run.Create(context.Background(), verdictRunInput(map[string]any{
		"type":     "object",
		"title":    "Verdict",
		"examples": []map[string]any{{"outcome": "approve", "label": "Approve"}},
	}))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	assertVerdictSchemaWire(t, capture.lastRun)
}

func TestStructConversion_FastPathUnchanged(t *testing.T) {
	// []any is structpb-native and must keep converting exactly as before
	// (the normalization fallback never runs for it).
	client, capture := newRunCaptureClient(t)

	_, err := client.Run.Create(context.Background(), verdictRunInput(map[string]any{
		"type":     "object",
		"title":    "Verdict",
		"examples": []any{map[string]any{"outcome": "approve", "label": "Approve"}},
	}))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	assertVerdictSchemaWire(t, capture.lastRun)
}

func TestStructConversion_UnrepresentableValueFailsLoud(t *testing.T) {
	// A value neither structpb nor JSON can represent must fail the Create
	// with a structured CodeInvalidArgument error naming the field path —
	// never send a silently-empty struct.
	client, capture := newRunCaptureClient(t)

	_, err := client.Run.Create(context.Background(), verdictRunInput(map[string]any{
		"type":    "object",
		"blocked": make(chan int),
	}))
	if err == nil {
		t.Fatal("Create accepted an unrepresentable struct value")
	}

	var sErr *Error
	if !errors.As(err, &sErr) {
		t.Fatalf("error is %T, want *stigmer.Error: %v", err, err)
	}
	if sErr.Code != CodeInvalidArgument {
		t.Errorf("code = %v, want CodeInvalidArgument", sErr.Code)
	}
	if !strings.Contains(sErr.Message, "StructuredOutputSchema:") {
		t.Errorf("message %q does not locate the offending field (want prefix \"StructuredOutputSchema:\")", sErr.Message)
	}

	if capture.lastRun != nil {
		t.Error("request reached the server despite the conversion failure")
	}
}
