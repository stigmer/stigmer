"""A token provider that fetches once and keeps the token until it nearly expires.

A backend that acts as one of its product's signed-in users mints that
person a user token with its service account's client, then starts the run
with a second client built on the token
(``StigmerClient(get_access_token=…)``). The client asks its provider for
the token on every call, so a provider that minted each time would mint per
request. :class:`TokenCache` sits between them: it serves the token it holds
until a minute before it expires, then fetches again; callers that ask while
a fetch is running wait for that one fetch; a fetch that raises is not kept,
so the next call tries again. It is the Python form of the TypeScript SDK's
``createTokenCache``, with the same rules.

The cache is the one writer of the token it holds: nothing else sets it, and
:meth:`TokenCache.invalidate` is the one way to drop it early (when the
person signs out, or the backend learns the token was revoked).
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Callable, Protocol

# How long before expiry a held token counts as stale, the TypeScript SDK's
# EXPIRY_SKEW_MS: a long stream must not start on a token that expires
# moments later.
EXPIRY_SKEW_SECONDS = 60.0


class FetchedToken(Protocol):
    """What a fetch returns: :class:`~stigmer.MintUserTokenResult`, or any
    object with the same two attributes."""

    @property
    def access_token(self) -> str: ...

    @property
    def expires_at(self) -> datetime: ...


class TokenCache:
    """Fetches a token once and reuses it until it is about to expire.

    Pass :meth:`get_access_token` to a client::

        admin = StigmerClient(os.environ["STIGMER_API_KEY"])

        tokens = TokenCache(
            lambda: admin.tokens.mint_user_token(org="acme", user_id=user.id)
        )
        as_user = StigmerClient(get_access_token=tokens.get_access_token)

    ``fetch`` returns an object with ``access_token`` (a non-empty string)
    and ``expires_at`` (a ``datetime``; one without a time zone is read as
    UTC), which is what ``mint_user_token`` returns. It is safe to share
    between threads.
    """

    def __init__(self, fetch: Callable[[], FetchedToken]) -> None:
        self._fetch = fetch
        # Held only while a fetch runs, so concurrent callers share it.
        self._fetch_lock = threading.Lock()
        # Guards the held token and the generation; never held across a fetch.
        self._state_lock = threading.Lock()
        self._token: str | None = None
        self._expires_at = 0.0
        # Bumped by invalidate, so a fetch that started before it is not kept.
        self._generation = 0

    def get_access_token(self) -> str:
        """The held token while it has more than a minute left, otherwise a new one.

        Raises:
            ValueError: the fetched value has no ``access_token``, or its
                ``expires_at`` is not a ``datetime``.
            Exception: whatever ``fetch`` raised (``StigmerError`` from
                ``mint_user_token``), unchanged and not kept.
        """
        held = self._fresh()
        if held is not None:
            return held
        with self._fetch_lock:
            # A caller that waited on the lock finds the token the fetch it
            # waited for kept.
            held = self._fresh()
            if held is not None:
                return held
            with self._state_lock:
                started_in = self._generation
            token, expires_at = _read(self._fetch())
            with self._state_lock:
                if started_in == self._generation:
                    self._token = token
                    self._expires_at = expires_at
            return token

    def invalidate(self) -> None:
        """Forget the held token, so the next call fetches a new one.

        A fetch already running still answers its callers, but its token is
        not kept: a token minted for one person must not be served after the
        host says that person signed out or changed.
        """
        with self._state_lock:
            self._generation += 1
            self._token = None
            self._expires_at = 0.0

    def _fresh(self) -> str | None:
        with self._state_lock:
            if self._token is not None and self._expires_at - time.time() > EXPIRY_SKEW_SECONDS:
                return self._token
            return None


def _read(fetched: FetchedToken) -> tuple[str, float]:
    token = getattr(fetched, "access_token", None)
    if not isinstance(token, str) or not token:
        raise ValueError(
            "TokenCache: the fetched value has no access_token; return what"
            " mint_user_token returns, or an object with access_token and expires_at"
        )
    expires_at = getattr(fetched, "expires_at", None)
    if not isinstance(expires_at, datetime):
        raise ValueError(
            f"TokenCache: the fetched token's expires_at ({expires_at!r}) is not a datetime"
        )
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return token, expires_at.timestamp()
