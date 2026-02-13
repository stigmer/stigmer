package bootstrap

import "testing"

func TestGetStatusSymbol(t *testing.T) {
	tests := []struct {
		status string
		want   string
	}{
		{StatusCompleted, "✓"},
		{StatusFailed, "✗"},
		{StatusInProgress, "↻"},
		{StatusPending, "○"},
		{"", "○"},
		{"unknown", "?"},
	}

	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			got := GetStatusSymbol(tt.status)
			if got != tt.want {
				t.Errorf("GetStatusSymbol(%q) = %q, want %q", tt.status, got, tt.want)
			}
		})
	}
}

func TestGetStatusDisplay(t *testing.T) {
	tests := []struct {
		status string
		want   string
	}{
		{StatusCompleted, "Completed"},
		{StatusFailed, "Failed"},
		{StatusInProgress, "In Progress"},
		{StatusPending, "Pending"},
		{"", "Not Started"},
		{"custom", "custom"},
	}

	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			got := GetStatusDisplay(tt.status)
			if got != tt.want {
				t.Errorf("GetStatusDisplay(%q) = %q, want %q", tt.status, got, tt.want)
			}
		})
	}
}

func TestFormatResourceNames(t *testing.T) {
	tests := []struct {
		name      string
		resources []ResourceState
		want      string
	}{
		{
			name:      "empty",
			resources: []ResourceState{},
			want:      "none",
		},
		{
			name: "single",
			resources: []ResourceState{
				{Name: "skill-creator"},
			},
			want: "skill-creator",
		},
		{
			name: "multiple",
			resources: []ResourceState{
				{Name: "skill-creator"},
				{Name: "yaml-validator"},
			},
			want: "skill-creator, yaml-validator",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FormatResourceNames(tt.resources)
			if got != tt.want {
				t.Errorf("FormatResourceNames() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestExtractDigest(t *testing.T) {
	tests := []struct {
		state string
		want  string
	}{
		{"applied:sha256:abc123", "sha256:abc123"},
		{"applied:sha256:def456...", "sha256:def456..."},
		{"pending", "pending"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.state, func(t *testing.T) {
			got := extractDigest(tt.state)
			if got != tt.want {
				t.Errorf("extractDigest(%q) = %q, want %q", tt.state, got, tt.want)
			}
		})
	}
}

func TestParseBootstrapState(t *testing.T) {
	stateMap := map[string]string{
		"bootstrap_status":          "completed",
		"seedpack_version":          "1.1.0",
		"skill:skill-creator":       "applied:sha256:abc123",
		"agent:skill-creator-agent": "applied:sha256:def456",
	}

	status := parseBootstrapState(stateMap)

	if status.Status != "completed" {
		t.Errorf("Status = %q, want %q", status.Status, "completed")
	}
	if status.Version != "1.1.0" {
		t.Errorf("Version = %q, want %q", status.Version, "1.1.0")
	}
	if len(status.Skills) != 1 {
		t.Errorf("len(Skills) = %d, want 1", len(status.Skills))
	}
	if len(status.Agents) != 1 {
		t.Errorf("len(Agents) = %d, want 1", len(status.Agents))
	}
	if len(status.Skills) > 0 && status.Skills[0].Name != "skill-creator" {
		t.Errorf("Skills[0].Name = %q, want %q", status.Skills[0].Name, "skill-creator")
	}
	if len(status.Agents) > 0 && status.Agents[0].Name != "skill-creator-agent" {
		t.Errorf("Agents[0].Name = %q, want %q", status.Agents[0].Name, "skill-creator-agent")
	}
}
