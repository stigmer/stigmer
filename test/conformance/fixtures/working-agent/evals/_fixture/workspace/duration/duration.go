// Package duration parses the human-readable durations the service's
// configuration uses.
package duration

import (
	"fmt"
	"strconv"
	"strings"
)

// ParseMinutes parses a duration such as "1h30m" or "45m" and returns the
// total number of whole minutes.
func ParseMinutes(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("parse %q: empty duration", s)
	}
	total := 0
	rest := s
	for rest != "" {
		i := 0
		for i < len(rest) && rest[i] >= '0' && rest[i] <= '9' {
			i++
		}
		if i == 0 || i == len(rest) {
			return 0, fmt.Errorf("parse %q: expected a number followed by a unit", s)
		}
		n, err := strconv.Atoi(rest[:i])
		if err != nil {
			return 0, fmt.Errorf("parse %q: %w", s, err)
		}
		switch rest[i] {
		case 'h':
			total += n * 60
		case 'm':
			total += n
		default:
			return 0, fmt.Errorf("parse %q: unknown unit %q", s, rest[i])
		}
		rest = rest[i+1:]
	}
	return total, nil
}
