package harness

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
)

// Cross-repo pinned strings (cloud: ScheduleArtifact.TICK_ID_PREFIX /
// PROBE_ID_PREFIX in stigmer-cloud). The tick prefix is baked into every
// per-resource Temporal Schedule artifact's id AND base workflow id —
// changing it on either side strands every existing artifact, so both
// sides pin it in tests.
const (
	// ScheduleTickIDPrefix prefixes each Schedule resource's Temporal
	// Schedule artifact id: schedule/tick/{scheduleResourceId}.
	ScheduleTickIDPrefix = "schedule/tick/"

	// ScheduleProbeIDPrefix prefixes the write path's throwaway fire-time
	// probe schedules. Always paused; leftovers mean a crashed request and
	// are reaped by the cloud reconciliation sweep.
	ScheduleProbeIDPrefix = "schedule/probe/"
)

// ScheduleArtifactID returns the Temporal Schedule artifact id for a
// Schedule resource id — the cloud runtime's identity convention.
func ScheduleArtifactID(scheduleResourceID string) string {
	return ScheduleTickIDPrefix + scheduleResourceID
}

// ScheduleInspector asserts on the Temporal Schedule artifacts the cloud
// service derives from Schedule resources (T04 slice 2a) — the
// TemporalInspector sibling for the schedules API, and the first consumer
// of the Temporal Go SDK's ScheduleClient in this repo.
type ScheduleInspector struct {
	client client.Client
}

// NewScheduleInspector wraps an existing Temporal client connection.
func NewScheduleInspector(c client.Client) *ScheduleInspector {
	return &ScheduleInspector{client: c}
}

// DescribeArtifact returns the live artifact for a Schedule resource id.
func (si *ScheduleInspector) DescribeArtifact(
	ctx context.Context, scheduleResourceID string) (*client.ScheduleDescription, error) {
	desc, err := si.client.ScheduleClient().
		GetHandle(ctx, ScheduleArtifactID(scheduleResourceID)).Describe(ctx)
	if err != nil {
		return nil, fmt.Errorf("describe schedule artifact %s: %w",
			ScheduleArtifactID(scheduleResourceID), err)
	}
	return desc, nil
}

// ArtifactExists reports whether the resource's artifact exists, mapping
// Temporal's not-found error to false rather than an error.
func (si *ScheduleInspector) ArtifactExists(
	ctx context.Context, scheduleResourceID string) (bool, error) {
	_, err := si.client.ScheduleClient().
		GetHandle(ctx, ScheduleArtifactID(scheduleResourceID)).Describe(ctx)
	if err == nil {
		return true, nil
	}
	var notFound *serviceerror.NotFound
	if errors.As(err, &notFound) {
		return false, nil
	}
	return false, fmt.Errorf("describe schedule artifact %s: %w",
		ScheduleArtifactID(scheduleResourceID), err)
}

// TriggerArtifact forces an immediate fire — the fast, deterministic test
// path (spike-verified: a triggered action carries the same nominal-time
// search attribute and workflow-id suffix a cron fire does), instead of
// parking the suite on a cron minute boundary.
func (si *ScheduleInspector) TriggerArtifact(
	ctx context.Context, scheduleResourceID string) error {
	return si.client.ScheduleClient().
		GetHandle(ctx, ScheduleArtifactID(scheduleResourceID)).
		Trigger(ctx, client.ScheduleTriggerOptions{})
}

// ListProbeLeftovers returns the ids of any fire-time probe schedules
// still live — a refusal path must leave nothing behind.
func (si *ScheduleInspector) ListProbeLeftovers(ctx context.Context) ([]string, error) {
	iter, err := si.client.ScheduleClient().List(ctx, client.ScheduleListOptions{PageSize: 100})
	if err != nil {
		return nil, fmt.Errorf("list schedules: %w", err)
	}
	var leftovers []string
	for iter.HasNext() {
		entry, err := iter.Next()
		if err != nil {
			return nil, fmt.Errorf("iterate schedules: %w", err)
		}
		if strings.HasPrefix(entry.ID, ScheduleProbeIDPrefix) {
			leftovers = append(leftovers, entry.ID)
		}
	}
	return leftovers, nil
}
