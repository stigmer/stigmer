package claimcheck

import (
	"sync/atomic"
	"time"
)

// Metrics tracks claim check performance
type Metrics struct {
	offloadCount         atomic.Int64
	retrievalCount       atomic.Int64
	totalBytesStored     atomic.Int64
	avgUploadLatencyMS   atomic.Int64
	avgDownloadLatencyMS atomic.Int64
}

// IncrementOffloadCount increments the offload counter
func (m *Metrics) IncrementOffloadCount() {
	m.offloadCount.Add(1)
}

// IncrementRetrievalCount increments the retrieval counter
func (m *Metrics) IncrementRetrievalCount() {
	m.retrievalCount.Add(1)
}

// AddBytesStored adds to the total bytes stored
func (m *Metrics) AddBytesStored(bytes int64) {
	m.totalBytesStored.Add(bytes)
}

// RecordUploadLatency records upload latency
func (m *Metrics) RecordUploadLatency(duration time.Duration) {
	// Simple moving average (can be improved with proper stats)
	m.avgUploadLatencyMS.Store(duration.Milliseconds())
}

// RecordDownloadLatency records download latency
func (m *Metrics) RecordDownloadLatency(duration time.Duration) {
	m.avgDownloadLatencyMS.Store(duration.Milliseconds())
}

// Snapshot returns current metrics snapshot
func (m *Metrics) Snapshot() MetricsSnapshot {
	return MetricsSnapshot{
		OffloadCount:         m.offloadCount.Load(),
		RetrievalCount:       m.retrievalCount.Load(),
		TotalBytesStored:     m.totalBytesStored.Load(),
		AvgUploadLatencyMS:   m.avgUploadLatencyMS.Load(),
		AvgDownloadLatencyMS: m.avgDownloadLatencyMS.Load(),
	}
}

// MetricsSnapshot is a point-in-time snapshot of metrics
type MetricsSnapshot struct {
	OffloadCount         int64
	RetrievalCount       int64
	TotalBytesStored     int64
	AvgUploadLatencyMS   int64
	AvgDownloadLatencyMS int64
}
