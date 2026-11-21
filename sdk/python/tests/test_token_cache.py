"""TokenCache: the backend's per-user token, fetched once per token, not per call.

The rules are the TypeScript SDK's ``createTokenCache``: the held token is
served until a minute before it expires; callers that ask during a fetch
share it; a fetch that raises is not kept; ``invalidate`` drops the token,
and a fetch already running when it is called is not kept either. Expiry is
real wall-clock time, so a token minted to expire in 30 seconds is already
inside the minute and is fetched again.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest

from stigmer import MintUserTokenResult, TokenCache


def _result(token: str, *, seconds: int = 900) -> MintUserTokenResult:
    return MintUserTokenResult(
        access_token=token,
        token_type="Bearer",
        expires_in=seconds,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=seconds),
    )


class _Counting:
    def __init__(self, *, seconds: int = 900) -> None:
        self.calls = 0
        self.seconds = seconds

    def __call__(self) -> MintUserTokenResult:
        self.calls += 1
        return _result(f"token-{self.calls}", seconds=self.seconds)


def test_a_fresh_token_is_fetched_once_and_reused() -> None:
    fetch = _Counting()
    cache = TokenCache(fetch)
    assert [cache.get_access_token() for _ in range(3)] == ["token-1"] * 3
    assert fetch.calls == 1


def test_a_token_inside_the_last_minute_is_fetched_again() -> None:
    fetch = _Counting(seconds=30)
    cache = TokenCache(fetch)
    assert cache.get_access_token() == "token-1"
    assert cache.get_access_token() == "token-2"
    assert fetch.calls == 2


def test_an_expired_token_is_never_served() -> None:
    fetch = _Counting(seconds=-5)
    cache = TokenCache(fetch)
    cache.get_access_token()
    assert cache.get_access_token() == "token-2"


def test_concurrent_callers_share_one_fetch() -> None:
    started = threading.Event()
    release = threading.Event()
    calls = 0

    def slow() -> MintUserTokenResult:
        nonlocal calls
        calls += 1
        started.set()
        release.wait(5)
        return _result("shared")

    cache = TokenCache(slow)
    results: list[str] = []
    threads = [threading.Thread(target=lambda: results.append(cache.get_access_token())) for _ in range(4)]
    for thread in threads:
        thread.start()
    started.wait(5)
    release.set()
    for thread in threads:
        thread.join(5)
    assert results == ["shared"] * 4
    assert calls == 1


def test_a_failed_fetch_is_not_kept() -> None:
    outcomes: list[object] = [RuntimeError("mint refused"), _result("after")]

    def flaky() -> MintUserTokenResult:
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        assert isinstance(outcome, MintUserTokenResult)
        return outcome

    cache = TokenCache(flaky)
    with pytest.raises(RuntimeError, match="mint refused"):
        cache.get_access_token()
    assert cache.get_access_token() == "after"


def test_invalidate_drops_the_held_token() -> None:
    fetch = _Counting()
    cache = TokenCache(fetch)
    cache.get_access_token()
    cache.invalidate()
    assert cache.get_access_token() == "token-2"


def test_a_fetch_running_when_invalidated_answers_but_is_not_kept() -> None:
    calls = 0
    cache: TokenCache

    def fetch() -> MintUserTokenResult:
        nonlocal calls
        calls += 1
        if calls == 1:
            cache.invalidate()  # the person signs out while the mint runs
        return _result(f"token-{calls}")

    cache = TokenCache(fetch)
    assert cache.get_access_token() == "token-1"
    assert cache.get_access_token() == "token-2"


def test_any_object_with_the_two_attributes_is_read() -> None:
    @dataclass
    class Fetched:
        access_token: str
        expires_at: datetime

    naive_utc = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=10)
    cache = TokenCache(lambda: Fetched("from-elsewhere", naive_utc))
    assert cache.get_access_token() == "from-elsewhere"
    assert cache.get_access_token() == "from-elsewhere"


@pytest.mark.parametrize(
    ("fetched", "message"),
    [
        (_result(""), "has no access_token"),
        (type("NoExpiry", (), {"access_token": "tok", "expires_at": "soon"})(), "is not a datetime"),
    ],
)
def test_a_value_without_a_token_or_an_expiry_is_refused(fetched: object, message: str) -> None:
    cache = TokenCache(lambda: fetched)  # type: ignore[arg-type, return-value]
    with pytest.raises(ValueError, match=message):
        cache.get_access_token()
