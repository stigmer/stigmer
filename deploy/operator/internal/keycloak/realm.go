// The bundled sign-in's realm, converged every pass: the realm itself, the
// console's and the native apps' clients with Stigmer's audience on their
// tokens, the owner's account, and sign-up.
//
// Converging reads each object, compares only the fields the operator owns,
// and writes only what differs, so a pass over a converged realm is reads
// alone, and a field someone changed by hand in Keycloak's console is put
// back (drift is reverted). Fields the operator does not own are left as
// Keycloak keeps them.
//
// The owner. Their account is created once, with the one-time password from
// the owner setup Secret as a temporary credential, so Keycloak makes them
// choose their own at the first sign-in. That they have (no UPDATE_PASSWORD
// left among their required actions) is the durable signal that the owner
// has signed in.
//
// Sign-up. Closed until the owner has signed in, and opened only for the
// declared email domains: the user profile's email attribute carries a
// pattern that admits addresses in those domains and the owner's own, and
// the realm verifies every address by mail (the declaration refuses domains
// without mail). Opening it before the owner would let the first colleague
// in become an administrator (Stigmer's first-sign-in rule).

package keycloak

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"slices"
	"sort"
	"strings"
)

// SMTP is the mail server the realm sends through.
type SMTP struct {
	Host     string
	Port     int32
	From     string
	User     string
	Password string
	StartTLS bool
}

// Desired is the realm the declaration asks for.
type Desired struct {
	Realm           string
	PublicURL       string
	Audience        string
	ConsoleClientID string
	NativeClientID  string
	OwnerEmail      string
	// OwnerPassword is the one-time password, used only to create the
	// owner's account.
	OwnerPassword string
	SignUpDomains []string
	SMTP          *SMTP
}

// Outcome is where the realm stands after a pass.
type Outcome struct {
	// OwnerSignedIn is true once the owner has replaced the one-time
	// password.
	OwnerSignedIn bool
	// SignUpOpen is true when people in the declared domains may sign up.
	SignUpOpen bool
}

// NativeRedirects are the redirects the desktop app and the CLI sign in
// with: the app's deep link and the CLI's loopback callbacks.
var NativeRedirects = []string{
	"stigmer://auth/callback",
	"http://127.0.0.1:17234/auth/callback",
	"http://127.0.0.1:17235/auth/callback",
	"http://127.0.0.1:17236/auth/callback",
}

// AudienceMapperName is the protocol mapper that puts Stigmer's audience on
// both clients' access tokens; the server refuses a token without it.
const AudienceMapperName = "stigmer-audience"

// Converge brings the realm to d and reports where it stands.
func Converge(ctx context.Context, c *Client, d Desired) (Outcome, error) {
	var out Outcome
	if _, err := c.Realm(ctx, d.Realm); errors.Is(err, ErrNotFound) {
		rep := realmFields(d, false)
		rep["realm"] = d.Realm
		if err := c.CreateRealm(ctx, rep); err != nil {
			return out, fmt.Errorf("creating realm %s: %w", d.Realm, err)
		}
	} else if err != nil {
		return out, fmt.Errorf("reading realm %s: %w", d.Realm, err)
	}

	for _, want := range []Object{consoleClient(d), nativeClient(d)} {
		if err := convergeClient(ctx, c, d, want); err != nil {
			return out, err
		}
	}
	if err := convergeEmailPattern(ctx, c, d); err != nil {
		return out, err
	}

	signedIn, err := convergeOwner(ctx, c, d)
	if err != nil {
		return out, err
	}
	out.OwnerSignedIn = signedIn
	out.SignUpOpen = signedIn && len(d.SignUpDomains) > 0 && d.SMTP != nil

	live, err := c.Realm(ctx, d.Realm)
	if err != nil {
		return out, fmt.Errorf("reading realm %s: %w", d.Realm, err)
	}
	want := realmFields(d, out.SignUpOpen)
	if !owned(live, want) {
		if err := c.UpdateRealm(ctx, d.Realm, want); err != nil {
			return out, fmt.Errorf("updating realm %s: %w", d.Realm, err)
		}
	}
	return out, nil
}

// realmFields are the realm fields the operator owns.
func realmFields(d Desired, signUpOpen bool) Object {
	rep := Object{
		"enabled":                     true,
		"registrationAllowed":         signUpOpen,
		"registrationEmailAsUsername": true,
		"loginWithEmailAllowed":       true,
		"duplicateEmailsAllowed":      false,
		"verifyEmail":                 d.SMTP != nil,
		"resetPasswordAllowed":        d.SMTP != nil,
	}
	if d.SMTP != nil {
		smtp := Object{
			"host":     d.SMTP.Host,
			"port":     fmt.Sprintf("%d", d.SMTP.Port),
			"from":     d.SMTP.From,
			"starttls": fmt.Sprintf("%t", d.SMTP.StartTLS),
			"auth":     fmt.Sprintf("%t", d.SMTP.User != ""),
		}
		if d.SMTP.User != "" {
			smtp["user"] = d.SMTP.User
			smtp["password"] = d.SMTP.Password
		}
		rep["smtpServer"] = smtp
	}
	return rep
}

func consoleClient(d Desired) Object {
	return Object{
		"clientId":                  d.ConsoleClientID,
		"name":                      "Stigmer console",
		"enabled":                   true,
		"publicClient":              true,
		"standardFlowEnabled":       true,
		"implicitFlowEnabled":       false,
		"directAccessGrantsEnabled": false,
		"serviceAccountsEnabled":    false,
		"rootUrl":                   d.PublicURL,
		"redirectUris":              []any{d.PublicURL + "/auth/callback"},
		"webOrigins":                []any{d.PublicURL},
		"attributes": Object{
			"pkce.code.challenge.method": "S256",
			"post.logout.redirect.uris":  d.PublicURL + "/login",
		},
	}
}

func nativeClient(d Desired) Object {
	redirects := make([]any, 0, len(NativeRedirects))
	for _, r := range NativeRedirects {
		redirects = append(redirects, r)
	}
	return Object{
		"clientId":                  d.NativeClientID,
		"name":                      "Stigmer desktop app and CLI",
		"enabled":                   true,
		"publicClient":              true,
		"standardFlowEnabled":       true,
		"implicitFlowEnabled":       false,
		"directAccessGrantsEnabled": false,
		"serviceAccountsEnabled":    false,
		"redirectUris":              redirects,
		"webOrigins":                []any{},
		"attributes": Object{
			"pkce.code.challenge.method":                "S256",
			"oauth2.device.authorization.grant.enabled": "true",
		},
	}
}

func convergeClient(ctx context.Context, c *Client, d Desired, want Object) error {
	clientID, _ := want["clientId"].(string)
	live, err := c.ClientByClientID(ctx, d.Realm, clientID)
	if errors.Is(err, ErrNotFound) {
		if err := c.CreateClient(ctx, d.Realm, want); err != nil {
			return fmt.Errorf("creating client %s: %w", clientID, err)
		}
		live, err = c.ClientByClientID(ctx, d.Realm, clientID)
	}
	if err != nil {
		return fmt.Errorf("reading client %s: %w", clientID, err)
	}
	id, _ := live["id"].(string)
	if !owned(live, want) {
		merged := Object{}
		for k, v := range live {
			merged[k] = v
		}
		for k, v := range want {
			if k == "attributes" {
				attrs := Object{}
				if la, ok := live["attributes"].(Object); ok {
					for ak, av := range la {
						attrs[ak] = av
					}
				}
				for ak, av := range v.(Object) {
					attrs[ak] = av
				}
				merged[k] = attrs
				continue
			}
			merged[k] = v
		}
		if err := c.UpdateClient(ctx, d.Realm, id, merged); err != nil {
			return fmt.Errorf("updating client %s: %w", clientID, err)
		}
	}
	return convergeAudienceMapper(ctx, c, d, id, clientID)
}

func audienceMapper(d Desired) Object {
	return Object{
		"name":           AudienceMapperName,
		"protocol":       "openid-connect",
		"protocolMapper": "oidc-audience-mapper",
		"config": Object{
			"included.custom.audience":  d.Audience,
			"access.token.claim":        "true",
			"id.token.claim":            "false",
			"introspection.token.claim": "true",
		},
	}
}

func convergeAudienceMapper(ctx context.Context, c *Client, d Desired, id, clientID string) error {
	mappers, err := c.ProtocolMappers(ctx, d.Realm, id)
	if err != nil {
		return fmt.Errorf("reading client %s's mappers: %w", clientID, err)
	}
	want := audienceMapper(d)
	for _, m := range mappers {
		if m["name"] != AudienceMapperName {
			continue
		}
		if owned(m, want) {
			return nil
		}
		mapperID, _ := m["id"].(string)
		want["id"] = mapperID
		if err := c.UpdateProtocolMapper(ctx, d.Realm, id, mapperID, want); err != nil {
			return fmt.Errorf("updating client %s's audience: %w", clientID, err)
		}
		return nil
	}
	if err := c.CreateProtocolMapper(ctx, d.Realm, id, want); err != nil {
		return fmt.Errorf("adding client %s's audience: %w", clientID, err)
	}
	return nil
}

// EmailPattern is the pattern the user profile holds an address to while
// sign-up is limited to domains: an address in one of them, or the owner's.
func EmailPattern(domains []string, owner string) string {
	sorted := slices.Clone(domains)
	sort.Strings(sorted)
	quoted := make([]string, 0, len(sorted))
	for _, dom := range sorted {
		quoted = append(quoted, regexp.QuoteMeta(strings.ToLower(dom)))
	}
	return fmt.Sprintf(`^[^@\s]+@(%s)$|^%s$`, strings.Join(quoted, "|"), regexp.QuoteMeta(strings.ToLower(owner)))
}

func convergeEmailPattern(ctx context.Context, c *Client, d Desired) error {
	profile, err := c.UserProfile(ctx, d.Realm)
	if err != nil {
		return fmt.Errorf("reading the user profile: %w", err)
	}
	attrs, _ := profile["attributes"].([]any)
	changed := false
	for _, a := range attrs {
		attr, _ := a.(Object)
		if attr["name"] != "email" {
			continue
		}
		validations, _ := attr["validations"].(Object)
		if validations == nil {
			validations = Object{}
		}
		current, has := validations["pattern"].(Object)
		if len(d.SignUpDomains) == 0 {
			if has {
				delete(validations, "pattern")
				changed = true
			}
		} else {
			want := Object{
				"pattern":       EmailPattern(d.SignUpDomains, d.OwnerEmail),
				"error-message": fmt.Sprintf("Sign-up is open to addresses at %s.", strings.Join(d.SignUpDomains, ", ")),
			}
			if !has || !reflect.DeepEqual(current, want) {
				validations["pattern"] = want
				changed = true
			}
		}
		attr["validations"] = validations
	}
	if !changed {
		return nil
	}
	if err := c.UpdateUserProfile(ctx, d.Realm, profile); err != nil {
		return fmt.Errorf("updating the user profile: %w", err)
	}
	return nil
}

// convergeOwner creates the owner's account once and reports whether they
// have replaced the one-time password.
func convergeOwner(ctx context.Context, c *Client, d Desired) (bool, error) {
	user, err := c.UserByEmail(ctx, d.Realm, d.OwnerEmail)
	if errors.Is(err, ErrNotFound) {
		if d.OwnerPassword == "" {
			return false, fmt.Errorf("the owner's account does not exist and there is no one-time password to create it with")
		}
		rep := Object{
			"username":        strings.ToLower(d.OwnerEmail),
			"email":           strings.ToLower(d.OwnerEmail),
			"emailVerified":   true,
			"enabled":         true,
			"requiredActions": []any{"UPDATE_PASSWORD"},
			"credentials": []any{Object{
				"type":      "password",
				"value":     d.OwnerPassword,
				"temporary": true,
			}},
		}
		if err := c.CreateUser(ctx, d.Realm, rep); err != nil {
			return false, fmt.Errorf("creating the owner's account: %w", err)
		}
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reading the owner's account: %w", err)
	}
	actions, _ := user["requiredActions"].([]any)
	for _, a := range actions {
		if a == "UPDATE_PASSWORD" {
			return false, nil
		}
	}
	return true, nil
}

// owned reports whether live already holds every field of want. Lists are
// compared as sets, nested objects field by field, and a write-only field
// Keycloak masks on read (an SMTP password) is not compared.
func owned(live, want Object) bool {
	for k, w := range want {
		if !same(k, live[k], w) {
			return false
		}
	}
	return true
}

func same(key string, live, want any) bool {
	switch w := want.(type) {
	case Object:
		l, ok := live.(Object)
		if !ok {
			return false
		}
		for k, v := range w {
			if key == "smtpServer" && k == "password" {
				continue
			}
			if !same(k, l[k], v) {
				return false
			}
		}
		return true
	case []any:
		l, ok := live.([]any)
		if !ok {
			return len(w) == 0 && live == nil
		}
		if len(l) != len(w) {
			return false
		}
		ls, ws := strs(l), strs(w)
		sort.Strings(ls)
		sort.Strings(ws)
		return slices.Equal(ls, ws)
	default:
		return fmt.Sprint(live) == fmt.Sprint(want)
	}
}

func strs(xs []any) []string {
	out := make([]string, 0, len(xs))
	for _, x := range xs {
		out = append(out, fmt.Sprint(x))
	}
	return out
}
