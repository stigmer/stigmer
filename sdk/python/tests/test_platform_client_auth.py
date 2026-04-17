"""Tests for the PlatformClient token-minting helper."""

from __future__ import annotations

import pytest

from stigmer._gen._errors import ErrorCode, StigmerError
from stigmer.platform_client_auth import (
    MintUserTokenInput,
    PlatformClientAuth,
    platform_client_auth,
)


class TestPlatformClientAuthFactory:
    """Tests for the platform_client_auth factory function."""

    def test_missing_client_id(self) -> None:
        with pytest.raises(ValueError, match="client_id is required"):
            platform_client_auth(client_id="", client_secret="stgm_cs_xyz")

    def test_missing_client_secret(self) -> None:
        with pytest.raises(ValueError, match="client_secret is required"):
            platform_client_auth(client_id="stgm_cid_abc", client_secret="")

    def test_valid_config(self) -> None:
        auth = platform_client_auth(
            base_url="localhost:7234",
            client_id="stgm_cid_abc",
            client_secret="stgm_cs_xyz",
            insecure=True,
        )
        assert isinstance(auth, PlatformClientAuth)
        auth.close()

    def test_context_manager(self) -> None:
        with platform_client_auth(
            base_url="localhost:7234",
            client_id="stgm_cid_abc",
            client_secret="stgm_cs_xyz",
            insecure=True,
        ) as auth:
            assert isinstance(auth, PlatformClientAuth)


class TestMintUserToken:
    """Tests for PlatformClientAuth.mint_user_token."""

    def test_empty_user_id(self) -> None:
        with platform_client_auth(
            base_url="localhost:7234",
            client_id="stgm_cid_abc",
            client_secret="stgm_cs_xyz",
            insecure=True,
        ) as auth:
            with pytest.raises(StigmerError, match="user_id is required") as exc_info:
                auth.mint_user_token(MintUserTokenInput(user_id=""))
            assert exc_info.value.code == ErrorCode.INVALID_ARGUMENT
