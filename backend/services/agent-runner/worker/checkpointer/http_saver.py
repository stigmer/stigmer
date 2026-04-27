"""HTTP-backed LangGraph checkpoint saver.

Routes checkpoint persistence through the Stigmer Side-Channel Proxy
(api.stigmer.ai/v1/proxy) instead of connecting directly to MongoDB. This
removes the need for STIGMER_CHECKPOINTER_MONGODB_URI in the runner.

Both sync and async interfaces are implemented.  The Temporal activity
runs in an async context, so LangGraph calls the ``a``-prefixed methods
(``aget_tuple``, ``aput``, etc.).  The sync variants remain for backward
compatibility and testing.

Serialization
-------------
``JsonPlusSerializer.dumps_typed()`` returns ``tuple[str, bytes]`` where
the first element is a serde type tag (e.g. ``"msgpack"``) and the
second is binary payload.  MongoDBSaver stores these as separate
``type`` (string) and ``checkpoint``/``value`` (BSON Binary) fields.

Because this saver transports data as JSON over HTTP, binary payloads
are encoded as **MongoDB Extended JSON v2** ``$binary`` objects::

    {"$binary": {"base64": "<base64-data>", "subType": "00"}}

The Java ``CheckpointerProxyController`` calls ``Document.parse(json)``
which handles ``$binary`` natively (converting to BSON Binary), and
``doc.toJson()`` emits the same format on reads.  This gives us a clean
round-trip without any changes on the server side.
"""

from __future__ import annotations

import base64
import logging
from collections.abc import AsyncIterator, Iterator, Sequence
from typing import Any, cast

import httpx
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
)
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

logger = logging.getLogger(__name__)


def _encode_binary(payload: bytes) -> dict[str, Any]:
    """Encode bytes as MongoDB Extended JSON v2 ``$binary``."""
    return {
        "$binary": {
            "base64": base64.b64encode(payload).decode("ascii"),
            "subType": "00",
        }
    }


def _decode_binary(obj: dict[str, Any]) -> bytes:
    """Decode MongoDB Extended JSON v2 ``$binary`` back to bytes."""
    return base64.b64decode(obj["$binary"]["base64"])


class HttpCheckpointSaver(BaseCheckpointSaver):
    """Checkpoint saver that persists state via the Stigmer proxy HTTP API.

    Implements the same interface as MongoDBSaver but routes all
    persistence through stigmer-service, which accesses MongoDB
    server-side. The runner never touches MongoDB directly.

    Both sync (``httpx.Client``) and async (``httpx.AsyncClient``)
    HTTP clients are maintained so the saver works in both execution
    contexts.  LangGraph's async graph runner calls the ``a``-prefixed
    methods; the sync methods are used by tests and CLI tooling.

    Authorization is handled server-side by the proxy via OpenFGA --
    the runner's auth token (user API key or JWT) is validated against
    the session that the checkpoint's thread_id belongs to.
    """

    serde = JsonPlusSerializer()

    def __init__(self, proxy_endpoint: str, auth_token: str) -> None:
        super().__init__()
        self._base_url = f"{proxy_endpoint.rstrip('/')}/v1/proxy/checkpoints"
        _headers = {"Authorization": f"Bearer {auth_token}"}
        self._client = httpx.Client(
            base_url=self._base_url,
            headers=_headers,
            timeout=30.0,
        )
        self._async_client = httpx.AsyncClient(
            base_url=self._base_url,
            headers=_headers,
            timeout=30.0,
        )

    # ------------------------------------------------------------------
    # Serialization helpers
    # ------------------------------------------------------------------

    def _serialize_typed(self, obj: Any) -> tuple[str, dict[str, Any]]:
        """Serialize via serde and return (type_tag, $binary dict)."""
        type_tag, payload = self.serde.dumps_typed(obj)
        return type_tag, _encode_binary(payload)

    def _deserialize_typed(
        self, type_tag: str, binary_obj: dict[str, Any],
    ) -> Any:
        """Decode $binary and deserialize via serde."""
        payload = _decode_binary(binary_obj)
        return self.serde.loads_typed((type_tag, payload))

    # ------------------------------------------------------------------
    # Sync interface
    # ------------------------------------------------------------------

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        checkpoint_id = checkpoint["id"]

        cp_type, cp_binary = self._serialize_typed(checkpoint)
        md_type, md_binary = self._serialize_typed(metadata)

        doc: dict[str, Any] = {
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "checkpoint_id": checkpoint_id,
            "parent_checkpoint_id": config["configurable"].get("checkpoint_id"),
            "type": cp_type,
            "checkpoint": cp_binary,
            "metadata_type": md_type,
            "metadata": md_binary,
        }

        org_id = config["configurable"].get("org")
        if org_id:
            doc["org_id"] = org_id

        resp = self._client.put("/checkpoint", json=doc)
        resp.raise_for_status()

        return cast(RunnableConfig, {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint_id,
            }
        })

    def put_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        checkpoint_id = config["configurable"]["checkpoint_id"]
        org_id = config["configurable"].get("org")

        docs = []
        for idx, (channel, value) in enumerate(writes):
            type_tag, binary_val = self._serialize_typed(value)
            doc: dict[str, Any] = {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint_id,
                "task_id": task_id,
                "idx": idx,
                "channel": channel,
                "type": type_tag,
                "value": binary_val,
            }
            if org_id:
                doc["org_id"] = org_id
            docs.append(doc)

        resp = self._client.put("/writes", json={"writes": docs})
        resp.raise_for_status()

    def get_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        checkpoint_id = config["configurable"].get("checkpoint_id")

        params: dict[str, str] = {
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
        }
        if checkpoint_id:
            params["checkpoint_id"] = checkpoint_id

        resp = self._client.get("/checkpoint", params=params)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()

        return self._parse_checkpoint_doc(
            resp.json(), thread_id, checkpoint_ns, self._client,
        )

    def list(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> Iterator[CheckpointTuple]:
        if config is None:
            return

        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")

        eff_limit = 10 if limit is None else limit
        params: dict[str, Any] = {
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "limit": str(eff_limit),
        }
        if before and before.get("configurable", {}).get("checkpoint_id"):
            params["before"] = before["configurable"]["checkpoint_id"]

        resp = self._client.get("/checkpoints", params=params)
        resp.raise_for_status()

        data = resp.json()
        for doc in data.get("checkpoints", []):
            yield self._parse_checkpoint_doc_without_writes(doc)

    # ------------------------------------------------------------------
    # Async interface (used by LangGraph's async graph runner)
    # ------------------------------------------------------------------

    async def aput(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        checkpoint_id = checkpoint["id"]

        cp_type, cp_binary = self._serialize_typed(checkpoint)
        md_type, md_binary = self._serialize_typed(metadata)

        doc: dict[str, Any] = {
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "checkpoint_id": checkpoint_id,
            "parent_checkpoint_id": config["configurable"].get("checkpoint_id"),
            "type": cp_type,
            "checkpoint": cp_binary,
            "metadata_type": md_type,
            "metadata": md_binary,
        }

        org_id = config["configurable"].get("org")
        if org_id:
            doc["org_id"] = org_id

        resp = await self._async_client.put("/checkpoint", json=doc)
        resp.raise_for_status()

        return cast(RunnableConfig, {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint_id,
            }
        })

    async def aput_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        checkpoint_id = config["configurable"]["checkpoint_id"]
        org_id = config["configurable"].get("org")

        docs = []
        for idx, (channel, value) in enumerate(writes):
            type_tag, binary_val = self._serialize_typed(value)
            doc: dict[str, Any] = {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint_id,
                "task_id": task_id,
                "idx": idx,
                "channel": channel,
                "type": type_tag,
                "value": binary_val,
            }
            if org_id:
                doc["org_id"] = org_id
            docs.append(doc)

        resp = await self._async_client.put("/writes", json={"writes": docs})
        resp.raise_for_status()

    async def aget_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        checkpoint_id = config["configurable"].get("checkpoint_id")

        params: dict[str, str] = {
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
        }
        if checkpoint_id:
            params["checkpoint_id"] = checkpoint_id

        resp = await self._async_client.get("/checkpoint", params=params)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()

        return await self._aparse_checkpoint_doc(
            resp.json(), thread_id, checkpoint_ns,
        )

    async def alist(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> AsyncIterator[CheckpointTuple]:
        if config is None:
            return

        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")

        eff_limit = 10 if limit is None else limit
        params: dict[str, Any] = {
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "limit": str(eff_limit),
        }
        if before and before.get("configurable", {}).get("checkpoint_id"):
            params["before"] = before["configurable"]["checkpoint_id"]

        resp = await self._async_client.get("/checkpoints", params=params)
        resp.raise_for_status()

        data = resp.json()
        for doc in data.get("checkpoints", []):
            yield self._parse_checkpoint_doc_without_writes(doc)

    # ------------------------------------------------------------------
    # Shared deserialization helpers
    # ------------------------------------------------------------------

    def _parse_checkpoint_doc(
        self,
        doc: dict[str, Any],
        thread_id: str,
        checkpoint_ns: str,
        client: httpx.Client,
    ) -> CheckpointTuple:
        """Parse a checkpoint document from the proxy (sync, with writes)."""
        config_out = {
            "configurable": {
                "thread_id": doc["thread_id"],
                "checkpoint_ns": doc.get("checkpoint_ns", ""),
                "checkpoint_id": doc["checkpoint_id"],
            }
        }

        cp_type = doc.get("type", "msgpack")
        checkpoint = self._deserialize_typed(cp_type, doc["checkpoint"])

        md_type = doc.get("metadata_type", cp_type)
        metadata = self._deserialize_typed(md_type, doc["metadata"]) if doc.get("metadata") else {}

        parent_config = None
        if doc.get("parent_checkpoint_id"):
            parent_config = {
                "configurable": {
                    "thread_id": doc["thread_id"],
                    "checkpoint_ns": doc.get("checkpoint_ns", ""),
                    "checkpoint_id": doc["parent_checkpoint_id"],
                }
            }

        writes_resp = client.get("/writes", params={
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "checkpoint_id": doc["checkpoint_id"],
        })
        pending_writes = self._parse_writes(writes_resp)

        return CheckpointTuple(
            config=cast(RunnableConfig, config_out),
            checkpoint=cast(Checkpoint, checkpoint),
            metadata=cast(CheckpointMetadata, metadata),
            parent_config=cast(RunnableConfig | None, parent_config),
            pending_writes=pending_writes,
        )

    async def _aparse_checkpoint_doc(
        self,
        doc: dict[str, Any],
        thread_id: str,
        checkpoint_ns: str,
    ) -> CheckpointTuple:
        """Parse a checkpoint document from the proxy (async, with writes)."""
        config_out = {
            "configurable": {
                "thread_id": doc["thread_id"],
                "checkpoint_ns": doc.get("checkpoint_ns", ""),
                "checkpoint_id": doc["checkpoint_id"],
            }
        }

        cp_type = doc.get("type", "msgpack")
        checkpoint = self._deserialize_typed(cp_type, doc["checkpoint"])

        md_type = doc.get("metadata_type", cp_type)
        metadata = self._deserialize_typed(md_type, doc["metadata"]) if doc.get("metadata") else {}

        parent_config = None
        if doc.get("parent_checkpoint_id"):
            parent_config = {
                "configurable": {
                    "thread_id": doc["thread_id"],
                    "checkpoint_ns": doc.get("checkpoint_ns", ""),
                    "checkpoint_id": doc["parent_checkpoint_id"],
                }
            }

        writes_resp = await self._async_client.get("/writes", params={
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "checkpoint_id": doc["checkpoint_id"],
        })
        pending_writes = self._parse_writes(writes_resp)

        return CheckpointTuple(
            config=cast(RunnableConfig, config_out),
            checkpoint=cast(Checkpoint, checkpoint),
            metadata=cast(CheckpointMetadata, metadata),
            parent_config=cast(RunnableConfig | None, parent_config),
            pending_writes=pending_writes,
        )

    def _parse_checkpoint_doc_without_writes(
        self, doc: dict[str, Any],
    ) -> CheckpointTuple:
        """Parse a checkpoint document without fetching writes (for list)."""
        cfg = {
            "configurable": {
                "thread_id": doc["thread_id"],
                "checkpoint_ns": doc.get("checkpoint_ns", ""),
                "checkpoint_id": doc["checkpoint_id"],
            }
        }

        cp_type = doc.get("type", "msgpack")
        checkpoint = self._deserialize_typed(cp_type, doc["checkpoint"])

        md_type = doc.get("metadata_type", cp_type)
        metadata = self._deserialize_typed(md_type, doc["metadata"]) if doc.get("metadata") else {}

        parent_config = None
        if doc.get("parent_checkpoint_id"):
            parent_config = {
                "configurable": {
                    "thread_id": doc["thread_id"],
                    "checkpoint_ns": doc.get("checkpoint_ns", ""),
                    "checkpoint_id": doc["parent_checkpoint_id"],
                }
            }

        return CheckpointTuple(
            config=cast(RunnableConfig, cfg),
            checkpoint=cast(Checkpoint, checkpoint),
            metadata=cast(CheckpointMetadata, metadata),
            parent_config=cast(RunnableConfig | None, parent_config),
        )

    def _parse_writes(self, resp: httpx.Response) -> list[tuple[str, str, Any]]:
        """Parse checkpoint writes from a proxy response."""
        pending_writes: list[tuple[str, str, Any]] = []
        if resp.status_code == 200:
            writes_data = resp.json()
            for w in writes_data.get("writes", []):
                w_type = w.get("type", "msgpack")
                value = self._deserialize_typed(w_type, w["value"])
                pending_writes.append((w["task_id"], w["channel"], value))
        return pending_writes

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        self._client.close()

    async def aclose(self) -> None:
        await self._async_client.aclose()
        self._client.close()
