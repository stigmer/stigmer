// Pins the bundled sign-in's realm convergence (realm.go) against an
// in-memory admin API (keycloaktest):
//
//   - the first pass creates the realm, the console's client (its redirect,
//     origin and PKCE), the native client (the app's and the CLI's fixed
//     redirects and the device grant), the audience on both, and the
//     owner's account with a temporary password; sign-up stays closed;
//   - a second pass over the converged realm writes nothing;
//   - a redirect changed by hand is put back;
//   - once the owner has replaced the password, sign-up opens, limited by
//     the user profile to the declared domains and the owner's address, and
//     the realm verifies addresses by mail;
//   - without declared domains sign-up never opens, and a pattern the
//     operator set is removed.
package keycloak_test

import (
	"context"
	"regexp"
	"slices"
	"testing"

	"github.com/stigmer/stigmer/deploy/operator/internal/keycloak"
	"github.com/stigmer/stigmer/deploy/operator/internal/keycloak/keycloaktest"
)

const url = "https://stigmer.example.com"

func desired() keycloak.Desired {
	return keycloak.Desired{
		Realm:           "stigmer",
		PublicURL:       url,
		Audience:        url,
		ConsoleClientID: "stigmer-console",
		NativeClientID:  "stigmer-native",
		OwnerEmail:      "priya@acme.dev",
		OwnerPassword:   "one-time",
		SignUpDomains:   []string{"acme.dev"},
		SMTP:            &keycloak.SMTP{Host: "mail", Port: 587, From: "stigmer@acme.dev", User: "u", Password: "p"},
	}
}

func converge(t *testing.T, f *keycloaktest.Fake, d keycloak.Desired) keycloak.Outcome {
	t.Helper()
	ctx := context.Background()
	c, err := keycloak.Login(ctx, f.URL, "admin", "secret")
	if err != nil {
		t.Fatal(err)
	}
	out, err := keycloak.Converge(ctx, c, d)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func strings(v any) []string {
	var out []string
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	slices.Sort(out)
	return out
}

func TestTheRealmConvergesAndOpensSignUpAfterTheOwner(t *testing.T) {
	f := keycloaktest.New("admin", "secret")
	defer f.Close()

	out := converge(t, f, desired())
	if out.OwnerSignedIn || out.SignUpOpen {
		t.Fatalf("first pass: %+v", out)
	}
	realm := f.Realm("stigmer")
	if realm["registrationAllowed"] != false || realm["verifyEmail"] != true {
		t.Errorf("realm: registration %v, verify email %v", realm["registrationAllowed"], realm["verifyEmail"])
	}
	console := f.Client("stigmer", "stigmer-console")
	if got := strings(console["redirectUris"]); !slices.Equal(got, []string{url + "/auth/callback"}) {
		t.Errorf("console redirects %v", got)
	}
	if console["publicClient"] != true || console["attributes"].(map[string]any)["pkce.code.challenge.method"] != "S256" {
		t.Errorf("console is not a public PKCE client: %v", console)
	}
	native := f.Client("stigmer", "stigmer-native")
	if got := strings(native["redirectUris"]); !slices.Equal(got, func() []string {
		r := slices.Clone(keycloak.NativeRedirects)
		slices.Sort(r)
		return r
	}()) {
		t.Errorf("native redirects %v", got)
	}
	if native["attributes"].(map[string]any)["oauth2.device.authorization.grant.enabled"] != "true" {
		t.Error("the native client has no device grant")
	}
	for _, client := range []string{"stigmer-console", "stigmer-native"} {
		mappers := f.Mappers("stigmer", client)
		if len(mappers) != 1 || mappers[0]["config"].(map[string]any)["included.custom.audience"] != url {
			t.Errorf("%s audience mappers: %v", client, mappers)
		}
	}
	for _, a := range f.Profile("stigmer")["attributes"].([]any) {
		attr := a.(map[string]any)
		if name := attr["name"]; (name == "firstName" || name == "lastName") && attr["required"] != nil {
			t.Errorf("%s is still required, which stops every sign-in at a profile page", name)
		}
	}
	owner := f.User("stigmer", "priya@acme.dev")
	if owner == nil || !slices.Contains(strings(owner["requiredActions"]), "UPDATE_PASSWORD") {
		t.Fatalf("owner: %v", owner)
	}

	before := f.Writes()
	converge(t, f, desired())
	if f.Writes() != before {
		t.Errorf("a pass over the converged realm wrote %d times", f.Writes()-before)
	}

	f.Client("stigmer", "stigmer-console")["redirectUris"] = []any{"https://evil.example/cb"}
	converge(t, f, desired())
	if got := strings(f.Client("stigmer", "stigmer-console")["redirectUris"]); !slices.Equal(got, []string{url + "/auth/callback"}) {
		t.Errorf("a redirect changed by hand was not put back: %v", got)
	}

	f.User("stigmer", "priya@acme.dev")["requiredActions"] = []any{}
	out = converge(t, f, desired())
	if !out.OwnerSignedIn || !out.SignUpOpen {
		t.Fatalf("after the owner: %+v", out)
	}
	if f.Realm("stigmer")["registrationAllowed"] != true {
		t.Error("sign-up did not open")
	}
	var pattern string
	for _, a := range f.Profile("stigmer")["attributes"].([]any) {
		attr := a.(map[string]any)
		if attr["name"] == "email" {
			pattern, _ = attr["validations"].(map[string]any)["pattern"].(map[string]any)["pattern"].(string)
		}
	}
	re := regexp.MustCompile(pattern)
	for addr, want := range map[string]bool{"sam@acme.dev": true, "priya@acme.dev": true, "eve@elsewhere.test": false, "eve@acme.dev.evil.test": false} {
		if re.MatchString(addr) != want {
			t.Errorf("%s admitted %v", addr, !want)
		}
	}
}

func TestSignUpStaysClosedWithoutDomains(t *testing.T) {
	f := keycloaktest.New("admin", "secret")
	defer f.Close()
	converge(t, f, desired())
	f.User("stigmer", "priya@acme.dev")["requiredActions"] = []any{}

	d := desired()
	d.SignUpDomains = nil
	out := converge(t, f, d)
	if !out.OwnerSignedIn || out.SignUpOpen {
		t.Fatalf("%+v", out)
	}
	if f.Realm("stigmer")["registrationAllowed"] != false {
		t.Error("sign-up opened with no domains declared")
	}
	for _, a := range f.Profile("stigmer")["attributes"].([]any) {
		attr := a.(map[string]any)
		if attr["name"] == "email" {
			if _, has := attr["validations"].(map[string]any)["pattern"]; has {
				t.Error("the domain pattern was left behind")
			}
		}
	}
}
