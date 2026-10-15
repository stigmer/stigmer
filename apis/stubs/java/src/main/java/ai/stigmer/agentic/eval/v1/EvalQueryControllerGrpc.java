package ai.stigmer.agentic.eval.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * EvalQueryController handles read operations for evals.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class EvalQueryControllerGrpc {

  private EvalQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.eval.v1.EvalQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.EvalId,
      ai.stigmer.agentic.eval.v1.Eval> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.eval.v1.EvalId.class,
      responseType = ai.stigmer.agentic.eval.v1.Eval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.EvalId,
      ai.stigmer.agentic.eval.v1.Eval> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.EvalId, ai.stigmer.agentic.eval.v1.Eval> getGetMethod;
    if ((getGetMethod = EvalQueryControllerGrpc.getGetMethod) == null) {
      synchronized (EvalQueryControllerGrpc.class) {
        if ((getGetMethod = EvalQueryControllerGrpc.getGetMethod) == null) {
          EvalQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.eval.v1.EvalId, ai.stigmer.agentic.eval.v1.Eval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.EvalId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.Eval.getDefaultInstance()))
              .setSchemaDescriptor(new EvalQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.eval.v1.Eval> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.eval.v1.Eval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.eval.v1.Eval> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.eval.v1.Eval> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = EvalQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (EvalQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = EvalQueryControllerGrpc.getGetByReferenceMethod) == null) {
          EvalQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.eval.v1.Eval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.Eval.getDefaultInstance()))
              .setSchemaDescriptor(new EvalQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.ListEvalsRequest,
      ai.stigmer.agentic.eval.v1.EvalList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.eval.v1.ListEvalsRequest.class,
      responseType = ai.stigmer.agentic.eval.v1.EvalList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.ListEvalsRequest,
      ai.stigmer.agentic.eval.v1.EvalList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.ListEvalsRequest, ai.stigmer.agentic.eval.v1.EvalList> getListMethod;
    if ((getListMethod = EvalQueryControllerGrpc.getListMethod) == null) {
      synchronized (EvalQueryControllerGrpc.class) {
        if ((getListMethod = EvalQueryControllerGrpc.getListMethod) == null) {
          EvalQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.eval.v1.ListEvalsRequest, ai.stigmer.agentic.eval.v1.EvalList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.ListEvalsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.EvalList.getDefaultInstance()))
              .setSchemaDescriptor(new EvalQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.ListEvalVersionsInput,
      ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse> getListVersionsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listVersions",
      requestType = ai.stigmer.agentic.eval.v1.ListEvalVersionsInput.class,
      responseType = ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.ListEvalVersionsInput,
      ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse> getListVersionsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.ListEvalVersionsInput, ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse> getListVersionsMethod;
    if ((getListVersionsMethod = EvalQueryControllerGrpc.getListVersionsMethod) == null) {
      synchronized (EvalQueryControllerGrpc.class) {
        if ((getListVersionsMethod = EvalQueryControllerGrpc.getListVersionsMethod) == null) {
          EvalQueryControllerGrpc.getListVersionsMethod = getListVersionsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.eval.v1.ListEvalVersionsInput, ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listVersions"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.ListEvalVersionsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse.getDefaultInstance()))
              .setSchemaDescriptor(new EvalQueryControllerMethodDescriptorSupplier("listVersions"))
              .build();
        }
      }
    }
    return getListVersionsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.eval.v1.EvalArchive> getDownloadMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "download",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.eval.v1.EvalArchive.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.eval.v1.EvalArchive> getDownloadMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.eval.v1.EvalArchive> getDownloadMethod;
    if ((getDownloadMethod = EvalQueryControllerGrpc.getDownloadMethod) == null) {
      synchronized (EvalQueryControllerGrpc.class) {
        if ((getDownloadMethod = EvalQueryControllerGrpc.getDownloadMethod) == null) {
          EvalQueryControllerGrpc.getDownloadMethod = getDownloadMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.eval.v1.EvalArchive>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "download"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.EvalArchive.getDefaultInstance()))
              .setSchemaDescriptor(new EvalQueryControllerMethodDescriptorSupplier("download"))
              .build();
        }
      }
    }
    return getDownloadMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl> getGetDownloadUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getDownloadUrl",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl> getGetDownloadUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl> getGetDownloadUrlMethod;
    if ((getGetDownloadUrlMethod = EvalQueryControllerGrpc.getGetDownloadUrlMethod) == null) {
      synchronized (EvalQueryControllerGrpc.class) {
        if ((getGetDownloadUrlMethod = EvalQueryControllerGrpc.getGetDownloadUrlMethod) == null) {
          EvalQueryControllerGrpc.getGetDownloadUrlMethod = getGetDownloadUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getDownloadUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl.getDefaultInstance()))
              .setSchemaDescriptor(new EvalQueryControllerMethodDescriptorSupplier("getDownloadUrl"))
              .build();
        }
      }
    }
    return getGetDownloadUrlMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest,
      ai.stigmer.agentic.eval.v1.EvalCaseArchive> getBuildCaseFromRunMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "buildCaseFromRun",
      requestType = ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest.class,
      responseType = ai.stigmer.agentic.eval.v1.EvalCaseArchive.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest,
      ai.stigmer.agentic.eval.v1.EvalCaseArchive> getBuildCaseFromRunMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest, ai.stigmer.agentic.eval.v1.EvalCaseArchive> getBuildCaseFromRunMethod;
    if ((getBuildCaseFromRunMethod = EvalQueryControllerGrpc.getBuildCaseFromRunMethod) == null) {
      synchronized (EvalQueryControllerGrpc.class) {
        if ((getBuildCaseFromRunMethod = EvalQueryControllerGrpc.getBuildCaseFromRunMethod) == null) {
          EvalQueryControllerGrpc.getBuildCaseFromRunMethod = getBuildCaseFromRunMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest, ai.stigmer.agentic.eval.v1.EvalCaseArchive>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "buildCaseFromRun"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.eval.v1.EvalCaseArchive.getDefaultInstance()))
              .setSchemaDescriptor(new EvalQueryControllerMethodDescriptorSupplier("buildCaseFromRun"))
              .build();
        }
      }
    }
    return getBuildCaseFromRunMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static EvalQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalQueryControllerStub>() {
        @java.lang.Override
        public EvalQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalQueryControllerStub(channel, callOptions);
        }
      };
    return EvalQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static EvalQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public EvalQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return EvalQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static EvalQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalQueryControllerBlockingStub>() {
        @java.lang.Override
        public EvalQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return EvalQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static EvalQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvalQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvalQueryControllerFutureStub>() {
        @java.lang.Override
        public EvalQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvalQueryControllerFutureStub(channel, callOptions);
        }
      };
    return EvalQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * EvalQueryController handles read operations for evals.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.eval.v1.EvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an eval by API resource reference, at a version.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g. "stable") → Resolves to the version holding this tag
     * - SHA-256 digest (64 hex chars) → Returns the exact immutable version
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List an organization's evals, newest first.
     * Returns the evals of the input org that the caller may view, one page at
     * a time.
     * </pre>
     */
    default void list(ai.stigmer.agentic.eval.v1.ListEvalsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * List an eval's versions, newest first, each with its digest, tag,
     * message and who pushed it.
     * </pre>
     */
    default void listVersions(ai.stigmer.agentic.eval.v1.ListEvalVersionsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListVersionsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Download one version of an eval as the ZIP archive it was pushed as.
     * The reference's version picks it as getByReference does; none is the
     * current version. Larger archives ride getDownloadUrl.
     * </pre>
     */
    default void download(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalArchive> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDownloadMethod(), responseObserver);
    }

    /**
     * <pre>
     * Mint a URL for downloading one version of an eval over HTTP.
     * Preferred over download for anything that might exceed the gRPC
     * message-size cap (10MB). The reference's version picks the version as
     * getByReference does.
     * </pre>
     */
    default void getDownloadUrl(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetDownloadUrlMethod(), responseObserver);
    }

    /**
     * <pre>
     * Build an eval case from a run, to keep on disk or push in an eval.
     * The case is the turn the run answered: its request as the prompt, the
     * conversation before it as the case's history (so the case resumes where
     * the person was), each MCP tool answer the run got as a fixed mock under
     * the server name the turn gave it, and a rubric to fill in, seeded with
     * why the run went wrong (an AI judge's failing reason, or the caller's
     * own thumbs-down note). It never carries a verdict of its own.
     * Error Cases:
     * - NOT_FOUND: no such run
     * - PERMISSION_DENIED: the caller may not view the run
     * - FAILED_PRECONDITION: the run has not ended
     * - RESOURCE_EXHAUSTED: the case is too large to answer inline; add it
     *   to an eval with addCaseFromRun, which writes it on the server
     * </pre>
     */
    default void buildCaseFromRun(ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalCaseArchive> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getBuildCaseFromRunMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service EvalQueryController.
   * <pre>
   * EvalQueryController handles read operations for evals.
   * </pre>
   */
  public static abstract class EvalQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return EvalQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service EvalQueryController.
   * <pre>
   * EvalQueryController handles read operations for evals.
   * </pre>
   */
  public static final class EvalQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<EvalQueryControllerStub> {
    private EvalQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.eval.v1.EvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an eval by API resource reference, at a version.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g. "stable") → Resolves to the version holding this tag
     * - SHA-256 digest (64 hex chars) → Returns the exact immutable version
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List an organization's evals, newest first.
     * Returns the evals of the input org that the caller may view, one page at
     * a time.
     * </pre>
     */
    public void list(ai.stigmer.agentic.eval.v1.ListEvalsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List an eval's versions, newest first, each with its digest, tag,
     * message and who pushed it.
     * </pre>
     */
    public void listVersions(ai.stigmer.agentic.eval.v1.ListEvalVersionsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListVersionsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Download one version of an eval as the ZIP archive it was pushed as.
     * The reference's version picks it as getByReference does; none is the
     * current version. Larger archives ride getDownloadUrl.
     * </pre>
     */
    public void download(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalArchive> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDownloadMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Mint a URL for downloading one version of an eval over HTTP.
     * Preferred over download for anything that might exceed the gRPC
     * message-size cap (10MB). The reference's version picks the version as
     * getByReference does.
     * </pre>
     */
    public void getDownloadUrl(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetDownloadUrlMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Build an eval case from a run, to keep on disk or push in an eval.
     * The case is the turn the run answered: its request as the prompt, the
     * conversation before it as the case's history (so the case resumes where
     * the person was), each MCP tool answer the run got as a fixed mock under
     * the server name the turn gave it, and a rubric to fill in, seeded with
     * why the run went wrong (an AI judge's failing reason, or the caller's
     * own thumbs-down note). It never carries a verdict of its own.
     * Error Cases:
     * - NOT_FOUND: no such run
     * - PERMISSION_DENIED: the caller may not view the run
     * - FAILED_PRECONDITION: the run has not ended
     * - RESOURCE_EXHAUSTED: the case is too large to answer inline; add it
     *   to an eval with addCaseFromRun, which writes it on the server
     * </pre>
     */
    public void buildCaseFromRun(ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalCaseArchive> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getBuildCaseFromRunMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service EvalQueryController.
   * <pre>
   * EvalQueryController handles read operations for evals.
   * </pre>
   */
  public static final class EvalQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<EvalQueryControllerBlockingV2Stub> {
    private EvalQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval get(ai.stigmer.agentic.eval.v1.EvalId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an eval by API resource reference, at a version.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g. "stable") → Resolves to the version holding this tag
     * - SHA-256 digest (64 hex chars) → Returns the exact immutable version
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an organization's evals, newest first.
     * Returns the evals of the input org that the caller may view, one page at
     * a time.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.EvalList list(ai.stigmer.agentic.eval.v1.ListEvalsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an eval's versions, newest first, each with its digest, tag,
     * message and who pushed it.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse listVersions(ai.stigmer.agentic.eval.v1.ListEvalVersionsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListVersionsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Download one version of an eval as the ZIP archive it was pushed as.
     * The reference's version picks it as getByReference does; none is the
     * current version. Larger archives ride getDownloadUrl.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.EvalArchive download(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDownloadMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a URL for downloading one version of an eval over HTTP.
     * Preferred over download for anything that might exceed the gRPC
     * message-size cap (10MB). The reference's version picks the version as
     * getByReference does.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl getDownloadUrl(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetDownloadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Build an eval case from a run, to keep on disk or push in an eval.
     * The case is the turn the run answered: its request as the prompt, the
     * conversation before it as the case's history (so the case resumes where
     * the person was), each MCP tool answer the run got as a fixed mock under
     * the server name the turn gave it, and a rubric to fill in, seeded with
     * why the run went wrong (an AI judge's failing reason, or the caller's
     * own thumbs-down note). It never carries a verdict of its own.
     * Error Cases:
     * - NOT_FOUND: no such run
     * - PERMISSION_DENIED: the caller may not view the run
     * - FAILED_PRECONDITION: the run has not ended
     * - RESOURCE_EXHAUSTED: the case is too large to answer inline; add it
     *   to an eval with addCaseFromRun, which writes it on the server
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.EvalCaseArchive buildCaseFromRun(ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getBuildCaseFromRunMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service EvalQueryController.
   * <pre>
   * EvalQueryController handles read operations for evals.
   * </pre>
   */
  public static final class EvalQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<EvalQueryControllerBlockingStub> {
    private EvalQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval get(ai.stigmer.agentic.eval.v1.EvalId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an eval by API resource reference, at a version.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g. "stable") → Resolves to the version holding this tag
     * - SHA-256 digest (64 hex chars) → Returns the exact immutable version
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.Eval getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an organization's evals, newest first.
     * Returns the evals of the input org that the caller may view, one page at
     * a time.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.EvalList list(ai.stigmer.agentic.eval.v1.ListEvalsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an eval's versions, newest first, each with its digest, tag,
     * message and who pushed it.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse listVersions(ai.stigmer.agentic.eval.v1.ListEvalVersionsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListVersionsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Download one version of an eval as the ZIP archive it was pushed as.
     * The reference's version picks it as getByReference does; none is the
     * current version. Larger archives ride getDownloadUrl.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.EvalArchive download(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDownloadMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a URL for downloading one version of an eval over HTTP.
     * Preferred over download for anything that might exceed the gRPC
     * message-size cap (10MB). The reference's version picks the version as
     * getByReference does.
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl getDownloadUrl(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetDownloadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Build an eval case from a run, to keep on disk or push in an eval.
     * The case is the turn the run answered: its request as the prompt, the
     * conversation before it as the case's history (so the case resumes where
     * the person was), each MCP tool answer the run got as a fixed mock under
     * the server name the turn gave it, and a rubric to fill in, seeded with
     * why the run went wrong (an AI judge's failing reason, or the caller's
     * own thumbs-down note). It never carries a verdict of its own.
     * Error Cases:
     * - NOT_FOUND: no such run
     * - PERMISSION_DENIED: the caller may not view the run
     * - FAILED_PRECONDITION: the run has not ended
     * - RESOURCE_EXHAUSTED: the case is too large to answer inline; add it
     *   to an eval with addCaseFromRun, which writes it on the server
     * </pre>
     */
    public ai.stigmer.agentic.eval.v1.EvalCaseArchive buildCaseFromRun(ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getBuildCaseFromRunMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service EvalQueryController.
   * <pre>
   * EvalQueryController handles read operations for evals.
   * </pre>
   */
  public static final class EvalQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<EvalQueryControllerFutureStub> {
    private EvalQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvalQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvalQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single eval by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.Eval> get(
        ai.stigmer.agentic.eval.v1.EvalId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an eval by API resource reference, at a version.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g. "stable") → Resolves to the version holding this tag
     * - SHA-256 digest (64 hex chars) → Returns the exact immutable version
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.Eval> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List an organization's evals, newest first.
     * Returns the evals of the input org that the caller may view, one page at
     * a time.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.EvalList> list(
        ai.stigmer.agentic.eval.v1.ListEvalsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List an eval's versions, newest first, each with its digest, tag,
     * message and who pushed it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse> listVersions(
        ai.stigmer.agentic.eval.v1.ListEvalVersionsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListVersionsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Download one version of an eval as the ZIP archive it was pushed as.
     * The reference's version picks it as getByReference does; none is the
     * current version. Larger archives ride getDownloadUrl.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.EvalArchive> download(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDownloadMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Mint a URL for downloading one version of an eval over HTTP.
     * Preferred over download for anything that might exceed the gRPC
     * message-size cap (10MB). The reference's version picks the version as
     * getByReference does.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl> getDownloadUrl(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetDownloadUrlMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Build an eval case from a run, to keep on disk or push in an eval.
     * The case is the turn the run answered: its request as the prompt, the
     * conversation before it as the case's history (so the case resumes where
     * the person was), each MCP tool answer the run got as a fixed mock under
     * the server name the turn gave it, and a rubric to fill in, seeded with
     * why the run went wrong (an AI judge's failing reason, or the caller's
     * own thumbs-down note). It never carries a verdict of its own.
     * Error Cases:
     * - NOT_FOUND: no such run
     * - PERMISSION_DENIED: the caller may not view the run
     * - FAILED_PRECONDITION: the run has not ended
     * - RESOURCE_EXHAUSTED: the case is too large to answer inline; add it
     *   to an eval with addCaseFromRun, which writes it on the server
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.eval.v1.EvalCaseArchive> buildCaseFromRun(
        ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getBuildCaseFromRunMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_LIST = 2;
  private static final int METHODID_LIST_VERSIONS = 3;
  private static final int METHODID_DOWNLOAD = 4;
  private static final int METHODID_GET_DOWNLOAD_URL = 5;
  private static final int METHODID_BUILD_CASE_FROM_RUN = 6;

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
          serviceImpl.get((ai.stigmer.agentic.eval.v1.EvalId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.Eval>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.eval.v1.ListEvalsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalList>) responseObserver);
          break;
        case METHODID_LIST_VERSIONS:
          serviceImpl.listVersions((ai.stigmer.agentic.eval.v1.ListEvalVersionsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse>) responseObserver);
          break;
        case METHODID_DOWNLOAD:
          serviceImpl.download((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalArchive>) responseObserver);
          break;
        case METHODID_GET_DOWNLOAD_URL:
          serviceImpl.getDownloadUrl((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl>) responseObserver);
          break;
        case METHODID_BUILD_CASE_FROM_RUN:
          serviceImpl.buildCaseFromRun((ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.eval.v1.EvalCaseArchive>) responseObserver);
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
              ai.stigmer.agentic.eval.v1.EvalId,
              ai.stigmer.agentic.eval.v1.Eval>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.eval.v1.Eval>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.eval.v1.ListEvalsRequest,
              ai.stigmer.agentic.eval.v1.EvalList>(
                service, METHODID_LIST)))
        .addMethod(
          getListVersionsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.eval.v1.ListEvalVersionsInput,
              ai.stigmer.agentic.eval.v1.ListEvalVersionsResponse>(
                service, METHODID_LIST_VERSIONS)))
        .addMethod(
          getDownloadMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.eval.v1.EvalArchive>(
                service, METHODID_DOWNLOAD)))
        .addMethod(
          getGetDownloadUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.eval.v1.EvalArchiveDownloadUrl>(
                service, METHODID_GET_DOWNLOAD_URL)))
        .addMethod(
          getBuildCaseFromRunMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.eval.v1.BuildEvalCaseFromRunRequest,
              ai.stigmer.agentic.eval.v1.EvalCaseArchive>(
                service, METHODID_BUILD_CASE_FROM_RUN)))
        .build();
  }

  private static abstract class EvalQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    EvalQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.eval.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("EvalQueryController");
    }
  }

  private static final class EvalQueryControllerFileDescriptorSupplier
      extends EvalQueryControllerBaseDescriptorSupplier {
    EvalQueryControllerFileDescriptorSupplier() {}
  }

  private static final class EvalQueryControllerMethodDescriptorSupplier
      extends EvalQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    EvalQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (EvalQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new EvalQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListMethod())
              .addMethod(getListVersionsMethod())
              .addMethod(getDownloadMethod())
              .addMethod(getGetDownloadUrlMethod())
              .addMethod(getBuildCaseFromRunMethod())
              .build();
        }
      }
    }
    return result;
  }
}
