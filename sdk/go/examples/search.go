// Example: Cross-resource search.
package examples

import (
	"context"
	"fmt"
	"log"

	stigmer "github.com/stigmer/stigmer/sdk/go"
)

func CrossResourceSearch() {
	ctx := context.Background()
	client, err := stigmer.NewClient(stigmer.WithAPIKey("sk_live_your_api_key"))
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	result, err := client.Search.Query(ctx, &stigmer.SearchParams{
		Kinds: []stigmer.ResourceKind{stigmer.KindAgent, stigmer.KindSkill},
		Query: "code review",
		Org:   "acme",
		Page:  &stigmer.Page{Num: 1, Size: 20},
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Found %d results across %d pages\n", result.TotalCount, result.TotalPages)
	for _, entry := range result.Entries {
		fmt.Printf("  [%s] %s — %s (score: %.2f)\n",
			entry.GetKind(), entry.GetName(), entry.GetDescription(), entry.GetScore(),
		)
	}
}
