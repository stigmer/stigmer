package claimcheck

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type contextKey string

const workflowExecutionIDKey contextKey = "claimcheck.workflowExecutionID"

// WithWorkflowExecutionID returns a context carrying the workflow execution ID
// for claim check proxy authorization headers.
func WithWorkflowExecutionID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, workflowExecutionIDKey, id)
}

func workflowExecutionIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(workflowExecutionIDKey).(string); ok {
		return v
	}
	return ""
}

// ProxyStore implements ObjectStore by requesting presigned URLs from the
// Stigmer Side-Channel Proxy. Actual upload/download goes directly to R2
// via the presigned URL — blob data never flows through the proxy.
//
// This mirrors the ArtifactProxyController presigned-URL pattern used by
// the agent-runner, eliminating the need for R2 credentials in the runner.
type ProxyStore struct {
	proxyEndpoint string
	authToken     string
	httpClient    *http.Client
}

type presignedUploadResponse struct {
	URL     string              `json:"url"`
	Method  string              `json:"method"`
	Headers map[string][]string `json:"headers"`
}

type presignedDownloadResponse struct {
	URL string `json:"url"`
}

// NewProxyStore creates a proxy-backed claim check store.
//
// The workflow execution ID is not set here — it varies per workflow and is
// passed via context using WithWorkflowExecutionID.
func NewProxyStore(proxyEndpoint, authToken string) (*ProxyStore, error) {
	if proxyEndpoint == "" {
		return nil, fmt.Errorf("proxy endpoint is required for proxy store")
	}
	if authToken == "" {
		return nil, fmt.Errorf("auth token is required for proxy store")
	}

	return &ProxyStore{
		proxyEndpoint: strings.TrimRight(proxyEndpoint, "/"),
		authToken:     authToken,
		httpClient: &http.Client{
			Timeout: 5 * time.Minute,
		},
	}, nil
}

func (p *ProxyStore) Put(ctx context.Context, data []byte) (string, error) {
	key := "claimcheck/" + uuid.New().String()

	presigned, err := p.getPresignedUploadURL(ctx, key)
	if err != nil {
		return "", fmt.Errorf("proxy presigned upload url failed: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, presigned.URL, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("proxy put: create request failed: %w", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	for k, vals := range presigned.Headers {
		for _, v := range vals {
			req.Header.Set(k, v)
		}
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("proxy put: upload failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return "", fmt.Errorf("proxy put: upload returned %d: %s", resp.StatusCode, string(body))
	}

	return key, nil
}

func (p *ProxyStore) Get(ctx context.Context, key string) ([]byte, error) {
	presigned, err := p.getPresignedDownloadURL(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("proxy presigned download url failed: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, presigned.URL, nil)
	if err != nil {
		return nil, fmt.Errorf("proxy get: create request failed: %w", err)
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("proxy get: download failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("proxy get: download returned %d: %s", resp.StatusCode, string(body))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("proxy get: read body failed: %w", err)
	}

	return data, nil
}

// Delete is a no-op in proxy mode — claim check blobs are TTL-managed on the bucket.
func (p *ProxyStore) Delete(_ context.Context, _ string) error {
	return nil
}

// Health verifies proxy reachability by requesting a presigned URL for a
// throwaway key. If the proxy responds successfully, connectivity is good.
func (p *ProxyStore) Health(ctx context.Context) error {
	healthKey := "claimcheck/" + uuid.New().String()
	_, err := p.getPresignedDownloadURL(ctx, healthKey)
	if err != nil {
		return fmt.Errorf("proxy health check failed: %w", err)
	}
	return nil
}

// ListKeys is not supported in proxy mode (debugging-only method).
func (p *ProxyStore) ListKeys(_ context.Context) ([]string, error) {
	return nil, fmt.Errorf("list keys not supported in proxy mode")
}

func (p *ProxyStore) getPresignedUploadURL(ctx context.Context, key string) (*presignedUploadResponse, error) {
	url := p.proxyEndpoint + "/v1/proxy/claimcheck/presigned-upload-url"

	body, err := json.Marshal(map[string]string{"key": key})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	p.setHeaders(ctx, req)

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("presigned upload url returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result presignedUploadResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode presigned upload response: %w", err)
	}
	return &result, nil
}

func (p *ProxyStore) getPresignedDownloadURL(ctx context.Context, key string) (*presignedDownloadResponse, error) {
	url := p.proxyEndpoint + "/v1/proxy/claimcheck/presigned-download-url"

	body, err := json.Marshal(map[string]string{"key": key})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	p.setHeaders(ctx, req)

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("presigned download url returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result presignedDownloadResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode presigned download response: %w", err)
	}
	return &result, nil
}

func (p *ProxyStore) setHeaders(ctx context.Context, req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.authToken)
	if wfID := workflowExecutionIDFromContext(ctx); wfID != "" {
		req.Header.Set("X-Stigmer-Workflow-Execution-Id", wfID)
	}
}
