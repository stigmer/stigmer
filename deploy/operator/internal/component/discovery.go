// What the operator asks the API server about the cluster itself, as opposed
// to its objects: which resources a group version serves, and the issuer
// the cluster's service account tokens carry. Agent Substrate's install needs
// both (internal/substrate/install), and reads them through this one adapter
// over client-go's discovery client.

package component

import (
	"context"
	"encoding/json"
	"fmt"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/discovery"
)

// ClusterDiscovery answers questions about the cluster's APIs.
type ClusterDiscovery struct {
	Client discovery.DiscoveryInterface
}

// Resources lists the resources a group version serves, empty when the
// cluster does not serve it.
func (d ClusterDiscovery) Resources(groupVersion string) ([]string, error) {
	list, err := d.Client.ServerResourcesForGroupVersion(groupVersion)
	if apierrors.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("listing the resources of %s: %w", groupVersion, err)
	}
	names := make([]string, 0, len(list.APIResources))
	for _, r := range list.APIResources {
		names = append(names, r.Name)
	}
	return names, nil
}

// ServiceAccountIssuer is the issuer in the cluster's service account
// discovery document, empty when the cluster publishes none.
func (d ClusterDiscovery) ServiceAccountIssuer(ctx context.Context) (string, error) {
	raw, err := d.Client.RESTClient().Get().AbsPath("/.well-known/openid-configuration").DoRaw(ctx)
	if apierrors.IsNotFound(err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("reading the cluster's service account issuer: %w", err)
	}
	var doc struct {
		Issuer string `json:"issuer"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return "", fmt.Errorf("reading the cluster's service account issuer: %w", err)
	}
	return doc.Issuer, nil
}
