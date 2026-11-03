// Pins SendAndWait and WaitForTurn (turn.go).
//
// The reader is held to the shared turn cases in test/fixtures/turns, which
// the TypeScript client reads through the fold itself: a rule that drifts
// here fails naming the case. The driver is pinned against a served fake
// over bufconn: it checks the org and the session before any call, names
// the run run-<epoch ms>, reads from the newest place of an existing
// session, reconnects from the last place delivered after a drop, ends on
// a code a reconnect cannot fix, closes its stream once the turn is
// decided, and stops at the context's deadline across reconnections.

package stigmer

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"sync"
	"testing"
	"time"

	runv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/run/v1"
	sessionv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/session/v1"
	"go.stigmer.ai/sdk/proto/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/encoding/protojson"
)

type turnCase struct {
	Description string            `json:"description"`
	RunID       string            `json:"runId"`
	Frames      []json.RawMessage `json:"frames"`
	Expect      struct {
		Decided   bool      `json:"decided"`
		Phase     string    `json:"phase"`
		Answer    string    `json:"answer"`
		StopCause string    `json:"stopCause"`
		Error     string    `json:"error"`
		Asks      []TurnAsk `json:"asks"`
		LastSeq   string    `json:"lastSeq"`
	} `json:"expect"`
}

func TestTurnReaderSharedCases(t *testing.T) {
	dir := filepath.Join("..", "..", "test", "fixtures", "turns")
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil || len(files) < 10 {
		t.Fatalf("the shared turn cases in %s: %d files, %v", dir, len(files), err)
	}
	sort.Strings(files)
	for _, file := range files {
		t.Run(filepath.Base(file), func(t *testing.T) {
			raw, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			var c turnCase
			if err := json.Unmarshal(raw, &c); err != nil {
				t.Fatal(err)
			}
			reader := newTurnReader(c.RunID)
			decided := false
			for i, rawFrame := range c.Frames {
				frame := &sessionv1.StreamSessionEventsResponse{}
				if err := protojson.Unmarshal(rawFrame, frame); err != nil {
					t.Fatalf("frame %d: %v", i, err)
				}
				if reader.read(frame) {
					decided = true
					break
				}
			}
			if decided != c.Expect.Decided {
				t.Fatalf("%s: decided %v, want %v", c.Description, decided, c.Expect.Decided)
			}
			if !decided {
				return
			}
			got := reader.outcome()
			wantSeq, _ := strconv.ParseInt(c.Expect.LastSeq, 10, 64)
			if got.Phase != c.Expect.Phase || got.Answer != c.Expect.Answer || got.StopCause != c.Expect.StopCause ||
				got.Error != c.Expect.Error || got.LastSeq != wantSeq || !sameAsks(got.Asks, c.Expect.Asks) || got.RunID != c.RunID {
				t.Fatalf("%s\n got: %+v\nwant: %+v", c.Description, got, c.Expect)
			}
		})
	}
}

func sameAsks(got, want []TurnAsk) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// ── The driver, against a served fake ─────────────────────────────────────

// A stream step: frames to send, then how the stream ends — nil returns
// (a normal end), an error fails it, and hold keeps it open until the
// client closes it.
type streamStep struct {
	frames []*sessionv1.StreamSessionEventsResponse
	err    error
	hold   bool
}

type turnFake struct {
	sessionv1.UnimplementedSessionQueryControllerServer
	runv1.UnimplementedRunCommandControllerServer

	mu       sync.Mutex
	newest   int64
	steps    []streamStep
	requests []*sessionv1.StreamSessionEventsRequest
	lists    int
	created  []*runv1.Run
	closed   chan struct{}
}

func (f *turnFake) ListEvents(_ context.Context, _ *sessionv1.ListSessionEventsRequest) (*sessionv1.SessionEventList, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lists++
	if f.newest == 0 {
		return &sessionv1.SessionEventList{}, nil
	}
	return &sessionv1.SessionEventList{Events: []*sessionv1.SessionEvent{{Seq: f.newest}}}, nil
}

func (f *turnFake) StreamEvents(req *sessionv1.StreamSessionEventsRequest, stream sessionv1.SessionQueryController_StreamEventsServer) error {
	f.mu.Lock()
	f.requests = append(f.requests, req)
	step := streamStep{hold: true}
	if len(f.steps) > 0 {
		step, f.steps = f.steps[0], f.steps[1:]
	}
	f.mu.Unlock()
	for _, frame := range step.frames {
		if err := stream.Send(frame); err != nil {
			return err
		}
	}
	if step.err != nil {
		return step.err
	}
	if step.hold {
		<-stream.Context().Done()
		f.closed <- struct{}{}
	}
	return nil
}

func (f *turnFake) Create(_ context.Context, run *runv1.Run) (*runv1.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.created = append(f.created, run)
	sessionID := run.GetSpec().GetSessionId()
	if sessionID == "" {
		sessionID = "ses_new"
	}
	return &runv1.Run{
		Metadata: &apiresource.ApiResourceMetadata{Id: "run_1"},
		Spec:     &runv1.RunSpec{Target: &runv1.RunSpec_SessionId{SessionId: sessionID}},
	}, nil
}

func newTurnClient(t *testing.T, fake *turnFake) *Client {
	t.Helper()
	fake.closed = make(chan struct{}, 8)
	lis := bufconn.Listen(1024 * 1024)
	srv := grpc.NewServer()
	sessionv1.RegisterSessionQueryControllerServer(srv, fake)
	runv1.RegisterRunCommandControllerServer(srv, fake)
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
	base, max := turnBackoffBase, turnBackoffMax
	turnBackoffBase, turnBackoffMax = 5*time.Millisecond, 20*time.Millisecond
	t.Cleanup(func() {
		turnBackoffBase, turnBackoffMax = base, max
		_ = client.Close()
		srv.Stop()
		_ = lis.Close()
	})
	return client
}

func event(seq int64, runID string, e *sessionv1.SessionEvent) *sessionv1.StreamSessionEventsResponse {
	e.Seq, e.SessionId, e.RunId = seq, "ses_1", runID
	return &sessionv1.StreamSessionEventsResponse{Frame: &sessionv1.StreamSessionEventsResponse_Event{Event: e}}
}

func message(seq int64, id, text string) *sessionv1.StreamSessionEventsResponse {
	return event(seq, "run_1", &sessionv1.SessionEvent{Event: &sessionv1.SessionEvent_AgentMessage{AgentMessage: &sessionv1.AgentMessageEvent{
		Id: id, Content: []*sessionv1.ContentBlock{{Type: "text", Text: text}},
	}}})
}

func runStatus(seq int64, id, phase string) *sessionv1.StreamSessionEventsResponse {
	return event(seq, "run_1", &sessionv1.SessionEvent{Event: &sessionv1.SessionEvent_StigmerRunStatus{StigmerRunStatus: &sessionv1.StigmerRunStatusEvent{
		Id: id, Phase: phase,
	}}})
}

// bounded is the context every driver test waits with: a broken rule that
// leaves the wait open fails here in seconds instead of hanging the suite.
func bounded(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func awaitClosed(t *testing.T, fake *turnFake) {
	t.Helper()
	select {
	case <-fake.closed:
	case <-time.After(5 * time.Second):
		t.Fatal("the stream was left open after the wait returned")
	}
}

func TestSendAndWaitChecksItsInputBeforeAnyCall(t *testing.T) {
	fake := &turnFake{}
	client := newTurnClient(t, fake)
	ctx := bounded(t)
	cases := map[string]*RunInput{
		"no org":                {SessionId: "ses_1", Message: "hi"},
		"no session or spec":    {Org: "acme", Message: "hi"},
		"both session and spec": {Org: "acme", SessionId: "ses_1", SessionSpec: &SessionSpecInput{}, Message: "hi"},
	}
	for name, input := range cases {
		_, err := client.SendAndWait(ctx, input)
		var sdkErr *Error
		if !errors.As(err, &sdkErr) || sdkErr.Code != CodeInvalidArgument {
			t.Errorf("%s: want invalid-argument, got %v", name, err)
		}
	}
	if _, err := client.SendAndWait(ctx, nil); err == nil {
		t.Error("nil input: want an error")
	}
	if fake.lists != 0 || len(fake.created) != 0 || len(fake.requests) != 0 {
		t.Fatalf("calls were made: %d lists, %d creates, %d streams", fake.lists, len(fake.created), len(fake.requests))
	}
}

func TestSendAndWaitReconnectsFromTheLastPlaceAndClosesItsStream(t *testing.T) {
	fake := &turnFake{
		newest: 7,
		steps: []streamStep{
			{frames: []*sessionv1.StreamSessionEventsResponse{message(8, "m8", "Working.")}, err: status.Error(codes.Unavailable, "gone")},
			{frames: []*sessionv1.StreamSessionEventsResponse{message(9, "m9", "Hello."), runStatus(10, "st10", "completed")}, hold: true},
		},
	}
	client := newTurnClient(t, fake)
	outcome, err := client.SendAndWait(bounded(t), &RunInput{Org: "acme", SessionId: "ses_1", Message: "hi"})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Phase != "completed" || outcome.Answer != "Hello." || outcome.RunID != "run_1" || outcome.SessionID != "ses_1" || outcome.LastSeq != 10 {
		t.Fatalf("outcome: %+v", outcome)
	}
	awaitClosed(t, fake)
	if got := []int64{fake.requests[0].GetAfterSeq(), fake.requests[1].GetAfterSeq()}; got[0] != 7 || got[1] != 8 {
		t.Fatalf("after_seq per stream: %v, want [7 8]", got)
	}
	if name := fake.created[0].GetMetadata().GetName(); !regexp.MustCompile(`^run-\d+$`).MatchString(name) {
		t.Fatalf("run name %q, want run-<epoch ms>", name)
	}
	if fake.created[0].GetMetadata().GetOrg() != "acme" {
		t.Fatalf("run org %q", fake.created[0].GetMetadata().GetOrg())
	}
}

func TestSendAndWaitInANewSessionReadsTheWholeLogAndKeepsAGivenName(t *testing.T) {
	fake := &turnFake{steps: []streamStep{
		{frames: []*sessionv1.StreamSessionEventsResponse{message(1, "m1", "Hi."), runStatus(2, "st2", "completed")}, hold: true},
	}}
	client := newTurnClient(t, fake)
	outcome, err := client.SendAndWait(bounded(t), &RunInput{
		Org: "acme", Name: "mine", Message: "hi",
		SessionSpec: &SessionSpecInput{AgentRef: ResourceRef{Org: "acme", Slug: "greeter"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	awaitClosed(t, fake)
	if fake.lists != 0 || fake.requests[0].AfterSeq == nil || fake.requests[0].GetAfterSeq() != 0 {
		t.Fatalf("a new session's log is read whole: %d lists, after_seq %v", fake.lists, fake.requests[0].AfterSeq)
	}
	if outcome.SessionID != "ses_new" || fake.created[0].GetMetadata().GetName() != "mine" {
		t.Fatalf("outcome %+v, name %q", outcome, fake.created[0].GetMetadata().GetName())
	}
}

func TestWaitForTurnEndsOnAFinalCodeWithoutRetrying(t *testing.T) {
	fake := &turnFake{steps: []streamStep{{err: status.Error(codes.PermissionDenied, "no")}}}
	client := newTurnClient(t, fake)
	_, err := client.WaitForTurn(bounded(t), "ses_1", "run_1", 0)
	if !IsPermissionDenied(err) {
		t.Fatalf("want permission-denied, got %v", err)
	}
	if len(fake.requests) != 1 {
		t.Fatalf("a final code was retried: %d streams", len(fake.requests))
	}
}

func TestWaitForTurnStopsAtTheDeadlineAcrossReconnectsAndClosesItsStream(t *testing.T) {
	fake := &turnFake{steps: []streamStep{
		{err: status.Error(codes.Unavailable, "gone")},
		{err: status.Error(codes.Unavailable, "gone")},
		{hold: true},
	}}
	client := newTurnClient(t, fake)
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := client.WaitForTurn(ctx, "ses_1", "run_1", 0)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want the deadline, got %v", err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("the deadline did not bound the wait: %v", elapsed)
	}
	if len(fake.requests) != 3 {
		t.Fatalf("streams: %d, want 3 (two drops, then the held one)", len(fake.requests))
	}
	awaitClosed(t, fake)
}

func TestWaitForTurnReturnsTheAsksOfAWaitingTurn(t *testing.T) {
	ask := event(3, "run_1", &sessionv1.SessionEvent{Event: &sessionv1.SessionEvent_AgentToolUse{AgentToolUse: &sessionv1.AgentToolUseEvent{
		Id: "t3", Name: "Bash", EvaluatedPermission: "ask",
	}}})
	idle := event(4, "", &sessionv1.SessionEvent{Event: &sessionv1.SessionEvent_SessionStatusIdle{SessionStatusIdle: &sessionv1.SessionStatusIdleEvent{
		Id: "i4", StopReason: &sessionv1.StopReason{Type: "requires_action", EventIds: []string{"t3"}},
	}}})
	fake := &turnFake{steps: []streamStep{{frames: []*sessionv1.StreamSessionEventsResponse{ask, idle}, hold: true}}}
	client := newTurnClient(t, fake)
	outcome, err := client.WaitForTurn(bounded(t), "ses_1", "run_1", 2)
	if err != nil {
		t.Fatal(err)
	}
	awaitClosed(t, fake)
	if outcome.Phase != TurnPhaseWaiting || len(outcome.Asks) != 1 || outcome.Asks[0] != (TurnAsk{ID: "t3", Name: "Bash"}) || outcome.LastSeq != 4 {
		t.Fatalf("outcome: %+v", outcome)
	}
}
