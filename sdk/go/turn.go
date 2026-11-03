// Sending a message and waiting for the agent's answer, in one call.
//
// A turn is a run: SendAndWait creates it (Run.Create, as every turn
// starts) and follows the session's event log (Session.StreamEvents) until
// the turn ends or waits for a person's answer, then returns how it stands.
// WaitForTurn resumes that wait after the person answered. They are the Go
// form of the TypeScript client's sendAndWait and waitForTurn
// (sdk/typescript/src/session-events.ts), with the same input rules and
// the same outcome.
//
// The reading is split from the driving. turnReader is pure: it takes
// stream frames one at a time and folds only what an answer needs, the
// three rules of the shared fold (backend/libs/ts/session-log/src/fold.ts),
// which is the reference:
//
//   - a turn has ended when its newest stigmer.run.status phase is
//     completed, failed, cancelled or terminated;
//   - it waits when the session is idle with stop reason requires_action
//     naming one of its tool uses that asks for permission and has neither
//     a confirmation nor a result;
//   - its answer is the text of its last stored message on its primary
//     thread, the text blocks joined with nothing between them.
//
// It reads stored events only (a preview is never the answer) and each
// event once, by id. The cases in test/fixtures/turns, which the
// TypeScript, Python and Java clients read too, hold it to the fold.
//
// The driver opens the stream from the place it was given, reconnects from
// the last place delivered with a backoff from 500 ms up to 5 s, and ends
// with the error on a code a reconnect cannot fix (not found, permission
// denied, unauthenticated, invalid argument, failed precondition). It closes
// its stream the moment the reader decides, and on an error or the
// context's end, so a returned wait leaves nothing open on the server. The
// context bounds the whole wait, reconnections included.

package stigmer

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"go.stigmer.ai/sdk/internal/gen"
	sessionv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/session/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// TurnPhaseWaiting is the phase of a turn that waits for a person's answer
// to one of its Asks.
const TurnPhaseWaiting = "waiting"

// TurnOutcome is how a waited-for turn stands when the wait returns.
type TurnOutcome struct {
	// RunID is the run that is the turn.
	RunID string
	// SessionID is the session the turn runs in.
	SessionID string
	// Phase is completed, failed, cancelled or terminated once the turn
	// ended, or TurnPhaseWaiting when it waits for an answer to its Asks.
	Phase string
	// Answer is the text of the turn's last message on its primary thread;
	// "" when it wrote none.
	Answer string
	// StopCause says why the turn ended, once it has; "" otherwise.
	StopCause string
	// Error says what went wrong, when the turn failed or was stopped with
	// a reason; "" otherwise.
	Error string
	// Asks are the tool uses that wait for an answer, when Phase is
	// TurnPhaseWaiting; empty once the turn ended.
	Asks []TurnAsk
	// LastSeq is the log's place when the wait returned: pass it to
	// WaitForTurn to resume after answering the Asks.
	LastSeq int64
}

// TurnAsk is a tool use that waits for a person's answer. Answer it with
// the session's ConfirmToolUse or GrantPermission, which take its ID.
type TurnAsk struct {
	// ID is the tool use's event id.
	ID string
	// Name is the tool's name.
	Name string
}

// The reconnect backoff: the first wait, doubled per failure up to the
// longest. Variables so a test can shorten them.
var (
	turnBackoffBase = 500 * time.Millisecond
	turnBackoffMax  = 5 * time.Second
)

// The codes a reconnect cannot fix: the wait ends with the error.
var finalTurnCodes = map[codes.Code]bool{
	codes.NotFound:           true,
	codes.PermissionDenied:   true,
	codes.Unauthenticated:    true,
	codes.InvalidArgument:    true,
	codes.FailedPrecondition: true,
}

// The phases that end a turn.
var turnEndedPhases = map[string]bool{
	"completed":  true,
	"failed":     true,
	"cancelled":  true,
	"terminated": true,
}

// SendAndWait sends a message as a new turn and waits for its answer.
//
// The turn runs in input.SessionId, or in a session bootstrapped from
// input.SessionSpec: exactly one of them is required, and so is input.Org,
// the organization the turn runs in. Both are checked before any call. An
// empty input.Name becomes run-<epoch ms>, as the console names its turns.
// For an existing session the log's newest place is read first, so the
// wait sees only this turn's events.
//
// It returns when the turn ends (Phase completed, failed, cancelled or
// terminated) or waits for a person's answer (Phase TurnPhaseWaiting, with
// its Asks); answer each ask, then call WaitForTurn with the outcome's
// LastSeq. An error is the server's refusal (of the run, or of the stream
// with a code a reconnect cannot fix) or the context's end.
func (c *Client) SendAndWait(ctx context.Context, input *RunInput) (*TurnOutcome, error) {
	if input == nil || input.Org == "" {
		return nil, invalidTurnInput("sendAndWait: org is required — the organization the turn runs in, by id or slug")
	}
	if (input.SessionId == "") == (input.SessionSpec == nil) {
		return nil, invalidTurnInput("sendAndWait: exactly one of SessionId or SessionSpec is required — the session the turn continues, or the one to start")
	}

	var afterSeq int64
	if input.SessionId != "" {
		newest, err := c.newestSeq(ctx, input.SessionId)
		if err != nil {
			return nil, err
		}
		afterSeq = newest
	}

	run := *input
	if run.Name == "" {
		run.Name = fmt.Sprintf("run-%d", time.Now().UnixMilli())
	}
	created, err := c.Run.Create(ctx, &run)
	if err != nil {
		return nil, err
	}
	sessionID := created.GetSpec().GetSessionId()
	if sessionID == "" {
		sessionID = input.SessionId
	}
	if sessionID == "" {
		return nil, &gen.Error{Code: gen.CodeInternal, Message: "the created run names no session", GRPCCode: codes.Internal}
	}
	return c.waitForTurn(ctx, sessionID, created.GetMetadata().GetId(), afterSeq)
}

// WaitForTurn waits for one turn of a session: until it ends, or waits for
// an answer. afterSeq is where in the log the turn's events begin, or
// later: pass a previous outcome's LastSeq to resume after answering its
// Asks, or 0 to read the whole log.
func (c *Client) WaitForTurn(ctx context.Context, sessionID, runID string, afterSeq int64) (*TurnOutcome, error) {
	return c.waitForTurn(ctx, sessionID, runID, afterSeq)
}

// newestSeq is the newest event's place in a session's log; 0 for an empty log.
func (c *Client) newestSeq(ctx context.Context, sessionID string) (int64, error) {
	page, err := c.Session.ListEvents(ctx, &sessionv1.ListSessionEventsRequest{
		SessionId: sessionID,
		Order:     "desc",
		PageSize:  1,
	})
	if err != nil {
		return 0, err
	}
	if len(page.GetEvents()) == 0 {
		return 0, nil
	}
	return page.GetEvents()[0].GetSeq(), nil
}

func (c *Client) waitForTurn(ctx context.Context, sessionID, runID string, afterSeq int64) (*TurnOutcome, error) {
	reader := newTurnReader(runID)
	place := afterSeq
	failures := 0
	for {
		decided, err := c.followOnce(ctx, sessionID, reader, &place, &failures)
		if decided {
			outcome := reader.outcome()
			outcome.SessionID = sessionID
			return &outcome, nil
		}
		if ctx.Err() != nil {
			return nil, fmt.Errorf("stigmer: the wait for the turn was stopped: %w", ctx.Err())
		}
		if err != nil {
			var sdkErr *gen.Error
			if errors.As(err, &sdkErr) && finalTurnCodes[sdkErr.GRPCCode] {
				return nil, err
			}
		}
		wait := turnBackoffBase << failures
		if wait > turnBackoffMax || wait <= 0 {
			wait = turnBackoffMax
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, fmt.Errorf("stigmer: the wait for the turn was stopped: %w", ctx.Err())
		case <-timer.C:
		}
		failures++
	}
}

// followOnce reads one stream from place until the reader decides, the
// stream ends, or it fails; the stream is closed when it returns.
func (c *Client) followOnce(ctx context.Context, sessionID string, reader *turnReader, place *int64, failures *int) (bool, error) {
	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	after := *place
	stream, err := c.Session.StreamEvents(streamCtx, &sessionv1.StreamSessionEventsRequest{
		SessionId: sessionID,
		AfterSeq:  &after,
	})
	if err != nil {
		return false, err
	}
	for {
		frame, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		*failures = 0
		if seq := frame.GetEvent().GetSeq(); seq > *place {
			*place = seq
		}
		if reader.read(frame) {
			return true, nil
		}
	}
}

func invalidTurnInput(message string) error {
	return &gen.Error{Code: gen.CodeInvalidArgument, Message: message, GRPCCode: codes.InvalidArgument}
}

// turnReader folds one turn's facts from stream frames (file header).
type turnReader struct {
	runID      string
	seen       map[string]bool
	lastSeq    int64
	status     *sessionv1.StigmerRunStatusEvent
	answer     string
	toolUses   []turnToolUse
	answered   map[string]bool
	idle       bool
	stopReason string
	waitingOn  []string
}

type turnToolUse struct {
	id   string
	name string
	asks bool
}

func newTurnReader(runID string) *turnReader {
	return &turnReader{runID: runID, seen: map[string]bool{}, answered: map[string]bool{}}
}

// read folds one frame and reports whether the turn has ended or waits.
func (r *turnReader) read(frame *sessionv1.StreamSessionEventsResponse) bool {
	event := frame.GetEvent()
	if event == nil {
		// A preview: never the answer, never an end.
		return false
	}
	if event.GetSeq() > r.lastSeq {
		r.lastSeq = event.GetSeq()
	}
	if event.GetUserMessage() != nil && event.GetRunId() == "" {
		// A message waiting in the session's queue: its run's copy comes
		// later under the same id, so it is not marked as read.
		return false
	}
	if id := eventIDOf(event); id != "" {
		if r.seen[id] {
			return false
		}
		r.seen[id] = true
	}
	ours := event.GetRunId() == r.runID
	switch e := event.GetEvent().(type) {
	case *sessionv1.SessionEvent_SessionStatusRunning:
		r.idle, r.stopReason, r.waitingOn = false, "", nil
	case *sessionv1.SessionEvent_SessionStatusIdle:
		r.idle = true
		r.stopReason = e.SessionStatusIdle.GetStopReason().GetType()
		r.waitingOn = e.SessionStatusIdle.GetStopReason().GetEventIds()
	case *sessionv1.SessionEvent_AgentMessage:
		if ours && event.GetThreadId() == "" {
			r.answer = textOf(e.AgentMessage.GetContent())
		}
	case *sessionv1.SessionEvent_StigmerRunStatus:
		if ours {
			r.status = e.StigmerRunStatus
		}
	case *sessionv1.SessionEvent_AgentToolUse:
		if ours {
			r.toolUses = append(r.toolUses, turnToolUse{e.AgentToolUse.GetId(), e.AgentToolUse.GetName(), e.AgentToolUse.GetEvaluatedPermission() == "ask"})
		}
	case *sessionv1.SessionEvent_AgentMcpToolUse:
		if ours {
			r.toolUses = append(r.toolUses, turnToolUse{e.AgentMcpToolUse.GetId(), e.AgentMcpToolUse.GetName(), e.AgentMcpToolUse.GetEvaluatedPermission() == "ask"})
		}
	case *sessionv1.SessionEvent_UserToolConfirmation:
		r.answered[e.UserToolConfirmation.GetToolUseId()] = true
	case *sessionv1.SessionEvent_AgentToolResult:
		r.answered[e.AgentToolResult.GetToolUseId()] = true
	case *sessionv1.SessionEvent_AgentMcpToolResult:
		r.answered[e.AgentMcpToolResult.GetMcpToolUseId()] = true
	}
	return r.ended() || r.waiting()
}

func (r *turnReader) ended() bool {
	return r.status != nil && turnEndedPhases[r.status.GetPhase()]
}

func (r *turnReader) openAsks() []TurnAsk {
	var asks []TurnAsk
	for _, use := range r.toolUses {
		if use.asks && !r.answered[use.id] {
			asks = append(asks, TurnAsk{ID: use.id, Name: use.name})
		}
	}
	return asks
}

func (r *turnReader) waiting() bool {
	if !r.idle || r.stopReason != "requires_action" {
		return false
	}
	for _, ask := range r.openAsks() {
		for _, id := range r.waitingOn {
			if ask.ID == id {
				return true
			}
		}
	}
	return false
}

// outcome is how the turn stands; SessionID is the driver's to fill.
func (r *turnReader) outcome() TurnOutcome {
	outcome := TurnOutcome{
		RunID:     r.runID,
		Answer:    r.answer,
		StopCause: r.status.GetStopCause(),
		Error:     r.status.GetError(),
		LastSeq:   r.lastSeq,
	}
	switch {
	case r.ended():
		outcome.Phase = r.status.GetPhase()
	case r.waiting():
		outcome.Phase = TurnPhaseWaiting
		outcome.Asks = r.openAsks()
	default:
		outcome.Phase = r.status.GetPhase()
	}
	return outcome
}

// eventIDOf is the id every event in the oneof carries.
func eventIDOf(event *sessionv1.SessionEvent) string {
	message := event.ProtoReflect()
	field := message.WhichOneof(message.Descriptor().Oneofs().ByName("event"))
	if field == nil || field.Kind() != protoreflect.MessageKind {
		return ""
	}
	inner := message.Get(field).Message()
	idField := inner.Descriptor().Fields().ByName("id")
	if idField == nil {
		return ""
	}
	return inner.Get(idField).String()
}

// textOf is a content list's text blocks, joined with nothing between them.
func textOf(content []*sessionv1.ContentBlock) string {
	var b strings.Builder
	for _, block := range content {
		if block.GetType() == "text" {
			b.WriteString(block.GetText())
		}
	}
	return b.String()
}
