"""Page iterators over the one list shape.

A generated ``list_all`` walks ``next_page_token`` to the end from the token
its input names, keeps the list's filters on every page and never changes
the caller's request; search's ``query_all`` and the billing catalog's
``list_model_pricing_baselines_all`` walk their tokens the same way.  Each
test injects a fake stub that serves a short list a page at a time.
"""

from __future__ import annotations

import pytest

from ai.stigmer.agentic.routine.v1 import api_pb2 as routine_api_pb2
from ai.stigmer.agentic.routine.v1 import io_pb2 as routine_io_pb2
from ai.stigmer.billing.v1 import io_pb2 as billing_io_pb2
from ai.stigmer.billing.v1 import model_pricing_baseline_pb2
from ai.stigmer.commons.apiresource import metadata_pb2
from ai.stigmer.search.v1 import io_pb2 as search_io_pb2

from stigmer import StigmerClient
from stigmer._search import SearchParams


class _PagedRoutineQuery:
    """Five routines served two at a time, each request recorded."""

    def __init__(self) -> None:
        self.requests: list[routine_io_pb2.ListRoutinesRequest] = []

    def list(self, req):
        copy = routine_io_pb2.ListRoutinesRequest()
        copy.CopyFrom(req)
        self.requests.append(copy)
        start = int(req.page_token) if req.page_token else 0
        end = min(start + 2, 5)
        return routine_io_pb2.RoutineList(
            entries=[
                routine_api_pb2.Routine(metadata=metadata_pb2.ApiResourceMetadata(id=f"rtn_{i}"))
                for i in range(start, end)
            ],
            next_page_token=str(end) if end < 5 else "",
        )


@pytest.fixture()
def client():
    with StigmerClient("test-key", base_url="localhost:7234", insecure=True) as c:
        yield c


class TestGeneratedListAll:
    def test_walks_every_page_keeping_the_filters(self, client: StigmerClient) -> None:
        fake = _PagedRoutineQuery()
        client.routines._query = fake
        request = routine_io_pb2.ListRoutinesRequest(org="acme", labels={"team": "support"}, page_size=2)

        ids = [s.metadata.id for s in client.routines.list_all(request)]

        assert ids == ["rtn_0", "rtn_1", "rtn_2", "rtn_3", "rtn_4"]
        assert [r.page_token for r in fake.requests] == ["", "2", "4"]
        assert all(r.org == "acme" and r.labels["team"] == "support" and r.page_size == 2 for r in fake.requests)
        assert request.page_token == ""

    def test_starts_from_the_input_token(self, client: StigmerClient) -> None:
        client.routines._query = _PagedRoutineQuery()

        ids = [s.metadata.id for s in client.routines.list_all(routine_io_pb2.ListRoutinesRequest(page_token="4"))]

        assert ids == ["rtn_4"]

    def test_stops_reading_when_the_caller_stops(self, client: StigmerClient) -> None:
        fake = _PagedRoutineQuery()
        client.routines._query = fake

        next(iter(client.routines.list_all(routine_io_pb2.ListRoutinesRequest())))

        assert len(fake.requests) == 1


class _PagedSearch:
    def __init__(self) -> None:
        self.tokens: list[str] = []

    def search(self, req):
        self.tokens.append(req.page_token)
        i = int(req.page_token) if req.page_token else 0
        return search_io_pb2.SearchResponse(
            entries=[search_io_pb2.SearchResult(name=f"r{i}")],
            counts_by_kind={"agent": 3},
            next_page_token=str(i + 1) if i < 2 else "",
        )


class _PagedBaselines:
    def __init__(self) -> None:
        self.requests: list[billing_io_pb2.ListModelPricingBaselinesInput] = []

    def listModelPricingBaselines(self, req):  # noqa: N802 — proto RPC name
        self.requests.append(req)
        i = int(req.page_token) if req.page_token else 0
        return billing_io_pb2.ModelPricingBaselinesResponse(
            entries=[model_pricing_baseline_pb2.ModelPricingBaseline(model_id=f"m{i}")],
            next_page_token=str(i + 1) if i < 2 else "",
        )


class TestHandWrittenIterators:
    def test_search_query_maps_the_page_fields(self, client: StigmerClient) -> None:
        fake = _PagedSearch()
        client.search._stub = fake

        page = client.search.query(SearchParams(kinds=[], org="acme", page_size=10, page_token="1"))

        assert fake.tokens == ["1"]
        assert page.counts_by_kind == {"agent": 3}
        assert page.next_page_token == "2"

    def test_search_query_all_walks_every_page(self, client: StigmerClient) -> None:
        fake = _PagedSearch()
        client.search._stub = fake

        names = [r.name for r in client.search.query_all(SearchParams(kinds=[], org="acme"))]

        assert names == ["r0", "r1", "r2"]
        assert fake.tokens == ["", "1", "2"]

    def test_baselines_all_walks_every_page(self, client: StigmerClient) -> None:
        fake = _PagedBaselines()
        client.billing._query = fake

        models = [b.model_id for b in client.billing.list_model_pricing_baselines_all(include_history=True)]

        assert models == ["m0", "m1", "m2"]
        assert [r.page_token for r in fake.requests] == ["", "1", "2"]
        assert all(r.include_history for r in fake.requests)
