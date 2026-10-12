package ai.stigmer.billing.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * BillingQueryController handles read operations for the billing bounded context.
 * An organization's own reads authorize against the organization resource
 * kind with can_view_billing; the model catalog's operator read authorizes
 * against the static platform target.
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
   * An organization's own reads authorize against the organization resource
   * kind with can_view_billing; the model catalog's operator read authorizes
   * against the static platform target.
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
     * Count an organization's metered LLM calls and runs in a date range,
     * with the calls broken down by model and harness. A count, never an
     * amount: the meter records what each call was, not what it cost.
     * </pre>
     */
    default void getBillingUsageReport(ai.stigmer.billing.v1.GetBillingUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingUsageReportResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetBillingUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Retrieve the model registry baseline catalog (ACTIVE documents, or the
     * full append-only revision history when include_history is set).
     * Operator surface: exposes the providers' list prices with their
     * revision provenance, so it is platform-gated, not org-gated.
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
   * An organization's own reads authorize against the organization resource
   * kind with can_view_billing; the model catalog's operator read authorizes
   * against the static platform target.
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
   * An organization's own reads authorize against the organization resource
   * kind with can_view_billing; the model catalog's operator read authorizes
   * against the static platform target.
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
     * Count an organization's metered LLM calls and runs in a date range,
     * with the calls broken down by model and harness. A count, never an
     * amount: the meter records what each call was, not what it cost.
     * </pre>
     */
    public void getBillingUsageReport(ai.stigmer.billing.v1.GetBillingUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingUsageReportResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetBillingUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Retrieve the model registry baseline catalog (ACTIVE documents, or the
     * full append-only revision history when include_history is set).
     * Operator surface: exposes the providers' list prices with their
     * revision provenance, so it is platform-gated, not org-gated.
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
   * An organization's own reads authorize against the organization resource
   * kind with can_view_billing; the model catalog's operator read authorizes
   * against the static platform target.
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
     * Count an organization's metered LLM calls and runs in a date range,
     * with the calls broken down by model and harness. A count, never an
     * amount: the meter records what each call was, not what it cost.
     * </pre>
     */
    public ai.stigmer.billing.v1.BillingUsageReportResponse getBillingUsageReport(ai.stigmer.billing.v1.GetBillingUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetBillingUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve the model registry baseline catalog (ACTIVE documents, or the
     * full append-only revision history when include_history is set).
     * Operator surface: exposes the providers' list prices with their
     * revision provenance, so it is platform-gated, not org-gated.
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
   * An organization's own reads authorize against the organization resource
   * kind with can_view_billing; the model catalog's operator read authorizes
   * against the static platform target.
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
     * Count an organization's metered LLM calls and runs in a date range,
     * with the calls broken down by model and harness. A count, never an
     * amount: the meter records what each call was, not what it cost.
     * </pre>
     */
    public ai.stigmer.billing.v1.BillingUsageReportResponse getBillingUsageReport(ai.stigmer.billing.v1.GetBillingUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetBillingUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve the model registry baseline catalog (ACTIVE documents, or the
     * full append-only revision history when include_history is set).
     * Operator surface: exposes the providers' list prices with their
     * revision provenance, so it is platform-gated, not org-gated.
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
   * An organization's own reads authorize against the organization resource
   * kind with can_view_billing; the model catalog's operator read authorizes
   * against the static platform target.
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
     * Count an organization's metered LLM calls and runs in a date range,
     * with the calls broken down by model and harness. A count, never an
     * amount: the meter records what each call was, not what it cost.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.BillingUsageReportResponse> getBillingUsageReport(
        ai.stigmer.billing.v1.GetBillingUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetBillingUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Retrieve the model registry baseline catalog (ACTIVE documents, or the
     * full append-only revision history when include_history is set).
     * Operator surface: exposes the providers' list prices with their
     * revision provenance, so it is platform-gated, not org-gated.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.ModelPricingBaselinesResponse> listModelPricingBaselines(
        ai.stigmer.billing.v1.ListModelPricingBaselinesInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListModelPricingBaselinesMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET_BILLING_ACCOUNT = 0;
  private static final int METHODID_GET_BILLING_USAGE_REPORT = 1;
  private static final int METHODID_LIST_MODEL_PRICING_BASELINES = 2;

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
        case METHODID_GET_BILLING_USAGE_REPORT:
          serviceImpl.getBillingUsageReport((ai.stigmer.billing.v1.GetBillingUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingUsageReportResponse>) responseObserver);
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
          getGetBillingUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.GetBillingUsageReportInput,
              ai.stigmer.billing.v1.BillingUsageReportResponse>(
                service, METHODID_GET_BILLING_USAGE_REPORT)))
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
              .addMethod(getGetBillingUsageReportMethod())
              .addMethod(getListModelPricingBaselinesMethod())
              .build();
        }
      }
    }
    return result;
  }
}
