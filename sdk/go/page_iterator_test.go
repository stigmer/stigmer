package stigmer

// The page iterators beside every list: a generated ListAll walks
// next_page_token to the end from the token its input names, keeps the
// list's filters on every page and never changes the caller's request, and
// stops reading when the caller stops; the billing catalog's hand-written
// iterator does the same.

import (
	"context"
	"fmt"
	"strconv"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/v3/internal/gen"
	schedulev1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/schedule/v1"
	billingv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/billing/v1"
	apiresource "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

// pagedScheduleConn answers ScheduleQueryController.list with five
// schedules served two at a time, recording each request.
type pagedScheduleConn struct {
	grpc.ClientConnInterface
	requests []*schedulev1.ListSchedulesRequest
}

func (c *pagedScheduleConn) Invoke(_ context.Context, method string, args, reply any, _ ...grpc.CallOption) error {
	if method != schedulev1.ScheduleQueryController_List_FullMethodName {
		return fmt.Errorf("unexpected method %s", method)
	}
	req := args.(*schedulev1.ListSchedulesRequest)
	c.requests = append(c.requests, proto.Clone(req).(*schedulev1.ListSchedulesRequest))
	start := 0
	if req.GetPageToken() != "" {
		start, _ = strconv.Atoi(req.GetPageToken())
	}
	end := min(start+2, 5)
	page := &schedulev1.ScheduleList{}
	for i := start; i < end; i++ {
		page.Entries = append(page.Entries, &schedulev1.Schedule{Metadata: &apiresource.ApiResourceMetadata{Id: fmt.Sprintf("sch_%d", i)}})
	}
	if end < 5 {
		page.NextPageToken = strconv.Itoa(end)
	}
	proto.Merge(reply.(*schedulev1.ScheduleList), page)
	return nil
}

func TestGeneratedListAll_WalksEveryPageKeepingFilters(t *testing.T) {
	conn := &pagedScheduleConn{}
	input := &schedulev1.ListSchedulesRequest{Org: "acme", Labels: map[string]string{"team": "support"}, PageSize: 2}
	var ids []string
	for s, err := range gen.NewScheduleClient(conn).ListAll(context.Background(), input) {
		if err != nil {
			t.Fatalf("ListAll: %v", err)
		}
		ids = append(ids, s.GetMetadata().GetId())
	}
	if fmt.Sprint(ids) != "[sch_0 sch_1 sch_2 sch_3 sch_4]" {
		t.Errorf("ids = %v", ids)
	}
	var tokens []string
	for _, r := range conn.requests {
		tokens = append(tokens, r.GetPageToken())
		if r.GetOrg() != "acme" || r.GetLabels()["team"] != "support" || r.GetPageSize() != 2 {
			t.Errorf("a page lost the list's filters: %v", r)
		}
	}
	if fmt.Sprint(tokens) != "[ 2 4]" {
		t.Errorf("tokens = %q", tokens)
	}
	if input.GetPageToken() != "" {
		t.Errorf("the caller's request was changed: page_token %q", input.GetPageToken())
	}
}

func TestGeneratedListAll_StartsFromTheInputToken(t *testing.T) {
	var ids []string
	for s, err := range gen.NewScheduleClient(&pagedScheduleConn{}).ListAll(context.Background(), &schedulev1.ListSchedulesRequest{PageToken: "4"}) {
		if err != nil {
			t.Fatalf("ListAll: %v", err)
		}
		ids = append(ids, s.GetMetadata().GetId())
	}
	if fmt.Sprint(ids) != "[sch_4]" {
		t.Errorf("ids = %v", ids)
	}
}

func TestGeneratedListAll_StopsReadingWhenTheCallerStops(t *testing.T) {
	conn := &pagedScheduleConn{}
	for range gen.NewScheduleClient(conn).ListAll(context.Background(), nil) {
		break
	}
	if len(conn.requests) != 1 {
		t.Errorf("pages read = %d, want 1", len(conn.requests))
	}
}

// pagedBaselines serves three baselines one to a page.
type pagedBaselines struct {
	billingv1.BillingQueryControllerClient
	tokens []string
}

func (f *pagedBaselines) ListModelPricingBaselines(_ context.Context, in *billingv1.ListModelPricingBaselinesInput, _ ...grpc.CallOption) (*billingv1.ModelPricingBaselinesResponse, error) {
	f.tokens = append(f.tokens, in.GetPageToken())
	i := 0
	if in.GetPageToken() != "" {
		i, _ = strconv.Atoi(in.GetPageToken())
	}
	resp := &billingv1.ModelPricingBaselinesResponse{Entries: []*billingv1.ModelPricingBaseline{{ModelId: fmt.Sprintf("m%d", i)}}}
	if i < 2 {
		resp.NextPageToken = strconv.Itoa(i + 1)
	}
	return resp, nil
}

func TestBillingListModelPricingBaselinesAll_WalksEveryPage(t *testing.T) {
	fake := &pagedBaselines{}
	client := &BillingClient{query: fake}
	var models []string
	for b, err := range client.ListModelPricingBaselinesAll(context.Background(), &ListModelPricingBaselinesParams{IncludeHistory: true}) {
		if err != nil {
			t.Fatalf("ListModelPricingBaselinesAll: %v", err)
		}
		models = append(models, b.GetModelId())
	}
	if fmt.Sprint(models) != "[m0 m1 m2]" || fmt.Sprint(fake.tokens) != "[ 1 2]" {
		t.Errorf("models = %v, tokens = %q", models, fake.tokens)
	}
}
