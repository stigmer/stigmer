// Pins that a minted key is one the server's loader accepts (canonical
// base64 of 32 bytes; base64 of a PEM RSA key of at least 2048 bits), and
// that the checks refuse each malformed shape in words.

package component

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

func TestMintedKeysAreAccepted(t *testing.T) {
	for _, name := range KeyNames {
		v, err := MintKey(name)
		if err != nil {
			t.Fatal(err)
		}
		if why := ValidateKey(name, v); why != "" {
			t.Errorf("a minted %s is refused: %s", name, why)
		}
	}
	a, _ := MintKey(render.EncryptionKey)
	b, _ := MintKey(render.EncryptionKey)
	if string(a) == string(b) {
		t.Error("two minted keys are equal")
	}
}

func TestMalformedKeysAreRefused(t *testing.T) {
	short := base64.StdEncoding.EncodeToString(make([]byte, 16))
	small, _ := rsa.GenerateKey(rand.Reader, 1024)
	der := x509.MarshalPKCS1PrivateKey(small)
	weak := base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: der}))
	cases := []struct{ name, value, says string }{
		{render.EncryptionKey, "not base64!", "not canonical base64"},
		{render.RunnerTokenKey, short, "16 bytes; the server needs exactly 32"},
		{render.PlatformTokenKey, base64.StdEncoding.EncodeToString([]byte("nope")), "does not decode to a PEM key"},
		{render.PlatformTokenKey, weak, "1024-bit RSA key"},
	}
	for _, c := range cases {
		if why := ValidateKey(c.name, []byte(c.value)); !strings.Contains(why, c.says) {
			t.Errorf("%s %q: got %q, want %q", c.name, c.value, why, c.says)
		}
	}
}

func TestPasswordsCarryNoCharacterAConnectionStringBreaksOn(t *testing.T) {
	for range 50 {
		p, err := Password()
		if err != nil {
			t.Fatal(err)
		}
		if strings.ContainsAny(p, " +/=%'\"@:") || len(p) < 30 {
			t.Errorf("password %q", p)
		}
	}
}
