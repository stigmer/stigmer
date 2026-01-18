package claimcheck

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// Manager orchestrates claim check operations
type Manager struct {
	store              ObjectStore
	compressor         Compressor
	thresholdBytes     int64
	compressionEnabled bool

	// Metrics (thread-safe via atomic)
	metrics Metrics
}

// NewManager creates ClaimCheckManager
func NewManager(cfg Config) (*Manager, error) {
	// Initialize Cloudflare R2 storage backend
	ctx := context.Background()
	store, err := NewR2Store(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize R2 store: %w", err)
	}

	// Initialize compressor
	var compressor Compressor
	if cfg.CompressionEnabled {
		compressor = NewGzipCompressor(gzip.DefaultCompression)
	} else {
		compressor = &NoopCompressor{}
	}

	return &Manager{
		store:              store,
		compressor:         compressor,
		thresholdBytes:     cfg.ThresholdBytes,
		compressionEnabled: cfg.CompressionEnabled,
	}, nil
}

// MaybeOffload checks payload size and offloads if needed
func (m *Manager) MaybeOffload(ctx workflow.Context, payload []byte) (interface{}, error) {
	originalSize := int64(len(payload))

	// Check threshold
	if originalSize < m.thresholdBytes {
		// Pass through - too small to offload
		return payload, nil
	}

	// Offload needed
	workflow.GetLogger(ctx).Info("Offloading large payload",
		"size_bytes", originalSize,
		"threshold", m.thresholdBytes)

	// Execute offload as activity (non-deterministic)
	// Set activity options with timeout
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute * 5, // 5 minutes for large uploads
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	activityCtx := workflow.WithActivityOptions(ctx, activityOptions)
	
	var ref ClaimCheckRef
	err := workflow.ExecuteActivity(activityCtx, m.OffloadActivity, payload).Get(activityCtx, &ref)
	if err != nil {
		return nil, fmt.Errorf("offload activity failed: %w", err)
	}

	// Update metrics
	m.metrics.IncrementOffloadCount()
	m.metrics.AddBytesStored(originalSize)

	return ref, nil
}

// MaybeRetrieve checks if input is reference and retrieves if needed
func (m *Manager) MaybeRetrieve(ctx workflow.Context, input interface{}) ([]byte, error) {
	// Check if input is claim check reference
	if !IsClaimCheckRef(input) {
		// Direct payload - pass through
		if data, ok := input.([]byte); ok {
			return data, nil
		}
		return nil, fmt.Errorf("input is not []byte or claim check reference")
	}

	// Convert to reference
	ref, err := ToClaimCheckRef(input)
	if err != nil {
		return nil, fmt.Errorf("failed to parse claim check reference: %w", err)
	}

	workflow.GetLogger(ctx).Info("Retrieving payload from storage",
		"key", ref.Key,
		"size_bytes", ref.SizeBytes)

	// Execute retrieval as activity
	// Set activity options with timeout
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute * 5, // 5 minutes for large downloads
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	activityCtx := workflow.WithActivityOptions(ctx, activityOptions)
	
	var payload []byte
	err = workflow.ExecuteActivity(activityCtx, m.RetrieveActivity, ref).Get(activityCtx, &payload)
	if err != nil {
		return nil, fmt.Errorf("retrieve activity failed: %w", err)
	}

	// Update metrics
	m.metrics.IncrementRetrievalCount()

	return payload, nil
}

// OffloadActivity uploads payload to storage (Temporal activity)
func (m *Manager) OffloadActivity(ctx context.Context, payload []byte) (ClaimCheckRef, error) {
	startTime := time.Now()
	originalSize := int64(len(payload))

	// Compress if enabled
	var dataToStore []byte
	var compressed bool
	var err error

	if m.compressionEnabled {
		dataToStore, err = m.compressor.Compress(payload)
		if err != nil {
			return ClaimCheckRef{}, fmt.Errorf("compression failed: %w", err)
		}
		compressed = true
	} else {
		dataToStore = payload
		compressed = false
	}

	// Upload to storage
	key, err := m.store.Put(ctx, dataToStore)
	if err != nil {
		return ClaimCheckRef{}, fmt.Errorf("storage put failed: %w", err)
	}

	// Record latency
	latency := time.Since(startTime)
	m.metrics.RecordUploadLatency(latency)

	// Create reference
	ref := CreateReference(key, originalSize, compressed)

	return ref, nil
}

// RetrieveActivity downloads payload from storage (Temporal activity)
func (m *Manager) RetrieveActivity(ctx context.Context, ref ClaimCheckRef) ([]byte, error) {
	startTime := time.Now()

	// Download from storage
	data, err := m.store.Get(ctx, ref.Key)
	if err != nil {
		return nil, fmt.Errorf("storage get failed: %w", err)
	}

	// Decompress if needed
	var payload []byte
	if ref.Compressed {
		payload, err = m.compressor.Decompress(data)
		if err != nil {
			return nil, fmt.Errorf("decompression failed: %w", err)
		}
	} else {
		payload = data
	}

	// Record latency
	latency := time.Since(startTime)
	m.metrics.RecordDownloadLatency(latency)

	return payload, nil
}

// MaybeOffloadStateData scans state data and offloads large fields
// This enables claim check between workflow steps, not just at the end
func (m *Manager) MaybeOffloadStateData(ctx workflow.Context, stateData map[string]any) (map[string]any, error) {
	logger := workflow.GetLogger(ctx)
	
	// Nothing to offload
	if stateData == nil {
		return stateData, nil
	}

	result := make(map[string]any)
	modified := false

	// Scan each field in state data
	for key, value := range stateData {
		// Skip nil values
		if value == nil {
			result[key] = value
			continue
		}

		// Skip if already a claim check reference
		if IsClaimCheckRef(value) {
			result[key] = value
			continue
		}

		// Try to serialize the field
		fieldData, err := serializeValue(value)
		if err != nil {
			logger.Debug("Skipping field - serialization failed",
				"field", key,
				"error", err)
			result[key] = value
			continue
		}

		fieldSize := int64(len(fieldData))

		// Check if this field exceeds threshold
		if fieldSize >= m.thresholdBytes {
			logger.Info("Offloading large state field",
				"field", key,
				"size_bytes", fieldSize,
				"threshold", m.thresholdBytes)

			// Offload this field
			processed, err := m.MaybeOffload(ctx, fieldData)
			if err != nil {
				logger.Warn("Failed to offload state field, keeping original",
					"field", key,
					"error", err)
				result[key] = value
				continue
			}

			// Check if it was actually offloaded
			if ref, ok := processed.(ClaimCheckRef); ok {
				logger.Info("State field offloaded to storage",
					"field", key,
					"key", ref.Key,
					"original_size", ref.SizeBytes)
				result[key] = ref
				modified = true
			} else {
				result[key] = value
			}
		} else {
			result[key] = value
		}
	}

	if modified {
		logger.Info("State data offloading complete - some fields offloaded")
	}

	return result, nil
}

// MaybeRetrieveStateData scans state data and retrieves any claim check references
// This auto-materializes offloaded data when needed by activities
func (m *Manager) MaybeRetrieveStateData(ctx workflow.Context, stateData map[string]any) (map[string]any, error) {
	logger := workflow.GetLogger(ctx)
	
	// Nothing to retrieve
	if stateData == nil {
		return stateData, nil
	}

	result := make(map[string]any)
	modified := false

	// Scan each field
	for key, value := range stateData {
		// Skip nil values
		if value == nil {
			result[key] = value
			continue
		}

		// Check if this is a claim check reference
		if IsClaimCheckRef(value) {
			logger.Info("Retrieving offloaded state field",
				"field", key)

			// Retrieve the data
			retrievedData, err := m.MaybeRetrieve(ctx, value)
			if err != nil {
				logger.Warn("Failed to retrieve state field, keeping reference",
					"field", key,
					"error", err)
				result[key] = value
				continue
			}

			// Try to unmarshal back to original structure
			var unmarshaled any
			if err := json.Unmarshal(retrievedData, &unmarshaled); err != nil {
				logger.Warn("Failed to unmarshal retrieved data, using raw bytes",
					"field", key,
					"error", err)
				result[key] = retrievedData
			} else {
				result[key] = unmarshaled
			}
			
			modified = true
		} else {
			result[key] = value
		}
	}

	if modified {
		logger.Info("State data retrieval complete - some fields retrieved")
	}

	return result, nil
}

// serializeValue converts any value to bytes
func serializeValue(value any) ([]byte, error) {
	if data, ok := value.([]byte); ok {
		return data, nil
	}
	return json.Marshal(value)
}

// Metrics returns current metrics
func (m *Manager) Metrics() MetricsSnapshot {
	return m.metrics.Snapshot()
}

// Health checks storage backend health
func (m *Manager) Health(ctx context.Context) error {
	return m.store.Health(ctx)
}
