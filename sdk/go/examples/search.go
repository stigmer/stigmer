// Example: Cross-resource search.
package examples

import (
	"context"
	"fmt"
	"log"

	stigmer "go.stigmer.ai/sdk"
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
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Found %d agents and %d skills\n", result.CountsByKind["agent"], result.CountsByKind["skill"])
	for _, entry := range result.Entries {
		fmt.Printf("  [%s] %s — %s (score: %.2f)\n",
			entry.GetKind(), entry.GetName(), entry.GetDescription(), entry.GetScore(),
		)
	}

	// Every result, page after page: QueryAll follows the page tokens.
	for entry, err := range client.Search.QueryAll(ctx, &stigmer.SearchParams{
		Kinds: []stigmer.ResourceKind{stigmer.KindAgent},
		Query: "code review",
		Org:   "acme",
	}) {
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(entry.GetName())
	}
}
