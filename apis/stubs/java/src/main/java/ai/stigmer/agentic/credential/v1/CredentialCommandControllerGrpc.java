package ai.stigmer.agentic.credential.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * CredentialCommandController handles write operations for credentials.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class CredentialCommandControllerGrpc {

  private CredentialCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.credential.v1.CredentialCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.Credential,
      ai.stigmer.agentic.credential.v1.Credential> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.credential.v1.Credential.class,
      responseType = ai.stigmer.agentic.credential.v1.Credential.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.Credential,
      ai.stigmer.agentic.credential.v1.Credential> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.Credential, ai.stigmer.agentic.credential.v1.Credential> getCreateMethod;
    if ((getCreateMethod = CredentialCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (CredentialCommandControllerGrpc.class) {
        if ((getCreateMethod = CredentialCommandControllerGrpc.getCreateMethod) == null) {
          CredentialCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.credential.v1.Credential, ai.stigmer.agentic.credential.v1.Credential>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.Credential.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.Credential.getDefaultInstance()))
              .setSchemaDescriptor(new CredentialCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.Credential,
      ai.stigmer.agentic.credential.v1.Credential> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.credential.v1.Credential.class,
      responseType = ai.stigmer.agentic.credential.v1.Credential.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.Credential,
      ai.stigmer.agentic.credential.v1.Credential> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.Credential, ai.stigmer.agentic.credential.v1.Credential> getUpdateMethod;
    if ((getUpdateMethod = CredentialCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (CredentialCommandControllerGrpc.class) {
        if ((getUpdateMethod = CredentialCommandControllerGrpc.getUpdateMethod) == null) {
          CredentialCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.credential.v1.Credential, ai.stigmer.agentic.credential.v1.Credential>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.Credential.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.Credential.getDefaultInstance()))
              .setSchemaDescriptor(new CredentialCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.credential.v1.Credential> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.agentic.credential.v1.Credential.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.credential.v1.Credential> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.credential.v1.Credential> getDeleteMethod;
    if ((getDeleteMethod = CredentialCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (CredentialCommandControllerGrpc.class) {
        if ((getDeleteMethod = CredentialCommandControllerGrpc.getDeleteMethod) == null) {
          CredentialCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.credential.v1.Credential>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.Credential.getDefaultInstance()))
              .setSchemaDescriptor(new CredentialCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput,
      ai.stigmer.agentic.credential.v1.Credential> getSetFieldsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "setFields",
      requestType = ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput.class,
      responseType = ai.stigmer.agentic.credential.v1.Credential.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput,
      ai.stigmer.agentic.credential.v1.Credential> getSetFieldsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput, ai.stigmer.agentic.credential.v1.Credential> getSetFieldsMethod;
    if ((getSetFieldsMethod = CredentialCommandControllerGrpc.getSetFieldsMethod) == null) {
      synchronized (CredentialCommandControllerGrpc.class) {
        if ((getSetFieldsMethod = CredentialCommandControllerGrpc.getSetFieldsMethod) == null) {
          CredentialCommandControllerGrpc.getSetFieldsMethod = getSetFieldsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput, ai.stigmer.agentic.credential.v1.Credential>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "setFields"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.Credential.getDefaultInstance()))
              .setSchemaDescriptor(new CredentialCommandControllerMethodDescriptorSupplier("setFields"))
              .build();
        }
      }
    }
    return getSetFieldsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput,
      ai.stigmer.agentic.credential.v1.Credential> getRemoveFieldsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "removeFields",
      requestType = ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput.class,
      responseType = ai.stigmer.agentic.credential.v1.Credential.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput,
      ai.stigmer.agentic.credential.v1.Credential> getRemoveFieldsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput, ai.stigmer.agentic.credential.v1.Credential> getRemoveFieldsMethod;
    if ((getRemoveFieldsMethod = CredentialCommandControllerGrpc.getRemoveFieldsMethod) == null) {
      synchronized (CredentialCommandControllerGrpc.class) {
        if ((getRemoveFieldsMethod = CredentialCommandControllerGrpc.getRemoveFieldsMethod) == null) {
          CredentialCommandControllerGrpc.getRemoveFieldsMethod = getRemoveFieldsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput, ai.stigmer.agentic.credential.v1.Credential>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "removeFields"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.Credential.getDefaultInstance()))
              .setSchemaDescriptor(new CredentialCommandControllerMethodDescriptorSupplier("removeFields"))
              .build();
        }
      }
    }
    return getRemoveFieldsMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static CredentialCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CredentialCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CredentialCommandControllerStub>() {
        @java.lang.Override
        public CredentialCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CredentialCommandControllerStub(channel, callOptions);
        }
      };
    return CredentialCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static CredentialCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CredentialCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CredentialCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public CredentialCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CredentialCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return CredentialCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static CredentialCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CredentialCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CredentialCommandControllerBlockingStub>() {
        @java.lang.Override
        public CredentialCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CredentialCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return CredentialCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static CredentialCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CredentialCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CredentialCommandControllerFutureStub>() {
        @java.lang.Override
        public CredentialCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CredentialCommandControllerFutureStub(channel, callOptions);
        }
      };
    return CredentialCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * CredentialCommandController handles write operations for credentials.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create a credential for yourself or for your organization.
     * </pre>
     */
    default void create(ai.stigmer.agentic.credential.v1.Credential request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a credential's name, description, fields and what it serves.
     * The owner never changes. A secret field sent back as the redaction
     * marker keeps its stored value.
     * </pre>
     */
    default void update(ai.stigmer.agentic.credential.v1.Credential request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a credential.
     * Runs that would have used it are refused at create until another
     * credential provides the values.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Add or replace fields of a credential, keeping the fields not named.
     * Refused on a credential written by an MCP server sign-in.
     * </pre>
     */
    default void setFields(ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSetFieldsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Remove fields of a credential by name.
     * Refused on a credential written by an MCP server sign-in.
     * </pre>
     */
    default void removeFields(ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRemoveFieldsMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service CredentialCommandController.
   * <pre>
   * CredentialCommandController handles write operations for credentials.
   * </pre>
   */
  public static abstract class CredentialCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return CredentialCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service CredentialCommandController.
   * <pre>
   * CredentialCommandController handles write operations for credentials.
   * </pre>
   */
  public static final class CredentialCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<CredentialCommandControllerStub> {
    private CredentialCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CredentialCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CredentialCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a credential for yourself or for your organization.
     * </pre>
     */
    public void create(ai.stigmer.agentic.credential.v1.Credential request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a credential's name, description, fields and what it serves.
     * The owner never changes. A secret field sent back as the redaction
     * marker keeps its stored value.
     * </pre>
     */
    public void update(ai.stigmer.agentic.credential.v1.Credential request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a credential.
     * Runs that would have used it are refused at create until another
     * credential provides the values.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Add or replace fields of a credential, keeping the fields not named.
     * Refused on a credential written by an MCP server sign-in.
     * </pre>
     */
    public void setFields(ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSetFieldsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Remove fields of a credential by name.
     * Refused on a credential written by an MCP server sign-in.
     * </pre>
     */
    public void removeFields(ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRemoveFieldsMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service CredentialCommandController.
   * <pre>
   * CredentialCommandController handles write operations for credentials.
   * </pre>
   */
  public static final class CredentialCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<CredentialCommandControllerBlockingV2Stub> {
    private CredentialCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CredentialCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CredentialCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a credential for yourself or for your organization.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential create(ai.stigmer.agentic.credential.v1.Credential request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a credential's name, description, fields and what it serves.
     * The owner never changes. A secret field sent back as the redaction
     * marker keeps its stored value.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential update(ai.stigmer.agentic.credential.v1.Credential request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a credential.
     * Runs that would have used it are refused at create until another
     * credential provides the values.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Add or replace fields of a credential, keeping the fields not named.
     * Refused on a credential written by an MCP server sign-in.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential setFields(ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSetFieldsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove fields of a credential by name.
     * Refused on a credential written by an MCP server sign-in.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential removeFields(ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRemoveFieldsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service CredentialCommandController.
   * <pre>
   * CredentialCommandController handles write operations for credentials.
   * </pre>
   */
  public static final class CredentialCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<CredentialCommandControllerBlockingStub> {
    private CredentialCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CredentialCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CredentialCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a credential for yourself or for your organization.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential create(ai.stigmer.agentic.credential.v1.Credential request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a credential's name, description, fields and what it serves.
     * The owner never changes. A secret field sent back as the redaction
     * marker keeps its stored value.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential update(ai.stigmer.agentic.credential.v1.Credential request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a credential.
     * Runs that would have used it are refused at create until another
     * credential provides the values.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Add or replace fields of a credential, keeping the fields not named.
     * Refused on a credential written by an MCP server sign-in.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential setFields(ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSetFieldsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove fields of a credential by name.
     * Refused on a credential written by an MCP server sign-in.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential removeFields(ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRemoveFieldsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service CredentialCommandController.
   * <pre>
   * CredentialCommandController handles write operations for credentials.
   * </pre>
   */
  public static final class CredentialCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<CredentialCommandControllerFutureStub> {
    private CredentialCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CredentialCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CredentialCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a credential for yourself or for your organization.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.credential.v1.Credential> create(
        ai.stigmer.agentic.credential.v1.Credential request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a credential's name, description, fields and what it serves.
     * The owner never changes. A secret field sent back as the redaction
     * marker keeps its stored value.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.credential.v1.Credential> update(
        ai.stigmer.agentic.credential.v1.Credential request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a credential.
     * Runs that would have used it are refused at create until another
     * credential provides the values.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.credential.v1.Credential> delete(
        ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Add or replace fields of a credential, keeping the fields not named.
     * Refused on a credential written by an MCP server sign-in.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.credential.v1.Credential> setFields(
        ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSetFieldsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Remove fields of a credential by name.
     * Refused on a credential written by an MCP server sign-in.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.credential.v1.Credential> removeFields(
        ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRemoveFieldsMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
  private static final int METHODID_DELETE = 2;
  private static final int METHODID_SET_FIELDS = 3;
  private static final int METHODID_REMOVE_FIELDS = 4;

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
          serviceImpl.create((ai.stigmer.agentic.credential.v1.Credential) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.credential.v1.Credential) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential>) responseObserver);
          break;
        case METHODID_SET_FIELDS:
          serviceImpl.setFields((ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential>) responseObserver);
          break;
        case METHODID_REMOVE_FIELDS:
          serviceImpl.removeFields((ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential>) responseObserver);
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
              ai.stigmer.agentic.credential.v1.Credential,
              ai.stigmer.agentic.credential.v1.Credential>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.credential.v1.Credential,
              ai.stigmer.agentic.credential.v1.Credential>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.agentic.credential.v1.Credential>(
                service, METHODID_DELETE)))
        .addMethod(
          getSetFieldsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.credential.v1.SetCredentialFieldsInput,
              ai.stigmer.agentic.credential.v1.Credential>(
                service, METHODID_SET_FIELDS)))
        .addMethod(
          getRemoveFieldsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.credential.v1.RemoveCredentialFieldsInput,
              ai.stigmer.agentic.credential.v1.Credential>(
                service, METHODID_REMOVE_FIELDS)))
        .build();
  }

  private static abstract class CredentialCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    CredentialCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.credential.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("CredentialCommandController");
    }
  }

  private static final class CredentialCommandControllerFileDescriptorSupplier
      extends CredentialCommandControllerBaseDescriptorSupplier {
    CredentialCommandControllerFileDescriptorSupplier() {}
  }

  private static final class CredentialCommandControllerMethodDescriptorSupplier
      extends CredentialCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    CredentialCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (CredentialCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new CredentialCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getSetFieldsMethod())
              .addMethod(getRemoveFieldsMethod())
              .build();
        }
      }
    }
    return result;
  }
}
