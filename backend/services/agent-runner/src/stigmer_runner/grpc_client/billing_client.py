"""gRPC client for billing usage reporting during agent execution.

Reports per-LLM-call usage to the billing service after each model call.
The billing service applies markup, debits credits, and returns a signal
directing the runner's next action (continue, warn, or stop).

Design Principles:
    1. Non-blocking — billing RPC should not stall LLM streaming. If the
       server is slow or unreachable, log and continue.
    2. Graceful degradation — if the RPC fails, the execution continues.
       The reservation caps financial exposure.
    3. Idempotent — deduped by (execution_id, sequence) on the server.
       Safe to retry on transient failures.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import grpc
from ai.stigmer.billing.v1 import command_pb2_grpc
from ai.stigmer.billing.v1.enum_pb2 import ExecutionBillingSignal
from ai.stigmer.billing.v1.io_pb2 import (
    ReportLlmCallUsageInput,
    ReportLlmCallUsageResponse,
)

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT_SECONDS = 5.0


@dataclass(frozen=True)
class BillingUsageReport:
    """Result of reporting a single LLM call to billing."""

    signal: int
    balance_after_micros: int
    billable_amount_micros: int

    @property
    def should_stop(self) -> bool:
        return self.signal == ExecutionBillingSignal.stop_execution

    @property
    def is_warning(self) -> bool:
        return self.signal == ExecutionBillingSignal.low_balance_warning


class BillingReporter:
    """Reports per-LLM-call usage to the billing service.

    Constructed once per execution and reused for all LLM calls within that
    execution (including sub-agent calls). Thread-safe for concurrent use
    from LangGraph event handlers.

    Typical lifecycle::

        reporter = BillingReporter(channel, execution_id="exec-123", harness="native")

        # After each LLM call
        result = await reporter.report_usage(
            sequence=1,
            model="claude-sonnet-4-6-20250514",
            cost_tier="standard",
            provider_cost_micros=45000,
            input_tokens=1500,
            output_tokens=300,
            cache_creation_tokens=0,
            cache_read_tokens=800,
        )
        if result.should_stop:
            # trigger graceful stop
    """

    def __init__(
        self,
        channel: grpc.aio.Channel,
        *,
        execution_id: str,
        harness: str,
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._stub = command_pb2_grpc.BillingCommandControllerStub(channel)
        self._execution_id = execution_id
        self._harness = harness
        self._timeout = timeout

    async def report_usage(
        self,
        *,
        sequence: int,
        model: str,
        cost_tier: str,
        provider_cost_micros: int,
        input_tokens: int,
        output_tokens: int,
        cache_creation_tokens: int,
        cache_read_tokens: int,
    ) -> BillingUsageReport | None:
        """Report a single LLM call's usage to the billing service.

        Returns the billing signal (continue/warning/stop) or None if the
        RPC failed (graceful degradation — execution continues).
        """
        request = ReportLlmCallUsageInput(
            execution_id=self._execution_id,
            sequence=sequence,
            model=model,
            harness=self._harness,
            cost_tier=cost_tier,
            provider_cost_micros=provider_cost_micros,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_creation_tokens=cache_creation_tokens,
            cache_read_tokens=cache_read_tokens,
        )

        try:
            response: ReportLlmCallUsageResponse = await self._stub.reportLlmCallUsage(
                request, timeout=self._timeout,
            )

            result = BillingUsageReport(
                signal=response.signal,
                balance_after_micros=response.balance_after_micros,
                billable_amount_micros=response.billable_amount_micros,
            )

            if result.should_stop:
                logger.warning(
                    "[BILLING] STOP signal received: execution=%s seq=%d "
                    "balance_after=%dμ billable=%dμ",
                    self._execution_id, sequence,
                    result.balance_after_micros, result.billable_amount_micros,
                )
            elif result.is_warning:
                logger.warning(
                    "[BILLING] LOW_BALANCE warning: execution=%s seq=%d "
                    "balance_after=%dμ billable=%dμ",
                    self._execution_id, sequence,
                    result.balance_after_micros, result.billable_amount_micros,
                )
            else:
                logger.debug(
                    "[BILLING] usage reported: execution=%s seq=%d "
                    "billable=%dμ balance=%dμ",
                    self._execution_id, sequence,
                    result.billable_amount_micros, result.balance_after_micros,
                )

            return result

        except grpc.aio.AioRpcError as e:
            logger.error(
                "[BILLING] RPC failed (graceful degradation): execution=%s seq=%d "
                "code=%s details=%s",
                self._execution_id, sequence,
                e.code().name, e.details(),
            )
            return None

        except Exception as e:
            logger.error(
                "[BILLING] Unexpected error (graceful degradation): execution=%s seq=%d "
                "error=%s",
                self._execution_id, sequence, str(e),
            )
            return None
