package ai.stigmer.billing.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * BillingCommandController handles write operations for the billing bounded context.
 * Billing is not a standard API Resource — there is no api_resource_kind annotation.
 * RPCs authorize against the organization resource kind.
 * Phase 0-2 RPCs are defined here. Stripe checkout (Phase 3),
 * auto-recharge configuration (Phase 4), and other write operations
 * are added in their respective phases.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class BillingCommandControllerGrpc {

  private BillingCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.billing.v1.BillingCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetOrCreateBillingAccountInput,
      ai.stigmer.billing.v1.BillingAccount> getGetOrCreateBillingAccountMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getOrCreateBillingAccount",
      requestType = ai.stigmer.billing.v1.GetOrCreateBillingAccountInput.class,
      responseType = ai.stigmer.billing.v1.BillingAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetOrCreateBillingAccountInput,
      ai.stigmer.billing.v1.BillingAccount> getGetOrCreateBillingAccountMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetOrCreateBillingAccountInput, ai.stigmer.billing.v1.BillingAccount> getGetOrCreateBillingAccountMethod;
    if ((getGetOrCreateBillingAccountMethod = BillingCommandControllerGrpc.getGetOrCreateBillingAccountMethod) == null) {
      synchronized (BillingCommandControllerGrpc.class) {
        if ((getGetOrCreateBillingAccountMethod = BillingCommandControllerGrpc.getGetOrCreateBillingAccountMethod) == null) {
          BillingCommandControllerGrpc.getGetOrCreateBillingAccountMethod = getGetOrCreateBillingAccountMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.GetOrCreateBillingAccountInput, ai.stigmer.billing.v1.BillingAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getOrCreateBillingAccount"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.GetOrCreateBillingAccountInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.BillingAccount.getDefaultInstance()))
              .setSchemaDescriptor(new BillingCommandControllerMethodDescriptorSupplier("getOrCreateBillingAccount"))
              .build();
        }
      }
    }
    return getGetOrCreateBillingAccountMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.AdjustCreditsInput,
      ai.stigmer.billing.v1.CreditLedgerEntry> getAdjustCreditsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "adjustCredits",
      requestType = ai.stigmer.billing.v1.AdjustCreditsInput.class,
      responseType = ai.stigmer.billing.v1.CreditLedgerEntry.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.AdjustCreditsInput,
      ai.stigmer.billing.v1.CreditLedgerEntry> getAdjustCreditsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.AdjustCreditsInput, ai.stigmer.billing.v1.CreditLedgerEntry> getAdjustCreditsMethod;
    if ((getAdjustCreditsMethod = BillingCommandControllerGrpc.getAdjustCreditsMethod) == null) {
      synchronized (BillingCommandControllerGrpc.class) {
        if ((getAdjustCreditsMethod = BillingCommandControllerGrpc.getAdjustCreditsMethod) == null) {
          BillingCommandControllerGrpc.getAdjustCreditsMethod = getAdjustCreditsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.AdjustCreditsInput, ai.stigmer.billing.v1.CreditLedgerEntry>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "adjustCredits"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.AdjustCreditsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.CreditLedgerEntry.getDefaultInstance()))
              .setSchemaDescriptor(new BillingCommandControllerMethodDescriptorSupplier("adjustCredits"))
              .build();
        }
      }
    }
    return getAdjustCreditsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.AuthorizeExecutionInput,
      ai.stigmer.billing.v1.AuthorizeExecutionResponse> getAuthorizeExecutionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "authorizeExecution",
      requestType = ai.stigmer.billing.v1.AuthorizeExecutionInput.class,
      responseType = ai.stigmer.billing.v1.AuthorizeExecutionResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.AuthorizeExecutionInput,
      ai.stigmer.billing.v1.AuthorizeExecutionResponse> getAuthorizeExecutionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.AuthorizeExecutionInput, ai.stigmer.billing.v1.AuthorizeExecutionResponse> getAuthorizeExecutionMethod;
    if ((getAuthorizeExecutionMethod = BillingCommandControllerGrpc.getAuthorizeExecutionMethod) == null) {
      synchronized (BillingCommandControllerGrpc.class) {
        if ((getAuthorizeExecutionMethod = BillingCommandControllerGrpc.getAuthorizeExecutionMethod) == null) {
          BillingCommandControllerGrpc.getAuthorizeExecutionMethod = getAuthorizeExecutionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.AuthorizeExecutionInput, ai.stigmer.billing.v1.AuthorizeExecutionResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "authorizeExecution"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.AuthorizeExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.AuthorizeExecutionResponse.getDefaultInstance()))
              .setSchemaDescriptor(new BillingCommandControllerMethodDescriptorSupplier("authorizeExecution"))
              .build();
        }
      }
    }
    return getAuthorizeExecutionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.ReportLlmCallUsageInput,
      ai.stigmer.billing.v1.ReportLlmCallUsageResponse> getReportLlmCallUsageMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "reportLlmCallUsage",
      requestType = ai.stigmer.billing.v1.ReportLlmCallUsageInput.class,
      responseType = ai.stigmer.billing.v1.ReportLlmCallUsageResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.ReportLlmCallUsageInput,
      ai.stigmer.billing.v1.ReportLlmCallUsageResponse> getReportLlmCallUsageMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.ReportLlmCallUsageInput, ai.stigmer.billing.v1.ReportLlmCallUsageResponse> getReportLlmCallUsageMethod;
    if ((getReportLlmCallUsageMethod = BillingCommandControllerGrpc.getReportLlmCallUsageMethod) == null) {
      synchronized (BillingCommandControllerGrpc.class) {
        if ((getReportLlmCallUsageMethod = BillingCommandControllerGrpc.getReportLlmCallUsageMethod) == null) {
          BillingCommandControllerGrpc.getReportLlmCallUsageMethod = getReportLlmCallUsageMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.ReportLlmCallUsageInput, ai.stigmer.billing.v1.ReportLlmCallUsageResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "reportLlmCallUsage"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.ReportLlmCallUsageInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.ReportLlmCallUsageResponse.getDefaultInstance()))
              .setSchemaDescriptor(new BillingCommandControllerMethodDescriptorSupplier("reportLlmCallUsage"))
              .build();
        }
      }
    }
    return getReportLlmCallUsageMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.FinalizeExecutionInput,
      ai.stigmer.billing.v1.FinalizeExecutionResponse> getFinalizeExecutionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "finalizeExecution",
      requestType = ai.stigmer.billing.v1.FinalizeExecutionInput.class,
      responseType = ai.stigmer.billing.v1.FinalizeExecutionResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.FinalizeExecutionInput,
      ai.stigmer.billing.v1.FinalizeExecutionResponse> getFinalizeExecutionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.FinalizeExecutionInput, ai.stigmer.billing.v1.FinalizeExecutionResponse> getFinalizeExecutionMethod;
    if ((getFinalizeExecutionMethod = BillingCommandControllerGrpc.getFinalizeExecutionMethod) == null) {
      synchronized (BillingCommandControllerGrpc.class) {
        if ((getFinalizeExecutionMethod = BillingCommandControllerGrpc.getFinalizeExecutionMethod) == null) {
          BillingCommandControllerGrpc.getFinalizeExecutionMethod = getFinalizeExecutionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.FinalizeExecutionInput, ai.stigmer.billing.v1.FinalizeExecutionResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "finalizeExecution"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.FinalizeExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.FinalizeExecutionResponse.getDefaultInstance()))
              .setSchemaDescriptor(new BillingCommandControllerMethodDescriptorSupplier("finalizeExecution"))
              .build();
        }
      }
    }
    return getFinalizeExecutionMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static BillingCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<BillingCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<BillingCommandControllerStub>() {
        @java.lang.Override
        public BillingCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new BillingCommandControllerStub(channel, callOptions);
        }
      };
    return BillingCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static BillingCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<BillingCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<BillingCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public BillingCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new BillingCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return BillingCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static BillingCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<BillingCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<BillingCommandControllerBlockingStub>() {
        @java.lang.Override
        public BillingCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new BillingCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return BillingCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static BillingCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<BillingCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<BillingCommandControllerFutureStub>() {
        @java.lang.Override
        public BillingCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new BillingCommandControllerFutureStub(channel, callOptions);
        }
      };
    return BillingCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * BillingCommandController handles write operations for the billing bounded context.
   * Billing is not a standard API Resource — there is no api_resource_kind annotation.
   * RPCs authorize against the organization resource kind.
   * Phase 0-2 RPCs are defined here. Stripe checkout (Phase 3),
   * auto-recharge configuration (Phase 4), and other write operations
   * are added in their respective phases.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Provision or retrieve the billing account for an organization.
     * Idempotent: creates the account on first call, returns existing on subsequent calls.
     * &#64;internal
     * Called during org creation or first billing interaction.
     * Initializes balance to zero with default thresholds.
     * </pre>
     */
    default void getOrCreateBillingAccount(ai.stigmer.billing.v1.GetOrCreateBillingAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetOrCreateBillingAccountMethod(), responseObserver);
    }

    /**
     * <pre>
     * Manually adjust an org's credit balance.
     * Produces an immutable ledger entry for audit. Requires admin privileges.
     * </pre>
     */
    default void adjustCredits(ai.stigmer.billing.v1.AdjustCreditsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreditLedgerEntry> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getAdjustCreditsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Reserve credits before starting an agent execution.
     * Returns authorization status and reservation details.
     * &#64;internal
     * Called by the Temporal workflow before dispatching to the agent runner.
     * The runner must not start if authorized is false.
     * </pre>
     */
    default void authorizeExecution(ai.stigmer.billing.v1.AuthorizeExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.AuthorizeExecutionResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getAuthorizeExecutionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Report a single LLM call's usage for billing.
     * Applies the billing policy, debits credits, and returns a signal.
     * &#64;internal
     * Called by the agent runner after each LLM call completes.
     * Deduplicated by (execution_id, sequence).
     * </pre>
     */
    default void reportLlmCallUsage(ai.stigmer.billing.v1.ReportLlmCallUsageInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ReportLlmCallUsageResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getReportLlmCallUsageMethod(), responseObserver);
    }

    /**
     * <pre>
     * Settle billing for a completed execution.
     * Releases unused reservation credits and produces the final billing record.
     * &#64;internal
     * Called by the Temporal workflow after the agent runner completes.
     * </pre>
     */
    default void finalizeExecution(ai.stigmer.billing.v1.FinalizeExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.FinalizeExecutionResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getFinalizeExecutionMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service BillingCommandController.
   * <pre>
   * BillingCommandController handles write operations for the billing bounded context.
   * Billing is not a standard API Resource — there is no api_resource_kind annotation.
   * RPCs authorize against the organization resource kind.
   * Phase 0-2 RPCs are defined here. Stripe checkout (Phase 3),
   * auto-recharge configuration (Phase 4), and other write operations
   * are added in their respective phases.
   * </pre>
   */
  public static abstract class BillingCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return BillingCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service BillingCommandController.
   * <pre>
   * BillingCommandController handles write operations for the billing bounded context.
   * Billing is not a standard API Resource — there is no api_resource_kind annotation.
   * RPCs authorize against the organization resource kind.
   * Phase 0-2 RPCs are defined here. Stripe checkout (Phase 3),
   * auto-recharge configuration (Phase 4), and other write operations
   * are added in their respective phases.
   * </pre>
   */
  public static final class BillingCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<BillingCommandControllerStub> {
    private BillingCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected BillingCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new BillingCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Provision or retrieve the billing account for an organization.
     * Idempotent: creates the account on first call, returns existing on subsequent calls.
     * &#64;internal
     * Called during org creation or first billing interaction.
     * Initializes balance to zero with default thresholds.
     * </pre>
     */
    public void getOrCreateBillingAccount(ai.stigmer.billing.v1.GetOrCreateBillingAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetOrCreateBillingAccountMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Manually adjust an org's credit balance.
     * Produces an immutable ledger entry for audit. Requires admin privileges.
     * </pre>
     */
    public void adjustCredits(ai.stigmer.billing.v1.AdjustCreditsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreditLedgerEntry> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getAdjustCreditsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Reserve credits before starting an agent execution.
     * Returns authorization status and reservation details.
     * &#64;internal
     * Called by the Temporal workflow before dispatching to the agent runner.
     * The runner must not start if authorized is false.
     * </pre>
     */
    public void authorizeExecution(ai.stigmer.billing.v1.AuthorizeExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.AuthorizeExecutionResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getAuthorizeExecutionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Report a single LLM call's usage for billing.
     * Applies the billing policy, debits credits, and returns a signal.
     * &#64;internal
     * Called by the agent runner after each LLM call completes.
     * Deduplicated by (execution_id, sequence).
     * </pre>
     */
    public void reportLlmCallUsage(ai.stigmer.billing.v1.ReportLlmCallUsageInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ReportLlmCallUsageResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getReportLlmCallUsageMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Settle billing for a completed execution.
     * Releases unused reservation credits and produces the final billing record.
     * &#64;internal
     * Called by the Temporal workflow after the agent runner completes.
     * </pre>
     */
    public void finalizeExecution(ai.stigmer.billing.v1.FinalizeExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.FinalizeExecutionResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getFinalizeExecutionMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service BillingCommandController.
   * <pre>
   * BillingCommandController handles write operations for the billing bounded context.
   * Billing is not a standard API Resource — there is no api_resource_kind annotation.
   * RPCs authorize against the organization resource kind.
   * Phase 0-2 RPCs are defined here. Stripe checkout (Phase 3),
   * auto-recharge configuration (Phase 4), and other write operations
   * are added in their respective phases.
   * </pre>
   */
  public static final class BillingCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<BillingCommandControllerBlockingV2Stub> {
    private BillingCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected BillingCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new BillingCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Provision or retrieve the billing account for an organization.
     * Idempotent: creates the account on first call, returns existing on subsequent calls.
     * &#64;internal
     * Called during org creation or first billing interaction.
     * Initializes balance to zero with default thresholds.
     * </pre>
     */
    public ai.stigmer.billing.v1.BillingAccount getOrCreateBillingAccount(ai.stigmer.billing.v1.GetOrCreateBillingAccountInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetOrCreateBillingAccountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Manually adjust an org's credit balance.
     * Produces an immutable ledger entry for audit. Requires admin privileges.
     * </pre>
     */
    public ai.stigmer.billing.v1.CreditLedgerEntry adjustCredits(ai.stigmer.billing.v1.AdjustCreditsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getAdjustCreditsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Reserve credits before starting an agent execution.
     * Returns authorization status and reservation details.
     * &#64;internal
     * Called by the Temporal workflow before dispatching to the agent runner.
     * The runner must not start if authorized is false.
     * </pre>
     */
    public ai.stigmer.billing.v1.AuthorizeExecutionResponse authorizeExecution(ai.stigmer.billing.v1.AuthorizeExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getAuthorizeExecutionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Report a single LLM call's usage for billing.
     * Applies the billing policy, debits credits, and returns a signal.
     * &#64;internal
     * Called by the agent runner after each LLM call completes.
     * Deduplicated by (execution_id, sequence).
     * </pre>
     */
    public ai.stigmer.billing.v1.ReportLlmCallUsageResponse reportLlmCallUsage(ai.stigmer.billing.v1.ReportLlmCallUsageInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getReportLlmCallUsageMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Settle billing for a completed execution.
     * Releases unused reservation credits and produces the final billing record.
     * &#64;internal
     * Called by the Temporal workflow after the agent runner completes.
     * </pre>
     */
    public ai.stigmer.billing.v1.FinalizeExecutionResponse finalizeExecution(ai.stigmer.billing.v1.FinalizeExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getFinalizeExecutionMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service BillingCommandController.
   * <pre>
   * BillingCommandController handles write operations for the billing bounded context.
   * Billing is not a standard API Resource — there is no api_resource_kind annotation.
   * RPCs authorize against the organization resource kind.
   * Phase 0-2 RPCs are defined here. Stripe checkout (Phase 3),
   * auto-recharge configuration (Phase 4), and other write operations
   * are added in their respective phases.
   * </pre>
   */
  public static final class BillingCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<BillingCommandControllerBlockingStub> {
    private BillingCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected BillingCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new BillingCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Provision or retrieve the billing account for an organization.
     * Idempotent: creates the account on first call, returns existing on subsequent calls.
     * &#64;internal
     * Called during org creation or first billing interaction.
     * Initializes balance to zero with default thresholds.
     * </pre>
     */
    public ai.stigmer.billing.v1.BillingAccount getOrCreateBillingAccount(ai.stigmer.billing.v1.GetOrCreateBillingAccountInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetOrCreateBillingAccountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Manually adjust an org's credit balance.
     * Produces an immutable ledger entry for audit. Requires admin privileges.
     * </pre>
     */
    public ai.stigmer.billing.v1.CreditLedgerEntry adjustCredits(ai.stigmer.billing.v1.AdjustCreditsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getAdjustCreditsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Reserve credits before starting an agent execution.
     * Returns authorization status and reservation details.
     * &#64;internal
     * Called by the Temporal workflow before dispatching to the agent runner.
     * The runner must not start if authorized is false.
     * </pre>
     */
    public ai.stigmer.billing.v1.AuthorizeExecutionResponse authorizeExecution(ai.stigmer.billing.v1.AuthorizeExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getAuthorizeExecutionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Report a single LLM call's usage for billing.
     * Applies the billing policy, debits credits, and returns a signal.
     * &#64;internal
     * Called by the agent runner after each LLM call completes.
     * Deduplicated by (execution_id, sequence).
     * </pre>
     */
    public ai.stigmer.billing.v1.ReportLlmCallUsageResponse reportLlmCallUsage(ai.stigmer.billing.v1.ReportLlmCallUsageInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getReportLlmCallUsageMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Settle billing for a completed execution.
     * Releases unused reservation credits and produces the final billing record.
     * &#64;internal
     * Called by the Temporal workflow after the agent runner completes.
     * </pre>
     */
    public ai.stigmer.billing.v1.FinalizeExecutionResponse finalizeExecution(ai.stigmer.billing.v1.FinalizeExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getFinalizeExecutionMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service BillingCommandController.
   * <pre>
   * BillingCommandController handles write operations for the billing bounded context.
   * Billing is not a standard API Resource — there is no api_resource_kind annotation.
   * RPCs authorize against the organization resource kind.
   * Phase 0-2 RPCs are defined here. Stripe checkout (Phase 3),
   * auto-recharge configuration (Phase 4), and other write operations
   * are added in their respective phases.
   * </pre>
   */
  public static final class BillingCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<BillingCommandControllerFutureStub> {
    private BillingCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected BillingCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new BillingCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Provision or retrieve the billing account for an organization.
     * Idempotent: creates the account on first call, returns existing on subsequent calls.
     * &#64;internal
     * Called during org creation or first billing interaction.
     * Initializes balance to zero with default thresholds.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.BillingAccount> getOrCreateBillingAccount(
        ai.stigmer.billing.v1.GetOrCreateBillingAccountInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetOrCreateBillingAccountMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Manually adjust an org's credit balance.
     * Produces an immutable ledger entry for audit. Requires admin privileges.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.CreditLedgerEntry> adjustCredits(
        ai.stigmer.billing.v1.AdjustCreditsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getAdjustCreditsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Reserve credits before starting an agent execution.
     * Returns authorization status and reservation details.
     * &#64;internal
     * Called by the Temporal workflow before dispatching to the agent runner.
     * The runner must not start if authorized is false.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.AuthorizeExecutionResponse> authorizeExecution(
        ai.stigmer.billing.v1.AuthorizeExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getAuthorizeExecutionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Report a single LLM call's usage for billing.
     * Applies the billing policy, debits credits, and returns a signal.
     * &#64;internal
     * Called by the agent runner after each LLM call completes.
     * Deduplicated by (execution_id, sequence).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.ReportLlmCallUsageResponse> reportLlmCallUsage(
        ai.stigmer.billing.v1.ReportLlmCallUsageInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getReportLlmCallUsageMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Settle billing for a completed execution.
     * Releases unused reservation credits and produces the final billing record.
     * &#64;internal
     * Called by the Temporal workflow after the agent runner completes.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.FinalizeExecutionResponse> finalizeExecution(
        ai.stigmer.billing.v1.FinalizeExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getFinalizeExecutionMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET_OR_CREATE_BILLING_ACCOUNT = 0;
  private static final int METHODID_ADJUST_CREDITS = 1;
  private static final int METHODID_AUTHORIZE_EXECUTION = 2;
  private static final int METHODID_REPORT_LLM_CALL_USAGE = 3;
  private static final int METHODID_FINALIZE_EXECUTION = 4;

  private static final class MethodHandlers<Req, Resp> implements
      io.grpc.stub.ServerCalls.UnaryMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.ServerStreamingMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.ClientStreamingMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.BidiStreamingMethod<Req, Resp> {
    private final AsyncService serviceImpl;
    private final int methodId;

    MethodHandlers(AsyncService serviceImpl, int methodId) {
      this.serviceImpl = serviceImpl;
      this.methodId = methodId;
    }

    @java.lang.Override
    @java.lang.SuppressWarnings("unchecked")
    public void invoke(Req request, io.grpc.stub.StreamObserver<Resp> responseObserver) {
      switch (methodId) {
        case METHODID_GET_OR_CREATE_BILLING_ACCOUNT:
          serviceImpl.getOrCreateBillingAccount((ai.stigmer.billing.v1.GetOrCreateBillingAccountInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingAccount>) responseObserver);
          break;
        case METHODID_ADJUST_CREDITS:
          serviceImpl.adjustCredits((ai.stigmer.billing.v1.AdjustCreditsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreditLedgerEntry>) responseObserver);
          break;
        case METHODID_AUTHORIZE_EXECUTION:
          serviceImpl.authorizeExecution((ai.stigmer.billing.v1.AuthorizeExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.AuthorizeExecutionResponse>) responseObserver);
          break;
        case METHODID_REPORT_LLM_CALL_USAGE:
          serviceImpl.reportLlmCallUsage((ai.stigmer.billing.v1.ReportLlmCallUsageInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ReportLlmCallUsageResponse>) responseObserver);
          break;
        case METHODID_FINALIZE_EXECUTION:
          serviceImpl.finalizeExecution((ai.stigmer.billing.v1.FinalizeExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.FinalizeExecutionResponse>) responseObserver);
          break;
        default:
          throw new AssertionError();
      }
    }

    @java.lang.Override
    @java.lang.SuppressWarnings("unchecked")
    public io.grpc.stub.StreamObserver<Req> invoke(
        io.grpc.stub.StreamObserver<Resp> responseObserver) {
      switch (methodId) {
        default:
          throw new AssertionError();
      }
    }
  }

  public static final io.grpc.ServerServiceDefinition bindService(AsyncService service) {
    return io.grpc.ServerServiceDefinition.builder(getServiceDescriptor())
        .addMethod(
          getGetOrCreateBillingAccountMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.GetOrCreateBillingAccountInput,
              ai.stigmer.billing.v1.BillingAccount>(
                service, METHODID_GET_OR_CREATE_BILLING_ACCOUNT)))
        .addMethod(
          getAdjustCreditsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.AdjustCreditsInput,
              ai.stigmer.billing.v1.CreditLedgerEntry>(
                service, METHODID_ADJUST_CREDITS)))
        .addMethod(
          getAuthorizeExecutionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.AuthorizeExecutionInput,
              ai.stigmer.billing.v1.AuthorizeExecutionResponse>(
                service, METHODID_AUTHORIZE_EXECUTION)))
        .addMethod(
          getReportLlmCallUsageMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.ReportLlmCallUsageInput,
              ai.stigmer.billing.v1.ReportLlmCallUsageResponse>(
                service, METHODID_REPORT_LLM_CALL_USAGE)))
        .addMethod(
          getFinalizeExecutionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.FinalizeExecutionInput,
              ai.stigmer.billing.v1.FinalizeExecutionResponse>(
                service, METHODID_FINALIZE_EXECUTION)))
        .build();
  }

  private static abstract class BillingCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    BillingCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.billing.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("BillingCommandController");
    }
  }

  private static final class BillingCommandControllerFileDescriptorSupplier
      extends BillingCommandControllerBaseDescriptorSupplier {
    BillingCommandControllerFileDescriptorSupplier() {}
  }

  private static final class BillingCommandControllerMethodDescriptorSupplier
      extends BillingCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    BillingCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
      this.methodName = methodName;
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.MethodDescriptor getMethodDescriptor() {
      return getServiceDescriptor().findMethodByName(methodName);
    }
  }

  private static volatile io.grpc.ServiceDescriptor serviceDescriptor;

  public static io.grpc.ServiceDescriptor getServiceDescriptor() {
    io.grpc.ServiceDescriptor result = serviceDescriptor;
    if (result == null) {
      synchronized (BillingCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new BillingCommandControllerFileDescriptorSupplier())
              .addMethod(getGetOrCreateBillingAccountMethod())
              .addMethod(getAdjustCreditsMethod())
              .addMethod(getAuthorizeExecutionMethod())
              .addMethod(getReportLlmCallUsageMethod())
              .addMethod(getFinalizeExecutionMethod())
              .build();
        }
      }
    }
    return result;
  }
}
