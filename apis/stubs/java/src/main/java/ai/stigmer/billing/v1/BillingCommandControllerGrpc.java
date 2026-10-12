package ai.stigmer.billing.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * BillingCommandController handles write operations for the billing bounded context.
 * Billing is not a standard API Resource — there is no api_resource_kind annotation.
 * An organization's own billing RPCs authorize against the organization
 * resource kind; the usage meter and the model catalog authorize against
 * the static platform target.
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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.RecordLlmCallUsageInput,
      ai.stigmer.billing.v1.RecordLlmCallUsageResponse> getRecordLlmCallUsageMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "recordLlmCallUsage",
      requestType = ai.stigmer.billing.v1.RecordLlmCallUsageInput.class,
      responseType = ai.stigmer.billing.v1.RecordLlmCallUsageResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.RecordLlmCallUsageInput,
      ai.stigmer.billing.v1.RecordLlmCallUsageResponse> getRecordLlmCallUsageMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.RecordLlmCallUsageInput, ai.stigmer.billing.v1.RecordLlmCallUsageResponse> getRecordLlmCallUsageMethod;
    if ((getRecordLlmCallUsageMethod = BillingCommandControllerGrpc.getRecordLlmCallUsageMethod) == null) {
      synchronized (BillingCommandControllerGrpc.class) {
        if ((getRecordLlmCallUsageMethod = BillingCommandControllerGrpc.getRecordLlmCallUsageMethod) == null) {
          BillingCommandControllerGrpc.getRecordLlmCallUsageMethod = getRecordLlmCallUsageMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.RecordLlmCallUsageInput, ai.stigmer.billing.v1.RecordLlmCallUsageResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "recordLlmCallUsage"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.RecordLlmCallUsageInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.RecordLlmCallUsageResponse.getDefaultInstance()))
              .setSchemaDescriptor(new BillingCommandControllerMethodDescriptorSupplier("recordLlmCallUsage"))
              .build();
        }
      }
    }
    return getRecordLlmCallUsageMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.CreateBillingPortalSessionInput,
      ai.stigmer.billing.v1.CreateBillingPortalSessionResponse> getCreateBillingPortalSessionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "createBillingPortalSession",
      requestType = ai.stigmer.billing.v1.CreateBillingPortalSessionInput.class,
      responseType = ai.stigmer.billing.v1.CreateBillingPortalSessionResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.CreateBillingPortalSessionInput,
      ai.stigmer.billing.v1.CreateBillingPortalSessionResponse> getCreateBillingPortalSessionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.CreateBillingPortalSessionInput, ai.stigmer.billing.v1.CreateBillingPortalSessionResponse> getCreateBillingPortalSessionMethod;
    if ((getCreateBillingPortalSessionMethod = BillingCommandControllerGrpc.getCreateBillingPortalSessionMethod) == null) {
      synchronized (BillingCommandControllerGrpc.class) {
        if ((getCreateBillingPortalSessionMethod = BillingCommandControllerGrpc.getCreateBillingPortalSessionMethod) == null) {
          BillingCommandControllerGrpc.getCreateBillingPortalSessionMethod = getCreateBillingPortalSessionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.CreateBillingPortalSessionInput, ai.stigmer.billing.v1.CreateBillingPortalSessionResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "createBillingPortalSession"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.CreateBillingPortalSessionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.CreateBillingPortalSessionResponse.getDefaultInstance()))
              .setSchemaDescriptor(new BillingCommandControllerMethodDescriptorSupplier("createBillingPortalSession"))
              .build();
        }
      }
    }
    return getCreateBillingPortalSessionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput,
      ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse> getCreatePaymentMethodSetupSessionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "createPaymentMethodSetupSession",
      requestType = ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput.class,
      responseType = ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput,
      ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse> getCreatePaymentMethodSetupSessionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput, ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse> getCreatePaymentMethodSetupSessionMethod;
    if ((getCreatePaymentMethodSetupSessionMethod = BillingCommandControllerGrpc.getCreatePaymentMethodSetupSessionMethod) == null) {
      synchronized (BillingCommandControllerGrpc.class) {
        if ((getCreatePaymentMethodSetupSessionMethod = BillingCommandControllerGrpc.getCreatePaymentMethodSetupSessionMethod) == null) {
          BillingCommandControllerGrpc.getCreatePaymentMethodSetupSessionMethod = getCreatePaymentMethodSetupSessionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput, ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "createPaymentMethodSetupSession"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse.getDefaultInstance()))
              .setSchemaDescriptor(new BillingCommandControllerMethodDescriptorSupplier("createPaymentMethodSetupSession"))
              .build();
        }
      }
    }
    return getCreatePaymentMethodSetupSessionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.UpsertModelPricingBaselineInput,
      ai.stigmer.billing.v1.ModelPricingBaseline> getUpsertModelPricingBaselineMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "upsertModelPricingBaseline",
      requestType = ai.stigmer.billing.v1.UpsertModelPricingBaselineInput.class,
      responseType = ai.stigmer.billing.v1.ModelPricingBaseline.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.UpsertModelPricingBaselineInput,
      ai.stigmer.billing.v1.ModelPricingBaseline> getUpsertModelPricingBaselineMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.UpsertModelPricingBaselineInput, ai.stigmer.billing.v1.ModelPricingBaseline> getUpsertModelPricingBaselineMethod;
    if ((getUpsertModelPricingBaselineMethod = BillingCommandControllerGrpc.getUpsertModelPricingBaselineMethod) == null) {
      synchronized (BillingCommandControllerGrpc.class) {
        if ((getUpsertModelPricingBaselineMethod = BillingCommandControllerGrpc.getUpsertModelPricingBaselineMethod) == null) {
          BillingCommandControllerGrpc.getUpsertModelPricingBaselineMethod = getUpsertModelPricingBaselineMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.UpsertModelPricingBaselineInput, ai.stigmer.billing.v1.ModelPricingBaseline>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "upsertModelPricingBaseline"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.UpsertModelPricingBaselineInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.ModelPricingBaseline.getDefaultInstance()))
              .setSchemaDescriptor(new BillingCommandControllerMethodDescriptorSupplier("upsertModelPricingBaseline"))
              .build();
        }
      }
    }
    return getUpsertModelPricingBaselineMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.v1.RetireModelPricingBaselineInput,
      ai.stigmer.billing.v1.ModelPricingBaseline> getRetireModelPricingBaselineMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "retireModelPricingBaseline",
      requestType = ai.stigmer.billing.v1.RetireModelPricingBaselineInput.class,
      responseType = ai.stigmer.billing.v1.ModelPricingBaseline.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.v1.RetireModelPricingBaselineInput,
      ai.stigmer.billing.v1.ModelPricingBaseline> getRetireModelPricingBaselineMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.v1.RetireModelPricingBaselineInput, ai.stigmer.billing.v1.ModelPricingBaseline> getRetireModelPricingBaselineMethod;
    if ((getRetireModelPricingBaselineMethod = BillingCommandControllerGrpc.getRetireModelPricingBaselineMethod) == null) {
      synchronized (BillingCommandControllerGrpc.class) {
        if ((getRetireModelPricingBaselineMethod = BillingCommandControllerGrpc.getRetireModelPricingBaselineMethod) == null) {
          BillingCommandControllerGrpc.getRetireModelPricingBaselineMethod = getRetireModelPricingBaselineMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.v1.RetireModelPricingBaselineInput, ai.stigmer.billing.v1.ModelPricingBaseline>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "retireModelPricingBaseline"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.RetireModelPricingBaselineInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.v1.ModelPricingBaseline.getDefaultInstance()))
              .setSchemaDescriptor(new BillingCommandControllerMethodDescriptorSupplier("retireModelPricingBaseline"))
              .build();
        }
      }
    }
    return getRetireModelPricingBaselineMethod;
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
   * An organization's own billing RPCs authorize against the organization
   * resource kind; the usage meter and the model catalog authorize against
   * the static platform target.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Provision or retrieve the billing account for an organization.
     * Idempotent: creates the account on first call, returns existing on subsequent calls.
     * </pre>
     */
    default void getOrCreateBillingAccount(ai.stigmer.billing.v1.GetOrCreateBillingAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetOrCreateBillingAccountMethod(), responseObserver);
    }

    /**
     * <pre>
     * Record a single LLM call's usage.
     * Resolves the call against the model catalog and inserts an immutable
     * LlmCallUsageRecord: what the call was (tokens, model, harness, served
     * tier and thinking mode, whose key served it), never what it cost.
     * </pre>
     */
    default void recordLlmCallUsage(ai.stigmer.billing.v1.RecordLlmCallUsageInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.RecordLlmCallUsageResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRecordLlmCallUsageMethod(), responseObserver);
    }

    /**
     * <pre>
     * Open a Stripe Customer Portal session for payment method management.
     * Returns a portal URL for the client to redirect the user.
     * Requires an existing Stripe Customer (created by
     * createPaymentMethodSetupSession on first use). The portal allows users
     * to add, update, or remove saved payment methods and to read the
     * invoices Stripe sends.
     * </pre>
     */
    default void createBillingPortalSession(ai.stigmer.billing.v1.CreateBillingPortalSessionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreateBillingPortalSessionResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateBillingPortalSessionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a Stripe Checkout Session in setup mode, which saves a payment
     * method without charging it. Returns a URL for the client to redirect
     * the user.
     * This is how an organization gets a card on file for its plan's
     * invoices (the billing portal needs an existing Stripe Customer, which
     * this call creates on first use). The saved card becomes the account's
     * default payment method through the payment_method.attached webhook.
     * </pre>
     */
    default void createPaymentMethodSetupSession(ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreatePaymentMethodSetupSessionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create or revise one model registry baseline entry (catalog + list
     * prices). Append-only: an existing ACTIVE document for the same
     * (model_id, provider, harness) key is superseded, never mutated. The
     * registry is rebuilt immediately, so the revision reaches the usage
     * meter, run admission and the published registry atomically.
     * </pre>
     */
    default void upsertModelPricingBaseline(ai.stigmer.billing.v1.UpsertModelPricingBaselineInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ModelPricingBaseline> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpsertModelPricingBaselineMethod(), responseObserver);
    }

    /**
     * <pre>
     * Retire one model from the registry catalog. The rebuilt registry drops
     * it. Kept for audit; the key can be revived by a subsequent upsert.
     * </pre>
     */
    default void retireModelPricingBaseline(ai.stigmer.billing.v1.RetireModelPricingBaselineInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ModelPricingBaseline> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRetireModelPricingBaselineMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service BillingCommandController.
   * <pre>
   * BillingCommandController handles write operations for the billing bounded context.
   * Billing is not a standard API Resource — there is no api_resource_kind annotation.
   * An organization's own billing RPCs authorize against the organization
   * resource kind; the usage meter and the model catalog authorize against
   * the static platform target.
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
   * An organization's own billing RPCs authorize against the organization
   * resource kind; the usage meter and the model catalog authorize against
   * the static platform target.
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
     * </pre>
     */
    public void getOrCreateBillingAccount(ai.stigmer.billing.v1.GetOrCreateBillingAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.BillingAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetOrCreateBillingAccountMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Record a single LLM call's usage.
     * Resolves the call against the model catalog and inserts an immutable
     * LlmCallUsageRecord: what the call was (tokens, model, harness, served
     * tier and thinking mode, whose key served it), never what it cost.
     * </pre>
     */
    public void recordLlmCallUsage(ai.stigmer.billing.v1.RecordLlmCallUsageInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.RecordLlmCallUsageResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRecordLlmCallUsageMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Open a Stripe Customer Portal session for payment method management.
     * Returns a portal URL for the client to redirect the user.
     * Requires an existing Stripe Customer (created by
     * createPaymentMethodSetupSession on first use). The portal allows users
     * to add, update, or remove saved payment methods and to read the
     * invoices Stripe sends.
     * </pre>
     */
    public void createBillingPortalSession(ai.stigmer.billing.v1.CreateBillingPortalSessionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreateBillingPortalSessionResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateBillingPortalSessionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a Stripe Checkout Session in setup mode, which saves a payment
     * method without charging it. Returns a URL for the client to redirect
     * the user.
     * This is how an organization gets a card on file for its plan's
     * invoices (the billing portal needs an existing Stripe Customer, which
     * this call creates on first use). The saved card becomes the account's
     * default payment method through the payment_method.attached webhook.
     * </pre>
     */
    public void createPaymentMethodSetupSession(ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreatePaymentMethodSetupSessionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create or revise one model registry baseline entry (catalog + list
     * prices). Append-only: an existing ACTIVE document for the same
     * (model_id, provider, harness) key is superseded, never mutated. The
     * registry is rebuilt immediately, so the revision reaches the usage
     * meter, run admission and the published registry atomically.
     * </pre>
     */
    public void upsertModelPricingBaseline(ai.stigmer.billing.v1.UpsertModelPricingBaselineInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ModelPricingBaseline> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpsertModelPricingBaselineMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Retire one model from the registry catalog. The rebuilt registry drops
     * it. Kept for audit; the key can be revived by a subsequent upsert.
     * </pre>
     */
    public void retireModelPricingBaseline(ai.stigmer.billing.v1.RetireModelPricingBaselineInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ModelPricingBaseline> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRetireModelPricingBaselineMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service BillingCommandController.
   * <pre>
   * BillingCommandController handles write operations for the billing bounded context.
   * Billing is not a standard API Resource — there is no api_resource_kind annotation.
   * An organization's own billing RPCs authorize against the organization
   * resource kind; the usage meter and the model catalog authorize against
   * the static platform target.
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
     * </pre>
     */
    public ai.stigmer.billing.v1.BillingAccount getOrCreateBillingAccount(ai.stigmer.billing.v1.GetOrCreateBillingAccountInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetOrCreateBillingAccountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Record a single LLM call's usage.
     * Resolves the call against the model catalog and inserts an immutable
     * LlmCallUsageRecord: what the call was (tokens, model, harness, served
     * tier and thinking mode, whose key served it), never what it cost.
     * </pre>
     */
    public ai.stigmer.billing.v1.RecordLlmCallUsageResponse recordLlmCallUsage(ai.stigmer.billing.v1.RecordLlmCallUsageInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRecordLlmCallUsageMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Open a Stripe Customer Portal session for payment method management.
     * Returns a portal URL for the client to redirect the user.
     * Requires an existing Stripe Customer (created by
     * createPaymentMethodSetupSession on first use). The portal allows users
     * to add, update, or remove saved payment methods and to read the
     * invoices Stripe sends.
     * </pre>
     */
    public ai.stigmer.billing.v1.CreateBillingPortalSessionResponse createBillingPortalSession(ai.stigmer.billing.v1.CreateBillingPortalSessionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateBillingPortalSessionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a Stripe Checkout Session in setup mode, which saves a payment
     * method without charging it. Returns a URL for the client to redirect
     * the user.
     * This is how an organization gets a card on file for its plan's
     * invoices (the billing portal needs an existing Stripe Customer, which
     * this call creates on first use). The saved card becomes the account's
     * default payment method through the payment_method.attached webhook.
     * </pre>
     */
    public ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse createPaymentMethodSetupSession(ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreatePaymentMethodSetupSessionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create or revise one model registry baseline entry (catalog + list
     * prices). Append-only: an existing ACTIVE document for the same
     * (model_id, provider, harness) key is superseded, never mutated. The
     * registry is rebuilt immediately, so the revision reaches the usage
     * meter, run admission and the published registry atomically.
     * </pre>
     */
    public ai.stigmer.billing.v1.ModelPricingBaseline upsertModelPricingBaseline(ai.stigmer.billing.v1.UpsertModelPricingBaselineInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpsertModelPricingBaselineMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retire one model from the registry catalog. The rebuilt registry drops
     * it. Kept for audit; the key can be revived by a subsequent upsert.
     * </pre>
     */
    public ai.stigmer.billing.v1.ModelPricingBaseline retireModelPricingBaseline(ai.stigmer.billing.v1.RetireModelPricingBaselineInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRetireModelPricingBaselineMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service BillingCommandController.
   * <pre>
   * BillingCommandController handles write operations for the billing bounded context.
   * Billing is not a standard API Resource — there is no api_resource_kind annotation.
   * An organization's own billing RPCs authorize against the organization
   * resource kind; the usage meter and the model catalog authorize against
   * the static platform target.
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
     * </pre>
     */
    public ai.stigmer.billing.v1.BillingAccount getOrCreateBillingAccount(ai.stigmer.billing.v1.GetOrCreateBillingAccountInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetOrCreateBillingAccountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Record a single LLM call's usage.
     * Resolves the call against the model catalog and inserts an immutable
     * LlmCallUsageRecord: what the call was (tokens, model, harness, served
     * tier and thinking mode, whose key served it), never what it cost.
     * </pre>
     */
    public ai.stigmer.billing.v1.RecordLlmCallUsageResponse recordLlmCallUsage(ai.stigmer.billing.v1.RecordLlmCallUsageInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRecordLlmCallUsageMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Open a Stripe Customer Portal session for payment method management.
     * Returns a portal URL for the client to redirect the user.
     * Requires an existing Stripe Customer (created by
     * createPaymentMethodSetupSession on first use). The portal allows users
     * to add, update, or remove saved payment methods and to read the
     * invoices Stripe sends.
     * </pre>
     */
    public ai.stigmer.billing.v1.CreateBillingPortalSessionResponse createBillingPortalSession(ai.stigmer.billing.v1.CreateBillingPortalSessionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateBillingPortalSessionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a Stripe Checkout Session in setup mode, which saves a payment
     * method without charging it. Returns a URL for the client to redirect
     * the user.
     * This is how an organization gets a card on file for its plan's
     * invoices (the billing portal needs an existing Stripe Customer, which
     * this call creates on first use). The saved card becomes the account's
     * default payment method through the payment_method.attached webhook.
     * </pre>
     */
    public ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse createPaymentMethodSetupSession(ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreatePaymentMethodSetupSessionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create or revise one model registry baseline entry (catalog + list
     * prices). Append-only: an existing ACTIVE document for the same
     * (model_id, provider, harness) key is superseded, never mutated. The
     * registry is rebuilt immediately, so the revision reaches the usage
     * meter, run admission and the published registry atomically.
     * </pre>
     */
    public ai.stigmer.billing.v1.ModelPricingBaseline upsertModelPricingBaseline(ai.stigmer.billing.v1.UpsertModelPricingBaselineInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpsertModelPricingBaselineMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retire one model from the registry catalog. The rebuilt registry drops
     * it. Kept for audit; the key can be revived by a subsequent upsert.
     * </pre>
     */
    public ai.stigmer.billing.v1.ModelPricingBaseline retireModelPricingBaseline(ai.stigmer.billing.v1.RetireModelPricingBaselineInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRetireModelPricingBaselineMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service BillingCommandController.
   * <pre>
   * BillingCommandController handles write operations for the billing bounded context.
   * Billing is not a standard API Resource — there is no api_resource_kind annotation.
   * An organization's own billing RPCs authorize against the organization
   * resource kind; the usage meter and the model catalog authorize against
   * the static platform target.
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
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.BillingAccount> getOrCreateBillingAccount(
        ai.stigmer.billing.v1.GetOrCreateBillingAccountInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetOrCreateBillingAccountMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Record a single LLM call's usage.
     * Resolves the call against the model catalog and inserts an immutable
     * LlmCallUsageRecord: what the call was (tokens, model, harness, served
     * tier and thinking mode, whose key served it), never what it cost.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.RecordLlmCallUsageResponse> recordLlmCallUsage(
        ai.stigmer.billing.v1.RecordLlmCallUsageInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRecordLlmCallUsageMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Open a Stripe Customer Portal session for payment method management.
     * Returns a portal URL for the client to redirect the user.
     * Requires an existing Stripe Customer (created by
     * createPaymentMethodSetupSession on first use). The portal allows users
     * to add, update, or remove saved payment methods and to read the
     * invoices Stripe sends.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.CreateBillingPortalSessionResponse> createBillingPortalSession(
        ai.stigmer.billing.v1.CreateBillingPortalSessionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateBillingPortalSessionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a Stripe Checkout Session in setup mode, which saves a payment
     * method without charging it. Returns a URL for the client to redirect
     * the user.
     * This is how an organization gets a card on file for its plan's
     * invoices (the billing portal needs an existing Stripe Customer, which
     * this call creates on first use). The saved card becomes the account's
     * default payment method through the payment_method.attached webhook.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse> createPaymentMethodSetupSession(
        ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreatePaymentMethodSetupSessionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create or revise one model registry baseline entry (catalog + list
     * prices). Append-only: an existing ACTIVE document for the same
     * (model_id, provider, harness) key is superseded, never mutated. The
     * registry is rebuilt immediately, so the revision reaches the usage
     * meter, run admission and the published registry atomically.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.ModelPricingBaseline> upsertModelPricingBaseline(
        ai.stigmer.billing.v1.UpsertModelPricingBaselineInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpsertModelPricingBaselineMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Retire one model from the registry catalog. The rebuilt registry drops
     * it. Kept for audit; the key can be revived by a subsequent upsert.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.v1.ModelPricingBaseline> retireModelPricingBaseline(
        ai.stigmer.billing.v1.RetireModelPricingBaselineInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRetireModelPricingBaselineMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET_OR_CREATE_BILLING_ACCOUNT = 0;
  private static final int METHODID_RECORD_LLM_CALL_USAGE = 1;
  private static final int METHODID_CREATE_BILLING_PORTAL_SESSION = 2;
  private static final int METHODID_CREATE_PAYMENT_METHOD_SETUP_SESSION = 3;
  private static final int METHODID_UPSERT_MODEL_PRICING_BASELINE = 4;
  private static final int METHODID_RETIRE_MODEL_PRICING_BASELINE = 5;

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
        case METHODID_RECORD_LLM_CALL_USAGE:
          serviceImpl.recordLlmCallUsage((ai.stigmer.billing.v1.RecordLlmCallUsageInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.RecordLlmCallUsageResponse>) responseObserver);
          break;
        case METHODID_CREATE_BILLING_PORTAL_SESSION:
          serviceImpl.createBillingPortalSession((ai.stigmer.billing.v1.CreateBillingPortalSessionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreateBillingPortalSessionResponse>) responseObserver);
          break;
        case METHODID_CREATE_PAYMENT_METHOD_SETUP_SESSION:
          serviceImpl.createPaymentMethodSetupSession((ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse>) responseObserver);
          break;
        case METHODID_UPSERT_MODEL_PRICING_BASELINE:
          serviceImpl.upsertModelPricingBaseline((ai.stigmer.billing.v1.UpsertModelPricingBaselineInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ModelPricingBaseline>) responseObserver);
          break;
        case METHODID_RETIRE_MODEL_PRICING_BASELINE:
          serviceImpl.retireModelPricingBaseline((ai.stigmer.billing.v1.RetireModelPricingBaselineInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.v1.ModelPricingBaseline>) responseObserver);
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
          getRecordLlmCallUsageMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.RecordLlmCallUsageInput,
              ai.stigmer.billing.v1.RecordLlmCallUsageResponse>(
                service, METHODID_RECORD_LLM_CALL_USAGE)))
        .addMethod(
          getCreateBillingPortalSessionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.CreateBillingPortalSessionInput,
              ai.stigmer.billing.v1.CreateBillingPortalSessionResponse>(
                service, METHODID_CREATE_BILLING_PORTAL_SESSION)))
        .addMethod(
          getCreatePaymentMethodSetupSessionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput,
              ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse>(
                service, METHODID_CREATE_PAYMENT_METHOD_SETUP_SESSION)))
        .addMethod(
          getUpsertModelPricingBaselineMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.UpsertModelPricingBaselineInput,
              ai.stigmer.billing.v1.ModelPricingBaseline>(
                service, METHODID_UPSERT_MODEL_PRICING_BASELINE)))
        .addMethod(
          getRetireModelPricingBaselineMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.v1.RetireModelPricingBaselineInput,
              ai.stigmer.billing.v1.ModelPricingBaseline>(
                service, METHODID_RETIRE_MODEL_PRICING_BASELINE)))
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
              .addMethod(getRecordLlmCallUsageMethod())
              .addMethod(getCreateBillingPortalSessionMethod())
              .addMethod(getCreatePaymentMethodSetupSessionMethod())
              .addMethod(getUpsertModelPricingBaselineMethod())
              .addMethod(getRetireModelPricingBaselineMethod())
              .build();
        }
      }
    }
    return result;
  }
}
