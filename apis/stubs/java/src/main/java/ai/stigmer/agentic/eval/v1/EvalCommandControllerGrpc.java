package ai.stigmer.agentic.eval.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * EvalCommandController handles write operations for evals.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class EvalCommandControllerGrpc {

  private EvalCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.eval.v1.EvalCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.PushEvalRequest,
      ai.stigmer.agentic.eval.v1.Eval> getPushMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "push",
      requestType = ai.stigmer.agentic.eval.v1.PushEvalRequest.class,
      responseType = ai.stigmer.agentic.eval.v1.Eval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.PushEvalRequest,
      ai.stigmer.agentic.eval.v1.Eval> getPushMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.PushEvalRequest, ai.stigmer.agentic.eval.v1.Eval> getPushMethod;
    if ((getPushMethod = EvalCommandControllerGrpc.getPushMethod) == null) {
      synchronized (EvalCommandControllerGrpc.class) {
        if ((getPushMethod = EvalCommandControllerGrpc.getPushMethod) == null) {
          EvalCommandControllerGrpc.getPushMethod = getPushMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.eval.v1.PushEvalRequest, ai.stigmer.agentic.eval.v1.Eval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "push"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.PushEvalRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.Eval.getDefaultInstance()))
              .setSchemaDescriptor(new EvalCommandControllerMethodDescriptorSupplier("push"))
              .build();
        }
      }
    }
    return getPushMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest,
      ai.stigmer.agentic.eval.v1.Eval> getAddCaseFromRunMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "addCaseFromRun",
      requestType = ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest.class,
      responseType = ai.stigmer.agentic.eval.v1.Eval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest,
      ai.stigmer.agentic.eval.v1.Eval> getAddCaseFromRunMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest, ai.stigmer.agentic.eval.v1.Eval> getAddCaseFromRunMethod;
    if ((getAddCaseFromRunMethod = EvalCommandControllerGrpc.getAddCaseFromRunMethod) == null) {
      synchronized (EvalCommandControllerGrpc.class) {
        if ((getAddCaseFromRunMethod = EvalCommandControllerGrpc.getAddCaseFromRunMethod) == null) {
          EvalCommandControllerGrpc.getAddCaseFromRunMethod = getAddCaseFromRunMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest, ai.stigmer.agentic.eval.v1.Eval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "addCaseFromRun"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.Eval.getDefaultInstance()))
              .setSchemaDescriptor(new EvalCommandControllerMethodDescriptorSupplier("addCaseFromRun"))
              .build();
        }
      }
    }
    return getAddCaseFromRunMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest,
      ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl> getCreateArtifactUploadUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "createArtifactUploadUrl",
      requestType = ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest.class,
      responseType = ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest,
      ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl> getCreateArtifactUploadUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest, ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl> getCreateArtifactUploadUrlMethod;
    if ((getCreateArtifactUploadUrlMethod = EvalCommandControllerGrpc.getCreateArtifactUploadUrlMethod) == null) {
      synchronized (EvalCommandControllerGrpc.class) {
        if ((getCreateArtifactUploadUrlMethod = EvalCommandControllerGrpc.getCreateArtifactUploadUrlMethod) == null) {
          EvalCommandControllerGrpc.getCreateArtifactUploadUrlMethod = getCreateArtifactUploadUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest, ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "createArtifactUploadUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl.getDefaultInstance()))
              .setSchemaDescriptor(new EvalCommandControllerMethodDescriptorSupplier("createArtifactUploadUrl"))
              .build();
        }
      }
    }
    return getCreateArtifactUploadUrlMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.eval.v1.Eval> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.eval.v1.Eval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.eval.v1.Eval> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.eval.v1.Eval> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = EvalCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (EvalCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = EvalCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          EvalCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.eval.v1.Eval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.Eval.getDefaultInstance()))
              .setSchemaDescriptor(new EvalCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.agentic.eval.v1.Eval> getRenameMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "rename",
      requestType = ai.stigmer.commons.apiresource.RenameInput.class,
      responseType = ai.stigmer.agentic.eval.v1.Eval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.agentic.eval.v1.Eval> getRenameMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.agentic.eval.v1.Eval> getRenameMethod;
    if ((getRenameMethod = EvalCommandControllerGrpc.getRenameMethod) == null) {
      synchronized (EvalCommandControllerGrpc.class) {
        if ((getRenameMethod = EvalCommandControllerGrpc.getRenameMethod) == null) {
          EvalCommandControllerGrpc.getRenameMethod = getRenameMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.agentic.eval.v1.Eval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "rename"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.RenameInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.Eval.getDefaultInstance()))
              .setSchemaDescriptor(new EvalCommandControllerMethodDescriptorSupplier("rename"))
              .build();
        }
      }
    }
    return getRenameMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.EvalId,
      ai.stigmer.agentic.eval.v1.Eval> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.eval.v1.EvalId.class,
      responseType = ai.stigmer.agentic.eval.v1.Eval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.EvalId,
      ai.stigmer.agentic.eval.v1.Eval> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.EvalId, ai.stigmer.agentic.eval.v1.Eval> getDeleteMethod;
    if ((getDeleteMethod = EvalCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (EvalCommandControllerGrpc.class) {
        if ((getDeleteMethod = EvalCommandControllerGrpc.getDeleteMethod) == null) {
          EvalCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.eval.v1.EvalId, ai.stigmer.agentic.eval.v1.Eval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.EvalId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.Eval.getDefaultInstance()))
              .setSchemaDescriptor(new EvalCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static EvalCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalCommandControllerStub>() {
        @java.lang.Override
        public EvalCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalCommandControllerStub(channel, callOptions);
        }
      };
    return EvalCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static EvalCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public EvalCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return EvalCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static EvalCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalCommandControllerBlockingStub>() {
        @java.lang.Override
        public EvalCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return EvalCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static EvalCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalCommandControllerFutureStub>() {
        @java.lang.Override
        public EvalCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalCommandControllerFutureStub(channel, callOptions);
        }
      };
    return EvalCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * EvalCommandController handles write operations for evals.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Push an evals/ folder as an eval's new version.
     * Creates the eval if the organization has none with the slug, or adds a
     * version to the one it has; pushing the folder the eval already holds
     * changes nothing, and with a new tag only moves the tag. The response's
     * status lists the cases and what could not be read.
     * Error Cases:
     * - INVALID_ARGUMENT: the archive is not a ZIP within the limits, or no
     *   case in it loads; the error lists the problems
     * - FAILED_PRECONDITION: the slug was renamed away from (SLUG_RENAMED)
     * - PERMISSION_DENIED: the caller may not create evals in the
     *   organization, or may not edit the eval with this slug
     * </pre>
     */
    default void push(ai.stigmer.agentic.eval.v1.PushEvalRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getPushMethod(), responseObserver);
    }

    /**
     * <pre>
     * Add a case built from a run (as buildCaseFromRun builds it) to an
     * eval, as a new version holding the current version's files and the
     * case.
     * Error Cases:
     * - NOT_FOUND: no such run, or no such eval
     * - PERMISSION_DENIED: the caller may not view the run, or may not edit
     *   the eval
     * - FAILED_PRECONDITION: the run has not ended, or the eval is not of the
     *   run's organization
     * - ALREADY_EXISTS: the eval already holds a case of that name
     * </pre>
     */
    default void addCaseFromRun(ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getAddCaseFromRunMethod(), responseObserver);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging an eval archive
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, slug, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushEvalRequest{ slug, artifact_upload_ref })
     * </pre>
     */
    default void createArtifactUploadUrl(ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateArtifactUploadUrlMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an eval: the whole organization, or its owner
     * alone. Only modifies metadata.visibility.
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Rename an eval: change its slug.
     * The eval keeps its id, its versions and its grants, and every answer
     * names it by the new slug. The old slug keeps leading to the eval for
     * reading for 30 days, during which no other eval of the organization can
     * take it and this one can take it back; then it is released. A push that
     * names the old slug is refused with SLUG_RENAMED. A slug another eval
     * holds is refused with ALREADY_EXISTS, and one another eval was recently
     * renamed away from with SLUG_RESERVED.
     * </pre>
     */
    default void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRenameMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an eval and every version of it.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.eval.v1.EvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service EvalCommandController.
   * <pre>
   * EvalCommandController handles write operations for evals.
   * </pre>
   */
  public static abstract class EvalCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return EvalCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service EvalCommandController.
   * <pre>
   * EvalCommandController handles write operations for evals.
   * </pre>
   */
  public static final class EvalCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<EvalCommandControllerStub> {
    private EvalCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Push an evals/ folder as an eval's new version.
     * Creates the eval if the organization has none with the slug, or adds a
     * version to the one it has; pushing the folder the eval already holds
     * changes nothing, and with a new tag only moves the tag. The response's
     * status lists the cases and what could not be read.
     * Error Cases:
     * - INVALID_ARGUMENT: the archive is not a ZIP within the limits, or no
     *   case in it loads; the error lists the problems
     * - FAILED_PRECONDITION: the slug was renamed away from (SLUG_RENAMED)
     * - PERMISSION_DENIED: the caller may not create evals in the
     *   organization, or may not edit the eval with this slug
     * </pre>
     */
    public void push(ai.stigmer.agentic.eval.v1.PushEvalRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getPushMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Add a case built from a run (as buildCaseFromRun builds it) to an
     * eval, as a new version holding the current version's files and the
     * case.
     * Error Cases:
     * - NOT_FOUND: no such run, or no such eval
     * - PERMISSION_DENIED: the caller may not view the run, or may not edit
     *   the eval
     * - FAILED_PRECONDITION: the run has not ended, or the eval is not of the
     *   run's organization
     * - ALREADY_EXISTS: the eval already holds a case of that name
     * </pre>
     */
    public void addCaseFromRun(ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getAddCaseFromRunMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging an eval archive
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, slug, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushEvalRequest{ slug, artifact_upload_ref })
     * </pre>
     */
    public void createArtifactUploadUrl(ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateArtifactUploadUrlMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an eval: the whole organization, or its owner
     * alone. Only modifies metadata.visibility.
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Rename an eval: change its slug.
     * The eval keeps its id, its versions and its grants, and every answer
     * names it by the new slug. The old slug keeps leading to the eval for
     * reading for 30 days, during which no other eval of the organization can
     * take it and this one can take it back; then it is released. A push that
     * names the old slug is refused with SLUG_RENAMED. A slug another eval
     * holds is refused with ALREADY_EXISTS, and one another eval was recently
     * renamed away from with SLUG_RESERVED.
     * </pre>
     */
    public void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an eval and every version of it.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.eval.v1.EvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service EvalCommandController.
   * <pre>
   * EvalCommandController handles write operations for evals.
   * </pre>
   */
  public static final class EvalCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<EvalCommandControllerBlockingV2Stub> {
    private EvalCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Push an evals/ folder as an eval's new version.
     * Creates the eval if the organization has none with the slug, or adds a
     * version to the one it has; pushing the folder the eval already holds
     * changes nothing, and with a new tag only moves the tag. The response's
     * status lists the cases and what could not be read.
     * Error Cases:
     * - INVALID_ARGUMENT: the archive is not a ZIP within the limits, or no
     *   case in it loads; the error lists the problems
     * - FAILED_PRECONDITION: the slug was renamed away from (SLUG_RENAMED)
     * - PERMISSION_DENIED: the caller may not create evals in the
     *   organization, or may not edit the eval with this slug
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval push(ai.stigmer.agentic.eval.v1.PushEvalRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getPushMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Add a case built from a run (as buildCaseFromRun builds it) to an
     * eval, as a new version holding the current version's files and the
     * case.
     * Error Cases:
     * - NOT_FOUND: no such run, or no such eval
     * - PERMISSION_DENIED: the caller may not view the run, or may not edit
     *   the eval
     * - FAILED_PRECONDITION: the run has not ended, or the eval is not of the
     *   run's organization
     * - ALREADY_EXISTS: the eval already holds a case of that name
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval addCaseFromRun(ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getAddCaseFromRunMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging an eval archive
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, slug, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushEvalRequest{ slug, artifact_upload_ref })
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl createArtifactUploadUrl(ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateArtifactUploadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an eval: the whole organization, or its owner
     * alone. Only modifies metadata.visibility.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename an eval: change its slug.
     * The eval keeps its id, its versions and its grants, and every answer
     * names it by the new slug. The old slug keeps leading to the eval for
     * reading for 30 days, during which no other eval of the organization can
     * take it and this one can take it back; then it is released. A push that
     * names the old slug is refused with SLUG_RENAMED. A slug another eval
     * holds is refused with ALREADY_EXISTS, and one another eval was recently
     * renamed away from with SLUG_RESERVED.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval rename(ai.stigmer.commons.apiresource.RenameInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an eval and every version of it.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval delete(ai.stigmer.agentic.eval.v1.EvalId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service EvalCommandController.
   * <pre>
   * EvalCommandController handles write operations for evals.
   * </pre>
   */
  public static final class EvalCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<EvalCommandControllerBlockingStub> {
    private EvalCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Push an evals/ folder as an eval's new version.
     * Creates the eval if the organization has none with the slug, or adds a
     * version to the one it has; pushing the folder the eval already holds
     * changes nothing, and with a new tag only moves the tag. The response's
     * status lists the cases and what could not be read.
     * Error Cases:
     * - INVALID_ARGUMENT: the archive is not a ZIP within the limits, or no
     *   case in it loads; the error lists the problems
     * - FAILED_PRECONDITION: the slug was renamed away from (SLUG_RENAMED)
     * - PERMISSION_DENIED: the caller may not create evals in the
     *   organization, or may not edit the eval with this slug
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval push(ai.stigmer.agentic.eval.v1.PushEvalRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getPushMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Add a case built from a run (as buildCaseFromRun builds it) to an
     * eval, as a new version holding the current version's files and the
     * case.
     * Error Cases:
     * - NOT_FOUND: no such run, or no such eval
     * - PERMISSION_DENIED: the caller may not view the run, or may not edit
     *   the eval
     * - FAILED_PRECONDITION: the run has not ended, or the eval is not of the
     *   run's organization
     * - ALREADY_EXISTS: the eval already holds a case of that name
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval addCaseFromRun(ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getAddCaseFromRunMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging an eval archive
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, slug, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushEvalRequest{ slug, artifact_upload_ref })
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl createArtifactUploadUrl(ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateArtifactUploadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an eval: the whole organization, or its owner
     * alone. Only modifies metadata.visibility.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename an eval: change its slug.
     * The eval keeps its id, its versions and its grants, and every answer
     * names it by the new slug. The old slug keeps leading to the eval for
     * reading for 30 days, during which no other eval of the organization can
     * take it and this one can take it back; then it is released. A push that
     * names the old slug is refused with SLUG_RENAMED. A slug another eval
     * holds is refused with ALREADY_EXISTS, and one another eval was recently
     * renamed away from with SLUG_RESERVED.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval rename(ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an eval and every version of it.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval delete(ai.stigmer.agentic.eval.v1.EvalId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service EvalCommandController.
   * <pre>
   * EvalCommandController handles write operations for evals.
   * </pre>
   */
  public static final class EvalCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<EvalCommandControllerFutureStub> {
    private EvalCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Push an evals/ folder as an eval's new version.
     * Creates the eval if the organization has none with the slug, or adds a
     * version to the one it has; pushing the folder the eval already holds
     * changes nothing, and with a new tag only moves the tag. The response's
     * status lists the cases and what could not be read.
     * Error Cases:
     * - INVALID_ARGUMENT: the archive is not a ZIP within the limits, or no
     *   case in it loads; the error lists the problems
     * - FAILED_PRECONDITION: the slug was renamed away from (SLUG_RENAMED)
     * - PERMISSION_DENIED: the caller may not create evals in the
     *   organization, or may not edit the eval with this slug
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.Eval> push(
        ai.stigmer.agentic.eval.v1.PushEvalRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getPushMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Add a case built from a run (as buildCaseFromRun builds it) to an
     * eval, as a new version holding the current version's files and the
     * case.
     * Error Cases:
     * - NOT_FOUND: no such run, or no such eval
     * - PERMISSION_DENIED: the caller may not view the run, or may not edit
     *   the eval
     * - FAILED_PRECONDITION: the run has not ended, or the eval is not of the
     *   run's organization
     * - ALREADY_EXISTS: the eval already holds a case of that name
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.Eval> addCaseFromRun(
        ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getAddCaseFromRunMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging an eval archive
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, slug, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushEvalRequest{ slug, artifact_upload_ref })
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl> createArtifactUploadUrl(
        ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateArtifactUploadUrlMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of an eval: the whole organization, or its owner
     * alone. Only modifies metadata.visibility.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.Eval> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Rename an eval: change its slug.
     * The eval keeps its id, its versions and its grants, and every answer
     * names it by the new slug. The old slug keeps leading to the eval for
     * reading for 30 days, during which no other eval of the organization can
     * take it and this one can take it back; then it is released. A push that
     * names the old slug is refused with SLUG_RENAMED. A slug another eval
     * holds is refused with ALREADY_EXISTS, and one another eval was recently
     * renamed away from with SLUG_RESERVED.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.Eval> rename(
        ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an eval and every version of it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.Eval> delete(
        ai.stigmer.agentic.eval.v1.EvalId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_PUSH = 0;
  private static final int METHODID_ADD_CASE_FROM_RUN = 1;
  private static final int METHODID_CREATE_ARTIFACT_UPLOAD_URL = 2;
  private static final int METHODID_UPDATE_VISIBILITY = 3;
  private static final int METHODID_RENAME = 4;
  private static final int METHODID_DELETE = 5;

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
        case METHODID_PUSH:
          serviceImpl.push((ai.stigmer.agentic.eval.v1.PushEvalRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval>) responseObserver);
          break;
        case METHODID_ADD_CASE_FROM_RUN:
          serviceImpl.addCaseFromRun((ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval>) responseObserver);
          break;
        case METHODID_CREATE_ARTIFACT_UPLOAD_URL:
          serviceImpl.createArtifactUploadUrl((ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval>) responseObserver);
          break;
        case METHODID_RENAME:
          serviceImpl.rename((ai.stigmer.commons.apiresource.RenameInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.eval.v1.EvalId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval>) responseObserver);
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
          getPushMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.eval.v1.PushEvalRequest,
              ai.stigmer.agentic.eval.v1.Eval>(
                service, METHODID_PUSH)))
        .addMethod(
          getAddCaseFromRunMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.eval.v1.AddEvalCaseFromRunRequest,
              ai.stigmer.agentic.eval.v1.Eval>(
                service, METHODID_ADD_CASE_FROM_RUN)))
        .addMethod(
          getCreateArtifactUploadUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.eval.v1.CreateEvalArtifactUploadUrlRequest,
              ai.stigmer.agentic.eval.v1.EvalArtifactUploadUrl>(
                service, METHODID_CREATE_ARTIFACT_UPLOAD_URL)))
        .addMethod(
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.eval.v1.Eval>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getRenameMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.RenameInput,
              ai.stigmer.agentic.eval.v1.Eval>(
                service, METHODID_RENAME)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.eval.v1.EvalId,
              ai.stigmer.agentic.eval.v1.Eval>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class EvalCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    EvalCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.eval.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("EvalCommandController");
    }
  }

  private static final class EvalCommandControllerFileDescriptorSupplier
      extends EvalCommandControllerBaseDescriptorSupplier {
    EvalCommandControllerFileDescriptorSupplier() {}
  }

  private static final class EvalCommandControllerMethodDescriptorSupplier
      extends EvalCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    EvalCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (EvalCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new EvalCommandControllerFileDescriptorSupplier())
              .addMethod(getPushMethod())
              .addMethod(getAddCaseFromRunMethod())
              .addMethod(getCreateArtifactUploadUrlMethod())
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getRenameMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
