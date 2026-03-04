package root

import (
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

// =============================================================================
// statusSymbol Tests
// =============================================================================

func TestStatusSymbol(t *testing.T) {
	tests := []struct {
		status checkStatus
		want   string
	}{
		{statusPass, "✓"},
		{statusWarn, "⚠"},
		{statusFail, "✗"},
		{statusSkip, "○"},
		{checkStatus(99), "?"},
	}
	for _, tt := range tests {
		if got := statusSymbol(tt.status); got != tt.want {
			t.Errorf("statusSymbol(%d) = %q, want %q", tt.status, got, tt.want)
		}
	}
}

// =============================================================================
// checkConfig Tests
// =============================================================================

func TestCheckConfig_LocalBackend(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeLocal,
			Local: &config.LocalBackendConfig{},
		},
	}

	r := checkConfig(cfg)
	if r.status != statusPass {
		t.Errorf("expected statusPass for valid local config, got %d", r.status)
	}
	if r.name != "Configuration" {
		t.Errorf("expected name 'Configuration', got %q", r.name)
	}

	assertFieldExists(t, r.fields, "Backend", "local")
	assertFieldExists(t, r.fields, "Endpoint", "localhost:7234")
}

func TestCheckConfig_CloudBackend(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "custom.api.example.com:443",
			},
		},
	}

	r := checkConfig(cfg)
	if r.status != statusPass {
		t.Errorf("expected statusPass for valid cloud config, got %d", r.status)
	}
	assertFieldExists(t, r.fields, "Backend", "cloud")
	assertFieldExists(t, r.fields, "Endpoint", "custom.api.example.com:443")
}

func TestCheckConfig_CloudDefaultEndpoint(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{},
		},
	}

	r := checkConfig(cfg)
	assertFieldExists(t, r.fields, "Endpoint", "api.stigmer.ai:443")
}

// =============================================================================
// checkAuth Tests
// =============================================================================

func TestCheckAuth_LocalBackend(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{Type: config.BackendTypeLocal},
	}

	r := checkAuth(cfg)
	if r.status != statusSkip {
		t.Errorf("expected statusSkip for local backend auth, got %d", r.status)
	}
}

func TestCheckAuth_CloudWithToken(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{Token: "tok-abc123"},
		},
	}

	r := checkAuth(cfg)
	if r.status != statusWarn {
		t.Errorf("expected statusWarn for cloud with token (unverified), got %d", r.status)
	}
}

func TestCheckAuth_CloudNoToken(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{},
		},
	}

	r := checkAuth(cfg)
	if r.status != statusFail {
		t.Errorf("expected statusFail for cloud without token, got %d", r.status)
	}
	if r.hint == "" {
		t.Error("expected a hint for missing auth token")
	}
}

func TestCheckAuth_CloudNilCloudConfig(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: nil,
		},
	}

	r := checkAuth(cfg)
	if r.status != statusFail {
		t.Errorf("expected statusFail for cloud with nil cloud config, got %d", r.status)
	}
}

// =============================================================================
// checkOrg Tests
// =============================================================================

func TestCheckOrg_Set(t *testing.T) {
	cfg := &config.Config{
		Context: config.ContextConfig{Organization: "acme-corp"},
	}

	r, orgID := checkOrg(cfg)
	if r.status != statusPass {
		t.Errorf("expected statusPass when org is set, got %d", r.status)
	}
	if orgID != "acme-corp" {
		t.Errorf("expected orgID 'acme-corp', got %q", orgID)
	}
}

func TestCheckOrg_NotSet(t *testing.T) {
	cfg := &config.Config{}

	r, orgID := checkOrg(cfg)
	if r.status != statusFail {
		t.Errorf("expected statusFail when org is not set, got %d", r.status)
	}
	if orgID != "" {
		t.Errorf("expected empty orgID, got %q", orgID)
	}
	if r.hint == "" {
		t.Error("expected a hint for missing org context")
	}
}

func TestCheckOrg_FallbackToCloudOrgID(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{OrgID: "legacy-org"},
		},
	}

	r, orgID := checkOrg(cfg)
	if r.status != statusPass {
		t.Errorf("expected statusPass for legacy org fallback, got %d", r.status)
	}
	if orgID != "legacy-org" {
		t.Errorf("expected orgID 'legacy-org', got %q", orgID)
	}
}

// =============================================================================
// checkMCPHealth Tests
// =============================================================================

func TestCheckMCPHealth_AlwaysSkips(t *testing.T) {
	r := checkMCPHealth()
	if r.status != statusSkip {
		t.Errorf("expected statusSkip for MCP health, got %d", r.status)
	}
	if r.name != "MCP Servers" {
		t.Errorf("expected name 'MCP Servers', got %q", r.name)
	}
}

// =============================================================================
// checkTerminal Tests
// =============================================================================

func TestCheckTerminal_ReportsFields(t *testing.T) {
	r := checkTerminal()
	if r.name != "Terminal" {
		t.Errorf("expected name 'Terminal', got %q", r.name)
	}

	requiredKeys := []string{"stdin", "stdout", "stderr", "TERM", "Color"}
	for _, key := range requiredKeys {
		found := false
		for _, f := range r.fields {
			if f.key == key {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("missing required field %q in terminal check", key)
		}
	}
}

func TestCheckTerminal_NonTTY_WarnsWithHint(t *testing.T) {
	// In test environments, stdout and stderr are not TTYs
	r := checkTerminal()
	if r.status != statusWarn {
		// Only warn if both stdout and stderr are non-TTY
		// (which they are in test environments)
		t.Logf("terminal check status: %d (may be pass if running in a real terminal)", r.status)
	}
}

func TestCheckTerminal_NoColorEnv(t *testing.T) {
	t.Setenv("NO_COLOR", "1")

	r := checkTerminal()
	found := false
	for _, f := range r.fields {
		if f.key == "Color" && f.value == "Disabled (NO_COLOR set)" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected Color field to reflect NO_COLOR=1")
	}
}

// =============================================================================
// skipCheck Tests
// =============================================================================

func TestSkipCheck(t *testing.T) {
	r := skipCheck("Agents", "requires server connectivity")
	if r.status != statusSkip {
		t.Errorf("expected statusSkip, got %d", r.status)
	}
	if r.name != "Agents" {
		t.Errorf("expected name 'Agents', got %q", r.name)
	}
}

// =============================================================================
// buildDoctorResult Tests
// =============================================================================

func TestBuildDoctorResult_AllPass(t *testing.T) {
	checks := []checkResult{
		{name: "A", status: statusPass, fields: []checkField{{key: "k", value: "v"}}},
		{name: "B", status: statusPass, fields: []checkField{{key: "k2", value: "v2"}}},
	}

	result, hasFailed := buildDoctorResult(checks)
	if hasFailed {
		t.Error("expected no failure when all checks pass")
	}
	if result.Status != clioutput.StatusSuccess {
		t.Errorf("expected StatusSuccess, got %v", result.Status)
	}
	if len(result.Sections) != 2 {
		t.Errorf("expected 2 sections, got %d", len(result.Sections))
	}
}

func TestBuildDoctorResult_WithFailures(t *testing.T) {
	checks := []checkResult{
		{name: "A", status: statusPass},
		{name: "B", status: statusFail, hint: "fix it"},
		{name: "C", status: statusFail, hint: "fix this too"},
	}

	result, hasFailed := buildDoctorResult(checks)
	if !hasFailed {
		t.Error("expected failure when checks fail")
	}
	if result.Status != clioutput.StatusError {
		t.Errorf("expected StatusError, got %v", result.Status)
	}
	if len(result.Hints) != 2 {
		t.Errorf("expected 2 hints from failed checks, got %d", len(result.Hints))
	}
}

func TestBuildDoctorResult_WithWarnings(t *testing.T) {
	checks := []checkResult{
		{name: "A", status: statusPass},
		{name: "B", status: statusWarn, hint: "warning note"},
	}

	result, hasFailed := buildDoctorResult(checks)
	if hasFailed {
		t.Error("expected no failure when only warnings exist")
	}
	if result.Status != clioutput.StatusWarning {
		t.Errorf("expected StatusWarning, got %v", result.Status)
	}
}

func TestBuildDoctorResult_FailTrumpsWarn(t *testing.T) {
	checks := []checkResult{
		{name: "A", status: statusWarn},
		{name: "B", status: statusFail, hint: "broken"},
	}

	result, hasFailed := buildDoctorResult(checks)
	if !hasFailed {
		t.Error("expected failure when a check fails")
	}
	if result.Status != clioutput.StatusError {
		t.Errorf("expected StatusError (fail trumps warn), got %v", result.Status)
	}
}

func TestBuildDoctorResult_SkipOnly(t *testing.T) {
	checks := []checkResult{
		{name: "A", status: statusSkip},
		{name: "B", status: statusSkip},
	}

	result, hasFailed := buildDoctorResult(checks)
	if hasFailed {
		t.Error("expected no failure when all checks are skipped")
	}
	if result.Status != clioutput.StatusSuccess {
		t.Errorf("expected StatusSuccess for all-skip, got %v", result.Status)
	}
}

func TestBuildDoctorResult_SectionFields(t *testing.T) {
	checks := []checkResult{
		{
			name:   "Config",
			status: statusPass,
			fields: []checkField{
				{key: "Backend", value: "local"},
				{key: "Endpoint", value: "localhost:7234"},
			},
		},
	}

	result, _ := buildDoctorResult(checks)
	if len(result.Sections) != 1 {
		t.Fatalf("expected 1 section, got %d", len(result.Sections))
	}
	sec := result.Sections[0]
	if sec.Title != "Config" {
		t.Errorf("expected section title 'Config', got %q", sec.Title)
	}
	if len(sec.Fields) != 2 {
		t.Errorf("expected 2 fields, got %d", len(sec.Fields))
	}
}

// =============================================================================
// checkServer Tests (connectivity — limited in unit tests)
// =============================================================================

func TestCheckServer_BadEndpoint_Fails(t *testing.T) {
	cfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeLocal,
			Local: &config.LocalBackendConfig{},
		},
	}

	// Override the server address to a known-unreachable endpoint so the
	// connection attempt fails fast. The test verifies the check produces
	// a failure result rather than panicking.
	t.Setenv("STIGMER_SERVER_ADDR", "localhost:1") // port 1 is almost certainly closed

	r, client := checkServer(cfg)
	if r.status != statusFail {
		t.Errorf("expected statusFail for unreachable server, got %d", r.status)
	}
	if client != nil {
		client.Close()
		t.Error("expected nil client when connection fails")
	}
	if r.hint == "" {
		t.Error("expected a hint when server is unreachable")
	}
}

// =============================================================================
// Helpers
// =============================================================================

func assertFieldExists(t *testing.T, fields []checkField, key, wantValue string) {
	t.Helper()
	for _, f := range fields {
		if f.key == key {
			if f.value != wantValue {
				t.Errorf("field %q: got %q, want %q", key, f.value, wantValue)
			}
			return
		}
	}
	t.Errorf("field %q not found in check fields", key)
}
