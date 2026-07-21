package ai.stigmer.billing.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * BillingQueryController handles read operations for the billing bounded context.
 * All RPCs authorize against the organization resource kind with can_view_billing.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class BillingQueryControllerGrpc {

  private BillingQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.billing.v1.BillingQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetBillingAccountInput,
      ai.stigmer.billing.v1.BillingAccount> getGetBillingAccountMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getBillingAccount",
      requestType = ai.stigmer.billing.v1.GetBillingAccountInput.class,
      responseType = ai.stigmer.billing.v1.BillingAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetBillingAccountInput,
      ai.stigmer.billing.v1.BillingAccount> getGetBillingAccountMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetBillingAccountInput, ai.stigmer.billing.v1.BillingAccount> getGetBillingAccountMethod;
    if ((getGetBillingAccountMethod = BillingQueryControllerGrpc.getGetBillingAccountMethod) == null) {
      synchronized (BillingQueryControllerGrpc.class) {
        if ((getGetBillingAccountMethod = BillingQueryControllerGrpc.getGetBillingAccountMethod) == null) {
          BillingQueryControllerGrpc.getGetBillingAccountMethod = getGetBillingAccountMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.GetBillingAccountInput, ai.stigmer.billing.v1.BillingAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getBillingAccount"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.GetBillingAccountInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.BillingAccount.getDefaultInstance()))
              .setSchemaDescriptor(new BillingQueryControllerMethodDescriptorSupplier("getBillingAccount"))
              .build();
        }
      }
    }
    return getGetBillingAccountMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetCreditBalanceInput,
      ai.stigmer.billing.v1.CreditBalance> getGetCreditBalanceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getCreditBalance",
      requestType = ai.stigmer.billing.v1.GetCreditBalanceInput.class,
      responseType = ai.stigmer.billing.v1.CreditBalance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetCreditBalanceInput,
      ai.stigmer.billing.v1.CreditBalance> getGetCreditBalanceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetCreditBalanceInput, ai.stigmer.billing.v1.CreditBalance> getGetCreditBalanceMethod;
    if ((getGetCreditBalanceMethod = BillingQueryControllerGrpc.getGetCreditBalanceMethod) == null) {
      synchronized (BillingQueryControllerGrpc.class) {
        if ((getGetCreditBalanceMethod = BillingQueryControllerGrpc.getGetCreditBalanceMethod) == null) {
          BillingQueryControllerGrpc.getGetCreditBalanceMethod = getGetCreditBalanceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.GetCreditBalanceInput, ai.stigmer.billing.v1.CreditBalance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getCreditBalance"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.GetCreditBalanceInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.CreditBalance.getDefaultInstance()))
              .setSchemaDescriptor(new BillingQueryControllerMethodDescriptorSupplier("getCreditBalance"))
              .build();
        }
      }
    }
    return getGetCreditBalanceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetCreditLedgerInput,
      ai.stigmer.billing.v1.CreditLedgerResponse> getGetCreditLedgerMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getCreditLedger",
      requestType = ai.stigmer.billing.v1.GetCreditLedgerInput.class,
      responseType = ai.stigmer.billing.v1.CreditLedgerResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetCreditLedgerInput,
      ai.stigmer.billing.v1.CreditLedgerResponse> getGetCreditLedgerMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetCreditLedgerInput, ai.stigmer.billing.v1.CreditLedgerResponse> getGetCreditLedgerMethod;
    if ((getGetCreditLedgerMethod = BillingQueryControllerGrpc.getGetCreditLedgerMethod) == null) {
      synchronized (BillingQueryControllerGrpc.class) {
        if ((getGetCreditLedgerMethod = BillingQueryControllerGrpc.getGetCreditLedgerMethod) == null) {
          BillingQueryControllerGrpc.getGetCreditLedgerMethod = getGetCreditLedgerMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.GetCreditLedgerInput, ai.stigmer.billing.v1.CreditLedgerResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getCreditLedger"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.GetCreditLedgerInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.CreditLedgerResponse.getDefaultInstance()))
              .setSchemaDescriptor(new BillingQueryControllerMethodDescriptorSupplier("getCreditLedger"))
              .build();
        }
      }
    }
    return getGetCreditLedgerMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetBillingUsageReportInput,
      ai.stigmer.billing.v1.BillingUsageReportResponse> getGetBillingUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getBillingUsageReport",
      requestType = ai.stigmer.billing.v1.GetBillingUsageReportInput.class,
      responseType = ai.stigmer.billing.v1.BillingUsageReportResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetBillingUsageReportInput,
      ai.stigmer.billing.v1.BillingUsageReportResponse> getGetBillingUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetBillingUsageReportInput, ai.stigmer.billing.v1.BillingUsageReportResponse> getGetBillingUsageReportMethod;
    if ((getGetBillingUsageReportMethod = BillingQueryControllerGrpc.getGetBillingUsageReportMethod) == null) {
      synchronized (BillingQueryControllerGrpc.class) {
        if ((getGetBillingUsageReportMethod = BillingQueryControllerGrpc.getGetBillingUsageReportMethod) == null) {
          BillingQueryControllerGrpc.getGetBillingUsageReportMethod = getGetBillingUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.GetBillingUsageReportInput, ai.stigmer.billing.v1.BillingUsageReportResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getBillingUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.GetBillingUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.BillingUsageReportResponse.getDefaultInstance()))
              .setSchemaDescriptor(new BillingQueryControllerMethodDescriptorSupplier("getBillingUsageReport"))
              .build();
        }
      }
    }
    return getGetBillingUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetCustomerModelPricingInput,
      ai.stigmer.billing.v1.CustomerModelPricingResponse> getGetCustomerModelPricingMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getCustomerModelPricing",
      requestType = ai.stigmer.billing.v1.GetCustomerModelPricingInput.class,
      responseType = ai.stigmer.billing.v1.CustomerModelPricingResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetCustomerModelPricingInput,
      ai.stigmer.billing.v1.CustomerModelPricingResponse> getGetCustomerModelPricingMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetCustomerModelPricingInput, ai.stigmer.billing.v1.CustomerModelPricingResponse> getGetCustomerModelPricingMethod;
    if ((getGetCustomerModelPricingMethod = BillingQueryControllerGrpc.getGetCustomerModelPricingMethod) == null) {
      synchronized (BillingQueryControllerGrpc.class) {
        if ((getGetCustomerModelPricingMethod = BillingQueryControllerGrpc.getGetCustomerModelPricingMethod) == null) {
          BillingQueryControllerGrpc.getGetCustomerModelPricingMethod = getGetCustomerModelPricingMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.GetCustomerModelPricingInput, ai.stigmer.billing.v1.CustomerModelPricingResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getCustomerModelPricing"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.GetCustomerModelPricingInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.CustomerModelPricingResponse.getDefaultInstance()))
              .setSchemaDescriptor(new BillingQueryControllerMethodDescriptorSupplier("getCustomerModelPricing"))
              .build();
        }
      }
    }
    return getGetCustomerModelPricingMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetModelPricingGovernanceInput,
      ai.stigmer.billing.v1.ModelPricingGovernanceResponse> getGetModelPricingGovernanceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getModelPricingGovernance",
      requestType = ai.stigmer.billing.v1.GetModelPricingGovernanceInput.class,
      responseType = ai.stigmer.billing.v1.ModelPricingGovernanceResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetModelPricingGovernanceInput,
      ai.stigmer.billing.v1.ModelPricingGovernanceResponse> getGetModelPricingGovernanceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.GetModelPricingGovernanceInput, ai.stigmer.billing.v1.ModelPricingGovernanceResponse> getGetModelPricingGovernanceMethod;
    if ((getGetModelPricingGovernanceMethod = BillingQueryControllerGrpc.getGetModelPricingGovernanceMethod) == null) {
      synchronized (BillingQueryControllerGrpc.class) {
        if ((getGetModelPricingGovernanceMethod = BillingQueryControllerGrpc.getGetModelPricingGovernanceMethod) == null) {
          BillingQueryControllerGrpc.getGetModelPricingGovernanceMethod = getGetModelPricingGovernanceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.GetModelPricingGovernanceInput, ai.stigmer.billing.v1.ModelPricingGovernanceResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getModelPricingGovernance"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.GetModelPricingGovernanceInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.ModelPricingGovernanceResponse.getDefaultInstance()))
              .setSchemaDescriptor(new BillingQueryControllerMethodDescriptorSupplier("getModelPricingGovernance"))
              .build();
        }
      }
    }
    return getGetModelPricingGovernanceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.ListModelPricingBaselinesInput,
      ai.stigmer.billing.v1.ModelPricingBaselinesResponse> getListModelPricingBaselinesMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listModelPricingBaselines",
      requestType = ai.stigmer.billing.v1.ListModelPricingBaselinesInput.class,
      responseType = ai.stigmer.billing.v1.ModelPricingBaselinesResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.ListModelPricingBaselinesInput,
      ai.stigmer.billing.v1.ModelPricingBaselinesResponse> getListModelPricingBaselinesMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.ListModelPricingBaselinesInput, ai.stigmer.billing.v1.ModelPricingBaselinesResponse> getListModelPricingBaselinesMethod;
    if ((getListModelPricingBaselinesMethod = BillingQueryControllerGrpc.getListModelPricingBaselinesMethod) == null) {
      synchronized (BillingQueryControllerGrpc.class) {
        if ((getListModelPricingBaselinesMethod = BillingQueryControllerGrpc.getListModelPricingBaselinesMethod) == null) {
          BillingQueryControllerGrpc.getListModelPricingBaselinesMethod = getListModelPricingBaselinesMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.ListModelPricingBaselinesInput, ai.stigmer.billing.v1.ModelPricingBaselinesResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listModelPricingBaselines"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.ListModelPricingBaselinesInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.ModelPricingBaselinesResponse.getDefaultInstance()))
              .setSchemaDescriptor(new BillingQueryControllerMethodDescriptorSupplier("listModelPricingBaselines"))
              .build();
        }
      }
    }
    return getListModelPricingBaselinesMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static BillingQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<BillingQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<BillingQueryControllerStub>() {
        @java.lang.Override
        public BillingQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new BillingQueryControllerStub(channel, callOptions);
        }
      };
    return BillingQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static BillingQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<BillingQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<BillingQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public BillingQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new BillingQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return BillingQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static BillingQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<BillingQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<BillingQueryControllerBlockingStub>() {
        @java.lang.Override
        public BillingQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new BillingQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return BillingQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static BillingQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<BillingQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<BillingQueryControllerFutureStub>() {
        @java.lang.Override
        public BillingQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new BillingQueryControllerFutureStub(channel, callOptions);
        }
      };
    return BillingQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * BillingQueryController handles read operations for the billing bounded context.
   * All RPCs authorize against the organization resource kind with can_view_billing.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Retrieve the billing account for an organization.
     * </pre>
     */
    default void getBillingAccount(ai.stigmer.billing.v1.GetBillingAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetBillingAccountMethod(), responseObserver);
    }

    /**
     * <pre>
     * Retrieve the credit balance breakdown for an organization.
     * </pre>
     */
    default void getCreditBalance(ai.stigmer.billing.v1.GetCreditBalanceInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreditBalance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetCreditBalanceMethod(), responseObserver);
    }

    /**
     * <pre>
     * Retrieve paginated credit ledger entries with optional filters.
     * </pre>
     */
    default void getCreditLedger(ai.stigmer.billing.v1.GetCreditLedgerInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreditLedgerResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetCreditLedgerMethod(), responseObserver);
    }

    /**
     * <pre>
     * Retrieve an aggregated billing usage report for a date range.
     * </pre>
     */
    default void getBillingUsageReport(ai.stigmer.billing.v1.GetBillingUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingUsageReportResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetBillingUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Retrieve the customer-facing model price list with markup applied.
     * Returns prices for all models, organized by harness and cost tier.
     * </pre>
     */
    default void getCustomerModelPricing(ai.stigmer.billing.v1.GetCustomerModelPricingInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CustomerModelPricingResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetCustomerModelPricingMethod(), responseObserver);
    }

    /**
     * <pre>
     * Retrieve the platform pricing governance view: baseline vs effective
     * rates per model, active override provenance, and pending sign-off
     * proposals from the pricing feedback loop.
     * Operator surface: exposes raw provider rates (pre-markup), so it is
     * platform-gated, not org-gated.
     * </pre>
     */
    default void getModelPricingGovernance(ai.stigmer.billing.v1.GetModelPricingGovernanceInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ModelPricingGovernanceResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetModelPricingGovernanceMethod(), responseObserver);
    }

    /**
     * <pre>
     * Retrieve the model registry baseline catalog (ACTIVE documents, or the
     * full append-only revision history when include_history is set).
     * Operator surface: exposes raw provider rates (pre-markup) and revision
     * provenance, so it is platform-gated like the governance view.
     * </pre>
     */
    default void listModelPricingBaselines(ai.stigmer.billing.v1.ListModelPricingBaselinesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ModelPricingBaselinesResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListModelPricingBaselinesMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service BillingQueryController.
   * <pre>
   * BillingQueryController handles read operations for the billing bounded context.
   * All RPCs authorize against the organization resource kind with can_view_billing.
   * </pre>
   */
  public static abstract class BillingQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return BillingQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service BillingQueryController.
   * <pre>
   * BillingQueryController handles read operations for the billing bounded context.
   * All RPCs authorize against the organization resource kind with can_view_billing.
   * </pre>
   */
  public static final class BillingQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<BillingQueryControllerStub> {
    private BillingQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected BillingQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new BillingQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Retrieve the billing account for an organization.
     * </pre>
     */
    public void getBillingAccount(ai.stigmer.billing.v1.GetBillingAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetBillingAccountMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Retrieve the credit balance breakdown for an organization.
     * </pre>
     */
    public void getCreditBalance(ai.stigmer.billing.v1.GetCreditBalanceInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreditBalance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetCreditBalanceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Retrieve paginated credit ledger entries with optional filters.
     * </pre>
     */
    public void getCreditLedger(ai.stigmer.billing.v1.GetCreditLedgerInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreditLedgerResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetCreditLedgerMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Retrieve an aggregated billing usage report for a date range.
     * </pre>
     */
    public void getBillingUsageReport(ai.stigmer.billing.v1.GetBillingUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingUsageReportResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetBillingUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Retrieve the customer-facing model price list with markup applied.
     * Returns prices for all models, organized by harness and cost tier.
     * </pre>
     */
    public void getCustomerModelPricing(ai.stigmer.billing.v1.GetCustomerModelPricingInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CustomerModelPricingResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetCustomerModelPricingMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Retrieve the platform pricing governance view: baseline vs effective
     * rates per model, active override provenance, and pending sign-off
     * proposals from the pricing feedback loop.
     * Operator surface: exposes raw provider rates (pre-markup), so it is
     * platform-gated, not org-gated.
     * </pre>
     */
    public void getModelPricingGovernance(ai.stigmer.billing.v1.GetModelPricingGovernanceInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ModelPricingGovernanceResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetModelPricingGovernanceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Retrieve the model registry baseline catalog (ACTIVE documents, or the
     * full append-only revision history when include_history is set).
     * Operator surface: exposes raw provider rates (pre-markup) and revision
     * provenance, so it is platform-gated like the governance view.
     * </pre>
     */
    public void listModelPricingBaselines(ai.stigmer.billing.v1.ListModelPricingBaselinesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ModelPricingBaselinesResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListModelPricingBaselinesMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service BillingQueryController.
   * <pre>
   * BillingQueryController handles read operations for the billing bounded context.
   * All RPCs authorize against the organization resource kind with can_view_billing.
   * </pre>
   */
  public static final class BillingQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<BillingQueryControllerBlockingV2Stub> {
    private BillingQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected BillingQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new BillingQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Retrieve the billing account for an organization.
     * </pre>
     */
    public ai.stigmer.billing.v1.BillingAccount getBillingAccount(ai.stigmer.billing.v1.GetBillingAccountInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetBillingAccountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve the credit balance breakdown for an organization.
     * </pre>
     */
    public ai.stigmer.billing.v1.CreditBalance getCreditBalance(ai.stigmer.billing.v1.GetCreditBalanceInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetCreditBalanceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve paginated credit ledger entries with optional filters.
     * </pre>
     */
    public ai.stigmer.billing.v1.CreditLedgerResponse getCreditLedger(ai.stigmer.billing.v1.GetCreditLedgerInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetCreditLedgerMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve an aggregated billing usage report for a date range.
     * </pre>
     */
    public ai.stigmer.billing.v1.BillingUsageReportResponse getBillingUsageReport(ai.stigmer.billing.v1.GetBillingUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetBillingUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve the customer-facing model price list with markup applied.
     * Returns prices for all models, organized by harness and cost tier.
     * </pre>
     */
    public ai.stigmer.billing.v1.CustomerModelPricingResponse getCustomerModelPricing(ai.stigmer.billing.v1.GetCustomerModelPricingInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetCustomerModelPricingMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve the platform pricing governance view: baseline vs effective
     * rates per model, active override provenance, and pending sign-off
     * proposals from the pricing feedback loop.
     * Operator surface: exposes raw provider rates (pre-markup), so it is
     * platform-gated, not org-gated.
     * </pre>
     */
    public ai.stigmer.billing.v1.ModelPricingGovernanceResponse getModelPricingGovernance(ai.stigmer.billing.v1.GetModelPricingGovernanceInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetModelPricingGovernanceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve the model registry baseline catalog (ACTIVE documents, or the
     * full append-only revision history when include_history is set).
     * Operator surface: exposes raw provider rates (pre-markup) and revision
     * provenance, so it is platform-gated like the governance view.
     * </pre>
     */
    public ai.stigmer.billing.v1.ModelPricingBaselinesResponse listModelPricingBaselines(ai.stigmer.billing.v1.ListModelPricingBaselinesInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListModelPricingBaselinesMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service BillingQueryController.
   * <pre>
   * BillingQueryController handles read operations for the billing bounded context.
   * All RPCs authorize against the organization resource kind with can_view_billing.
   * </pre>
   */
  public static final class BillingQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<BillingQueryControllerBlockingStub> {
    private BillingQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected BillingQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new BillingQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Retrieve the billing account for an organization.
     * </pre>
     */
    public ai.stigmer.billing.v1.BillingAccount getBillingAccount(ai.stigmer.billing.v1.GetBillingAccountInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetBillingAccountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve the credit balance breakdown for an organization.
     * </pre>
     */
    public ai.stigmer.billing.v1.CreditBalance getCreditBalance(ai.stigmer.billing.v1.GetCreditBalanceInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetCreditBalanceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve paginated credit ledger entries with optional filters.
     * </pre>
     */
    public ai.stigmer.billing.v1.CreditLedgerResponse getCreditLedger(ai.stigmer.billing.v1.GetCreditLedgerInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetCreditLedgerMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve an aggregated billing usage report for a date range.
     * </pre>
     */
    public ai.stigmer.billing.v1.BillingUsageReportResponse getBillingUsageReport(ai.stigmer.billing.v1.GetBillingUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetBillingUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve the customer-facing model price list with markup applied.
     * Returns prices for all models, organized by harness and cost tier.
     * </pre>
     */
    public ai.stigmer.billing.v1.CustomerModelPricingResponse getCustomerModelPricing(ai.stigmer.billing.v1.GetCustomerModelPricingInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetCustomerModelPricingMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve the platform pricing governance view: baseline vs effective
     * rates per model, active override provenance, and pending sign-off
     * proposals from the pricing feedback loop.
     * Operator surface: exposes raw provider rates (pre-markup), so it is
     * platform-gated, not org-gated.
     * </pre>
     */
    public ai.stigmer.billing.v1.ModelPricingGovernanceResponse getModelPricingGovernance(ai.stigmer.billing.v1.GetModelPricingGovernanceInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetModelPricingGovernanceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve the model registry baseline catalog (ACTIVE documents, or the
     * full append-only revision history when include_history is set).
     * Operator surface: exposes raw provider rates (pre-markup) and revision
     * provenance, so it is platform-gated like the governance view.
     * </pre>
     */
    public ai.stigmer.billing.v1.ModelPricingBaselinesResponse listModelPricingBaselines(ai.stigmer.billing.v1.ListModelPricingBaselinesInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListModelPricingBaselinesMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service BillingQueryController.
   * <pre>
   * BillingQueryController handles read operations for the billing bounded context.
   * All RPCs authorize against the organization resource kind with can_view_billing.
   * </pre>
   */
  public static final class BillingQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<BillingQueryControllerFutureStub> {
    private BillingQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected BillingQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new BillingQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Retrieve the billing account for an organization.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.BillingAccount> getBillingAccount(
        ai.stigmer.billing.v1.GetBillingAccountInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetBillingAccountMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Retrieve the credit balance breakdown for an organization.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.CreditBalance> getCreditBalance(
        ai.stigmer.billing.v1.GetCreditBalanceInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetCreditBalanceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Retrieve paginated credit ledger entries with optional filters.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.CreditLedgerResponse> getCreditLedger(
        ai.stigmer.billing.v1.GetCreditLedgerInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetCreditLedgerMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Retrieve an aggregated billing usage report for a date range.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.BillingUsageReportResponse> getBillingUsageReport(
        ai.stigmer.billing.v1.GetBillingUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetBillingUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Retrieve the customer-facing model price list with markup applied.
     * Returns prices for all models, organized by harness and cost tier.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.CustomerModelPricingResponse> getCustomerModelPricing(
        ai.stigmer.billing.v1.GetCustomerModelPricingInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetCustomerModelPricingMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Retrieve the platform pricing governance view: baseline vs effective
     * rates per model, active override provenance, and pending sign-off
     * proposals from the pricing feedback loop.
     * Operator surface: exposes raw provider rates (pre-markup), so it is
     * platform-gated, not org-gated.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.ModelPricingGovernanceResponse> getModelPricingGovernance(
        ai.stigmer.billing.v1.GetModelPricingGovernanceInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetModelPricingGovernanceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Retrieve the model registry baseline catalog (ACTIVE documents, or the
     * full append-only revision history when include_history is set).
     * Operator surface: exposes raw provider rates (pre-markup) and revision
     * provenance, so it is platform-gated like the governance view.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.ModelPricingBaselinesResponse> listModelPricingBaselines(
        ai.stigmer.billing.v1.ListModelPricingBaselinesInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListModelPricingBaselinesMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET_BILLING_ACCOUNT = 0;
  private static final int METHODID_GET_CREDIT_BALANCE = 1;
  private static final int METHODID_GET_CREDIT_LEDGER = 2;
  private static final int METHODID_GET_BILLING_USAGE_REPORT = 3;
  private static final int METHODID_GET_CUSTOMER_MODEL_PRICING = 4;
  private static final int METHODID_GET_MODEL_PRICING_GOVERNANCE = 5;
  private static final int METHODID_LIST_MODEL_PRICING_BASELINES = 6;

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
        case METHODID_GET_BILLING_ACCOUNT:
          serviceImpl.getBillingAccount((ai.stigmer.billing.v1.GetBillingAccountInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingAccount>) responseObserver);
          break;
        case METHODID_GET_CREDIT_BALANCE:
          serviceImpl.getCreditBalance((ai.stigmer.billing.v1.GetCreditBalanceInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreditBalance>) responseObserver);
          break;
        case METHODID_GET_CREDIT_LEDGER:
          serviceImpl.getCreditLedger((ai.stigmer.billing.v1.GetCreditLedgerInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreditLedgerResponse>) responseObserver);
          break;
        case METHODID_GET_BILLING_USAGE_REPORT:
          serviceImpl.getBillingUsageReport((ai.stigmer.billing.v1.GetBillingUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingUsageReportResponse>) responseObserver);
          break;
        case METHODID_GET_CUSTOMER_MODEL_PRICING:
          serviceImpl.getCustomerModelPricing((ai.stigmer.billing.v1.GetCustomerModelPricingInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CustomerModelPricingResponse>) responseObserver);
          break;
        case METHODID_GET_MODEL_PRICING_GOVERNANCE:
          serviceImpl.getModelPricingGovernance((ai.stigmer.billing.v1.GetModelPricingGovernanceInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ModelPricingGovernanceResponse>) responseObserver);
          break;
        case METHODID_LIST_MODEL_PRICING_BASELINES:
          serviceImpl.listModelPricingBaselines((ai.stigmer.billing.v1.ListModelPricingBaselinesInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ModelPricingBaselinesResponse>) responseObserver);
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
          getGetBillingAccountMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.GetBillingAccountInput,
              ai.stigmer.billing.v1.BillingAccount>(
                service, METHODID_GET_BILLING_ACCOUNT)))
        .addMethod(
          getGetCreditBalanceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.GetCreditBalanceInput,
              ai.stigmer.billing.v1.CreditBalance>(
                service, METHODID_GET_CREDIT_BALANCE)))
        .addMethod(
          getGetCreditLedgerMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.GetCreditLedgerInput,
              ai.stigmer.billing.v1.CreditLedgerResponse>(
                service, METHODID_GET_CREDIT_LEDGER)))
        .addMethod(
          getGetBillingUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.GetBillingUsageReportInput,
              ai.stigmer.billing.v1.BillingUsageReportResponse>(
                service, METHODID_GET_BILLING_USAGE_REPORT)))
        .addMethod(
          getGetCustomerModelPricingMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.GetCustomerModelPricingInput,
              ai.stigmer.billing.v1.CustomerModelPricingResponse>(
                service, METHODID_GET_CUSTOMER_MODEL_PRICING)))
        .addMethod(
          getGetModelPricingGovernanceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.GetModelPricingGovernanceInput,
              ai.stigmer.billing.v1.ModelPricingGovernanceResponse>(
                service, METHODID_GET_MODEL_PRICING_GOVERNANCE)))
        .addMethod(
          getListModelPricingBaselinesMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.ListModelPricingBaselinesInput,
              ai.stigmer.billing.v1.ModelPricingBaselinesResponse>(
                service, METHODID_LIST_MODEL_PRICING_BASELINES)))
        .build();
  }

  private static abstract class BillingQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    BillingQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.billing.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("BillingQueryController");
    }
  }

  private static final class BillingQueryControllerFileDescriptorSupplier
      extends BillingQueryControllerBaseDescriptorSupplier {
    BillingQueryControllerFileDescriptorSupplier() {}
  }

  private static final class BillingQueryControllerMethodDescriptorSupplier
      extends BillingQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    BillingQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (BillingQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new BillingQueryControllerFileDescriptorSupplier())
              .addMethod(getGetBillingAccountMethod())
              .addMethod(getGetCreditBalanceMethod())
              .addMethod(getGetCreditLedgerMethod())
              .addMethod(getGetBillingUsageReportMethod())
              .addMethod(getGetCustomerModelPricingMethod())
              .addMethod(getGetModelPricingGovernanceMethod())
              .addMethod(getListModelPricingBaselinesMethod())
              .build();
        }
      }
    }
    return result;
  }
}
