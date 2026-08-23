#!/usr/bin/env bash
# Regenerates src/encryption/__tests__/fixtures/go-ciphertext.json — the
# cross-edition compatibility fixture (sub-project DD-001): enc:v1: values
# produced by the REAL Go encryption code (pkg/encryption) under a fixed
# test key. The TS unit suite decrypts every entry and must recover the
# exact plaintext, proving the AES-256-GCM layout (nonce || ct || tag,
# standard Base64, enc:v1: prefix) is byte-compatible across editions.
#
# Ciphertext is nonce-random, so regeneration rewrites the file with
# different bytes — that is fine; the CONTRACT is that whatever Go emits,
# TS decrypts. Requires: go (the repo toolchain). Run from anywhere.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
service_dir="$repo_root/backend/services/stigmer-server-ts"
gen_dir="$repo_root/backend/services/stigmer-server/fixturegen-tmp"
out_file="$service_dir/src/encryption/__tests__/fixtures/go-ciphertext.json"

cleanup() {
  rm -rf "$gen_dir"
}
trap cleanup EXIT

mkdir -p "$gen_dir" "$(dirname "$out_file")"

cat > "$gen_dir/main.go" <<'EOF'
// Throwaway fixture generator (written by regen-go-ciphertext-fixture.sh,
// never committed): encrypts a set of plaintexts through the REAL Go
// SecretService under a fixed test key and emits JSON on stdout.
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"

	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

type entry struct {
	Name       string `json:"name"`
	Plaintext  string `json:"plaintext"`
	Ciphertext string `json:"ciphertext"`
}

type fixture struct {
	// The fixed 32-byte test key (Base64). A committed key is safe here:
	// it encrypts only these fixture strings and guards a format contract.
	KeyBase64 string  `json:"keyBase64"`
	Entries   []entry `json:"entries"`
}

func main() {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1) // 0x01..0x20 — fixed, reviewable, obviously non-production
	}

	svc, err := encryption.NewSecretService(key)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	plaintexts := map[string]string{
		"simple":       "hello world",
		"empty":        "",
		"single-byte":  "x",
		"api-key-like": "sk-proj-AbCdEf0123456789_secretSECRET-9876543210fedcba",
		"unicode":      "秘密のパスワード🔐 — ключ",
		"multiline":    "line one\nline two\r\n\ttabbed",
		"long":         string(make500()),
	}

	fx := fixture{KeyBase64: base64.StdEncoding.EncodeToString(key)}
	for _, name := range []string{"simple", "empty", "single-byte", "api-key-like", "unicode", "multiline", "long"} {
		pt := plaintexts[name]
		ct, err := svc.Encrypt(pt)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fx.Entries = append(fx.Entries, entry{Name: name, Plaintext: pt, Ciphertext: ct})
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(fx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func make500() []byte {
	b := make([]byte, 500)
	for i := range b {
		b[i] = byte('a' + i%26)
	}
	return b
}
EOF

echo "Generating Go ciphertext fixture ..."
(cd "$repo_root" && go run "$gen_dir/main.go") > "$out_file"

echo "Wrote $out_file"
