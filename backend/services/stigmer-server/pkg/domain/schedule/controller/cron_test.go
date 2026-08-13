package schedule

import (
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// The cron/timezone rejection matrix (DD-009 C-4). The Java edition
// (ScheduleSpecRulesTest) asserts the SAME inputs against the SAME
// message text — a change on either side must change both, or the two
// editions drift on a user-facing contract.

func TestValidateScheduleCron_AcceptedForms(t *testing.T) {
	accepted := []string{
		"0 9 * * *",         // daily at 09:00
		"*/5 * * * *",       // every 5 minutes
		"0 0 1,15 * *",      // 1st and 15th
		"30 8 * * MON-FRI",  // weekday names
		"0 12 * Jan,Apr *",  // month names
		"15 8-17 * * 0-6/2", // ranges with steps
		"@hourly",           // shorthands
		"@daily",
		"@weekly",
		"@monthly",
		"@yearly",
		"  0 9 * * *  ", // surrounding whitespace collapses
	}
	for _, cron := range accepted {
		if err := validateScheduleCron(cron); err != nil {
			t.Errorf("validateScheduleCron(%q) should be accepted, got: %v", cron, err)
		}
	}
}

func TestValidateScheduleCron_RejectedForms(t *testing.T) {
	tests := []struct {
		name        string
		cron        string
		wantMessage string
	}{
		{
			// spec.time_zone is the single timezone authority; Temporal
			// itself rejects prefix+timezone at schedule-create time, so
			// accepting the prefix here would store a spec that detonates
			// when the clock lands.
			name:        "CRON_TZ prefix",
			cron:        "CRON_TZ=America/New_York 0 9 * * *",
			wantMessage: "spec.cron must not carry a timezone prefix (CRON_TZ=/TZ=) — spec.time_zone is the single timezone authority",
		},
		{
			name:        "TZ prefix",
			cron:        "TZ=UTC 0 9 * * *",
			wantMessage: "spec.cron must not carry a timezone prefix (CRON_TZ=/TZ=) — spec.time_zone is the single timezone authority",
		},
		{
			// Compiles to an interval spec in Temporal — bypasses the
			// calendar model and the structural firing floor.
			name:        "@every interval",
			cron:        "@every 30s",
			wantMessage: "spec.cron must be a calendar expression — @every intervals are not supported",
		},
		{
			name:        "unsupported shorthand @annually",
			cron:        "@annually",
			wantMessage: `spec.cron shorthand "@annually" is not supported — use @hourly, @daily, @weekly, @monthly, or @yearly, or a 5-field cron expression`,
		},
		{
			name:        "unsupported shorthand @midnight",
			cron:        "@midnight",
			wantMessage: `spec.cron shorthand "@midnight" is not supported — use @hourly, @daily, @weekly, @monthly, or @yearly, or a 5-field cron expression`,
		},
		{
			name:        "trailing comment",
			cron:        "0 9 * * * # fee reminders",
			wantMessage: "spec.cron must not contain a comment (#)",
		},
		{
			// The 6-field form adds a year column.
			name:        "6 fields",
			cron:        "0 9 * * * 2027",
			wantMessage: "spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got 6",
		},
		{
			// The 7-field form leads with SECONDS — "every second" would
			// be expressible, defeating the structural one-minute floor.
			name:        "7 fields",
			cron:        "* * * * * * *",
			wantMessage: "spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got 7",
		},
		{
			name:        "too few fields",
			cron:        "0 9 *",
			wantMessage: "spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got 3",
		},
		{
			name:        "whitespace only",
			cron:        "   ",
			wantMessage: "spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got 0",
		},
		{
			// Quartz-ism: Temporal's CalendarSpec does not implement '?'.
			name:        "quartz question mark",
			cron:        "0 9 ? * *",
			wantMessage: `spec.cron field "?" contains unsupported characters — allowed: digits, names, '*', ',', '-', '/'`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateScheduleCron(tt.cron)
			if err == nil {
				t.Fatalf("validateScheduleCron(%q) should be rejected", tt.cron)
			}
			st, ok := status.FromError(err)
			if !ok {
				t.Fatalf("expected a gRPC status error, got: %v", err)
			}
			if st.Code() != codes.InvalidArgument {
				t.Errorf("expected INVALID_ARGUMENT, got %s", st.Code())
			}
			if st.Message() != tt.wantMessage {
				t.Errorf("message mismatch (the cloud edition pins the same string):\n got: %s\nwant: %s",
					st.Message(), tt.wantMessage)
			}
		})
	}
}

func TestValidateScheduleTimeZone(t *testing.T) {
	for _, zone := range []string{"UTC", "Asia/Kolkata", "America/New_York", "Europe/Berlin"} {
		if err := validateScheduleTimeZone(zone); err != nil {
			t.Errorf("validateScheduleTimeZone(%q) should be accepted, got: %v", zone, err)
		}
	}

	rejected := []struct {
		name string
		zone string
	}{
		{"garbage", "Not/AZone"},
		{"abbreviation-ish garbage", "GMT+5"},
		// "Local" resolves to the HOST's zone in Go (nondeterministic
		// across replicas) and not at all in Java — rejected explicitly
		// for cross-edition parity.
		{"Local", "Local"},
	}
	for _, tt := range rejected {
		t.Run(tt.name, func(t *testing.T) {
			err := validateScheduleTimeZone(tt.zone)
			if err == nil {
				t.Fatalf("validateScheduleTimeZone(%q) should be rejected", tt.zone)
			}
			st, _ := status.FromError(err)
			if st.Code() != codes.InvalidArgument {
				t.Errorf("expected INVALID_ARGUMENT, got %s", st.Code())
			}
			want := `spec.time_zone "` + tt.zone + `" is not a valid IANA time zone (e.g. "Asia/Kolkata")`
			if st.Message() != want {
				t.Errorf("message mismatch:\n got: %s\nwant: %s", st.Message(), want)
			}
			if !strings.Contains(st.Message(), tt.zone) {
				t.Errorf("message should name the rejected zone %q: %s", tt.zone, st.Message())
			}
		})
	}
}
