"""Cross-resource search client for the Stigmer SDK."""

from __future__ import annotations

from dataclasses import dataclass, field

import grpc

from ai.stigmer.commons.apiresource.apiresourcekind import api_resource_kind_pb2
from ai.stigmer.commons.rpc import pagination_pb2
from ai.stigmer.search.v1 import io_pb2 as search_io_pb2
from ai.stigmer.search.v1 import query_pb2_grpc as search_query_pb2_grpc

from ._gen._errors import wrap_error
from ._gen._types import Page

ApiResourceKind = api_resource_kind_pb2.ApiResourceKind
"""Re-export of the proto ``ApiResourceKind`` enum for use with :class:`SearchParams`."""


@dataclass
class SearchParams:
    """Parameters for a cross-resource search query.

    Unlike the per-resource ``list()`` methods (which search within a single
    resource kind), :meth:`SearchClient.query` searches across multiple
    resource kinds in a single call.
    """

    kinds: list[int]
    org: str
    query: str = ""
    exclude_public: bool = False
    page: Page | None = None


@dataclass
class SearchResponse:
    """A page of cross-resource search results."""

    entries: list[search_io_pb2.SearchResult] = field(default_factory=list)
    total_count: int = 0
    total_pages: int = 0


class SearchClient:
    """Cross-resource search client.

    Wraps the platform ``SearchService`` to query across multiple resource
    kinds in a single call.  For per-resource listing, use the ``list()``
    method on each resource client instead.
    """

    def __init__(self, channel: grpc.Channel) -> None:
        self._stub = search_query_pb2_grpc.SearchServiceStub(channel)

    def query(self, params: SearchParams) -> SearchResponse:
        """Perform a cross-resource search."""
        req = search_io_pb2.SearchRequest(
            kinds=params.kinds,
            query=params.query,
            org=params.org,
            exclude_public=params.exclude_public,
        )
        if params.page is not None:
            req.page.CopyFrom(
                pagination_pb2.PageInfo(
                    num=params.page.num,
                    size=params.page.size,
                )
            )
        try:
            resp = self._stub.search(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

        return SearchResponse(
            entries=list(resp.entries),
            total_count=resp.total_count,
            total_pages=resp.total_pages,
        )
