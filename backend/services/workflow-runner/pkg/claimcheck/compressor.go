package claimcheck

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
)

// Compressor handles payload compression
type Compressor interface {
	Compress(data []byte) ([]byte, error)
	Decompress(data []byte) ([]byte, error)
}

// GzipCompressor uses gzip compression
type GzipCompressor struct {
	level int // gzip.BestSpeed, gzip.DefaultCompression, gzip.BestCompression
}

// NewGzipCompressor creates compressor with specified level
func NewGzipCompressor(level int) *GzipCompressor {
	return &GzipCompressor{level: level}
}

// Compress compresses data using gzip
func (c *GzipCompressor) Compress(data []byte) ([]byte, error) {
	var buf bytes.Buffer

	writer, err := gzip.NewWriterLevel(&buf, c.level)
	if err != nil {
		return nil, fmt.Errorf("gzip writer creation failed: %w", err)
	}

	_, err = writer.Write(data)
	if err != nil {
		writer.Close()
		return nil, fmt.Errorf("gzip write failed: %w", err)
	}

	err = writer.Close()
	if err != nil {
		return nil, fmt.Errorf("gzip close failed: %w", err)
	}

	return buf.Bytes(), nil
}

// Decompress decompresses gzip data
func (c *GzipCompressor) Decompress(data []byte) ([]byte, error) {
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("gzip reader creation failed: %w", err)
	}
	defer reader.Close()

	decompressed, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("gzip read failed: %w", err)
	}

	return decompressed, nil
}

// NoopCompressor does no compression (for binary data)
type NoopCompressor struct{}

// Compress returns data unchanged
func (c *NoopCompressor) Compress(data []byte) ([]byte, error) {
	return data, nil
}

// Decompress returns data unchanged
func (c *NoopCompressor) Decompress(data []byte) ([]byte, error) {
	return data, nil
}
