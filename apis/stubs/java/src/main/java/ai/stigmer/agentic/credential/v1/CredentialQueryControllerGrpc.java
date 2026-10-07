package ai.stigmer.agentic.credential.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * CredentialQueryController handles read operations for credentials.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class CredentialQueryControllerGrpc {

  private CredentialQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.credential.v1.CredentialQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.credential.v1.Credential> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.credential.v1.Credential.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.credential.v1.Credential> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.credential.v1.Credential> getGetMethod;
    if ((getGetMethod = CredentialQueryControllerGrpc.getGetMethod) == null) {
      synchronized (CredentialQueryControllerGrpc.class) {
        if ((getGetMethod = CredentialQueryControllerGrpc.getGetMethod) == null) {
          CredentialQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.credential.v1.Credential>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.Credential.getDefaultInstance()))
              .setSchemaDescriptor(new CredentialQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.credential.v1.Credential> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.credential.v1.Credential.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.credential.v1.Credential> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.credential.v1.Credential> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = CredentialQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (CredentialQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = CredentialQueryControllerGrpc.getGetByReferenceMethod) == null) {
          CredentialQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.credential.v1.Credential>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.Credential.getDefaultInstance()))
              .setSchemaDescriptor(new CredentialQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput,
      ai.stigmer.agentic.credential.v1.CredentialField> getRevealFieldMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "revealField",
      requestType = ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput.class,
      responseType = ai.stigmer.agentic.credential.v1.CredentialField.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput,
      ai.stigmer.agentic.credential.v1.CredentialField> getRevealFieldMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput, ai.stigmer.agentic.credential.v1.CredentialField> getRevealFieldMethod;
    if ((getRevealFieldMethod = CredentialQueryControllerGrpc.getRevealFieldMethod) == null) {
      synchronized (CredentialQueryControllerGrpc.class) {
        if ((getRevealFieldMethod = CredentialQueryControllerGrpc.getRevealFieldMethod) == null) {
          CredentialQueryControllerGrpc.getRevealFieldMethod = getRevealFieldMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput, ai.stigmer.agentic.credential.v1.CredentialField>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "revealField"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.CredentialField.getDefaultInstance()))
              .setSchemaDescriptor(new CredentialQueryControllerMethodDescriptorSupplier("revealField"))
              .build();
        }
      }
    }
    return getRevealFieldMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.ListCredentialsInput,
      ai.stigmer.agentic.credential.v1.CredentialList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.credential.v1.ListCredentialsInput.class,
      responseType = ai.stigmer.agentic.credential.v1.CredentialList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.ListCredentialsInput,
      ai.stigmer.agentic.credential.v1.CredentialList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.credential.v1.ListCredentialsInput, ai.stigmer.agentic.credential.v1.CredentialList> getListMethod;
    if ((getListMethod = CredentialQueryControllerGrpc.getListMethod) == null) {
      synchronized (CredentialQueryControllerGrpc.class) {
        if ((getListMethod = CredentialQueryControllerGrpc.getListMethod) == null) {
          CredentialQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.credential.v1.ListCredentialsInput, ai.stigmer.agentic.credential.v1.CredentialList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.ListCredentialsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.credential.v1.CredentialList.getDefaultInstance()))
              .setSchemaDescriptor(new CredentialQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static CredentialQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CredentialQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CredentialQueryControllerStub>() {
        @java.lang.Override
        public CredentialQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CredentialQueryControllerStub(channel, callOptions);
        }
      };
    return CredentialQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static CredentialQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CredentialQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CredentialQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public CredentialQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CredentialQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return CredentialQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static CredentialQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CredentialQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CredentialQueryControllerBlockingStub>() {
        @java.lang.Override
        public CredentialQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CredentialQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return CredentialQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static CredentialQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CredentialQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CredentialQueryControllerFutureStub>() {
        @java.lang.Override
        public CredentialQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CredentialQueryControllerFutureStub(channel, callOptions);
        }
      };
    return CredentialQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * CredentialQueryController handles read operations for credentials.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a credential by ID, with secret values redacted.
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a credential by its organization-scoped reference (org/slug), with secret values redacted.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * Reveal one field of your own credential.
     * An organization's credential is write-only: its values can be
     * replaced, never read back.
     * </pre>
     */
    default void revealField(ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.CredentialField> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRevealFieldMethod(), responseObserver);
    }

    /**
     * <pre>
     * List the credentials you may see in an organization, with secret values redacted.
     * Your own credentials, and the organization's credentials you may use;
     * an admin sees all of the organization's. Nobody lists another
     * person's credentials.
     * </pre>
     */
    default void list(ai.stigmer.agentic.credential.v1.ListCredentialsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.CredentialList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service CredentialQueryController.
   * <pre>
   * CredentialQueryController handles read operations for credentials.
   * </pre>
   */
  public static abstract class CredentialQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return CredentialQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service CredentialQueryController.
   * <pre>
   * CredentialQueryController handles read operations for credentials.
   * </pre>
   */
  public static final class CredentialQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<CredentialQueryControllerStub> {
    private CredentialQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CredentialQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CredentialQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a credential by ID, with secret values redacted.
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a credential by its organization-scoped reference (org/slug), with secret values redacted.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Reveal one field of your own credential.
     * An organization's credential is write-only: its values can be
     * replaced, never read back.
     * </pre>
     */
    public void revealField(ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.CredentialField> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRevealFieldMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List the credentials you may see in an organization, with secret values redacted.
     * Your own credentials, and the organization's credentials you may use;
     * an admin sees all of the organization's. Nobody lists another
     * person's credentials.
     * </pre>
     */
    public void list(ai.stigmer.agentic.credential.v1.ListCredentialsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.CredentialList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service CredentialQueryController.
   * <pre>
   * CredentialQueryController handles read operations for credentials.
   * </pre>
   */
  public static final class CredentialQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<CredentialQueryControllerBlockingV2Stub> {
    private CredentialQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CredentialQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CredentialQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a credential by ID, with secret values redacted.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a credential by its organization-scoped reference (org/slug), with secret values redacted.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Reveal one field of your own credential.
     * An organization's credential is write-only: its values can be
     * replaced, never read back.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.CredentialField revealField(ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRevealFieldMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the credentials you may see in an organization, with secret values redacted.
     * Your own credentials, and the organization's credentials you may use;
     * an admin sees all of the organization's. Nobody lists another
     * person's credentials.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.CredentialList list(ai.stigmer.agentic.credential.v1.ListCredentialsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service CredentialQueryController.
   * <pre>
   * CredentialQueryController handles read operations for credentials.
   * </pre>
   */
  public static final class CredentialQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<CredentialQueryControllerBlockingStub> {
    private CredentialQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CredentialQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CredentialQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a credential by ID, with secret values redacted.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a credential by its organization-scoped reference (org/slug), with secret values redacted.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.Credential getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Reveal one field of your own credential.
     * An organization's credential is write-only: its values can be
     * replaced, never read back.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.CredentialField revealField(ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRevealFieldMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the credentials you may see in an organization, with secret values redacted.
     * Your own credentials, and the organization's credentials you may use;
     * an admin sees all of the organization's. Nobody lists another
     * person's credentials.
     * </pre>
     */
    public ai.stigmer.agentic.credential.v1.CredentialList list(ai.stigmer.agentic.credential.v1.ListCredentialsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service CredentialQueryController.
   * <pre>
   * CredentialQueryController handles read operations for credentials.
   * </pre>
   */
  public static final class CredentialQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<CredentialQueryControllerFutureStub> {
    private CredentialQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CredentialQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CredentialQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a credential by ID, with secret values redacted.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.credential.v1.Credential> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a credential by its organization-scoped reference (org/slug), with secret values redacted.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.credential.v1.Credential> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Reveal one field of your own credential.
     * An organization's credential is write-only: its values can be
     * replaced, never read back.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.credential.v1.CredentialField> revealField(
        ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRevealFieldMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List the credentials you may see in an organization, with secret values redacted.
     * Your own credentials, and the organization's credentials you may use;
     * an admin sees all of the organization's. Nobody lists another
     * person's credentials.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.credential.v1.CredentialList> list(
        ai.stigmer.agentic.credential.v1.ListCredentialsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_REVEAL_FIELD = 2;
  private static final int METHODID_LIST = 3;

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
          serviceImpl.get((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.Credential>) responseObserver);
          break;
        case METHODID_REVEAL_FIELD:
          serviceImpl.revealField((ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.CredentialField>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.credential.v1.ListCredentialsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.credential.v1.CredentialList>) responseObserver);
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
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.agentic.credential.v1.Credential>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.credential.v1.Credential>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getRevealFieldMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.credential.v1.RevealCredentialFieldInput,
              ai.stigmer.agentic.credential.v1.CredentialField>(
                service, METHODID_REVEAL_FIELD)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.credential.v1.ListCredentialsInput,
              ai.stigmer.agentic.credential.v1.CredentialList>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class CredentialQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    CredentialQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.credential.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("CredentialQueryController");
    }
  }

  private static final class CredentialQueryControllerFileDescriptorSupplier
      extends CredentialQueryControllerBaseDescriptorSupplier {
    CredentialQueryControllerFileDescriptorSupplier() {}
  }

  private static final class CredentialQueryControllerMethodDescriptorSupplier
      extends CredentialQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    CredentialQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (CredentialQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new CredentialQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getRevealFieldMethod())
              .addMethod(getListMethod())
              .build();
        }
      }
    }
    return result;
  }
}
