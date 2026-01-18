package claimcheck_test

import (
	"compress/gzip"
	"strings"
	"testing"

	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/claimcheck"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGzipCompressor_TextPayload(t *testing.T) {
	compressor := claimcheck.NewGzipCompressor(gzip.DefaultCompression)

	// Large text payload (typical AI output)
	original := []byte(strings.Repeat("This is AI-generated content. ", 1000))
	originalSize := len(original)

	// Compress
	compressed, err := compressor.Compress(original)
	require.NoError(t, err)
	compressedSize := len(compressed)

	// Should achieve >50% compression on repetitive text
	assert.Less(t, compressedSize, originalSize/2, "Compression ratio insufficient")

	// Decompress
	decompressed, err := compressor.Decompress(compressed)
	require.NoError(t, err)

	// Should match original
	assert.Equal(t, original, decompressed)
}

func TestGzipCompressor_EmptyPayload(t *testing.T) {
	compressor := claimcheck.NewGzipCompressor(gzip.DefaultCompression)

	original := []byte("")

	compressed, err := compressor.Compress(original)
	require.NoError(t, err)

	decompressed, err := compressor.Decompress(compressed)
	require.NoError(t, err)

	assert.Equal(t, original, decompressed)
}

func TestGzipCompressor_LargePayload(t *testing.T) {
	compressor := claimcheck.NewGzipCompressor(gzip.DefaultCompression)

	// 1MB of text
	original := []byte(strings.Repeat("AI generated content. ", 50000))

	compressed, err := compressor.Compress(original)
	require.NoError(t, err)

	decompressed, err := compressor.Decompress(compressed)
	require.NoError(t, err)

	assert.Equal(t, original, decompressed)
}

func TestNoopCompressor(t *testing.T) {
	compressor := &claimcheck.NoopCompressor{}

	original := []byte("test data")

	compressed, err := compressor.Compress(original)
	require.NoError(t, err)
	assert.Equal(t, original, compressed)

	decompressed, err := compressor.Decompress(compressed)
	require.NoError(t, err)
	assert.Equal(t, original, decompressed)
}

func BenchmarkGzipCompress(b *testing.B) {
	compressor := claimcheck.NewGzipCompressor(gzip.DefaultCompression)
	data := []byte(strings.Repeat("AI generated content. ", 10000)) // ~220KB

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = compressor.Compress(data)
	}
}

func BenchmarkGzipDecompress(b *testing.B) {
	compressor := claimcheck.NewGzipCompressor(gzip.DefaultCompression)
	data := []byte(strings.Repeat("AI generated content. ", 10000)) // ~220KB
	compressed, _ := compressor.Compress(data)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = compressor.Decompress(compressed)
	}
}
