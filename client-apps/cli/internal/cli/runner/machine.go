package runner

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

const (
	machineFileName = "machine.json"
	machineIDPrefix = "mach_"
	machineIDBytes  = 16 // 128 bits of randomness
)

// MachineIdentity is the stable, persistent identity for this Stigmer
// installation. Generated once and reused forever. Survives hostname
// changes, network switches, and OS updates.
type MachineIdentity struct {
	MachineID   string    `json:"machine_id"`
	CreatedAt   time.Time `json:"created_at"`
	DisplayName string    `json:"display_name"`
}

// LoadOrCreateMachineID reads the machine identity from ~/.stigmer/machine.json.
// If the file does not exist or is corrupt, a new identity is generated and
// persisted. This function is idempotent: repeated calls return the same ID.
func LoadOrCreateMachineID() (*MachineIdentity, error) {
	path, err := machineFilePath()
	if err != nil {
		return nil, err
	}

	identity, err := loadMachineIdentity(path)
	if err == nil && identity.MachineID != "" {
		return identity, nil
	}

	identity, err = generateMachineIdentity()
	if err != nil {
		return nil, errors.Wrap(err, "failed to generate machine identity")
	}

	if err := saveMachineIdentity(path, identity); err != nil {
		return nil, err
	}

	return identity, nil
}

func machineFilePath() (string, error) {
	configDir, err := config.GetConfigDir()
	if err != nil {
		return "", errors.Wrap(err, "failed to resolve config directory")
	}
	return filepath.Join(configDir, machineFileName), nil
}

func loadMachineIdentity(path string) (*MachineIdentity, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var identity MachineIdentity
	if err := json.Unmarshal(data, &identity); err != nil {
		return nil, err
	}
	return &identity, nil
}

func generateMachineIdentity() (*MachineIdentity, error) {
	id, err := generateMachineID()
	if err != nil {
		return nil, err
	}

	hostname, _ := os.Hostname()

	return &MachineIdentity{
		MachineID:   id,
		CreatedAt:   time.Now().UTC(),
		DisplayName: hostname,
	}, nil
}

func generateMachineID() (string, error) {
	b := make([]byte, machineIDBytes)
	if _, err := rand.Read(b); err != nil {
		return "", errors.Wrap(err, "failed to read random bytes")
	}
	return machineIDPrefix + hex.EncodeToString(b), nil
}

func saveMachineIdentity(path string, identity *MachineIdentity) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return errors.Wrap(err, "failed to create config directory")
	}

	data, err := json.MarshalIndent(identity, "", "  ")
	if err != nil {
		return errors.Wrap(err, "failed to marshal machine identity")
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		return errors.Wrapf(err, "failed to write machine identity to %s", path)
	}
	return nil
}
