// A small client for the parts of Keycloak's admin API the operator uses to
// converge the bundled sign-in's realm: signing in as the operator's own
// admin, and reading and writing realms, clients, protocol mappers, users
// and the user profile.
//
// It is the operator's one outbound HTTP client, and it only ever talks to
// the Keycloak the operator runs, at its in-cluster Service. Representations
// are plain maps: the operator owns a handful of fields on each object and
// leaves every other field as Keycloak keeps it, so a read, a merge of the
// owned fields and a write never needs a full model of Keycloak's types.

package keycloak

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Object is one Keycloak representation.
type Object = map[string]any

// Client talks to one Keycloak's admin API as the operator's admin.
type Client struct {
	base  string
	http  *http.Client
	token string
}

// Login signs in to the master realm with the operator's admin credential
// and returns a client holding the token. base is Keycloak's base URL,
// relative path included (http://<service>:8080/idp).
func Login(ctx context.Context, base, username, password string) (*Client, error) {
	c := &Client{base: strings.TrimSuffix(base, "/"), http: &http.Client{Timeout: 15 * time.Second}}
	form := url.Values{
		"grant_type": {"password"},
		"client_id":  {"admin-cli"},
		"username":   {username},
		"password":   {password},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.base+"/realms/master/protocol/openid-connect/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("signing in to the sign-in's admin API: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("signing in to the sign-in's admin API: HTTP %d: %s", resp.StatusCode, brief(body))
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &tok); err != nil || tok.AccessToken == "" {
		return nil, fmt.Errorf("signing in to the sign-in's admin API: no access token in the answer")
	}
	c.token = tok.AccessToken
	return c, nil
}

// ErrNotFound is returned for a 404.
var ErrNotFound = fmt.Errorf("not found")

func brief(body []byte) string {
	s := strings.TrimSpace(string(body))
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}

// do sends one admin call; out, when given, receives the JSON answer.
func (c *Client) do(ctx context.Context, method, path string, in, out any) (http.Header, error) {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+"/admin"+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s %s: %w", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrNotFound
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s %s: HTTP %d: %s", method, path, resp.StatusCode, brief(raw))
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return nil, fmt.Errorf("%s %s: reading the answer: %w", method, path, err)
		}
	}
	return resp.Header, nil
}

// Realm reads a realm, or ErrNotFound.
func (c *Client) Realm(ctx context.Context, realm string) (Object, error) {
	var out Object
	_, err := c.do(ctx, http.MethodGet, "/realms/"+realm, nil, &out)
	return out, err
}

// CreateRealm creates a realm.
func (c *Client) CreateRealm(ctx context.Context, rep Object) error {
	_, err := c.do(ctx, http.MethodPost, "/realms", rep, nil)
	return err
}

// UpdateRealm writes the given fields of a realm; fields it leaves out keep
// their values.
func (c *Client) UpdateRealm(ctx context.Context, realm string, rep Object) error {
	_, err := c.do(ctx, http.MethodPut, "/realms/"+realm, rep, nil)
	return err
}

// ClientByClientID reads a realm's client by its clientId, or ErrNotFound.
func (c *Client) ClientByClientID(ctx context.Context, realm, clientID string) (Object, error) {
	var out []Object
	if _, err := c.do(ctx, http.MethodGet, "/realms/"+realm+"/clients?clientId="+url.QueryEscape(clientID), nil, &out); err != nil {
		return nil, err
	}
	for _, o := range out {
		if o["clientId"] == clientID {
			return o, nil
		}
	}
	return nil, ErrNotFound
}

// CreateClient creates a client.
func (c *Client) CreateClient(ctx context.Context, realm string, rep Object) error {
	_, err := c.do(ctx, http.MethodPost, "/realms/"+realm+"/clients", rep, nil)
	return err
}

// UpdateClient writes a client by its id.
func (c *Client) UpdateClient(ctx context.Context, realm, id string, rep Object) error {
	_, err := c.do(ctx, http.MethodPut, "/realms/"+realm+"/clients/"+id, rep, nil)
	return err
}

// ProtocolMappers lists a client's protocol mappers.
func (c *Client) ProtocolMappers(ctx context.Context, realm, id string) ([]Object, error) {
	var out []Object
	_, err := c.do(ctx, http.MethodGet, "/realms/"+realm+"/clients/"+id+"/protocol-mappers/models", nil, &out)
	return out, err
}

// CreateProtocolMapper adds a protocol mapper to a client.
func (c *Client) CreateProtocolMapper(ctx context.Context, realm, id string, rep Object) error {
	_, err := c.do(ctx, http.MethodPost, "/realms/"+realm+"/clients/"+id+"/protocol-mappers/models", rep, nil)
	return err
}

// UpdateProtocolMapper writes a client's protocol mapper.
func (c *Client) UpdateProtocolMapper(ctx context.Context, realm, id, mapperID string, rep Object) error {
	_, err := c.do(ctx, http.MethodPut, "/realms/"+realm+"/clients/"+id+"/protocol-mappers/models/"+mapperID, rep, nil)
	return err
}

// UserByEmail reads a realm's user by exact email, or ErrNotFound.
func (c *Client) UserByEmail(ctx context.Context, realm, email string) (Object, error) {
	var out []Object
	if _, err := c.do(ctx, http.MethodGet, "/realms/"+realm+"/users?exact=true&email="+url.QueryEscape(email), nil, &out); err != nil {
		return nil, err
	}
	for _, o := range out {
		if e, _ := o["email"].(string); strings.EqualFold(e, email) {
			return o, nil
		}
	}
	return nil, ErrNotFound
}

// CreateUser creates a user.
func (c *Client) CreateUser(ctx context.Context, realm string, rep Object) error {
	_, err := c.do(ctx, http.MethodPost, "/realms/"+realm+"/users", rep, nil)
	return err
}

// UserProfile reads a realm's user profile configuration.
func (c *Client) UserProfile(ctx context.Context, realm string) (Object, error) {
	var out Object
	_, err := c.do(ctx, http.MethodGet, "/realms/"+realm+"/users/profile", nil, &out)
	return out, err
}

// UpdateUserProfile writes a realm's user profile configuration.
func (c *Client) UpdateUserProfile(ctx context.Context, realm string, rep Object) error {
	_, err := c.do(ctx, http.MethodPut, "/realms/"+realm+"/users/profile", rep, nil)
	return err
}
