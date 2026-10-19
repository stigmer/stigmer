package ai.stigmer.agentic.file.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * FileCommandController handles write operations for Files.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class FileCommandControllerGrpc {

  private FileCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.file.v1.FileCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.UploadFileInput,
      ai.stigmer.agentic.file.v1.File> getUploadMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "upload",
      requestType = ai.stigmer.agentic.file.v1.UploadFileInput.class,
      responseType = ai.stigmer.agentic.file.v1.File.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.UploadFileInput,
      ai.stigmer.agentic.file.v1.File> getUploadMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.UploadFileInput, ai.stigmer.agentic.file.v1.File> getUploadMethod;
    if ((getUploadMethod = FileCommandControllerGrpc.getUploadMethod) == null) {
      synchronized (FileCommandControllerGrpc.class) {
        if ((getUploadMethod = FileCommandControllerGrpc.getUploadMethod) == null) {
          FileCommandControllerGrpc.getUploadMethod = getUploadMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.file.v1.UploadFileInput, ai.stigmer.agentic.file.v1.File>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "upload"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.UploadFileInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.File.getDefaultInstance()))
              .setSchemaDescriptor(new FileCommandControllerMethodDescriptorSupplier("upload"))
              .build();
        }
      }
    }
    return getUploadMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput,
      ai.stigmer.agentic.file.v1.FileUploadUrl> getCreateUploadUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "createUploadUrl",
      requestType = ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput.class,
      responseType = ai.stigmer.agentic.file.v1.FileUploadUrl.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput,
      ai.stigmer.agentic.file.v1.FileUploadUrl> getCreateUploadUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput, ai.stigmer.agentic.file.v1.FileUploadUrl> getCreateUploadUrlMethod;
    if ((getCreateUploadUrlMethod = FileCommandControllerGrpc.getCreateUploadUrlMethod) == null) {
      synchronized (FileCommandControllerGrpc.class) {
        if ((getCreateUploadUrlMethod = FileCommandControllerGrpc.getCreateUploadUrlMethod) == null) {
          FileCommandControllerGrpc.getCreateUploadUrlMethod = getCreateUploadUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput, ai.stigmer.agentic.file.v1.FileUploadUrl>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "createUploadUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.FileUploadUrl.getDefaultInstance()))
              .setSchemaDescriptor(new FileCommandControllerMethodDescriptorSupplier("createUploadUrl"))
              .build();
        }
      }
    }
    return getCreateUploadUrlMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.UpdateFileInput,
      ai.stigmer.agentic.file.v1.File> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.file.v1.UpdateFileInput.class,
      responseType = ai.stigmer.agentic.file.v1.File.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.UpdateFileInput,
      ai.stigmer.agentic.file.v1.File> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.UpdateFileInput, ai.stigmer.agentic.file.v1.File> getUpdateMethod;
    if ((getUpdateMethod = FileCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (FileCommandControllerGrpc.class) {
        if ((getUpdateMethod = FileCommandControllerGrpc.getUpdateMethod) == null) {
          FileCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.file.v1.UpdateFileInput, ai.stigmer.agentic.file.v1.File>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.UpdateFileInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.File.getDefaultInstance()))
              .setSchemaDescriptor(new FileCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.file.v1.File> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.file.v1.File.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.file.v1.File> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.file.v1.File> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = FileCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (FileCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = FileCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          FileCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.file.v1.File>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.File.getDefaultInstance()))
              .setSchemaDescriptor(new FileCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.FileId,
      ai.stigmer.agentic.file.v1.File> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.file.v1.FileId.class,
      responseType = ai.stigmer.agentic.file.v1.File.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.FileId,
      ai.stigmer.agentic.file.v1.File> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.FileId, ai.stigmer.agentic.file.v1.File> getDeleteMethod;
    if ((getDeleteMethod = FileCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (FileCommandControllerGrpc.class) {
        if ((getDeleteMethod = FileCommandControllerGrpc.getDeleteMethod) == null) {
          FileCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.file.v1.FileId, ai.stigmer.agentic.file.v1.File>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.FileId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.File.getDefaultInstance()))
              .setSchemaDescriptor(new FileCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static FileCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FileCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FileCommandControllerStub>() {
        @java.lang.Override
        public FileCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FileCommandControllerStub(channel, callOptions);
        }
      };
    return FileCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static FileCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FileCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FileCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public FileCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FileCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return FileCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static FileCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FileCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FileCommandControllerBlockingStub>() {
        @java.lang.Override
        public FileCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FileCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return FileCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static FileCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FileCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FileCommandControllerFutureStub>() {
        @java.lang.Override
        public FileCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FileCommandControllerFutureStub(channel, callOptions);
        }
      };
    return FileCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * FileCommandController handles write operations for Files.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Upload a File: its bytes inline, or the reference of bytes already put
     * to a URL createUploadUrl returned. Returns the File with its new id.
     * With session_id, the File belongs to that conversation: whoever may
     * send it a message may upload into it, and org must be the
     * conversation's organization (FAILED_PRECONDITION otherwise). Without
     * it, the File is the uploader's own, private until shared, and any
     * member or guest of the organization may upload one.
     * A file over the server's limit (500 MB unless the operator set
     * another) is refused with INVALID_ARGUMENT. An upload_ref that is
     * unknown, expired or already used is refused with FAILED_PRECONDITION,
     * and so is one whose bytes differ in size from the size createUploadUrl
     * was given.
     * </pre>
     */
    default void upload(ai.stigmer.agentic.file.v1.UploadFileInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUploadMethod(), responseObserver);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use URL to put a file's bytes to, for a file
     * too large to upload inline. Then PUT exactly size_bytes bytes to the
     * URL and call upload with the returned upload_ref.
     * A size over the server's limit is refused here, before any bytes move.
     * </pre>
     */
    default void createUploadUrl(ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.FileUploadUrl> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateUploadUrlMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a File's labels and tags: the fields update_mask names change,
     * every other field keeps its stored value. A File's name, type and
     * bytes never change, so any other path is refused with INVALID_ARGUMENT.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the File changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the File kept changing while the update was being
     *     saved: try again. No metadata.
     * </pre>
     */
    default void update(ai.stigmer.agentic.file.v1.UpdateFileInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of a File.
     * Setting org lets every member of the organization see the File.
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a File. Its bytes are removed once no other File shares them.
     * Its uploader may delete it, and so may the owner of the conversation
     * it belongs to.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.file.v1.FileId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service FileCommandController.
   * <pre>
   * FileCommandController handles write operations for Files.
   * </pre>
   */
  public static abstract class FileCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return FileCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service FileCommandController.
   * <pre>
   * FileCommandController handles write operations for Files.
   * </pre>
   */
  public static final class FileCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<FileCommandControllerStub> {
    private FileCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FileCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FileCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Upload a File: its bytes inline, or the reference of bytes already put
     * to a URL createUploadUrl returned. Returns the File with its new id.
     * With session_id, the File belongs to that conversation: whoever may
     * send it a message may upload into it, and org must be the
     * conversation's organization (FAILED_PRECONDITION otherwise). Without
     * it, the File is the uploader's own, private until shared, and any
     * member or guest of the organization may upload one.
     * A file over the server's limit (500 MB unless the operator set
     * another) is refused with INVALID_ARGUMENT. An upload_ref that is
     * unknown, expired or already used is refused with FAILED_PRECONDITION,
     * and so is one whose bytes differ in size from the size createUploadUrl
     * was given.
     * </pre>
     */
    public void upload(ai.stigmer.agentic.file.v1.UploadFileInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUploadMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use URL to put a file's bytes to, for a file
     * too large to upload inline. Then PUT exactly size_bytes bytes to the
     * URL and call upload with the returned upload_ref.
     * A size over the server's limit is refused here, before any bytes move.
     * </pre>
     */
    public void createUploadUrl(ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.FileUploadUrl> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateUploadUrlMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a File's labels and tags: the fields update_mask names change,
     * every other field keeps its stored value. A File's name, type and
     * bytes never change, so any other path is refused with INVALID_ARGUMENT.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the File changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the File kept changing while the update was being
     *     saved: try again. No metadata.
     * </pre>
     */
    public void update(ai.stigmer.agentic.file.v1.UpdateFileInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of a File.
     * Setting org lets every member of the organization see the File.
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a File. Its bytes are removed once no other File shares them.
     * Its uploader may delete it, and so may the owner of the conversation
     * it belongs to.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.file.v1.FileId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service FileCommandController.
   * <pre>
   * FileCommandController handles write operations for Files.
   * </pre>
   */
  public static final class FileCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<FileCommandControllerBlockingV2Stub> {
    private FileCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FileCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FileCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Upload a File: its bytes inline, or the reference of bytes already put
     * to a URL createUploadUrl returned. Returns the File with its new id.
     * With session_id, the File belongs to that conversation: whoever may
     * send it a message may upload into it, and org must be the
     * conversation's organization (FAILED_PRECONDITION otherwise). Without
     * it, the File is the uploader's own, private until shared, and any
     * member or guest of the organization may upload one.
     * A file over the server's limit (500 MB unless the operator set
     * another) is refused with INVALID_ARGUMENT. An upload_ref that is
     * unknown, expired or already used is refused with FAILED_PRECONDITION,
     * and so is one whose bytes differ in size from the size createUploadUrl
     * was given.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.File upload(ai.stigmer.agentic.file.v1.UploadFileInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUploadMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use URL to put a file's bytes to, for a file
     * too large to upload inline. Then PUT exactly size_bytes bytes to the
     * URL and call upload with the returned upload_ref.
     * A size over the server's limit is refused here, before any bytes move.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.FileUploadUrl createUploadUrl(ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateUploadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a File's labels and tags: the fields update_mask names change,
     * every other field keeps its stored value. A File's name, type and
     * bytes never change, so any other path is refused with INVALID_ARGUMENT.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the File changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the File kept changing while the update was being
     *     saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.File update(ai.stigmer.agentic.file.v1.UpdateFileInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of a File.
     * Setting org lets every member of the organization see the File.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.File updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a File. Its bytes are removed once no other File shares them.
     * Its uploader may delete it, and so may the owner of the conversation
     * it belongs to.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.File delete(ai.stigmer.agentic.file.v1.FileId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service FileCommandController.
   * <pre>
   * FileCommandController handles write operations for Files.
   * </pre>
   */
  public static final class FileCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<FileCommandControllerBlockingStub> {
    private FileCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FileCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FileCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Upload a File: its bytes inline, or the reference of bytes already put
     * to a URL createUploadUrl returned. Returns the File with its new id.
     * With session_id, the File belongs to that conversation: whoever may
     * send it a message may upload into it, and org must be the
     * conversation's organization (FAILED_PRECONDITION otherwise). Without
     * it, the File is the uploader's own, private until shared, and any
     * member or guest of the organization may upload one.
     * A file over the server's limit (500 MB unless the operator set
     * another) is refused with INVALID_ARGUMENT. An upload_ref that is
     * unknown, expired or already used is refused with FAILED_PRECONDITION,
     * and so is one whose bytes differ in size from the size createUploadUrl
     * was given.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.File upload(ai.stigmer.agentic.file.v1.UploadFileInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUploadMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use URL to put a file's bytes to, for a file
     * too large to upload inline. Then PUT exactly size_bytes bytes to the
     * URL and call upload with the returned upload_ref.
     * A size over the server's limit is refused here, before any bytes move.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.FileUploadUrl createUploadUrl(ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateUploadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a File's labels and tags: the fields update_mask names change,
     * every other field keeps its stored value. A File's name, type and
     * bytes never change, so any other path is refused with INVALID_ARGUMENT.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the File changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the File kept changing while the update was being
     *     saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.File update(ai.stigmer.agentic.file.v1.UpdateFileInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of a File.
     * Setting org lets every member of the organization see the File.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.File updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a File. Its bytes are removed once no other File shares them.
     * Its uploader may delete it, and so may the owner of the conversation
     * it belongs to.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.File delete(ai.stigmer.agentic.file.v1.FileId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service FileCommandController.
   * <pre>
   * FileCommandController handles write operations for Files.
   * </pre>
   */
  public static final class FileCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<FileCommandControllerFutureStub> {
    private FileCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FileCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FileCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Upload a File: its bytes inline, or the reference of bytes already put
     * to a URL createUploadUrl returned. Returns the File with its new id.
     * With session_id, the File belongs to that conversation: whoever may
     * send it a message may upload into it, and org must be the
     * conversation's organization (FAILED_PRECONDITION otherwise). Without
     * it, the File is the uploader's own, private until shared, and any
     * member or guest of the organization may upload one.
     * A file over the server's limit (500 MB unless the operator set
     * another) is refused with INVALID_ARGUMENT. An upload_ref that is
     * unknown, expired or already used is refused with FAILED_PRECONDITION,
     * and so is one whose bytes differ in size from the size createUploadUrl
     * was given.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.file.v1.File> upload(
        ai.stigmer.agentic.file.v1.UploadFileInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUploadMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use URL to put a file's bytes to, for a file
     * too large to upload inline. Then PUT exactly size_bytes bytes to the
     * URL and call upload with the returned upload_ref.
     * A size over the server's limit is refused here, before any bytes move.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.file.v1.FileUploadUrl> createUploadUrl(
        ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateUploadUrlMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a File's labels and tags: the fields update_mask names change,
     * every other field keeps its stored value. A File's name, type and
     * bytes never change, so any other path is refused with INVALID_ARGUMENT.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the File changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the File kept changing while the update was being
     *     saved: try again. No metadata.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.file.v1.File> update(
        ai.stigmer.agentic.file.v1.UpdateFileInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of a File.
     * Setting org lets every member of the organization see the File.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.file.v1.File> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a File. Its bytes are removed once no other File shares them.
     * Its uploader may delete it, and so may the owner of the conversation
     * it belongs to.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.file.v1.File> delete(
        ai.stigmer.agentic.file.v1.FileId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_UPLOAD = 0;
  private static final int METHODID_CREATE_UPLOAD_URL = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_UPDATE_VISIBILITY = 3;
  private static final int METHODID_DELETE = 4;

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
        case METHODID_UPLOAD:
          serviceImpl.upload((ai.stigmer.agentic.file.v1.UploadFileInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File>) responseObserver);
          break;
        case METHODID_CREATE_UPLOAD_URL:
          serviceImpl.createUploadUrl((ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.FileUploadUrl>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.file.v1.UpdateFileInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.file.v1.FileId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File>) responseObserver);
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
          getUploadMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.file.v1.UploadFileInput,
              ai.stigmer.agentic.file.v1.File>(
                service, METHODID_UPLOAD)))
        .addMethod(
          getCreateUploadUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.file.v1.CreateFileUploadUrlInput,
              ai.stigmer.agentic.file.v1.FileUploadUrl>(
                service, METHODID_CREATE_UPLOAD_URL)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.file.v1.UpdateFileInput,
              ai.stigmer.agentic.file.v1.File>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.file.v1.File>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.file.v1.FileId,
              ai.stigmer.agentic.file.v1.File>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class FileCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    FileCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.file.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("FileCommandController");
    }
  }

  private static final class FileCommandControllerFileDescriptorSupplier
      extends FileCommandControllerBaseDescriptorSupplier {
    FileCommandControllerFileDescriptorSupplier() {}
  }

  private static final class FileCommandControllerMethodDescriptorSupplier
      extends FileCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    FileCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (FileCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new FileCommandControllerFileDescriptorSupplier())
              .addMethod(getUploadMethod())
              .addMethod(getCreateUploadUrlMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
