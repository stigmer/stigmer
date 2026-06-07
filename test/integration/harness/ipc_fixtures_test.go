package harness

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Conformance test for the Go IPC mirror (ipcCommand/ipcResponse in unified_runner.go).
// It asserts the harness serializes commands to, and deserializes responses from, the exact
// golden wire shapes generated from backend/services/runner/src/ipc-protocol.ts. This is the
// Go arm of the cross-language conformance suite (Rust: crates/stigmer-runner-host/src/
// protocol.rs; TS: src/__tests__/ipc-protocol-fixtures.test.ts). No runner process is
// started — this is a pure wire-shape check. It runs with the integration suite because the
// mirror lives in this module; the fast gate's freshness guard forces fixture regeneration
// whenever the contract changes.

// ipcFixtures is the shape of fixtures/ipc-protocol.generated.json. Messages stay as
// RawMessage so each is compared with the harness's own (de)serialization, not a second
// hand-typed mirror.
type ipcFixtures struct {
	IpcProtocolVersion int                        `json:"ipcProtocolVersion"`
	Commands           map[string]json.RawMessage `json:"commands"`
	Responses          map[string]json.RawMessage `json:"responses"`
}

// goldenFixturesPath resolves the canonical artifact relative to this test file, so it is
// independent of the working directory the test runs from.
func goldenFixturesPath(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	require.True(t, ok, "runtime.Caller failed to locate the test file")
	repoRoot := filepath.Join(filepath.Dir(thisFile), "..", "..", "..")
	return filepath.Join(repoRoot, "backend", "services", "runner", "fixtures", "ipc-protocol.generated.json")
}

func loadGoldenFixtures(t *testing.T) ipcFixtures {
	t.Helper()
	raw, err := os.ReadFile(goldenFixturesPath(t))
	require.NoError(t, err, "read golden IPC fixtures — run `make gen-ipc-fixtures`")
	var fx ipcFixtures
	require.NoError(t, json.Unmarshal(raw, &fx), "parse golden IPC fixtures")
	return fx
}

func TestIPCFixtures_ProtocolVersion(t *testing.T) {
	// The harness reads ProtocolVersion off `ready` (see StartUnifiedRunnerManager); the
	// fixture pins the version the runner advertises, so keep them aligned.
	assert.Equal(t, 1, loadGoldenFixtures(t).IpcProtocolVersion)
}

func TestIPCFixtures_CommandsSerializeToGoldenWire(t *testing.T) {
	fx := loadGoldenFixtures(t)
	token := "tok_example"
	cases := map[string]ipcCommand{
		"addSession":              {Type: "addSession", SessionID: "ses_example"},
		"removeSession":           {Type: "removeSession", SessionID: "ses_example"},
		"addWorkflowExecution":    {Type: "addWorkflowExecution", ExecutionID: "wfe_example"},
		"removeWorkflowExecution": {Type: "removeWorkflowExecution", ExecutionID: "wfe_example"},
		"updateTokenSet":          {Type: "updateToken", Token: &token},
		"shutdown":                {Type: "shutdown"},
	}
	for name, cmd := range cases {
		got, err := json.Marshal(cmd)
		require.NoError(t, err, "marshal command %q", name)
		assert.JSONEq(t, string(fx.Commands[name]), string(got),
			"command %q drifted from the golden fixture", name)
	}
}

// TestIPCFixtures_ClearTokenToleratedDeviation pins a known, intentional gap. The harness's
// ipcCommand.Token uses `omitempty`, so a cleared token marshals to `{"type":"updateToken"}`
// (field absent), not the canonical `{"type":"updateToken","token":null}` that the TS runner
// and Rust host emit. The runner treats an absent token as a clear, so this is a tolerated
// wire deviation, not a correctness bug. It is asserted explicitly so any future change to
// the struct must consciously update this expectation — and so the deviation is documented
// in exactly one place rather than silently diverging.
func TestIPCFixtures_ClearTokenToleratedDeviation(t *testing.T) {
	fx := loadGoldenFixtures(t)

	got, err := json.Marshal(ipcCommand{Type: "updateToken", Token: nil})
	require.NoError(t, err)
	assert.JSONEq(t, `{"type":"updateToken"}`, string(got),
		"harness clears a token by omitting the field (omitempty)")

	// The harness must still accept the canonical clear shape on the wire: parsing
	// `token:null` yields a nil token, matching the field-absent intent.
	var parsed ipcCommand
	require.NoError(t, json.Unmarshal(fx.Commands["updateTokenCleared"], &parsed))
	assert.Nil(t, parsed.Token, "canonical token:null must parse to a nil token")
}

func TestIPCFixtures_ResponsesDeserializeFromGoldenWire(t *testing.T) {
	fx := loadGoldenFixtures(t)
	resp := func(key string) ipcResponse {
		var r ipcResponse
		require.NoError(t, json.Unmarshal(fx.Responses[key], &r), "unmarshal response %q", key)
		return r
	}

	assert.Equal(t, 1, resp("ready").ProtocolVersion)
	assert.Equal(t, 0, resp("readyLegacy").ProtocolVersion, "absent version must default to zero")

	sessionAdded := resp("sessionAdded")
	assert.Equal(t, "ses_example", sessionAdded.SessionID)
	assert.Equal(t, "session:ses_example", sessionAdded.TaskQueue)

	assert.Equal(t, "ses_example", resp("sessionRemoved").SessionID)

	wfAdded := resp("workflowExecutionAdded")
	assert.Equal(t, "wfe_example", wfAdded.ExecutionID)
	assert.Equal(t, "wfexec:wfe_example", wfAdded.TaskQueue)

	assert.Equal(t, "wfe_example", resp("workflowExecutionRemoved").ExecutionID)

	assert.Equal(t, "tokenUpdated", resp("tokenUpdated").Type)

	errResp := resp("error")
	assert.Equal(t, "boom", errResp.Message)
	assert.True(t, errResp.Fatal)

	assert.Equal(t, "shutdownComplete", resp("shutdownComplete").Type)
}
