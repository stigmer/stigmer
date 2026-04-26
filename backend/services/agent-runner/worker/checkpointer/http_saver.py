"""HTTP-backed LangGraph checkpoint saver.

Routes checkpoint persistence through the Stigmer Side-Channel Proxy
(api.stigmer.ai/v1/proxy) instead of connecting directly to MongoDB. This
removes the need for STIGMER_CHECKPOINTER_MONGODB_URI in the runner.

Both sync and async interfaces are implemented.  The Temporal activity
runs in an async context, so LangGraph calls the ``a``-prefixed methods
(``aget_tuple``, ``aput``, etc.).  The sync variants remain for backward
compatibility and testing.
"""

from __future__ import annotations

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


class HttpCheckpointSaver(BaseCheckpointSaver):
    """Checkpoint saver that persists state via the Stigmer proxy HTTP API.

    Implements the same interface as MongoDBSaver but routes all
    persistence through stigmer-service, which accesses MongoDB
    server-side. The runner never touches MongoDB directly.

    Both sync (``httpx.Client``) and async (``httpx.AsyncClient``)
    HTTP clients are maintained so the saver works in both execution
    contexts.  LangGraph's async graph runner calls the ``a``-prefixed
    methods; the sync methods are used by tests and CLI tooling.

    Authorization is handled server-side by the proxy via OpenFGA —
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

        doc: dict[str, Any] = {
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "checkpoint_id": checkpoint_id,
            "parent_checkpoint_id": config["configurable"].get("checkpoint_id"),
            "checkpoint": self.serde.dumps_typed(checkpoint),
            "metadata": self.serde.dumps_typed(metadata),
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
            doc: dict[str, Any] = {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint_id,
                "task_id": task_id,
                "idx": idx,
                "channel": channel,
                "type": type(value).__name__,
                "value": self.serde.dumps_typed(value),
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

        doc = resp.json()
        config_out = {
            "configurable": {
                "thread_id": doc["thread_id"],
                "checkpoint_ns": doc.get("checkpoint_ns", ""),
                "checkpoint_id": doc["checkpoint_id"],
            }
        }

        checkpoint = self.serde.loads_typed(doc["checkpoint"])
        metadata = self.serde.loads_typed(doc["metadata"]) if doc.get("metadata") else {}

        parent_config = None
        if doc.get("parent_checkpoint_id"):
            parent_config = {
                "configurable": {
                    "thread_id": doc["thread_id"],
                    "checkpoint_ns": doc.get("checkpoint_ns", ""),
                    "checkpoint_id": doc["parent_checkpoint_id"],
                }
            }

        writes_resp = self._client.get("/writes", params={
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "checkpoint_id": doc["checkpoint_id"],
        })
        pending_writes = []
        if writes_resp.status_code == 200:
            writes_data = writes_resp.json()
            for w in writes_data.get("writes", []):
                pending_writes.append((
                    w["task_id"],
                    w["channel"],
                    self.serde.loads_typed(w["value"]),
                ))

        return CheckpointTuple(
            config=cast(RunnableConfig, config_out),
            checkpoint=cast(Checkpoint, checkpoint),
            metadata=cast(CheckpointMetadata, metadata),
            parent_config=cast(RunnableConfig | None, parent_config),
            pending_writes=pending_writes,
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
            cfg = {
                "configurable": {
                    "thread_id": doc["thread_id"],
                    "checkpoint_ns": doc.get("checkpoint_ns", ""),
                    "checkpoint_id": doc["checkpoint_id"],
                }
            }
            checkpoint = self.serde.loads_typed(doc["checkpoint"])
            metadata = self.serde.loads_typed(doc["metadata"]) if doc.get("metadata") else {}

            parent_config = None
            if doc.get("parent_checkpoint_id"):
                parent_config = {
                    "configurable": {
                        "thread_id": doc["thread_id"],
                        "checkpoint_ns": doc.get("checkpoint_ns", ""),
                        "checkpoint_id": doc["parent_checkpoint_id"],
                    }
                }

            yield CheckpointTuple(
                config=cast(RunnableConfig, cfg),
                checkpoint=cast(Checkpoint, checkpoint),
                metadata=cast(CheckpointMetadata, metadata),
                parent_config=cast(RunnableConfig | None, parent_config),
            )

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

        doc: dict[str, Any] = {
            "thread_id": thread_id,
            "checkpoint_ns": checkpoint_ns,
            "checkpoint_id": checkpoint_id,
            "parent_checkpoint_id": config["configurable"].get("checkpoint_id"),
            "checkpoint": self.serde.dumps_typed(checkpoint),
            "metadata": self.serde.dumps_typed(metadata),
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
            doc: dict[str, Any] = {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint_id,
                "task_id": task_id,
                "idx": idx,
                "channel": channel,
                "type": type(value).__name__,
                "value": self.serde.dumps_typed(value),
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

        doc = resp.json()
        config_out = {
            "configurable": {
                "thread_id": doc["thread_id"],
                "checkpoint_ns": doc.get("checkpoint_ns", ""),
                "checkpoint_id": doc["checkpoint_id"],
            }
        }

        checkpoint = self.serde.loads_typed(doc["checkpoint"])
        metadata = self.serde.loads_typed(doc["metadata"]) if doc.get("metadata") else {}

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
        pending_writes = []
        if writes_resp.status_code == 200:
            writes_data = writes_resp.json()
            for w in writes_data.get("writes", []):
                pending_writes.append((
                    w["task_id"],
                    w["channel"],
                    self.serde.loads_typed(w["value"]),
                ))

        return CheckpointTuple(
            config=cast(RunnableConfig, config_out),
            checkpoint=cast(Checkpoint, checkpoint),
            metadata=cast(CheckpointMetadata, metadata),
            parent_config=cast(RunnableConfig | None, parent_config),
            pending_writes=pending_writes,
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
            cfg = {
                "configurable": {
                    "thread_id": doc["thread_id"],
                    "checkpoint_ns": doc.get("checkpoint_ns", ""),
                    "checkpoint_id": doc["checkpoint_id"],
                }
            }
            checkpoint = self.serde.loads_typed(doc["checkpoint"])
            metadata = self.serde.loads_typed(doc["metadata"]) if doc.get("metadata") else {}

            parent_config = None
            if doc.get("parent_checkpoint_id"):
                parent_config = {
                    "configurable": {
                        "thread_id": doc["thread_id"],
                        "checkpoint_ns": doc.get("checkpoint_ns", ""),
                        "checkpoint_id": doc["parent_checkpoint_id"],
                    }
                }

            yield CheckpointTuple(
                config=cast(RunnableConfig, cfg),
                checkpoint=cast(Checkpoint, checkpoint),
                metadata=cast(CheckpointMetadata, metadata),
                parent_config=cast(RunnableConfig | None, parent_config),
            )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        self._client.close()

    async def aclose(self) -> None:
        await self._async_client.aclose()
        self._client.close()
