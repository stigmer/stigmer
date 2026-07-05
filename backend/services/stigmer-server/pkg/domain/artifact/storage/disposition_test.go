package storage

import (
	"context"
	"testing"
	"time"
)

func TestContentDispositionAttachment(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		want     string
	}{
		{
			name:     "plain ascii filename",
			filename: "plan_card_ux_cleanup.plan.md",
			want:     `attachment; filename="plan_card_ux_cleanup.plan.md"`,
		},
		{
			name:     "embedded quote is escaped, not broken out of",
			filename: `evil".md`,
			want:     `attachment; filename="evil\".md"`,
		},
		{
			name:     "non-ascii adds an RFC 5987 filename* fallback",
			filename: "café.md",
			want:     `attachment; filename="caf_.md"; filename*=UTF-8''caf%C3%A9.md`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ContentDispositionAttachment(tt.filename); got != tt.want {
				t.Errorf("ContentDispositionAttachment(%q) = %q, want %q", tt.filename, got, tt.want)
			}
		})
	}
}

func TestLocalStorageGetSignedURL_Disposition(t *testing.T) {
	s, err := NewLocalStorage(t.TempDir(), "http://localhost:7235")
	if err != nil {
		t.Fatalf("NewLocalStorage: %v", err)
	}

	ctx := context.Background()
	key := "artifacts/aex_1/plan.md"

	inline, err := s.GetSignedURL(ctx, key, time.Hour, "")
	if err != nil {
		t.Fatalf("GetSignedURL inline: %v", err)
	}
	if want := "http://localhost:7235/" + key; inline != want {
		t.Errorf("inline URL = %q, want %q", inline, want)
	}

	download, err := s.GetSignedURL(ctx, key, time.Hour, "my plan.plan.md")
	if err != nil {
		t.Fatalf("GetSignedURL download: %v", err)
	}
	// The filename is URL-encoded in the query string (space escaped).
	if want := "http://localhost:7235/" + key + "?download=my+plan.plan.md"; download != want {
		t.Errorf("download URL = %q, want %q", download, want)
	}
}
