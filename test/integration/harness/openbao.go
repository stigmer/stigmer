package harness

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// OpenBaoContainer holds a running dev-mode OpenBAO instance backing the
// cloud service's secret encryption (the `vault` Spring profile). The Java
// service connects via the VAULT_* env vars emitted by buildServiceEnv.
//
// Vault is a BOOT requirement, not an optional feature: the service's secret
// codecs (enc:v2 envelope encryption, enc:v3 vault-KV pointers) exist only
// when vault is enabled, and with the v1 static-key codec retired there is no
// codec — and therefore no boot — without it. The harness always provisions
// this container, like AppPostgres.
type OpenBaoContainer struct {
	Container testcontainers.Container
	// Addr is the full http endpoint (VAULT_ADDR) the service connects to.
	Addr string
	// RootToken authenticates the service via token auth (VAULT_TOKEN).
	// Dev mode has no Kubernetes auth; the production-policy-scoped access
	// contract is proven separately by the cloud repo's `make test-vault`.
	RootToken string
}

const (
	// Pinned to the production OpenBAO version — the same image
	// VaultClientOpenBaoTest (stigmer-cloud) locks to, so what boots here is
	// what runs in prod.
	openBaoImage = "openbao/openbao:2.4.4"

	openBaoRootToken = "integration-test-root-token"
)

// StartOpenBao starts a dev-mode OpenBAO container and mounts the Transit
// engine. Dev mode auto-mounts only KV v2 (at secret/, the service's
// VAULT_KV_MOUNT default); Transit — where the per-org key-encryption keys
// live — must be mounted explicitly, exactly as the production bootstrap
// runbook does (stigmer-cloud _ops/setup-guides/07-openbao-bootstrap.md).
func StartOpenBao(ctx context.Context) (*OpenBaoContainer, error) {
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        openBaoImage,
			ExposedPorts: []string{"8200/tcp"},
			// Both env spellings: OpenBAO's entrypoint reads BAO_*, and older
			// entrypoint revisions still honor the VAULT_* names.
			Env: map[string]string{
				"BAO_DEV_ROOT_TOKEN_ID":    openBaoRootToken,
				"VAULT_DEV_ROOT_TOKEN_ID":  openBaoRootToken,
				"BAO_DEV_LISTEN_ADDRESS":   "0.0.0.0:8200",
				"VAULT_DEV_LISTEN_ADDRESS": "0.0.0.0:8200",
			},
			Cmd:        []string{"server", "-dev"},
			WaitingFor: wait.ForHTTP("/v1/sys/health").WithPort("8200/tcp"),
		},
		Started: true,
	})
	if err != nil {
		return nil, fmt.Errorf("start openbao container: %w", err)
	}

	host, err := container.Host(ctx)
	if err != nil {
		return nil, fmt.Errorf("get openbao host: %w", err)
	}
	port, err := container.MappedPort(ctx, "8200/tcp")
	if err != nil {
		return nil, fmt.Errorf("get openbao port: %w", err)
	}
	addr := fmt.Sprintf("http://%s:%s", host, port.Port())

	if err := mountTransit(ctx, addr, openBaoRootToken); err != nil {
		return nil, fmt.Errorf("mount transit engine: %w", err)
	}

	return &OpenBaoContainer{
		Container: container,
		Addr:      addr,
		RootToken: openBaoRootToken,
	}, nil
}

// mountTransit enables the Transit secrets engine at the service's
// VAULT_TRANSIT_MOUNT default path via the sys/mounts API.
func mountTransit(ctx context.Context, addr, token string) error {
	body := bytes.NewReader([]byte(`{"type":"transit"}`))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, addr+"/v1/sys/mounts/transit", body)
	if err != nil {
		return err
	}
	req.Header.Set("X-Vault-Token", token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// sys/mounts returns 204 on success; 400 with "path is already in use"
	// would mean a double mount, which only a harness bug can cause — fail
	// loudly rather than tolerate it.
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
