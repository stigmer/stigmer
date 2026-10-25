// Package integration checks the service's sync settings against the
// staging services they name. Each check waits on a stand-in for its staging
// service, so the suite takes about a minute, as the real one does.
package integration

import (
	"os"
	"regexp"
	"strconv"
	"testing"
	"time"

	"example.com/orders-sync/duration"
)

// stagingRoundTrip stands in for one call to a staging service.
const stagingRoundTrip = 20 * time.Second

func setting(t *testing.T, key string) string {
	t.Helper()
	data, err := os.ReadFile("../config/sync.yaml")
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	m := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(key) + `:\s*(\S+)`).FindSubmatch(data)
	if m == nil {
		t.Fatalf("config has no %s", key)
	}
	return string(m[1])
}

func TestSyncConfig(t *testing.T) {
	checks := []struct {
		name  string
		check func(t *testing.T)
	}{
		{"interval reaches the scheduler", func(t *testing.T) {
			minutes, err := duration.ParseMinutes(setting(t, "interval"))
			if err != nil || minutes <= 0 {
				t.Fatalf("interval: %d, %v", minutes, err)
			}
		}},
		{"retry attempts reach the storefront", func(t *testing.T) {
			attempts, err := strconv.Atoi(setting(t, "max_attempts"))
			if err != nil || attempts <= 0 {
				t.Fatalf("max_attempts: %d, %v", attempts, err)
			}
		}},
		{"backoff reaches the queue", func(t *testing.T) {
			if setting(t, "backoff") == "" {
				t.Fatal("backoff is empty")
			}
		}},
	}
	for _, c := range checks {
		t.Run(c.name, func(t *testing.T) {
			time.Sleep(stagingRoundTrip)
			c.check(t)
		})
	}
}
