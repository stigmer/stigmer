package ai.stigmer.iam.identityaccount.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * IdentityAccountCommandController handles write operations for identity accounts.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class IdentityAccountCommandControllerGrpc {

  private IdentityAccountCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.identityaccount.v1.IdentityAccountCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccount,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.iam.identityaccount.v1.IdentityAccount.class,
      responseType = ai.stigmer.iam.identityaccount.v1.IdentityAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccount,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccount, ai.stigmer.iam.identityaccount.v1.IdentityAccount> getCreateMethod;
    if ((getCreateMethod = IdentityAccountCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (IdentityAccountCommandControllerGrpc.class) {
        if ((getCreateMethod = IdentityAccountCommandControllerGrpc.getCreateMethod) == null) {
          IdentityAccountCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityaccount.v1.IdentityAccount, ai.stigmer.iam.identityaccount.v1.IdentityAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccount.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccount.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityAccountCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccount,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.iam.identityaccount.v1.IdentityAccount.class,
      responseType = ai.stigmer.iam.identityaccount.v1.IdentityAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccount,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccount, ai.stigmer.iam.identityaccount.v1.IdentityAccount> getUpdateMethod;
    if ((getUpdateMethod = IdentityAccountCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (IdentityAccountCommandControllerGrpc.class) {
        if ((getUpdateMethod = IdentityAccountCommandControllerGrpc.getUpdateMethod) == null) {
          IdentityAccountCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityaccount.v1.IdentityAccount, ai.stigmer.iam.identityaccount.v1.IdentityAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccount.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccount.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityAccountCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountId,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.iam.identityaccount.v1.IdentityAccountId.class,
      responseType = ai.stigmer.iam.identityaccount.v1.IdentityAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountId,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountId, ai.stigmer.iam.identityaccount.v1.IdentityAccount> getDeleteMethod;
    if ((getDeleteMethod = IdentityAccountCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (IdentityAccountCommandControllerGrpc.class) {
        if ((getDeleteMethod = IdentityAccountCommandControllerGrpc.getDeleteMethod) == null) {
          IdentityAccountCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityaccount.v1.IdentityAccountId, ai.stigmer.iam.identityaccount.v1.IdentityAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccountId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccount.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityAccountCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getCreateFederatedAccountMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "createFederatedAccount",
      requestType = ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput.class,
      responseType = ai.stigmer.iam.identityaccount.v1.IdentityAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getCreateFederatedAccountMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput, ai.stigmer.iam.identityaccount.v1.IdentityAccount> getCreateFederatedAccountMethod;
    if ((getCreateFederatedAccountMethod = IdentityAccountCommandControllerGrpc.getCreateFederatedAccountMethod) == null) {
      synchronized (IdentityAccountCommandControllerGrpc.class) {
        if ((getCreateFederatedAccountMethod = IdentityAccountCommandControllerGrpc.getCreateFederatedAccountMethod) == null) {
          IdentityAccountCommandControllerGrpc.getCreateFederatedAccountMethod = getCreateFederatedAccountMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput, ai.stigmer.iam.identityaccount.v1.IdentityAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "createFederatedAccount"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccount.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityAccountCommandControllerMethodDescriptorSupplier("createFederatedAccount"))
              .build();
        }
      }
    }
    return getCreateFederatedAccountMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail,
      com.google.protobuf.Empty> getSimulateSignupWebhookMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "simulateSignupWebhook",
      requestType = ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail.class,
      responseType = com.google.protobuf.Empty.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail,
      com.google.protobuf.Empty> getSimulateSignupWebhookMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail, com.google.protobuf.Empty> getSimulateSignupWebhookMethod;
    if ((getSimulateSignupWebhookMethod = IdentityAccountCommandControllerGrpc.getSimulateSignupWebhookMethod) == null) {
      synchronized (IdentityAccountCommandControllerGrpc.class) {
        if ((getSimulateSignupWebhookMethod = IdentityAccountCommandControllerGrpc.getSimulateSignupWebhookMethod) == null) {
          IdentityAccountCommandControllerGrpc.getSimulateSignupWebhookMethod = getSimulateSignupWebhookMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail, com.google.protobuf.Empty>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "simulateSignupWebhook"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  com.google.protobuf.Empty.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityAccountCommandControllerMethodDescriptorSupplier("simulateSignupWebhook"))
              .build();
        }
      }
    }
    return getSimulateSignupWebhookMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static IdentityAccountCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityAccountCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityAccountCommandControllerStub>() {
        @java.lang.Override
        public IdentityAccountCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityAccountCommandControllerStub(channel, callOptions);
        }
      };
    return IdentityAccountCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static IdentityAccountCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityAccountCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityAccountCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public IdentityAccountCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityAccountCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return IdentityAccountCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static IdentityAccountCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityAccountCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityAccountCommandControllerBlockingStub>() {
        @java.lang.Override
        public IdentityAccountCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityAccountCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return IdentityAccountCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static IdentityAccountCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityAccountCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityAccountCommandControllerFutureStub>() {
        @java.lang.Override
        public IdentityAccountCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityAccountCommandControllerFutureStub(channel, callOptions);
        }
      };
    return IdentityAccountCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * IdentityAccountCommandController handles write operations for identity accounts.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create a new identity account.
     * &#64;internal
     * System-level RPC used by Auth0 webhook flow and federated account creation.
     * No FGA authorization — called via inProcessChannelAsSystem (machine account).
     * The handler's createAuthorizationTuples step writes the self-ownership tuple after creation.
     * </pre>
     */
    default void create(ai.stigmer.iam.identityaccount.v1.IdentityAccount request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing identity account.
     * &#64;internal
     * Authorization: Requires can_edit permission on the identity account resource.
     * </pre>
     */
    default void update(ai.stigmer.iam.identityaccount.v1.IdentityAccount request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an identity account.
     * &#64;internal
     * Authorization: Requires can_delete permission on the identity account resource.
     * </pre>
     */
    default void delete(ai.stigmer.iam.identityaccount.v1.IdentityAccountId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a federated identity account for an external platform user.
     * Called by platform backends (via API key) when a new user signs up on their
     * platform. The platform provides the user's OIDC subject identifier and profile
     * data. The account must be created before the user can authenticate via the IdP.
     * Returns the full identity account including its ID, which the platform uses
     * to grant roles via IAM policies.
     * Authorization: Requires can_create_identity_account on the organization
     * that owns the identity provider.
     * </pre>
     */
    default void createFederatedAccount(ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateFederatedAccountMethod(), responseObserver);
    }

    /**
     * <pre>
     * Trigger account provisioning for a user who exists in Auth0 but not in Stigmer.
     * &#64;internal
     * Takes the email, looks it up on Auth0, and if a user exists, posts a webhook
     * to Stigmer with the Auth0 payload format to trigger account provisioning.
     * Authorization is skipped — this is a system-level operation.
     * </pre>
     */
    default void simulateSignupWebhook(ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSimulateSignupWebhookMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service IdentityAccountCommandController.
   * <pre>
   * IdentityAccountCommandController handles write operations for identity accounts.
   * </pre>
   */
  public static abstract class IdentityAccountCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return IdentityAccountCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service IdentityAccountCommandController.
   * <pre>
   * IdentityAccountCommandController handles write operations for identity accounts.
   * </pre>
   */
  public static final class IdentityAccountCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<IdentityAccountCommandControllerStub> {
    private IdentityAccountCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityAccountCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityAccountCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new identity account.
     * &#64;internal
     * System-level RPC used by Auth0 webhook flow and federated account creation.
     * No FGA authorization — called via inProcessChannelAsSystem (machine account).
     * The handler's createAuthorizationTuples step writes the self-ownership tuple after creation.
     * </pre>
     */
    public void create(ai.stigmer.iam.identityaccount.v1.IdentityAccount request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing identity account.
     * &#64;internal
     * Authorization: Requires can_edit permission on the identity account resource.
     * </pre>
     */
    public void update(ai.stigmer.iam.identityaccount.v1.IdentityAccount request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an identity account.
     * &#64;internal
     * Authorization: Requires can_delete permission on the identity account resource.
     * </pre>
     */
    public void delete(ai.stigmer.iam.identityaccount.v1.IdentityAccountId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a federated identity account for an external platform user.
     * Called by platform backends (via API key) when a new user signs up on their
     * platform. The platform provides the user's OIDC subject identifier and profile
     * data. The account must be created before the user can authenticate via the IdP.
     * Returns the full identity account including its ID, which the platform uses
     * to grant roles via IAM policies.
     * Authorization: Requires can_create_identity_account on the organization
     * that owns the identity provider.
     * </pre>
     */
    public void createFederatedAccount(ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateFederatedAccountMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Trigger account provisioning for a user who exists in Auth0 but not in Stigmer.
     * &#64;internal
     * Takes the email, looks it up on Auth0, and if a user exists, posts a webhook
     * to Stigmer with the Auth0 payload format to trigger account provisioning.
     * Authorization is skipped — this is a system-level operation.
     * </pre>
     */
    public void simulateSignupWebhook(ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSimulateSignupWebhookMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service IdentityAccountCommandController.
   * <pre>
   * IdentityAccountCommandController handles write operations for identity accounts.
   * </pre>
   */
  public static final class IdentityAccountCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<IdentityAccountCommandControllerBlockingV2Stub> {
    private IdentityAccountCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityAccountCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityAccountCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new identity account.
     * &#64;internal
     * System-level RPC used by Auth0 webhook flow and federated account creation.
     * No FGA authorization — called via inProcessChannelAsSystem (machine account).
     * The handler's createAuthorizationTuples step writes the self-ownership tuple after creation.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount create(ai.stigmer.iam.identityaccount.v1.IdentityAccount request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing identity account.
     * &#64;internal
     * Authorization: Requires can_edit permission on the identity account resource.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount update(ai.stigmer.iam.identityaccount.v1.IdentityAccount request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an identity account.
     * &#64;internal
     * Authorization: Requires can_delete permission on the identity account resource.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount delete(ai.stigmer.iam.identityaccount.v1.IdentityAccountId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a federated identity account for an external platform user.
     * Called by platform backends (via API key) when a new user signs up on their
     * platform. The platform provides the user's OIDC subject identifier and profile
     * data. The account must be created before the user can authenticate via the IdP.
     * Returns the full identity account including its ID, which the platform uses
     * to grant roles via IAM policies.
     * Authorization: Requires can_create_identity_account on the organization
     * that owns the identity provider.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount createFederatedAccount(ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateFederatedAccountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Trigger account provisioning for a user who exists in Auth0 but not in Stigmer.
     * &#64;internal
     * Takes the email, looks it up on Auth0, and if a user exists, posts a webhook
     * to Stigmer with the Auth0 payload format to trigger account provisioning.
     * Authorization is skipped — this is a system-level operation.
     * </pre>
     */
    public com.google.protobuf.Empty simulateSignupWebhook(ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSimulateSignupWebhookMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service IdentityAccountCommandController.
   * <pre>
   * IdentityAccountCommandController handles write operations for identity accounts.
   * </pre>
   */
  public static final class IdentityAccountCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<IdentityAccountCommandControllerBlockingStub> {
    private IdentityAccountCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityAccountCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityAccountCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new identity account.
     * &#64;internal
     * System-level RPC used by Auth0 webhook flow and federated account creation.
     * No FGA authorization — called via inProcessChannelAsSystem (machine account).
     * The handler's createAuthorizationTuples step writes the self-ownership tuple after creation.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount create(ai.stigmer.iam.identityaccount.v1.IdentityAccount request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing identity account.
     * &#64;internal
     * Authorization: Requires can_edit permission on the identity account resource.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount update(ai.stigmer.iam.identityaccount.v1.IdentityAccount request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an identity account.
     * &#64;internal
     * Authorization: Requires can_delete permission on the identity account resource.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount delete(ai.stigmer.iam.identityaccount.v1.IdentityAccountId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a federated identity account for an external platform user.
     * Called by platform backends (via API key) when a new user signs up on their
     * platform. The platform provides the user's OIDC subject identifier and profile
     * data. The account must be created before the user can authenticate via the IdP.
     * Returns the full identity account including its ID, which the platform uses
     * to grant roles via IAM policies.
     * Authorization: Requires can_create_identity_account on the organization
     * that owns the identity provider.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount createFederatedAccount(ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateFederatedAccountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Trigger account provisioning for a user who exists in Auth0 but not in Stigmer.
     * &#64;internal
     * Takes the email, looks it up on Auth0, and if a user exists, posts a webhook
     * to Stigmer with the Auth0 payload format to trigger account provisioning.
     * Authorization is skipped — this is a system-level operation.
     * </pre>
     */
    public com.google.protobuf.Empty simulateSignupWebhook(ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSimulateSignupWebhookMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service IdentityAccountCommandController.
   * <pre>
   * IdentityAccountCommandController handles write operations for identity accounts.
   * </pre>
   */
  public static final class IdentityAccountCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<IdentityAccountCommandControllerFutureStub> {
    private IdentityAccountCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityAccountCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityAccountCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new identity account.
     * &#64;internal
     * System-level RPC used by Auth0 webhook flow and federated account creation.
     * No FGA authorization — called via inProcessChannelAsSystem (machine account).
     * The handler's createAuthorizationTuples step writes the self-ownership tuple after creation.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityaccount.v1.IdentityAccount> create(
        ai.stigmer.iam.identityaccount.v1.IdentityAccount request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing identity account.
     * &#64;internal
     * Authorization: Requires can_edit permission on the identity account resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityaccount.v1.IdentityAccount> update(
        ai.stigmer.iam.identityaccount.v1.IdentityAccount request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an identity account.
     * &#64;internal
     * Authorization: Requires can_delete permission on the identity account resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityaccount.v1.IdentityAccount> delete(
        ai.stigmer.iam.identityaccount.v1.IdentityAccountId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a federated identity account for an external platform user.
     * Called by platform backends (via API key) when a new user signs up on their
     * platform. The platform provides the user's OIDC subject identifier and profile
     * data. The account must be created before the user can authenticate via the IdP.
     * Returns the full identity account including its ID, which the platform uses
     * to grant roles via IAM policies.
     * Authorization: Requires can_create_identity_account on the organization
     * that owns the identity provider.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityaccount.v1.IdentityAccount> createFederatedAccount(
        ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateFederatedAccountMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Trigger account provisioning for a user who exists in Auth0 but not in Stigmer.
     * &#64;internal
     * Takes the email, looks it up on Auth0, and if a user exists, posts a webhook
     * to Stigmer with the Auth0 payload format to trigger account provisioning.
     * Authorization is skipped — this is a system-level operation.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<com.google.protobuf.Empty> simulateSignupWebhook(
        ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSimulateSignupWebhookMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
  private static final int METHODID_DELETE = 2;
  private static final int METHODID_CREATE_FEDERATED_ACCOUNT = 3;
  private static final int METHODID_SIMULATE_SIGNUP_WEBHOOK = 4;

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
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.iam.identityaccount.v1.IdentityAccount) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.iam.identityaccount.v1.IdentityAccount) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.iam.identityaccount.v1.IdentityAccountId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount>) responseObserver);
          break;
        case METHODID_CREATE_FEDERATED_ACCOUNT:
          serviceImpl.createFederatedAccount((ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount>) responseObserver);
          break;
        case METHODID_SIMULATE_SIGNUP_WEBHOOK:
          serviceImpl.simulateSignupWebhook((ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail) request,
              (io.grpc.stub.StreamObserver<com.google.protobuf.Empty>) responseObserver);
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
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityaccount.v1.IdentityAccount,
              ai.stigmer.iam.identityaccount.v1.IdentityAccount>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityaccount.v1.IdentityAccount,
              ai.stigmer.iam.identityaccount.v1.IdentityAccount>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityaccount.v1.IdentityAccountId,
              ai.stigmer.iam.identityaccount.v1.IdentityAccount>(
                service, METHODID_DELETE)))
        .addMethod(
          getCreateFederatedAccountMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityaccount.v1.CreateFederatedAccountInput,
              ai.stigmer.iam.identityaccount.v1.IdentityAccount>(
                service, METHODID_CREATE_FEDERATED_ACCOUNT)))
        .addMethod(
          getSimulateSignupWebhookMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail,
              com.google.protobuf.Empty>(
                service, METHODID_SIMULATE_SIGNUP_WEBHOOK)))
        .build();
  }

  private static abstract class IdentityAccountCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    IdentityAccountCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.identityaccount.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("IdentityAccountCommandController");
    }
  }

  private static final class IdentityAccountCommandControllerFileDescriptorSupplier
      extends IdentityAccountCommandControllerBaseDescriptorSupplier {
    IdentityAccountCommandControllerFileDescriptorSupplier() {}
  }

  private static final class IdentityAccountCommandControllerMethodDescriptorSupplier
      extends IdentityAccountCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    IdentityAccountCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (IdentityAccountCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new IdentityAccountCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getCreateFederatedAccountMethod())
              .addMethod(getSimulateSignupWebhookMethod())
              .build();
        }
      }
    }
    return result;
  }
}
