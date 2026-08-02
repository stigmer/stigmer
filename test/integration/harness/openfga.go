package harness

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/testcontainers/testcontainers-go/modules/openfga"
)

// OpenFGAContainer holds a running OpenFGA instance and the store/model IDs
// created during test setup.
type OpenFGAContainer struct {
	Container    *openfga.OpenFGAContainer
	HTTPEndpoint string
	StoreID      string
	ModelID      string
}

// StartOpenFGA starts an OpenFGA container, creates a store, and writes the
// authorization model from the .fga source files in the stigmer-cloud repo.
//
// The fgaModelDir must point to the directory containing fga.mod and all
// referenced .fga files (typically stigmer-cloud's src/main/resources/fga/model/).
//
// Requires the `fga` CLI on PATH for DSL-to-JSON transformation.
func StartOpenFGA(ctx context.Context, fgaModelDir string) (*OpenFGAContainer, error) {
	container, err := openfga.Run(ctx, openFGAImage)
	if err != nil {
		return nil, fmt.Errorf("start openfga container: %w", err)
	}

	httpEndpoint, err := container.HttpEndpoint(ctx)
	if err != nil {
		return nil, fmt.Errorf("get openfga http endpoint: %w", err)
	}

	storeID, err := createStore(ctx, httpEndpoint, "integration-test")
	if err != nil {
		return nil, fmt.Errorf("create openfga store: %w", err)
	}

	modelJSON, err := transformFGAModel(ctx, fgaModelDir)
	if err != nil {
		return nil, fmt.Errorf("transform fga model: %w", err)
	}

	modelID, err := writeAuthorizationModel(ctx, httpEndpoint, storeID, modelJSON)
	if err != nil {
		return nil, fmt.Errorf("write authorization model: %w", err)
	}

	return &OpenFGAContainer{
		Container:    container,
		HTTPEndpoint: httpEndpoint,
		StoreID:      storeID,
		ModelID:      modelID,
	}, nil
}

// WriteTuples writes a batch of relationship tuples to the OpenFGA store.
func (c *OpenFGAContainer) WriteTuples(ctx context.Context, tuples []RelationshipTuple) error {
	if len(tuples) == 0 {
		return nil
	}

	type tupleKey struct {
		User     string `json:"user"`
		Relation string `json:"relation"`
		Object   string `json:"object"`
	}

	writes := make([]tupleKey, len(tuples))
	for i, t := range tuples {
		writes[i] = tupleKey{User: t.User, Relation: t.Relation, Object: t.Object}
	}

	body := map[string]any{
		"writes": map[string]any{
			"tuple_keys": writes,
		},
		"authorization_model_id": c.ModelID,
	}

	reqBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal write request: %w", err)
	}

	url := fmt.Sprintf("%s/stores/%s/write", c.HTTPEndpoint, c.StoreID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(reqBody))
	if err != nil {
		return fmt.Errorf("create write request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("execute write request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("write tuples failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// RelationshipTuple represents an OpenFGA relationship tuple.
type RelationshipTuple struct {
	User     string
	Relation string
	Object   string
}

// createStore creates a new OpenFGA store via the REST API and returns its ID.
func createStore(ctx context.Context, httpEndpoint, name string) (string, error) {
	body, err := json.Marshal(map[string]string{"name": name})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, httpEndpoint+"/stores", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	return result.ID, nil
}

// transformFGAModel uses the `fga` CLI to transform the modular DSL files
// (fga.mod + *.fga) into the JSON format that WriteAuthorizationModel expects.
func transformFGAModel(ctx context.Context, modelDir string) ([]byte, error) {
	fgaModPath := filepath.Join(modelDir, "fga.mod")
	if _, err := os.Stat(fgaModPath); err != nil {
		return nil, fmt.Errorf("fga.mod not found at %s: %w", fgaModPath, err)
	}

	cmdCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, "fga", "model", "transform", "--file", "fga.mod")
	cmd.Dir = modelDir

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("fga model transform failed (stderr: %s): %w", stderr.String(), err)
	}

	output := stdout.Bytes()
	if !json.Valid(output) {
		return nil, fmt.Errorf("fga model transform produced invalid JSON (length %d)", len(output))
	}

	return output, nil
}

// writeAuthorizationModel writes a JSON authorization model to an OpenFGA store
// and returns the model ID.
func writeAuthorizationModel(ctx context.Context, httpEndpoint, storeID string, modelJSON []byte) (string, error) {
	url := fmt.Sprintf("%s/stores/%s/authorization-models", httpEndpoint, storeID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(modelJSON))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		AuthorizationModelID string `json:"authorization_model_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	return result.AuthorizationModelID, nil
}

// FindFGAModelDir locates the FGA model directory in the stigmer-cloud repo.
// go test sets cwd to the package directory (test/integration/), and
// stigmer-cloud is a sibling of the stigmer repo.
func FindFGAModelDir() string {
	if dir := os.Getenv("STIGMER_FGA_MODEL_DIR"); dir != "" {
		return dir
	}

	candidate := "../../../stigmer-cloud/backend/services/stigmer-service/src/main/resources/fga/model"
	abs, err := filepath.Abs(candidate)
	if err != nil {
		return ""
	}
	if _, err := os.Stat(filepath.Join(abs, "fga.mod")); err == nil {
		return abs
	}
	return ""
}

// IsFGACLIAvailable checks whether the `fga` CLI is on PATH.
func IsFGACLIAvailable() bool {
	_, err := exec.LookPath("fga")
	return err == nil
}
