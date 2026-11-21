// Pins where the database's fence admits CloudNativePG from: the namespace
// its own webhook's Service is in, wherever someone installed it, and its
// release's namespace when there is no webhook to read.

package component

import (
	"context"
	"testing"

	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	"github.com/stigmer/stigmer/deploy/operator/internal/manifests"
)

func TestThePostgresOperatorIsAdmittedFromTheNamespaceItRunsIn(t *testing.T) {
	ctx := context.Background()

	none := &Env{Reader: fake.NewClientBuilder().Build()}
	if got, err := postgresOperatorNamespace(ctx, none); err != nil || got != manifests.CloudNativePGNamespace {
		t.Errorf("with no CloudNativePG webhook: %q %v, want %q", got, err, manifests.CloudNativePGNamespace)
	}

	hook := &admissionregistrationv1.MutatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{Name: cnpgWebhook},
		Webhooks: []admissionregistrationv1.MutatingWebhook{{
			Name: "mcluster.cnpg.io",
			ClientConfig: admissionregistrationv1.WebhookClientConfig{
				Service: &admissionregistrationv1.ServiceReference{Namespace: "databases", Name: "cnpg-webhook-service"},
			},
		}},
	}
	elsewhere := &Env{Reader: fake.NewClientBuilder().WithObjects(hook).Build()}
	if got, err := postgresOperatorNamespace(ctx, elsewhere); err != nil || got != "databases" {
		t.Errorf("with CloudNativePG installed in databases: %q %v", got, err)
	}
}
