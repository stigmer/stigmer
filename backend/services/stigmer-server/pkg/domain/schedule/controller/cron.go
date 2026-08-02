package schedule

import (
	"regexp"
	"strings"
	"time"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
)

// Lexical cron validation (DD-009 C-4).
//
// The platform owns NO cron parsing in either edition — calendar and DST
// semantics live in the Temporal server (DD-008 D2). What this file does
// instead is restrict the accepted GRAMMAR to the subset that is safe to
// store: the classic 5-field form plus the @daily-family shorthands.
//
// Everything rejected here is something Temporal's wider grammar would
// accept but that must not reach a stored spec:
//
//   - CRON_TZ=/TZ= prefixes carry a second timezone authority beside
//     spec.time_zone, and Temporal itself rejects the combination at
//     schedule-create time — accepting the prefix here would store a
//     spec that applies clean today and fails when the clock lands.
//   - @every compiles to an interval spec, bypassing the calendar model
//     and any firing floor.
//   - The 6- and 7-field forms add year and seconds columns; a seconds
//     column defeats the structural one-minute floor the 5-field
//     restriction guarantees.
//   - Trailing "#" comments are noise the resource's metadata already
//     covers.
//
// The Java edition (ValidateScheduleSpec) mirrors these checks with
// byte-identical messages; the shared rejection matrix is pinned by unit
// tests in both editions. Widening this grammar later is additive;
// narrowing it would break stored specs — start narrow.

// scheduleCronShorthands are the accepted @-shorthands — deliberately
// only the calendar ones Temporal documents (no @every, and none of the
// nonstandard aliases like @annually or @midnight some cron
// implementations accept).
var scheduleCronShorthands = map[string]bool{
	"@hourly":  true,
	"@daily":   true,
	"@weekly":  true,
	"@monthly": true,
	"@yearly":  true,
}

// scheduleCronFieldPattern bounds each field to the character set of
// Temporal's CalendarSpec ranges: digits, month/day names (Jan, MON),
// '*', ',', '-', '/'. Quartz-isms ('?', 'L', 'W', '#') and anything else
// are rejected — Temporal does not implement them.
var scheduleCronFieldPattern = regexp.MustCompile(`^[0-9A-Za-z*,/-]+$`)

// validateScheduleCron enforces the DD-009 C-4 grammar. Pure and
// deterministic; the error copy is the user-facing contract, mirrored
// byte-identically by the Java edition.
func validateScheduleCron(cron string) error {
	if strings.HasPrefix(cron, "CRON_TZ=") || strings.HasPrefix(cron, "TZ=") {
		return grpclib.InvalidArgumentError(
			"spec.cron must not carry a timezone prefix (CRON_TZ=/TZ=) — spec.time_zone is the single timezone authority")
	}

	if strings.Contains(cron, "#") {
		return grpclib.InvalidArgumentError(
			"spec.cron must not contain a comment (#)")
	}

	if strings.HasPrefix(cron, "@") {
		if strings.HasPrefix(cron, "@every") {
			return grpclib.InvalidArgumentError(
				"spec.cron must be a calendar expression — @every intervals are not supported")
		}
		if !scheduleCronShorthands[cron] {
			return grpclib.InvalidArgumentError(
				"spec.cron shorthand %q is not supported — use @hourly, @daily, @weekly, @monthly, or @yearly, or a 5-field cron expression", cron)
		}
		return nil
	}

	fields := strings.Fields(cron)
	if len(fields) != 5 {
		return grpclib.InvalidArgumentError(
			"spec.cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got %d", len(fields))
	}

	for _, field := range fields {
		if !scheduleCronFieldPattern.MatchString(field) {
			return grpclib.InvalidArgumentError(
				"spec.cron field %q contains unsupported characters — allowed: digits, names, '*', ',', '-', '/'", field)
		}
	}

	return nil
}

// validateScheduleTimeZone requires a name the platform tz database
// resolves (the Temporal server loads the same database when it
// evaluates the cron — DD-008 D2).
//
// "Local" is rejected explicitly: Go resolves it to the host's zone
// (nondeterministic across replicas) while Java's ZoneId does not
// resolve it at all — accepting it would be a cross-edition divergence
// on top of a correctness bug.
func validateScheduleTimeZone(timeZone string) error {
	if timeZone == "Local" {
		return grpclib.InvalidArgumentError(
			"spec.time_zone %q is not a valid IANA time zone (e.g. \"Asia/Kolkata\")", timeZone)
	}
	if _, err := time.LoadLocation(timeZone); err != nil {
		return grpclib.InvalidArgumentError(
			"spec.time_zone %q is not a valid IANA time zone (e.g. \"Asia/Kolkata\")", timeZone)
	}
	return nil
}
