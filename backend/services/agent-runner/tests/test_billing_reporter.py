"""Tests for BillingReporter gRPC client."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest

from ai.stigmer.billing.v1.enum_pb2 import ExecutionBillingSignal
from ai.stigmer.billing.v1.io_pb2 import ReportLlmCallUsageResponse

from stigmer_runner.grpc_client.billing_client import BillingReporter, BillingUsageReport


@pytest.fixture
def mock_channel():
    return MagicMock(spec=grpc.aio.Channel)


@pytest.fixture
def reporter(mock_channel):
    return BillingReporter(
        mock_channel,
        execution_id="exec-test-001",
        harness="native",
    )


class TestBillingUsageReport:
    def test_should_stop_on_stop_signal(self):
        report = BillingUsageReport(
            signal=ExecutionBillingSignal.stop_execution,
            balance_after_micros=0,
            billable_amount_micros=50_000,
        )
        assert report.should_stop is True
        assert report.is_warning is False

    def test_is_warning_on_low_balance(self):
        report = BillingUsageReport(
            signal=ExecutionBillingSignal.low_balance_warning,
            balance_after_micros=100_000,
            billable_amount_micros=50_000,
        )
        assert report.should_stop is False
        assert report.is_warning is True

    def test_continue_signal(self):
        report = BillingUsageReport(
            signal=ExecutionBillingSignal.continue_execution,
            balance_after_micros=9_000_000,
            billable_amount_micros=50_000,
        )
        assert report.should_stop is False
        assert report.is_warning is False


class TestBillingReporter:
    @pytest.mark.asyncio
    async def test_report_usage_success(self, reporter, mock_channel):
        response = ReportLlmCallUsageResponse(
            signal=ExecutionBillingSignal.continue_execution,
            balance_after_micros=9_500_000,
            billable_amount_micros=62_500,
        )

        mock_stub = MagicMock()
        mock_stub.reportLlmCallUsage = AsyncMock(return_value=response)

        with patch.object(reporter, "_stub", mock_stub):
            result = await reporter.report_usage(
                sequence=1,
                model="claude-sonnet-4-6",
                cost_tier="standard",
                provider_cost_micros=50_000,
                input_tokens=1500,
                output_tokens=300,
                cache_creation_tokens=0,
                cache_read_tokens=800,
            )

        assert result is not None
        assert result.signal == ExecutionBillingSignal.continue_execution
        assert result.balance_after_micros == 9_500_000
        assert result.billable_amount_micros == 62_500

        call_args = mock_stub.reportLlmCallUsage.call_args
        request = call_args[0][0]
        assert request.execution_id == "exec-test-001"
        assert request.sequence == 1
        assert request.model == "claude-sonnet-4-6"
        assert request.harness == "native"
        assert request.cost_tier == "standard"
        assert request.provider_cost_micros == 50_000
        assert request.input_tokens == 1500
        assert request.output_tokens == 300

    @pytest.mark.asyncio
    async def test_report_usage_stop_signal(self, reporter, mock_channel):
        response = ReportLlmCallUsageResponse(
            signal=ExecutionBillingSignal.stop_execution,
            balance_after_micros=0,
            billable_amount_micros=50_000,
        )

        mock_stub = MagicMock()
        mock_stub.reportLlmCallUsage = AsyncMock(return_value=response)

        with patch.object(reporter, "_stub", mock_stub):
            result = await reporter.report_usage(
                sequence=5,
                model="claude-sonnet-4-6",
                cost_tier="standard",
                provider_cost_micros=50_000,
                input_tokens=1000,
                output_tokens=200,
                cache_creation_tokens=0,
                cache_read_tokens=0,
            )

        assert result is not None
        assert result.should_stop is True

    @pytest.mark.asyncio
    async def test_graceful_degradation_on_rpc_error(self, reporter, mock_channel):
        mock_stub = MagicMock()
        error = grpc.aio.AioRpcError(
            code=grpc.StatusCode.UNAVAILABLE,
            initial_metadata=grpc.aio.Metadata(),
            trailing_metadata=grpc.aio.Metadata(),
            details="Connection refused",
        )
        mock_stub.reportLlmCallUsage = AsyncMock(side_effect=error)

        with patch.object(reporter, "_stub", mock_stub):
            result = await reporter.report_usage(
                sequence=1,
                model="claude-sonnet-4-6",
                cost_tier="standard",
                provider_cost_micros=50_000,
                input_tokens=1000,
                output_tokens=200,
                cache_creation_tokens=0,
                cache_read_tokens=0,
            )

        assert result is None

    @pytest.mark.asyncio
    async def test_graceful_degradation_on_unexpected_error(self, reporter, mock_channel):
        mock_stub = MagicMock()
        mock_stub.reportLlmCallUsage = AsyncMock(side_effect=RuntimeError("unexpected"))

        with patch.object(reporter, "_stub", mock_stub):
            result = await reporter.report_usage(
                sequence=1,
                model="claude-sonnet-4-6",
                cost_tier="standard",
                provider_cost_micros=50_000,
                input_tokens=1000,
                output_tokens=200,
                cache_creation_tokens=0,
                cache_read_tokens=0,
            )

        assert result is None
