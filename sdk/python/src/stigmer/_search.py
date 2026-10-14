"""Cross-resource search client for the Stigmer SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator

import grpc

from ai.stigmer.commons.apiresource.apiresourcekind import api_resource_kind_pb2
from ai.stigmer.search.v1 import io_pb2 as search_io_pb2
from ai.stigmer.search.v1 import query_pb2_grpc as search_query_pb2_grpc

from ._gen._errors import wrap_error

ApiResourceKind = api_resource_kind_pb2.ApiResourceKind
"""Re-export of the proto ``ApiResourceKind`` enum for use with :class:`SearchParams`."""


@dataclass
class SearchParams:
    """Parameters for a cross-resource search query.

    Unlike the per-resource ``list()`` methods (which browse a single
    resource kind), :meth:`SearchClient.query` finds resources of several
    kinds by their words in a single call.
    """

    kinds: list[int]
    org: str
    query: str = ""
    page_size: int = 0
    """The most results to return: 0 asks for the default page of 50, and above 100 reads 100."""
    page_token: str = ""
    """The previous response's ``next_page_token``, to continue the same query."""


@dataclass
class SearchResponse:
    """A page of cross-resource search results."""

    entries: list[search_io_pb2.SearchResult] = field(default_factory=list)
    counts_by_kind: dict[str, int] = field(default_factory=dict)
    """Matches per resource kind across every page, keyed by kind name."""
    next_page_token: str = ""
    """Set when more results may follow: pass it as ``page_token`` to continue."""


class SearchClient:
    """Cross-resource search client.

    Wraps the platform ``SearchService`` to query across multiple resource
    kinds in a single call.  To browse one kind, use the ``list()`` method
    on its resource client instead.
    """

    def __init__(self, channel: grpc.Channel) -> None:
        self._stub = search_query_pb2_grpc.SearchServiceStub(channel)

    def query(self, params: SearchParams) -> SearchResponse:
        """Perform a cross-resource search."""
        req = search_io_pb2.SearchRequest(
            kinds=params.kinds,
            query=params.query,
            org=params.org,
            page_size=params.page_size,
            page_token=params.page_token,
        )
        try:
            resp = self._stub.search(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

        return SearchResponse(
            entries=list(resp.entries),
            counts_by_kind=dict(resp.counts_by_kind),
            next_page_token=resp.next_page_token,
        )

    def query_all(self, params: SearchParams) -> Iterator[search_io_pb2.SearchResult]:
        """Every result of a search, page after page: follows
        ``next_page_token`` from the token the params name until the results end."""
        token = params.page_token
        while True:
            page = self.query(
                SearchParams(
                    kinds=params.kinds,
                    org=params.org,
                    query=params.query,
                    page_size=params.page_size,
                    page_token=token,
                )
            )
            yield from page.entries
            if not page.next_page_token:
                return
            token = page.next_page_token
