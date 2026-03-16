package ai.stigmer.iam.identityaccount.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * identity-account query controller
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class IdentityAccountQueryControllerGrpc {

  private IdentityAccountQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.identityaccount.v1.IdentityAccountQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountId,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.iam.identityaccount.v1.IdentityAccountId.class,
      responseType = ai.stigmer.iam.identityaccount.v1.IdentityAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountId,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountId, ai.stigmer.iam.identityaccount.v1.IdentityAccount> getGetMethod;
    if ((getGetMethod = IdentityAccountQueryControllerGrpc.getGetMethod) == null) {
      synchronized (IdentityAccountQueryControllerGrpc.class) {
        if ((getGetMethod = IdentityAccountQueryControllerGrpc.getGetMethod) == null) {
          IdentityAccountQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityaccount.v1.IdentityAccountId, ai.stigmer.iam.identityaccount.v1.IdentityAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccountId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccount.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityAccountQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<com.google.protobuf.Empty,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getWhoAmIMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "whoAmI",
      requestType = com.google.protobuf.Empty.class,
      responseType = ai.stigmer.iam.identityaccount.v1.IdentityAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<com.google.protobuf.Empty,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getWhoAmIMethod() {
    io.grpc.MethodDescriptor<com.google.protobuf.Empty, ai.stigmer.iam.identityaccount.v1.IdentityAccount> getWhoAmIMethod;
    if ((getWhoAmIMethod = IdentityAccountQueryControllerGrpc.getWhoAmIMethod) == null) {
      synchronized (IdentityAccountQueryControllerGrpc.class) {
        if ((getWhoAmIMethod = IdentityAccountQueryControllerGrpc.getWhoAmIMethod) == null) {
          IdentityAccountQueryControllerGrpc.getWhoAmIMethod = getWhoAmIMethod =
              io.grpc.MethodDescriptor.<com.google.protobuf.Empty, ai.stigmer.iam.identityaccount.v1.IdentityAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "whoAmI"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  com.google.protobuf.Empty.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccount.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityAccountQueryControllerMethodDescriptorSupplier("whoAmI"))
              .build();
        }
      }
    }
    return getWhoAmIMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getGetByEmailMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByEmail",
      requestType = ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail.class,
      responseType = ai.stigmer.iam.identityaccount.v1.IdentityAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getGetByEmailMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail, ai.stigmer.iam.identityaccount.v1.IdentityAccount> getGetByEmailMethod;
    if ((getGetByEmailMethod = IdentityAccountQueryControllerGrpc.getGetByEmailMethod) == null) {
      synchronized (IdentityAccountQueryControllerGrpc.class) {
        if ((getGetByEmailMethod = IdentityAccountQueryControllerGrpc.getGetByEmailMethod) == null) {
          IdentityAccountQueryControllerGrpc.getGetByEmailMethod = getGetByEmailMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail, ai.stigmer.iam.identityaccount.v1.IdentityAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByEmail"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccount.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityAccountQueryControllerMethodDescriptorSupplier("getByEmail"))
              .build();
        }
      }
    }
    return getGetByEmailMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdpId,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getGetByIdpIdMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByIdpId",
      requestType = ai.stigmer.iam.identityaccount.v1.IdpId.class,
      responseType = ai.stigmer.iam.identityaccount.v1.IdentityAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdpId,
      ai.stigmer.iam.identityaccount.v1.IdentityAccount> getGetByIdpIdMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdpId, ai.stigmer.iam.identityaccount.v1.IdentityAccount> getGetByIdpIdMethod;
    if ((getGetByIdpIdMethod = IdentityAccountQueryControllerGrpc.getGetByIdpIdMethod) == null) {
      synchronized (IdentityAccountQueryControllerGrpc.class) {
        if ((getGetByIdpIdMethod = IdentityAccountQueryControllerGrpc.getGetByIdpIdMethod) == null) {
          IdentityAccountQueryControllerGrpc.getGetByIdpIdMethod = getGetByIdpIdMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityaccount.v1.IdpId, ai.stigmer.iam.identityaccount.v1.IdentityAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByIdpId"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdpId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccount.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityAccountQueryControllerMethodDescriptorSupplier("getByIdpId"))
              .build();
        }
      }
    }
    return getGetByIdpIdMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountId,
      ai.stigmer.commons.apiresource.ApiResourceAuditActor> getGetActorInfoMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getActorInfo",
      requestType = ai.stigmer.iam.identityaccount.v1.IdentityAccountId.class,
      responseType = ai.stigmer.commons.apiresource.ApiResourceAuditActor.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountId,
      ai.stigmer.commons.apiresource.ApiResourceAuditActor> getGetActorInfoMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityaccount.v1.IdentityAccountId, ai.stigmer.commons.apiresource.ApiResourceAuditActor> getGetActorInfoMethod;
    if ((getGetActorInfoMethod = IdentityAccountQueryControllerGrpc.getGetActorInfoMethod) == null) {
      synchronized (IdentityAccountQueryControllerGrpc.class) {
        if ((getGetActorInfoMethod = IdentityAccountQueryControllerGrpc.getGetActorInfoMethod) == null) {
          IdentityAccountQueryControllerGrpc.getGetActorInfoMethod = getGetActorInfoMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityaccount.v1.IdentityAccountId, ai.stigmer.commons.apiresource.ApiResourceAuditActor>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getActorInfo"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityaccount.v1.IdentityAccountId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceAuditActor.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityAccountQueryControllerMethodDescriptorSupplier("getActorInfo"))
              .build();
        }
      }
    }
    return getGetActorInfoMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static IdentityAccountQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityAccountQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityAccountQueryControllerStub>() {
        @java.lang.Override
        public IdentityAccountQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityAccountQueryControllerStub(channel, callOptions);
        }
      };
    return IdentityAccountQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static IdentityAccountQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityAccountQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityAccountQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public IdentityAccountQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityAccountQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return IdentityAccountQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static IdentityAccountQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityAccountQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityAccountQueryControllerBlockingStub>() {
        @java.lang.Override
        public IdentityAccountQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityAccountQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return IdentityAccountQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static IdentityAccountQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityAccountQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityAccountQueryControllerFutureStub>() {
        @java.lang.Override
        public IdentityAccountQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityAccountQueryControllerFutureStub(channel, callOptions);
        }
      };
    return IdentityAccountQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * identity-account query controller
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * lookup identity-account.
     * </pre>
     */
    default void get(ai.stigmer.iam.identityaccount.v1.IdentityAccountId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * look up identity-account by authentication token.
     * </pre>
     */
    default void whoAmI(com.google.protobuf.Empty request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getWhoAmIMethod(), responseObserver);
    }

    /**
     * <pre>
     * lookup user-account by identity account email.
     * </pre>
     */
    default void getByEmail(ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByEmailMethod(), responseObserver);
    }

    /**
     * <pre>
     * lookup user-account by idp id.
     * </pre>
     */
    default void getByIdpId(ai.stigmer.iam.identityaccount.v1.IdpId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByIdpIdMethod(), responseObserver);
    }

    /**
     * <pre>
     * lookup identity-account actor-info (lightweight actor data for audit trail caching)
     * This RPC is specifically designed to break circular dependency loops in audit actor resolution.
     * When converting IdentityAccount entities to proto responses, the audit info (created_by, updated_by)
     * needs actor details. If we use the standard get() RPC, it triggers a full entity-to-proto conversion
     * including audit actors, which can create infinite recursion if audit actors reference IdentityAccounts.
     * This dedicated endpoint:
     * - Returns ONLY the lightweight ApiResourceAuditActor (id + avatar)
     * - Does NOT include full audit trail in the response
     * - Accesses entity data directly without recursive proto conversion
     * - Is used by ApiResourceAuditActorCacheProxy to safely populate Redis cache
     * - Prevents StackOverflowError when Redis cache is empty or cleared
     * Restricted to platform operators only as this is an internal cache-population mechanism.
     * </pre>
     */
    default void getActorInfo(ai.stigmer.iam.identityaccount.v1.IdentityAccountId request,
        io.grpc.stub.StreamObserver<ai.stigmer.commons.apiresource.ApiResourceAuditActor> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetActorInfoMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service IdentityAccountQueryController.
   * <pre>
   * identity-account query controller
   * </pre>
   */
  public static abstract class IdentityAccountQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return IdentityAccountQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service IdentityAccountQueryController.
   * <pre>
   * identity-account query controller
   * </pre>
   */
  public static final class IdentityAccountQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<IdentityAccountQueryControllerStub> {
    private IdentityAccountQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityAccountQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityAccountQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * lookup identity-account.
     * </pre>
     */
    public void get(ai.stigmer.iam.identityaccount.v1.IdentityAccountId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * look up identity-account by authentication token.
     * </pre>
     */
    public void whoAmI(com.google.protobuf.Empty request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getWhoAmIMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * lookup user-account by identity account email.
     * </pre>
     */
    public void getByEmail(ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByEmailMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * lookup user-account by idp id.
     * </pre>
     */
    public void getByIdpId(ai.stigmer.iam.identityaccount.v1.IdpId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByIdpIdMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * lookup identity-account actor-info (lightweight actor data for audit trail caching)
     * This RPC is specifically designed to break circular dependency loops in audit actor resolution.
     * When converting IdentityAccount entities to proto responses, the audit info (created_by, updated_by)
     * needs actor details. If we use the standard get() RPC, it triggers a full entity-to-proto conversion
     * including audit actors, which can create infinite recursion if audit actors reference IdentityAccounts.
     * This dedicated endpoint:
     * - Returns ONLY the lightweight ApiResourceAuditActor (id + avatar)
     * - Does NOT include full audit trail in the response
     * - Accesses entity data directly without recursive proto conversion
     * - Is used by ApiResourceAuditActorCacheProxy to safely populate Redis cache
     * - Prevents StackOverflowError when Redis cache is empty or cleared
     * Restricted to platform operators only as this is an internal cache-population mechanism.
     * </pre>
     */
    public void getActorInfo(ai.stigmer.iam.identityaccount.v1.IdentityAccountId request,
        io.grpc.stub.StreamObserver<ai.stigmer.commons.apiresource.ApiResourceAuditActor> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetActorInfoMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service IdentityAccountQueryController.
   * <pre>
   * identity-account query controller
   * </pre>
   */
  public static final class IdentityAccountQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<IdentityAccountQueryControllerBlockingV2Stub> {
    private IdentityAccountQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityAccountQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityAccountQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * lookup identity-account.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount get(ai.stigmer.iam.identityaccount.v1.IdentityAccountId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * look up identity-account by authentication token.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount whoAmI(com.google.protobuf.Empty request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getWhoAmIMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * lookup user-account by identity account email.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount getByEmail(ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByEmailMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * lookup user-account by idp id.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount getByIdpId(ai.stigmer.iam.identityaccount.v1.IdpId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByIdpIdMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * lookup identity-account actor-info (lightweight actor data for audit trail caching)
     * This RPC is specifically designed to break circular dependency loops in audit actor resolution.
     * When converting IdentityAccount entities to proto responses, the audit info (created_by, updated_by)
     * needs actor details. If we use the standard get() RPC, it triggers a full entity-to-proto conversion
     * including audit actors, which can create infinite recursion if audit actors reference IdentityAccounts.
     * This dedicated endpoint:
     * - Returns ONLY the lightweight ApiResourceAuditActor (id + avatar)
     * - Does NOT include full audit trail in the response
     * - Accesses entity data directly without recursive proto conversion
     * - Is used by ApiResourceAuditActorCacheProxy to safely populate Redis cache
     * - Prevents StackOverflowError when Redis cache is empty or cleared
     * Restricted to platform operators only as this is an internal cache-population mechanism.
     * </pre>
     */
    public ai.stigmer.commons.apiresource.ApiResourceAuditActor getActorInfo(ai.stigmer.iam.identityaccount.v1.IdentityAccountId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetActorInfoMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service IdentityAccountQueryController.
   * <pre>
   * identity-account query controller
   * </pre>
   */
  public static final class IdentityAccountQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<IdentityAccountQueryControllerBlockingStub> {
    private IdentityAccountQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityAccountQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityAccountQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * lookup identity-account.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount get(ai.stigmer.iam.identityaccount.v1.IdentityAccountId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * look up identity-account by authentication token.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount whoAmI(com.google.protobuf.Empty request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getWhoAmIMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * lookup user-account by identity account email.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount getByEmail(ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByEmailMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * lookup user-account by idp id.
     * </pre>
     */
    public ai.stigmer.iam.identityaccount.v1.IdentityAccount getByIdpId(ai.stigmer.iam.identityaccount.v1.IdpId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByIdpIdMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * lookup identity-account actor-info (lightweight actor data for audit trail caching)
     * This RPC is specifically designed to break circular dependency loops in audit actor resolution.
     * When converting IdentityAccount entities to proto responses, the audit info (created_by, updated_by)
     * needs actor details. If we use the standard get() RPC, it triggers a full entity-to-proto conversion
     * including audit actors, which can create infinite recursion if audit actors reference IdentityAccounts.
     * This dedicated endpoint:
     * - Returns ONLY the lightweight ApiResourceAuditActor (id + avatar)
     * - Does NOT include full audit trail in the response
     * - Accesses entity data directly without recursive proto conversion
     * - Is used by ApiResourceAuditActorCacheProxy to safely populate Redis cache
     * - Prevents StackOverflowError when Redis cache is empty or cleared
     * Restricted to platform operators only as this is an internal cache-population mechanism.
     * </pre>
     */
    public ai.stigmer.commons.apiresource.ApiResourceAuditActor getActorInfo(ai.stigmer.iam.identityaccount.v1.IdentityAccountId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetActorInfoMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service IdentityAccountQueryController.
   * <pre>
   * identity-account query controller
   * </pre>
   */
  public static final class IdentityAccountQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<IdentityAccountQueryControllerFutureStub> {
    private IdentityAccountQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityAccountQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityAccountQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * lookup identity-account.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityaccount.v1.IdentityAccount> get(
        ai.stigmer.iam.identityaccount.v1.IdentityAccountId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * look up identity-account by authentication token.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityaccount.v1.IdentityAccount> whoAmI(
        com.google.protobuf.Empty request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getWhoAmIMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * lookup user-account by identity account email.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityaccount.v1.IdentityAccount> getByEmail(
        ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByEmailMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * lookup user-account by idp id.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityaccount.v1.IdentityAccount> getByIdpId(
        ai.stigmer.iam.identityaccount.v1.IdpId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByIdpIdMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * lookup identity-account actor-info (lightweight actor data for audit trail caching)
     * This RPC is specifically designed to break circular dependency loops in audit actor resolution.
     * When converting IdentityAccount entities to proto responses, the audit info (created_by, updated_by)
     * needs actor details. If we use the standard get() RPC, it triggers a full entity-to-proto conversion
     * including audit actors, which can create infinite recursion if audit actors reference IdentityAccounts.
     * This dedicated endpoint:
     * - Returns ONLY the lightweight ApiResourceAuditActor (id + avatar)
     * - Does NOT include full audit trail in the response
     * - Accesses entity data directly without recursive proto conversion
     * - Is used by ApiResourceAuditActorCacheProxy to safely populate Redis cache
     * - Prevents StackOverflowError when Redis cache is empty or cleared
     * Restricted to platform operators only as this is an internal cache-population mechanism.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.commons.apiresource.ApiResourceAuditActor> getActorInfo(
        ai.stigmer.iam.identityaccount.v1.IdentityAccountId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetActorInfoMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_WHO_AM_I = 1;
  private static final int METHODID_GET_BY_EMAIL = 2;
  private static final int METHODID_GET_BY_IDP_ID = 3;
  private static final int METHODID_GET_ACTOR_INFO = 4;

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
        case METHODID_GET:
          serviceImpl.get((ai.stigmer.iam.identityaccount.v1.IdentityAccountId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount>) responseObserver);
          break;
        case METHODID_WHO_AM_I:
          serviceImpl.whoAmI((com.google.protobuf.Empty) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount>) responseObserver);
          break;
        case METHODID_GET_BY_EMAIL:
          serviceImpl.getByEmail((ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount>) responseObserver);
          break;
        case METHODID_GET_BY_IDP_ID:
          serviceImpl.getByIdpId((ai.stigmer.iam.identityaccount.v1.IdpId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityaccount.v1.IdentityAccount>) responseObserver);
          break;
        case METHODID_GET_ACTOR_INFO:
          serviceImpl.getActorInfo((ai.stigmer.iam.identityaccount.v1.IdentityAccountId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.commons.apiresource.ApiResourceAuditActor>) responseObserver);
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
          getGetMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityaccount.v1.IdentityAccountId,
              ai.stigmer.iam.identityaccount.v1.IdentityAccount>(
                service, METHODID_GET)))
        .addMethod(
          getWhoAmIMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              com.google.protobuf.Empty,
              ai.stigmer.iam.identityaccount.v1.IdentityAccount>(
                service, METHODID_WHO_AM_I)))
        .addMethod(
          getGetByEmailMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityaccount.v1.IdentityAccountEmail,
              ai.stigmer.iam.identityaccount.v1.IdentityAccount>(
                service, METHODID_GET_BY_EMAIL)))
        .addMethod(
          getGetByIdpIdMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityaccount.v1.IdpId,
              ai.stigmer.iam.identityaccount.v1.IdentityAccount>(
                service, METHODID_GET_BY_IDP_ID)))
        .addMethod(
          getGetActorInfoMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityaccount.v1.IdentityAccountId,
              ai.stigmer.commons.apiresource.ApiResourceAuditActor>(
                service, METHODID_GET_ACTOR_INFO)))
        .build();
  }

  private static abstract class IdentityAccountQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    IdentityAccountQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.identityaccount.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("IdentityAccountQueryController");
    }
  }

  private static final class IdentityAccountQueryControllerFileDescriptorSupplier
      extends IdentityAccountQueryControllerBaseDescriptorSupplier {
    IdentityAccountQueryControllerFileDescriptorSupplier() {}
  }

  private static final class IdentityAccountQueryControllerMethodDescriptorSupplier
      extends IdentityAccountQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    IdentityAccountQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (IdentityAccountQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new IdentityAccountQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getWhoAmIMethod())
              .addMethod(getGetByEmailMethod())
              .addMethod(getGetByIdpIdMethod())
              .addMethod(getGetActorInfoMethod())
              .build();
        }
      }
    }
    return result;
  }
}
