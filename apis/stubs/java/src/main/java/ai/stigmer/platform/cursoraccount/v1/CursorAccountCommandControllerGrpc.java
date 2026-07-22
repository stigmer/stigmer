package ai.stigmer.platform.cursoraccount.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * CursorAccountCommandController handles write operations for managed
 * Cursor accounts.
 * Cursor accounts are not a standard API Resource — like billing, there
 * is no api_resource_kind annotation. Every RPC is platform-gated to
 * can_manage_cursor_accounts on platform:stigmer (human operators only):
 * the resource holds provider key material and per-member spend, which
 * are platform-internal and never org-visible.
 * &#64;internal
 * Cloud-only. The OSS Go server does not implement this service — in the
 * OSS edition Cursor credentials are the user's own (BYOK env var), so
 * there is nothing to manage. Handlers refuse writes when secret
 * encryption is not enabled on the deployment (FAILED_PRECONDITION):
 * silently persisting plaintext keys is never acceptable for this store.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class CursorAccountCommandControllerGrpc {

  private CursorAccountCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.platform.cursoraccount.v1.CursorAccountCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccount> getUpsertCursorAccountMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "upsertCursorAccount",
      requestType = ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput.class,
      responseType = ai.stigmer.platform.cursoraccount.v1.CursorAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccount> getUpsertCursorAccountMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput, ai.stigmer.platform.cursoraccount.v1.CursorAccount> getUpsertCursorAccountMethod;
    if ((getUpsertCursorAccountMethod = CursorAccountCommandControllerGrpc.getUpsertCursorAccountMethod) == null) {
      synchronized (CursorAccountCommandControllerGrpc.class) {
        if ((getUpsertCursorAccountMethod = CursorAccountCommandControllerGrpc.getUpsertCursorAccountMethod) == null) {
          CursorAccountCommandControllerGrpc.getUpsertCursorAccountMethod = getUpsertCursorAccountMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput, ai.stigmer.platform.cursoraccount.v1.CursorAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "upsertCursorAccount"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.CursorAccount.getDefaultInstance()))
              .setSchemaDescriptor(new CursorAccountCommandControllerMethodDescriptorSupplier("upsertCursorAccount"))
              .build();
        }
      }
    }
    return getUpsertCursorAccountMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccount> getDeleteCursorAccountMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "deleteCursorAccount",
      requestType = ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput.class,
      responseType = ai.stigmer.platform.cursoraccount.v1.CursorAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccount> getDeleteCursorAccountMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput, ai.stigmer.platform.cursoraccount.v1.CursorAccount> getDeleteCursorAccountMethod;
    if ((getDeleteCursorAccountMethod = CursorAccountCommandControllerGrpc.getDeleteCursorAccountMethod) == null) {
      synchronized (CursorAccountCommandControllerGrpc.class) {
        if ((getDeleteCursorAccountMethod = CursorAccountCommandControllerGrpc.getDeleteCursorAccountMethod) == null) {
          CursorAccountCommandControllerGrpc.getDeleteCursorAccountMethod = getDeleteCursorAccountMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput, ai.stigmer.platform.cursoraccount.v1.CursorAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "deleteCursorAccount"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.CursorAccount.getDefaultInstance()))
              .setSchemaDescriptor(new CursorAccountCommandControllerMethodDescriptorSupplier("deleteCursorAccount"))
              .build();
        }
      }
    }
    return getDeleteCursorAccountMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccount> getAddCursorMemberKeyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "addCursorMemberKey",
      requestType = ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput.class,
      responseType = ai.stigmer.platform.cursoraccount.v1.CursorAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccount> getAddCursorMemberKeyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput, ai.stigmer.platform.cursoraccount.v1.CursorAccount> getAddCursorMemberKeyMethod;
    if ((getAddCursorMemberKeyMethod = CursorAccountCommandControllerGrpc.getAddCursorMemberKeyMethod) == null) {
      synchronized (CursorAccountCommandControllerGrpc.class) {
        if ((getAddCursorMemberKeyMethod = CursorAccountCommandControllerGrpc.getAddCursorMemberKeyMethod) == null) {
          CursorAccountCommandControllerGrpc.getAddCursorMemberKeyMethod = getAddCursorMemberKeyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput, ai.stigmer.platform.cursoraccount.v1.CursorAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "addCursorMemberKey"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.CursorAccount.getDefaultInstance()))
              .setSchemaDescriptor(new CursorAccountCommandControllerMethodDescriptorSupplier("addCursorMemberKey"))
              .build();
        }
      }
    }
    return getAddCursorMemberKeyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccount> getRemoveCursorMemberKeyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "removeCursorMemberKey",
      requestType = ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput.class,
      responseType = ai.stigmer.platform.cursoraccount.v1.CursorAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccount> getRemoveCursorMemberKeyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput, ai.stigmer.platform.cursoraccount.v1.CursorAccount> getRemoveCursorMemberKeyMethod;
    if ((getRemoveCursorMemberKeyMethod = CursorAccountCommandControllerGrpc.getRemoveCursorMemberKeyMethod) == null) {
      synchronized (CursorAccountCommandControllerGrpc.class) {
        if ((getRemoveCursorMemberKeyMethod = CursorAccountCommandControllerGrpc.getRemoveCursorMemberKeyMethod) == null) {
          CursorAccountCommandControllerGrpc.getRemoveCursorMemberKeyMethod = getRemoveCursorMemberKeyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput, ai.stigmer.platform.cursoraccount.v1.CursorAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "removeCursorMemberKey"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.CursorAccount.getDefaultInstance()))
              .setSchemaDescriptor(new CursorAccountCommandControllerMethodDescriptorSupplier("removeCursorMemberKey"))
              .build();
        }
      }
    }
    return getRemoveCursorMemberKeyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccount> getSetCursorMemberKeyEnabledMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "setCursorMemberKeyEnabled",
      requestType = ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput.class,
      responseType = ai.stigmer.platform.cursoraccount.v1.CursorAccount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccount> getSetCursorMemberKeyEnabledMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput, ai.stigmer.platform.cursoraccount.v1.CursorAccount> getSetCursorMemberKeyEnabledMethod;
    if ((getSetCursorMemberKeyEnabledMethod = CursorAccountCommandControllerGrpc.getSetCursorMemberKeyEnabledMethod) == null) {
      synchronized (CursorAccountCommandControllerGrpc.class) {
        if ((getSetCursorMemberKeyEnabledMethod = CursorAccountCommandControllerGrpc.getSetCursorMemberKeyEnabledMethod) == null) {
          CursorAccountCommandControllerGrpc.getSetCursorMemberKeyEnabledMethod = getSetCursorMemberKeyEnabledMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput, ai.stigmer.platform.cursoraccount.v1.CursorAccount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "setCursorMemberKeyEnabled"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.CursorAccount.getDefaultInstance()))
              .setSchemaDescriptor(new CursorAccountCommandControllerMethodDescriptorSupplier("setCursorMemberKeyEnabled"))
              .build();
        }
      }
    }
    return getSetCursorMemberKeyEnabledMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccountView> getSyncCursorAccountMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "syncCursorAccount",
      requestType = ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput.class,
      responseType = ai.stigmer.platform.cursoraccount.v1.CursorAccountView.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccountView> getSyncCursorAccountMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput, ai.stigmer.platform.cursoraccount.v1.CursorAccountView> getSyncCursorAccountMethod;
    if ((getSyncCursorAccountMethod = CursorAccountCommandControllerGrpc.getSyncCursorAccountMethod) == null) {
      synchronized (CursorAccountCommandControllerGrpc.class) {
        if ((getSyncCursorAccountMethod = CursorAccountCommandControllerGrpc.getSyncCursorAccountMethod) == null) {
          CursorAccountCommandControllerGrpc.getSyncCursorAccountMethod = getSyncCursorAccountMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput, ai.stigmer.platform.cursoraccount.v1.CursorAccountView>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "syncCursorAccount"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.CursorAccountView.getDefaultInstance()))
              .setSchemaDescriptor(new CursorAccountCommandControllerMethodDescriptorSupplier("syncCursorAccount"))
              .build();
        }
      }
    }
    return getSyncCursorAccountMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static CursorAccountCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CursorAccountCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CursorAccountCommandControllerStub>() {
        @java.lang.Override
        public CursorAccountCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CursorAccountCommandControllerStub(channel, callOptions);
        }
      };
    return CursorAccountCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static CursorAccountCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CursorAccountCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CursorAccountCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public CursorAccountCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CursorAccountCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return CursorAccountCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static CursorAccountCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CursorAccountCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CursorAccountCommandControllerBlockingStub>() {
        @java.lang.Override
        public CursorAccountCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CursorAccountCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return CursorAccountCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static CursorAccountCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CursorAccountCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CursorAccountCommandControllerFutureStub>() {
        @java.lang.Override
        public CursorAccountCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CursorAccountCommandControllerFutureStub(channel, callOptions);
        }
      };
    return CursorAccountCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * CursorAccountCommandController handles write operations for managed
   * Cursor accounts.
   * Cursor accounts are not a standard API Resource — like billing, there
   * is no api_resource_kind annotation. Every RPC is platform-gated to
   * can_manage_cursor_accounts on platform:stigmer (human operators only):
   * the resource holds provider key material and per-member spend, which
   * are platform-internal and never org-visible.
   * &#64;internal
   * Cloud-only. The OSS Go server does not implement this service — in the
   * OSS edition Cursor credentials are the user's own (BYOK env var), so
   * there is nothing to manage. Handlers refuse writes when secret
   * encryption is not enabled on the deployment (FAILED_PRECONDITION):
   * silently persisting plaintext keys is never acceptable for this store.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a Cursor account (identity, admin key, org
     * assignments, enablement, platform-default flag).
     * The admin key is validated live against GET /teams/members before
     * persistence; org assignments are unique across accounts and at most
     * one account may be the platform default. Member keys are NOT written
     * through this RPC — see addCursorMemberKey / removeCursorMemberKey.
     * </pre>
     */
    default void upsertCursorAccount(ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpsertCursorAccountMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a Cursor account. Refused while live sessions are pinned to
     * its keys unless force is set (see DeleteCursorAccountInput).
     * </pre>
     */
    default void deleteCursorAccount(ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteCursorAccountMethod(), responseObserver);
    }

    /**
     * <pre>
     * Add one execution-capable member key. The key is identified via
     * Cursor's GET /v1/me and bound to its owning team member server-side;
     * non-user-scoped keys are rejected with Cursor's own explanation.
     * </pre>
     */
    default void addCursorMemberKey(ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getAddCursorMemberKeyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Remove one member key. Refused while live sessions are pinned to it
     * unless force is set (see RemoveCursorMemberKeyInput).
     * </pre>
     */
    default void removeCursorMemberKey(ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRemoveCursorMemberKeyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Enable or disable one member key for new-session selection.
     * </pre>
     */
    default void setCursorMemberKeyEnabled(ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSetCursorMemberKeyEnabledMethod(), responseObserver);
    }

    /**
     * <pre>
     * Run an on-demand roster + spend sync (the console "Sync now") and
     * return the refreshed detail view. Same activity the hourly schedule
     * runs; Admin API rate limits apply, so the console debounces.
     * </pre>
     */
    default void syncCursorAccount(ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccountView> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSyncCursorAccountMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service CursorAccountCommandController.
   * <pre>
   * CursorAccountCommandController handles write operations for managed
   * Cursor accounts.
   * Cursor accounts are not a standard API Resource — like billing, there
   * is no api_resource_kind annotation. Every RPC is platform-gated to
   * can_manage_cursor_accounts on platform:stigmer (human operators only):
   * the resource holds provider key material and per-member spend, which
   * are platform-internal and never org-visible.
   * &#64;internal
   * Cloud-only. The OSS Go server does not implement this service — in the
   * OSS edition Cursor credentials are the user's own (BYOK env var), so
   * there is nothing to manage. Handlers refuse writes when secret
   * encryption is not enabled on the deployment (FAILED_PRECONDITION):
   * silently persisting plaintext keys is never acceptable for this store.
   * </pre>
   */
  public static abstract class CursorAccountCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return CursorAccountCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service CursorAccountCommandController.
   * <pre>
   * CursorAccountCommandController handles write operations for managed
   * Cursor accounts.
   * Cursor accounts are not a standard API Resource — like billing, there
   * is no api_resource_kind annotation. Every RPC is platform-gated to
   * can_manage_cursor_accounts on platform:stigmer (human operators only):
   * the resource holds provider key material and per-member spend, which
   * are platform-internal and never org-visible.
   * &#64;internal
   * Cloud-only. The OSS Go server does not implement this service — in the
   * OSS edition Cursor credentials are the user's own (BYOK env var), so
   * there is nothing to manage. Handlers refuse writes when secret
   * encryption is not enabled on the deployment (FAILED_PRECONDITION):
   * silently persisting plaintext keys is never acceptable for this store.
   * </pre>
   */
  public static final class CursorAccountCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<CursorAccountCommandControllerStub> {
    private CursorAccountCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CursorAccountCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CursorAccountCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a Cursor account (identity, admin key, org
     * assignments, enablement, platform-default flag).
     * The admin key is validated live against GET /teams/members before
     * persistence; org assignments are unique across accounts and at most
     * one account may be the platform default. Member keys are NOT written
     * through this RPC — see addCursorMemberKey / removeCursorMemberKey.
     * </pre>
     */
    public void upsertCursorAccount(ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpsertCursorAccountMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a Cursor account. Refused while live sessions are pinned to
     * its keys unless force is set (see DeleteCursorAccountInput).
     * </pre>
     */
    public void deleteCursorAccount(ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteCursorAccountMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Add one execution-capable member key. The key is identified via
     * Cursor's GET /v1/me and bound to its owning team member server-side;
     * non-user-scoped keys are rejected with Cursor's own explanation.
     * </pre>
     */
    public void addCursorMemberKey(ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getAddCursorMemberKeyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Remove one member key. Refused while live sessions are pinned to it
     * unless force is set (see RemoveCursorMemberKeyInput).
     * </pre>
     */
    public void removeCursorMemberKey(ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRemoveCursorMemberKeyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Enable or disable one member key for new-session selection.
     * </pre>
     */
    public void setCursorMemberKeyEnabled(ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSetCursorMemberKeyEnabledMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Run an on-demand roster + spend sync (the console "Sync now") and
     * return the refreshed detail view. Same activity the hourly schedule
     * runs; Admin API rate limits apply, so the console debounces.
     * </pre>
     */
    public void syncCursorAccount(ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccountView> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSyncCursorAccountMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service CursorAccountCommandController.
   * <pre>
   * CursorAccountCommandController handles write operations for managed
   * Cursor accounts.
   * Cursor accounts are not a standard API Resource — like billing, there
   * is no api_resource_kind annotation. Every RPC is platform-gated to
   * can_manage_cursor_accounts on platform:stigmer (human operators only):
   * the resource holds provider key material and per-member spend, which
   * are platform-internal and never org-visible.
   * &#64;internal
   * Cloud-only. The OSS Go server does not implement this service — in the
   * OSS edition Cursor credentials are the user's own (BYOK env var), so
   * there is nothing to manage. Handlers refuse writes when secret
   * encryption is not enabled on the deployment (FAILED_PRECONDITION):
   * silently persisting plaintext keys is never acceptable for this store.
   * </pre>
   */
  public static final class CursorAccountCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<CursorAccountCommandControllerBlockingV2Stub> {
    private CursorAccountCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CursorAccountCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CursorAccountCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a Cursor account (identity, admin key, org
     * assignments, enablement, platform-default flag).
     * The admin key is validated live against GET /teams/members before
     * persistence; org assignments are unique across accounts and at most
     * one account may be the platform default. Member keys are NOT written
     * through this RPC — see addCursorMemberKey / removeCursorMemberKey.
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccount upsertCursorAccount(ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpsertCursorAccountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a Cursor account. Refused while live sessions are pinned to
     * its keys unless force is set (see DeleteCursorAccountInput).
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccount deleteCursorAccount(ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteCursorAccountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Add one execution-capable member key. The key is identified via
     * Cursor's GET /v1/me and bound to its owning team member server-side;
     * non-user-scoped keys are rejected with Cursor's own explanation.
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccount addCursorMemberKey(ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getAddCursorMemberKeyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove one member key. Refused while live sessions are pinned to it
     * unless force is set (see RemoveCursorMemberKeyInput).
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccount removeCursorMemberKey(ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRemoveCursorMemberKeyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Enable or disable one member key for new-session selection.
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccount setCursorMemberKeyEnabled(ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSetCursorMemberKeyEnabledMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Run an on-demand roster + spend sync (the console "Sync now") and
     * return the refreshed detail view. Same activity the hourly schedule
     * runs; Admin API rate limits apply, so the console debounces.
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccountView syncCursorAccount(ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSyncCursorAccountMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service CursorAccountCommandController.
   * <pre>
   * CursorAccountCommandController handles write operations for managed
   * Cursor accounts.
   * Cursor accounts are not a standard API Resource — like billing, there
   * is no api_resource_kind annotation. Every RPC is platform-gated to
   * can_manage_cursor_accounts on platform:stigmer (human operators only):
   * the resource holds provider key material and per-member spend, which
   * are platform-internal and never org-visible.
   * &#64;internal
   * Cloud-only. The OSS Go server does not implement this service — in the
   * OSS edition Cursor credentials are the user's own (BYOK env var), so
   * there is nothing to manage. Handlers refuse writes when secret
   * encryption is not enabled on the deployment (FAILED_PRECONDITION):
   * silently persisting plaintext keys is never acceptable for this store.
   * </pre>
   */
  public static final class CursorAccountCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<CursorAccountCommandControllerBlockingStub> {
    private CursorAccountCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CursorAccountCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CursorAccountCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a Cursor account (identity, admin key, org
     * assignments, enablement, platform-default flag).
     * The admin key is validated live against GET /teams/members before
     * persistence; org assignments are unique across accounts and at most
     * one account may be the platform default. Member keys are NOT written
     * through this RPC — see addCursorMemberKey / removeCursorMemberKey.
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccount upsertCursorAccount(ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpsertCursorAccountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a Cursor account. Refused while live sessions are pinned to
     * its keys unless force is set (see DeleteCursorAccountInput).
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccount deleteCursorAccount(ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteCursorAccountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Add one execution-capable member key. The key is identified via
     * Cursor's GET /v1/me and bound to its owning team member server-side;
     * non-user-scoped keys are rejected with Cursor's own explanation.
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccount addCursorMemberKey(ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getAddCursorMemberKeyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove one member key. Refused while live sessions are pinned to it
     * unless force is set (see RemoveCursorMemberKeyInput).
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccount removeCursorMemberKey(ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRemoveCursorMemberKeyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Enable or disable one member key for new-session selection.
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccount setCursorMemberKeyEnabled(ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSetCursorMemberKeyEnabledMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Run an on-demand roster + spend sync (the console "Sync now") and
     * return the refreshed detail view. Same activity the hourly schedule
     * runs; Admin API rate limits apply, so the console debounces.
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccountView syncCursorAccount(ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSyncCursorAccountMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service CursorAccountCommandController.
   * <pre>
   * CursorAccountCommandController handles write operations for managed
   * Cursor accounts.
   * Cursor accounts are not a standard API Resource — like billing, there
   * is no api_resource_kind annotation. Every RPC is platform-gated to
   * can_manage_cursor_accounts on platform:stigmer (human operators only):
   * the resource holds provider key material and per-member spend, which
   * are platform-internal and never org-visible.
   * &#64;internal
   * Cloud-only. The OSS Go server does not implement this service — in the
   * OSS edition Cursor credentials are the user's own (BYOK env var), so
   * there is nothing to manage. Handlers refuse writes when secret
   * encryption is not enabled on the deployment (FAILED_PRECONDITION):
   * silently persisting plaintext keys is never acceptable for this store.
   * </pre>
   */
  public static final class CursorAccountCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<CursorAccountCommandControllerFutureStub> {
    private CursorAccountCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CursorAccountCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CursorAccountCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a Cursor account (identity, admin key, org
     * assignments, enablement, platform-default flag).
     * The admin key is validated live against GET /teams/members before
     * persistence; org assignments are unique across accounts and at most
     * one account may be the platform default. Member keys are NOT written
     * through this RPC — see addCursorMemberKey / removeCursorMemberKey.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.cursoraccount.v1.CursorAccount> upsertCursorAccount(
        ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpsertCursorAccountMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a Cursor account. Refused while live sessions are pinned to
     * its keys unless force is set (see DeleteCursorAccountInput).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.cursoraccount.v1.CursorAccount> deleteCursorAccount(
        ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteCursorAccountMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Add one execution-capable member key. The key is identified via
     * Cursor's GET /v1/me and bound to its owning team member server-side;
     * non-user-scoped keys are rejected with Cursor's own explanation.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.cursoraccount.v1.CursorAccount> addCursorMemberKey(
        ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getAddCursorMemberKeyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Remove one member key. Refused while live sessions are pinned to it
     * unless force is set (see RemoveCursorMemberKeyInput).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.cursoraccount.v1.CursorAccount> removeCursorMemberKey(
        ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRemoveCursorMemberKeyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Enable or disable one member key for new-session selection.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.cursoraccount.v1.CursorAccount> setCursorMemberKeyEnabled(
        ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSetCursorMemberKeyEnabledMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Run an on-demand roster + spend sync (the console "Sync now") and
     * return the refreshed detail view. Same activity the hourly schedule
     * runs; Admin API rate limits apply, so the console debounces.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.cursoraccount.v1.CursorAccountView> syncCursorAccount(
        ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSyncCursorAccountMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_UPSERT_CURSOR_ACCOUNT = 0;
  private static final int METHODID_DELETE_CURSOR_ACCOUNT = 1;
  private static final int METHODID_ADD_CURSOR_MEMBER_KEY = 2;
  private static final int METHODID_REMOVE_CURSOR_MEMBER_KEY = 3;
  private static final int METHODID_SET_CURSOR_MEMBER_KEY_ENABLED = 4;
  private static final int METHODID_SYNC_CURSOR_ACCOUNT = 5;

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
        case METHODID_UPSERT_CURSOR_ACCOUNT:
          serviceImpl.upsertCursorAccount((ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount>) responseObserver);
          break;
        case METHODID_DELETE_CURSOR_ACCOUNT:
          serviceImpl.deleteCursorAccount((ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount>) responseObserver);
          break;
        case METHODID_ADD_CURSOR_MEMBER_KEY:
          serviceImpl.addCursorMemberKey((ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount>) responseObserver);
          break;
        case METHODID_REMOVE_CURSOR_MEMBER_KEY:
          serviceImpl.removeCursorMemberKey((ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount>) responseObserver);
          break;
        case METHODID_SET_CURSOR_MEMBER_KEY_ENABLED:
          serviceImpl.setCursorMemberKeyEnabled((ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccount>) responseObserver);
          break;
        case METHODID_SYNC_CURSOR_ACCOUNT:
          serviceImpl.syncCursorAccount((ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccountView>) responseObserver);
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
          getUpsertCursorAccountMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.cursoraccount.v1.UpsertCursorAccountInput,
              ai.stigmer.platform.cursoraccount.v1.CursorAccount>(
                service, METHODID_UPSERT_CURSOR_ACCOUNT)))
        .addMethod(
          getDeleteCursorAccountMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.cursoraccount.v1.DeleteCursorAccountInput,
              ai.stigmer.platform.cursoraccount.v1.CursorAccount>(
                service, METHODID_DELETE_CURSOR_ACCOUNT)))
        .addMethod(
          getAddCursorMemberKeyMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.cursoraccount.v1.AddCursorMemberKeyInput,
              ai.stigmer.platform.cursoraccount.v1.CursorAccount>(
                service, METHODID_ADD_CURSOR_MEMBER_KEY)))
        .addMethod(
          getRemoveCursorMemberKeyMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.cursoraccount.v1.RemoveCursorMemberKeyInput,
              ai.stigmer.platform.cursoraccount.v1.CursorAccount>(
                service, METHODID_REMOVE_CURSOR_MEMBER_KEY)))
        .addMethod(
          getSetCursorMemberKeyEnabledMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.cursoraccount.v1.SetCursorMemberKeyEnabledInput,
              ai.stigmer.platform.cursoraccount.v1.CursorAccount>(
                service, METHODID_SET_CURSOR_MEMBER_KEY_ENABLED)))
        .addMethod(
          getSyncCursorAccountMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.cursoraccount.v1.SyncCursorAccountInput,
              ai.stigmer.platform.cursoraccount.v1.CursorAccountView>(
                service, METHODID_SYNC_CURSOR_ACCOUNT)))
        .build();
  }

  private static abstract class CursorAccountCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    CursorAccountCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.platform.cursoraccount.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("CursorAccountCommandController");
    }
  }

  private static final class CursorAccountCommandControllerFileDescriptorSupplier
      extends CursorAccountCommandControllerBaseDescriptorSupplier {
    CursorAccountCommandControllerFileDescriptorSupplier() {}
  }

  private static final class CursorAccountCommandControllerMethodDescriptorSupplier
      extends CursorAccountCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    CursorAccountCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (CursorAccountCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new CursorAccountCommandControllerFileDescriptorSupplier())
              .addMethod(getUpsertCursorAccountMethod())
              .addMethod(getDeleteCursorAccountMethod())
              .addMethod(getAddCursorMemberKeyMethod())
              .addMethod(getRemoveCursorMemberKeyMethod())
              .addMethod(getSetCursorMemberKeyEnabledMethod())
              .addMethod(getSyncCursorAccountMethod())
              .build();
        }
      }
    }
    return result;
  }
}
