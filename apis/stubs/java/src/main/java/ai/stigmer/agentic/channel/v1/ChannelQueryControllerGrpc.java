package ai.stigmer.agentic.channel.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ChannelQueryController handles read operations for channels.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ChannelQueryControllerGrpc {

  private ChannelQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.channel.v1.ChannelQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ChannelId,
      ai.stigmer.agentic.channel.v1.Channel> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.channel.v1.ChannelId.class,
      responseType = ai.stigmer.agentic.channel.v1.Channel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ChannelId,
      ai.stigmer.agentic.channel.v1.Channel> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ChannelId, ai.stigmer.agentic.channel.v1.Channel> getGetMethod;
    if ((getGetMethod = ChannelQueryControllerGrpc.getGetMethod) == null) {
      synchronized (ChannelQueryControllerGrpc.class) {
        if ((getGetMethod = ChannelQueryControllerGrpc.getGetMethod) == null) {
          ChannelQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channel.v1.ChannelId, ai.stigmer.agentic.channel.v1.Channel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.ChannelId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.Channel.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.channel.v1.Channel> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.channel.v1.Channel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.channel.v1.Channel> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.channel.v1.Channel> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = ChannelQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (ChannelQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = ChannelQueryControllerGrpc.getGetByReferenceMethod) == null) {
          ChannelQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.channel.v1.Channel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.Channel.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest,
      ai.stigmer.agentic.channel.v1.ChannelList> getListByAgentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByAgent",
      requestType = ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest.class,
      responseType = ai.stigmer.agentic.channel.v1.ChannelList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest,
      ai.stigmer.agentic.channel.v1.ChannelList> getListByAgentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest, ai.stigmer.agentic.channel.v1.ChannelList> getListByAgentMethod;
    if ((getListByAgentMethod = ChannelQueryControllerGrpc.getListByAgentMethod) == null) {
      synchronized (ChannelQueryControllerGrpc.class) {
        if ((getListByAgentMethod = ChannelQueryControllerGrpc.getListByAgentMethod) == null) {
          ChannelQueryControllerGrpc.getListByAgentMethod = getListByAgentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest, ai.stigmer.agentic.channel.v1.ChannelList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByAgent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.ChannelList.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelQueryControllerMethodDescriptorSupplier("listByAgent"))
              .build();
        }
      }
    }
    return getListByAgentMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ListChannelsRequest,
      ai.stigmer.agentic.channel.v1.ChannelList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.channel.v1.ListChannelsRequest.class,
      responseType = ai.stigmer.agentic.channel.v1.ChannelList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ListChannelsRequest,
      ai.stigmer.agentic.channel.v1.ChannelList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ListChannelsRequest, ai.stigmer.agentic.channel.v1.ChannelList> getListMethod;
    if ((getListMethod = ChannelQueryControllerGrpc.getListMethod) == null) {
      synchronized (ChannelQueryControllerGrpc.class) {
        if ((getListMethod = ChannelQueryControllerGrpc.getListMethod) == null) {
          ChannelQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channel.v1.ListChannelsRequest, ai.stigmer.agentic.channel.v1.ChannelList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.ListChannelsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.ChannelList.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest,
      ai.stigmer.agentic.channel.v1.ChannelAgentProfile> getGetAgentProfileMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getAgentProfile",
      requestType = ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest.class,
      responseType = ai.stigmer.agentic.channel.v1.ChannelAgentProfile.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest,
      ai.stigmer.agentic.channel.v1.ChannelAgentProfile> getGetAgentProfileMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest, ai.stigmer.agentic.channel.v1.ChannelAgentProfile> getGetAgentProfileMethod;
    if ((getGetAgentProfileMethod = ChannelQueryControllerGrpc.getGetAgentProfileMethod) == null) {
      synchronized (ChannelQueryControllerGrpc.class) {
        if ((getGetAgentProfileMethod = ChannelQueryControllerGrpc.getGetAgentProfileMethod) == null) {
          ChannelQueryControllerGrpc.getGetAgentProfileMethod = getGetAgentProfileMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest, ai.stigmer.agentic.channel.v1.ChannelAgentProfile>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getAgentProfile"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.ChannelAgentProfile.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelQueryControllerMethodDescriptorSupplier("getAgentProfile"))
              .build();
        }
      }
    }
    return getGetAgentProfileMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ChannelId,
      ai.stigmer.agentic.channel.v1.ChannelAgentProfile> getGetAgentProfileForMemberMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getAgentProfileForMember",
      requestType = ai.stigmer.agentic.channel.v1.ChannelId.class,
      responseType = ai.stigmer.agentic.channel.v1.ChannelAgentProfile.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ChannelId,
      ai.stigmer.agentic.channel.v1.ChannelAgentProfile> getGetAgentProfileForMemberMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ChannelId, ai.stigmer.agentic.channel.v1.ChannelAgentProfile> getGetAgentProfileForMemberMethod;
    if ((getGetAgentProfileForMemberMethod = ChannelQueryControllerGrpc.getGetAgentProfileForMemberMethod) == null) {
      synchronized (ChannelQueryControllerGrpc.class) {
        if ((getGetAgentProfileForMemberMethod = ChannelQueryControllerGrpc.getGetAgentProfileForMemberMethod) == null) {
          ChannelQueryControllerGrpc.getGetAgentProfileForMemberMethod = getGetAgentProfileForMemberMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channel.v1.ChannelId, ai.stigmer.agentic.channel.v1.ChannelAgentProfile>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getAgentProfileForMember"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.ChannelId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.ChannelAgentProfile.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelQueryControllerMethodDescriptorSupplier("getAgentProfileForMember"))
              .build();
        }
      }
    }
    return getGetAgentProfileForMemberMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ChannelQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelQueryControllerStub>() {
        @java.lang.Override
        public ChannelQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelQueryControllerStub(channel, callOptions);
        }
      };
    return ChannelQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ChannelQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ChannelQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ChannelQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ChannelQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelQueryControllerBlockingStub>() {
        @java.lang.Override
        public ChannelQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ChannelQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ChannelQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelQueryControllerFutureStub>() {
        @java.lang.Override
        public ChannelQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ChannelQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ChannelQueryController handles read operations for channels.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single channel by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.channel.v1.ChannelId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a channel by its organization-scoped reference (org/slug).
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List the channels of a specific agent, newest first, every type
     * together. Returns only channels the caller has access to, optionally
     * scoped to one organization via the request's org field.
     * This is how the agent's console tab and the CLI find an agent's
     * channels regardless of their slugs.
     * </pre>
     */
    default void listByAgent(ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.ChannelList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByAgentMethod(), responseObserver);
    }

    /**
     * <pre>
     * List channels with optional label filtering.
     * </pre>
     */
    default void list(ai.stigmer.agentic.channel.v1.ListChannelsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.ChannelList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get the public profile of the agent a web channel serves, by the
     * channel's id.
     * This is the resolution path for the hosted chat page: anonymous
     * visitors (no Stigmer account, no token) resolve a chat link to the
     * trimmed ChannelAgentProfile, never the full Agent, whose spec carries
     * the system prompt and MCP wiring.
     * Returns NOT_FOUND when the channel does not exist, is not a web
     * channel, is disabled, has the org audience (anonymous callers must not
     * be able to distinguish an org-internal link from a nonexistent one;
     * use getAgentProfileForMember instead), or the link is locked and
     * link_token does not match the channel's current status.web.link_token.
     * The same NOT_FOUND answers when the channel's organization no longer
     * exists. The cases are deliberately indistinguishable so an unshared,
     * revoked, or rotated URL leaks nothing. Returns INVALID_ARGUMENT when
     * channel_id is empty.
     * </pre>
     */
    default void getAgentProfile(ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.ChannelAgentProfile> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetAgentProfileMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get the profile of the agent a web channel serves, as a signed-in
     * organization member.
     * This is the resolution path for the hosted chat page when a web
     * channel has the org audience: the public getAgentProfile deliberately
     * returns NOT_FOUND for such channels, so a signed-in member resolves the
     * same trimmed ChannelAgentProfile through this authenticated RPC
     * instead. Also resolves public-audience channels, so an authenticated
     * caller can use one resolution path for any chat link.
     * Returns NOT_FOUND when the channel does not exist, is not a web
     * channel, is disabled, the caller is not a member of the channel's
     * organization, the channel's organization no longer exists, or the
     * channel is a public-audience channel locked with a link token (this
     * tokenless path must not reveal a killed link's profile); the cases are
     * deliberately indistinguishable so a chat link leaks nothing to
     * non-members. Returns INVALID_ARGUMENT when the id is empty.
     * </pre>
     */
    default void getAgentProfileForMember(ai.stigmer.agentic.channel.v1.ChannelId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.ChannelAgentProfile> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetAgentProfileForMemberMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ChannelQueryController.
   * <pre>
   * ChannelQueryController handles read operations for channels.
   * </pre>
   */
  public static abstract class ChannelQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ChannelQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ChannelQueryController.
   * <pre>
   * ChannelQueryController handles read operations for channels.
   * </pre>
   */
  public static final class ChannelQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ChannelQueryControllerStub> {
    private ChannelQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single channel by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.channel.v1.ChannelId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a channel by its organization-scoped reference (org/slug).
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List the channels of a specific agent, newest first, every type
     * together. Returns only channels the caller has access to, optionally
     * scoped to one organization via the request's org field.
     * This is how the agent's console tab and the CLI find an agent's
     * channels regardless of their slugs.
     * </pre>
     */
    public void listByAgent(ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.ChannelList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByAgentMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List channels with optional label filtering.
     * </pre>
     */
    public void list(ai.stigmer.agentic.channel.v1.ListChannelsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.ChannelList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get the public profile of the agent a web channel serves, by the
     * channel's id.
     * This is the resolution path for the hosted chat page: anonymous
     * visitors (no Stigmer account, no token) resolve a chat link to the
     * trimmed ChannelAgentProfile, never the full Agent, whose spec carries
     * the system prompt and MCP wiring.
     * Returns NOT_FOUND when the channel does not exist, is not a web
     * channel, is disabled, has the org audience (anonymous callers must not
     * be able to distinguish an org-internal link from a nonexistent one;
     * use getAgentProfileForMember instead), or the link is locked and
     * link_token does not match the channel's current status.web.link_token.
     * The same NOT_FOUND answers when the channel's organization no longer
     * exists. The cases are deliberately indistinguishable so an unshared,
     * revoked, or rotated URL leaks nothing. Returns INVALID_ARGUMENT when
     * channel_id is empty.
     * </pre>
     */
    public void getAgentProfile(ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.ChannelAgentProfile> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetAgentProfileMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get the profile of the agent a web channel serves, as a signed-in
     * organization member.
     * This is the resolution path for the hosted chat page when a web
     * channel has the org audience: the public getAgentProfile deliberately
     * returns NOT_FOUND for such channels, so a signed-in member resolves the
     * same trimmed ChannelAgentProfile through this authenticated RPC
     * instead. Also resolves public-audience channels, so an authenticated
     * caller can use one resolution path for any chat link.
     * Returns NOT_FOUND when the channel does not exist, is not a web
     * channel, is disabled, the caller is not a member of the channel's
     * organization, the channel's organization no longer exists, or the
     * channel is a public-audience channel locked with a link token (this
     * tokenless path must not reveal a killed link's profile); the cases are
     * deliberately indistinguishable so a chat link leaks nothing to
     * non-members. Returns INVALID_ARGUMENT when the id is empty.
     * </pre>
     */
    public void getAgentProfileForMember(ai.stigmer.agentic.channel.v1.ChannelId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.ChannelAgentProfile> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetAgentProfileForMemberMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ChannelQueryController.
   * <pre>
   * ChannelQueryController handles read operations for channels.
   * </pre>
   */
  public static final class ChannelQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ChannelQueryControllerBlockingV2Stub> {
    private ChannelQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single channel by ID.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel get(ai.stigmer.agentic.channel.v1.ChannelId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a channel by its organization-scoped reference (org/slug).
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the channels of a specific agent, newest first, every type
     * together. Returns only channels the caller has access to, optionally
     * scoped to one organization via the request's org field.
     * This is how the agent's console tab and the CLI find an agent's
     * channels regardless of their slugs.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.ChannelList listByAgent(ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List channels with optional label filtering.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.ChannelList list(ai.stigmer.agentic.channel.v1.ListChannelsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the public profile of the agent a web channel serves, by the
     * channel's id.
     * This is the resolution path for the hosted chat page: anonymous
     * visitors (no Stigmer account, no token) resolve a chat link to the
     * trimmed ChannelAgentProfile, never the full Agent, whose spec carries
     * the system prompt and MCP wiring.
     * Returns NOT_FOUND when the channel does not exist, is not a web
     * channel, is disabled, has the org audience (anonymous callers must not
     * be able to distinguish an org-internal link from a nonexistent one;
     * use getAgentProfileForMember instead), or the link is locked and
     * link_token does not match the channel's current status.web.link_token.
     * The same NOT_FOUND answers when the channel's organization no longer
     * exists. The cases are deliberately indistinguishable so an unshared,
     * revoked, or rotated URL leaks nothing. Returns INVALID_ARGUMENT when
     * channel_id is empty.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.ChannelAgentProfile getAgentProfile(ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetAgentProfileMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the profile of the agent a web channel serves, as a signed-in
     * organization member.
     * This is the resolution path for the hosted chat page when a web
     * channel has the org audience: the public getAgentProfile deliberately
     * returns NOT_FOUND for such channels, so a signed-in member resolves the
     * same trimmed ChannelAgentProfile through this authenticated RPC
     * instead. Also resolves public-audience channels, so an authenticated
     * caller can use one resolution path for any chat link.
     * Returns NOT_FOUND when the channel does not exist, is not a web
     * channel, is disabled, the caller is not a member of the channel's
     * organization, the channel's organization no longer exists, or the
     * channel is a public-audience channel locked with a link token (this
     * tokenless path must not reveal a killed link's profile); the cases are
     * deliberately indistinguishable so a chat link leaks nothing to
     * non-members. Returns INVALID_ARGUMENT when the id is empty.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.ChannelAgentProfile getAgentProfileForMember(ai.stigmer.agentic.channel.v1.ChannelId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetAgentProfileForMemberMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ChannelQueryController.
   * <pre>
   * ChannelQueryController handles read operations for channels.
   * </pre>
   */
  public static final class ChannelQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ChannelQueryControllerBlockingStub> {
    private ChannelQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single channel by ID.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel get(ai.stigmer.agentic.channel.v1.ChannelId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a channel by its organization-scoped reference (org/slug).
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the channels of a specific agent, newest first, every type
     * together. Returns only channels the caller has access to, optionally
     * scoped to one organization via the request's org field.
     * This is how the agent's console tab and the CLI find an agent's
     * channels regardless of their slugs.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.ChannelList listByAgent(ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List channels with optional label filtering.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.ChannelList list(ai.stigmer.agentic.channel.v1.ListChannelsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the public profile of the agent a web channel serves, by the
     * channel's id.
     * This is the resolution path for the hosted chat page: anonymous
     * visitors (no Stigmer account, no token) resolve a chat link to the
     * trimmed ChannelAgentProfile, never the full Agent, whose spec carries
     * the system prompt and MCP wiring.
     * Returns NOT_FOUND when the channel does not exist, is not a web
     * channel, is disabled, has the org audience (anonymous callers must not
     * be able to distinguish an org-internal link from a nonexistent one;
     * use getAgentProfileForMember instead), or the link is locked and
     * link_token does not match the channel's current status.web.link_token.
     * The same NOT_FOUND answers when the channel's organization no longer
     * exists. The cases are deliberately indistinguishable so an unshared,
     * revoked, or rotated URL leaks nothing. Returns INVALID_ARGUMENT when
     * channel_id is empty.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.ChannelAgentProfile getAgentProfile(ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetAgentProfileMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the profile of the agent a web channel serves, as a signed-in
     * organization member.
     * This is the resolution path for the hosted chat page when a web
     * channel has the org audience: the public getAgentProfile deliberately
     * returns NOT_FOUND for such channels, so a signed-in member resolves the
     * same trimmed ChannelAgentProfile through this authenticated RPC
     * instead. Also resolves public-audience channels, so an authenticated
     * caller can use one resolution path for any chat link.
     * Returns NOT_FOUND when the channel does not exist, is not a web
     * channel, is disabled, the caller is not a member of the channel's
     * organization, the channel's organization no longer exists, or the
     * channel is a public-audience channel locked with a link token (this
     * tokenless path must not reveal a killed link's profile); the cases are
     * deliberately indistinguishable so a chat link leaks nothing to
     * non-members. Returns INVALID_ARGUMENT when the id is empty.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.ChannelAgentProfile getAgentProfileForMember(ai.stigmer.agentic.channel.v1.ChannelId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetAgentProfileForMemberMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ChannelQueryController.
   * <pre>
   * ChannelQueryController handles read operations for channels.
   * </pre>
   */
  public static final class ChannelQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ChannelQueryControllerFutureStub> {
    private ChannelQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single channel by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.Channel> get(
        ai.stigmer.agentic.channel.v1.ChannelId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a channel by its organization-scoped reference (org/slug).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.Channel> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List the channels of a specific agent, newest first, every type
     * together. Returns only channels the caller has access to, optionally
     * scoped to one organization via the request's org field.
     * This is how the agent's console tab and the CLI find an agent's
     * channels regardless of their slugs.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.ChannelList> listByAgent(
        ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByAgentMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List channels with optional label filtering.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.ChannelList> list(
        ai.stigmer.agentic.channel.v1.ListChannelsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get the public profile of the agent a web channel serves, by the
     * channel's id.
     * This is the resolution path for the hosted chat page: anonymous
     * visitors (no Stigmer account, no token) resolve a chat link to the
     * trimmed ChannelAgentProfile, never the full Agent, whose spec carries
     * the system prompt and MCP wiring.
     * Returns NOT_FOUND when the channel does not exist, is not a web
     * channel, is disabled, has the org audience (anonymous callers must not
     * be able to distinguish an org-internal link from a nonexistent one;
     * use getAgentProfileForMember instead), or the link is locked and
     * link_token does not match the channel's current status.web.link_token.
     * The same NOT_FOUND answers when the channel's organization no longer
     * exists. The cases are deliberately indistinguishable so an unshared,
     * revoked, or rotated URL leaks nothing. Returns INVALID_ARGUMENT when
     * channel_id is empty.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.ChannelAgentProfile> getAgentProfile(
        ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetAgentProfileMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get the profile of the agent a web channel serves, as a signed-in
     * organization member.
     * This is the resolution path for the hosted chat page when a web
     * channel has the org audience: the public getAgentProfile deliberately
     * returns NOT_FOUND for such channels, so a signed-in member resolves the
     * same trimmed ChannelAgentProfile through this authenticated RPC
     * instead. Also resolves public-audience channels, so an authenticated
     * caller can use one resolution path for any chat link.
     * Returns NOT_FOUND when the channel does not exist, is not a web
     * channel, is disabled, the caller is not a member of the channel's
     * organization, the channel's organization no longer exists, or the
     * channel is a public-audience channel locked with a link token (this
     * tokenless path must not reveal a killed link's profile); the cases are
     * deliberately indistinguishable so a chat link leaks nothing to
     * non-members. Returns INVALID_ARGUMENT when the id is empty.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.ChannelAgentProfile> getAgentProfileForMember(
        ai.stigmer.agentic.channel.v1.ChannelId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetAgentProfileForMemberMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_LIST_BY_AGENT = 2;
  private static final int METHODID_LIST = 3;
  private static final int METHODID_GET_AGENT_PROFILE = 4;
  private static final int METHODID_GET_AGENT_PROFILE_FOR_MEMBER = 5;

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
          serviceImpl.get((ai.stigmer.agentic.channel.v1.ChannelId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel>) responseObserver);
          break;
        case METHODID_LIST_BY_AGENT:
          serviceImpl.listByAgent((ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.ChannelList>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.channel.v1.ListChannelsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.ChannelList>) responseObserver);
          break;
        case METHODID_GET_AGENT_PROFILE:
          serviceImpl.getAgentProfile((ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.ChannelAgentProfile>) responseObserver);
          break;
        case METHODID_GET_AGENT_PROFILE_FOR_MEMBER:
          serviceImpl.getAgentProfileForMember((ai.stigmer.agentic.channel.v1.ChannelId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.ChannelAgentProfile>) responseObserver);
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
              ai.stigmer.agentic.channel.v1.ChannelId,
              ai.stigmer.agentic.channel.v1.Channel>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.channel.v1.Channel>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListByAgentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channel.v1.ListChannelsByAgentRequest,
              ai.stigmer.agentic.channel.v1.ChannelList>(
                service, METHODID_LIST_BY_AGENT)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channel.v1.ListChannelsRequest,
              ai.stigmer.agentic.channel.v1.ChannelList>(
                service, METHODID_LIST)))
        .addMethod(
          getGetAgentProfileMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channel.v1.GetChannelAgentProfileRequest,
              ai.stigmer.agentic.channel.v1.ChannelAgentProfile>(
                service, METHODID_GET_AGENT_PROFILE)))
        .addMethod(
          getGetAgentProfileForMemberMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channel.v1.ChannelId,
              ai.stigmer.agentic.channel.v1.ChannelAgentProfile>(
                service, METHODID_GET_AGENT_PROFILE_FOR_MEMBER)))
        .build();
  }

  private static abstract class ChannelQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ChannelQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.channel.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ChannelQueryController");
    }
  }

  private static final class ChannelQueryControllerFileDescriptorSupplier
      extends ChannelQueryControllerBaseDescriptorSupplier {
    ChannelQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ChannelQueryControllerMethodDescriptorSupplier
      extends ChannelQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ChannelQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ChannelQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ChannelQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListByAgentMethod())
              .addMethod(getListMethod())
              .addMethod(getGetAgentProfileMethod())
              .addMethod(getGetAgentProfileForMemberMethod())
              .build();
        }
      }
    }
    return result;
  }
}
