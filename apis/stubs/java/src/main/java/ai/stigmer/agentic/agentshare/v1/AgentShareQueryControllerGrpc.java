package ai.stigmer.agentic.agentshare.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentShareQueryController handles read operations for agent shares.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentShareQueryControllerGrpc {

  private AgentShareQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentshare.v1.AgentShareQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShareId,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.agentshare.v1.AgentShareId.class,
      responseType = ai.stigmer.agentic.agentshare.v1.AgentShare.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShareId,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShareId, ai.stigmer.agentic.agentshare.v1.AgentShare> getGetMethod;
    if ((getGetMethod = AgentShareQueryControllerGrpc.getGetMethod) == null) {
      synchronized (AgentShareQueryControllerGrpc.class) {
        if ((getGetMethod = AgentShareQueryControllerGrpc.getGetMethod) == null) {
          AgentShareQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentshare.v1.AgentShareId, ai.stigmer.agentic.agentshare.v1.AgentShare>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShareId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShare.getDefaultInstance()))
              .setSchemaDescriptor(new AgentShareQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.agentshare.v1.AgentShare.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agentshare.v1.AgentShare> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = AgentShareQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (AgentShareQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = AgentShareQueryControllerGrpc.getGetByReferenceMethod) == null) {
          AgentShareQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agentshare.v1.AgentShare>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShare.getDefaultInstance()))
              .setSchemaDescriptor(new AgentShareQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest,
      ai.stigmer.agentic.agentshare.v1.AgentShareList> getGetByAgentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByAgent",
      requestType = ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest.class,
      responseType = ai.stigmer.agentic.agentshare.v1.AgentShareList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest,
      ai.stigmer.agentic.agentshare.v1.AgentShareList> getGetByAgentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest, ai.stigmer.agentic.agentshare.v1.AgentShareList> getGetByAgentMethod;
    if ((getGetByAgentMethod = AgentShareQueryControllerGrpc.getGetByAgentMethod) == null) {
      synchronized (AgentShareQueryControllerGrpc.class) {
        if ((getGetByAgentMethod = AgentShareQueryControllerGrpc.getGetByAgentMethod) == null) {
          AgentShareQueryControllerGrpc.getGetByAgentMethod = getGetByAgentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest, ai.stigmer.agentic.agentshare.v1.AgentShareList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByAgent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShareList.getDefaultInstance()))
              .setSchemaDescriptor(new AgentShareQueryControllerMethodDescriptorSupplier("getByAgent"))
              .build();
        }
      }
    }
    return getGetByAgentMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest,
      ai.stigmer.agentic.agentshare.v1.AgentShareList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest.class,
      responseType = ai.stigmer.agentic.agentshare.v1.AgentShareList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest,
      ai.stigmer.agentic.agentshare.v1.AgentShareList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest, ai.stigmer.agentic.agentshare.v1.AgentShareList> getListMethod;
    if ((getListMethod = AgentShareQueryControllerGrpc.getListMethod) == null) {
      synchronized (AgentShareQueryControllerGrpc.class) {
        if ((getListMethod = AgentShareQueryControllerGrpc.getListMethod) == null) {
          AgentShareQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest, ai.stigmer.agentic.agentshare.v1.AgentShareList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShareList.getDefaultInstance()))
              .setSchemaDescriptor(new AgentShareQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest,
      ai.stigmer.agentic.agentshare.v1.SharedAgentProfile> getGetSharedProfileMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getSharedProfile",
      requestType = ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest.class,
      responseType = ai.stigmer.agentic.agentshare.v1.SharedAgentProfile.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest,
      ai.stigmer.agentic.agentshare.v1.SharedAgentProfile> getGetSharedProfileMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest, ai.stigmer.agentic.agentshare.v1.SharedAgentProfile> getGetSharedProfileMethod;
    if ((getGetSharedProfileMethod = AgentShareQueryControllerGrpc.getGetSharedProfileMethod) == null) {
      synchronized (AgentShareQueryControllerGrpc.class) {
        if ((getGetSharedProfileMethod = AgentShareQueryControllerGrpc.getGetSharedProfileMethod) == null) {
          AgentShareQueryControllerGrpc.getGetSharedProfileMethod = getGetSharedProfileMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest, ai.stigmer.agentic.agentshare.v1.SharedAgentProfile>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getSharedProfile"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.SharedAgentProfile.getDefaultInstance()))
              .setSchemaDescriptor(new AgentShareQueryControllerMethodDescriptorSupplier("getSharedProfile"))
              .build();
        }
      }
    }
    return getGetSharedProfileMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agentshare.v1.SharedAgentProfile> getGetSharedProfileForMemberMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getSharedProfileForMember",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.agentshare.v1.SharedAgentProfile.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agentshare.v1.SharedAgentProfile> getGetSharedProfileForMemberMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agentshare.v1.SharedAgentProfile> getGetSharedProfileForMemberMethod;
    if ((getGetSharedProfileForMemberMethod = AgentShareQueryControllerGrpc.getGetSharedProfileForMemberMethod) == null) {
      synchronized (AgentShareQueryControllerGrpc.class) {
        if ((getGetSharedProfileForMemberMethod = AgentShareQueryControllerGrpc.getGetSharedProfileForMemberMethod) == null) {
          AgentShareQueryControllerGrpc.getGetSharedProfileForMemberMethod = getGetSharedProfileForMemberMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agentshare.v1.SharedAgentProfile>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getSharedProfileForMember"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.SharedAgentProfile.getDefaultInstance()))
              .setSchemaDescriptor(new AgentShareQueryControllerMethodDescriptorSupplier("getSharedProfileForMember"))
              .build();
        }
      }
    }
    return getGetSharedProfileForMemberMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentShareQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentShareQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentShareQueryControllerStub>() {
        @java.lang.Override
        public AgentShareQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentShareQueryControllerStub(channel, callOptions);
        }
      };
    return AgentShareQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentShareQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentShareQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentShareQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentShareQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentShareQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentShareQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentShareQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentShareQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentShareQueryControllerBlockingStub>() {
        @java.lang.Override
        public AgentShareQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentShareQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentShareQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentShareQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentShareQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentShareQueryControllerFutureStub>() {
        @java.lang.Override
        public AgentShareQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentShareQueryControllerFutureStub(channel, callOptions);
        }
      };
    return AgentShareQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentShareQueryController handles read operations for agent shares.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single agent share by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.agentshare.v1.AgentShareId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an agent share by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get all shares of a specific agent.
     * Returns only shares the caller has access to, optionally scoped to
     * one organization via the request's org field.
     * This is how the Share dialog and CLI resolve an agent's existing
     * share regardless of its slug (a renamed share keeps working).
     * &#64;internal
     * Authorization is handled in-handler: FGA-filtered in cloud, unrestricted
     * in OSS (single-user edition).
     * </pre>
     */
    default void getByAgent(ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShareList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByAgentMethod(), responseObserver);
    }

    /**
     * <pre>
     * List agent shares with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    default void list(ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShareList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get the public profile of a shared agent by the share's org/slug.
     * This is the resolution path for the hosted chat page: anonymous
     * visitors (no Stigmer account, no token) resolve a shared link to the
     * trimmed SharedAgentProfile — never the full Agent, whose spec carries
     * the system prompt, environment declarations, and MCP wiring.
     * Returns NOT_FOUND when the share does not exist, is disabled, has the
     * org audience (anonymous callers must not be able to distinguish an
     * org-internal share from a nonexistent one; use
     * getSharedProfileForMember instead), or the share link is locked and
     * link_token does not match the share's current status.share_link_token.
     * The cases are deliberately indistinguishable so an unshared, revoked,
     * or rotated URL leaks nothing. Returns INVALID_ARGUMENT when org is
     * empty: org+slug is the shared URL's identity, and cross-org slug
     * matching on a public endpoint would enable enumeration.
     * &#64;internal
     * Public by design (no authentication): enforcement is the app-level
     * sharing gate in the handler, not FGA — see AgentShareSpec for why a
     * share writes no visibility tuples.
     * </pre>
     */
    default void getSharedProfile(ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.SharedAgentProfile> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetSharedProfileMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get the profile of a shared agent as a signed-in organization member.
     * This is the resolution path for the hosted chat page when a share has
     * the org audience: the public getSharedProfile deliberately returns
     * NOT_FOUND for such shares, so a signed-in member resolves the same
     * trimmed SharedAgentProfile through this authenticated RPC instead.
     * Also resolves public-audience shares, so an authenticated caller can
     * use one resolution path for any share.
     * Returns NOT_FOUND when the share does not exist, is disabled, the
     * caller is not a member of the sharing organization, or the share is a
     * public-audience share locked with a link token (this tokenless path
     * must not reveal a killed link's profile) — the cases are deliberately
     * indistinguishable so a share URL leaks nothing to non-members.
     * Returns INVALID_ARGUMENT when org is empty.
     * &#64;internal
     * Custom authorization in handler — requires authentication (not
     * is_public), then an app-level organization#member FGA check for org
     * shares. No standard resource_kind/permission config: the sharing gate
     * is app-level by design (see AgentShareSpec), and membership is checked
     * live on every call so revoked members lose access immediately.
     * </pre>
     */
    default void getSharedProfileForMember(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.SharedAgentProfile> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetSharedProfileForMemberMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentShareQueryController.
   * <pre>
   * AgentShareQueryController handles read operations for agent shares.
   * </pre>
   */
  public static abstract class AgentShareQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentShareQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentShareQueryController.
   * <pre>
   * AgentShareQueryController handles read operations for agent shares.
   * </pre>
   */
  public static final class AgentShareQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentShareQueryControllerStub> {
    private AgentShareQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentShareQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentShareQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent share by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.agentshare.v1.AgentShareId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an agent share by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get all shares of a specific agent.
     * Returns only shares the caller has access to, optionally scoped to
     * one organization via the request's org field.
     * This is how the Share dialog and CLI resolve an agent's existing
     * share regardless of its slug (a renamed share keeps working).
     * &#64;internal
     * Authorization is handled in-handler: FGA-filtered in cloud, unrestricted
     * in OSS (single-user edition).
     * </pre>
     */
    public void getByAgent(ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShareList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByAgentMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List agent shares with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public void list(ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShareList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get the public profile of a shared agent by the share's org/slug.
     * This is the resolution path for the hosted chat page: anonymous
     * visitors (no Stigmer account, no token) resolve a shared link to the
     * trimmed SharedAgentProfile — never the full Agent, whose spec carries
     * the system prompt, environment declarations, and MCP wiring.
     * Returns NOT_FOUND when the share does not exist, is disabled, has the
     * org audience (anonymous callers must not be able to distinguish an
     * org-internal share from a nonexistent one; use
     * getSharedProfileForMember instead), or the share link is locked and
     * link_token does not match the share's current status.share_link_token.
     * The cases are deliberately indistinguishable so an unshared, revoked,
     * or rotated URL leaks nothing. Returns INVALID_ARGUMENT when org is
     * empty: org+slug is the shared URL's identity, and cross-org slug
     * matching on a public endpoint would enable enumeration.
     * &#64;internal
     * Public by design (no authentication): enforcement is the app-level
     * sharing gate in the handler, not FGA — see AgentShareSpec for why a
     * share writes no visibility tuples.
     * </pre>
     */
    public void getSharedProfile(ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.SharedAgentProfile> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetSharedProfileMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get the profile of a shared agent as a signed-in organization member.
     * This is the resolution path for the hosted chat page when a share has
     * the org audience: the public getSharedProfile deliberately returns
     * NOT_FOUND for such shares, so a signed-in member resolves the same
     * trimmed SharedAgentProfile through this authenticated RPC instead.
     * Also resolves public-audience shares, so an authenticated caller can
     * use one resolution path for any share.
     * Returns NOT_FOUND when the share does not exist, is disabled, the
     * caller is not a member of the sharing organization, or the share is a
     * public-audience share locked with a link token (this tokenless path
     * must not reveal a killed link's profile) — the cases are deliberately
     * indistinguishable so a share URL leaks nothing to non-members.
     * Returns INVALID_ARGUMENT when org is empty.
     * &#64;internal
     * Custom authorization in handler — requires authentication (not
     * is_public), then an app-level organization#member FGA check for org
     * shares. No standard resource_kind/permission config: the sharing gate
     * is app-level by design (see AgentShareSpec), and membership is checked
     * live on every call so revoked members lose access immediately.
     * </pre>
     */
    public void getSharedProfileForMember(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.SharedAgentProfile> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetSharedProfileForMemberMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentShareQueryController.
   * <pre>
   * AgentShareQueryController handles read operations for agent shares.
   * </pre>
   */
  public static final class AgentShareQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentShareQueryControllerBlockingV2Stub> {
    private AgentShareQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentShareQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentShareQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent share by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare get(ai.stigmer.agentic.agentshare.v1.AgentShareId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an agent share by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get all shares of a specific agent.
     * Returns only shares the caller has access to, optionally scoped to
     * one organization via the request's org field.
     * This is how the Share dialog and CLI resolve an agent's existing
     * share regardless of its slug (a renamed share keeps working).
     * &#64;internal
     * Authorization is handled in-handler: FGA-filtered in cloud, unrestricted
     * in OSS (single-user edition).
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShareList getByAgent(ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List agent shares with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShareList list(ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the public profile of a shared agent by the share's org/slug.
     * This is the resolution path for the hosted chat page: anonymous
     * visitors (no Stigmer account, no token) resolve a shared link to the
     * trimmed SharedAgentProfile — never the full Agent, whose spec carries
     * the system prompt, environment declarations, and MCP wiring.
     * Returns NOT_FOUND when the share does not exist, is disabled, has the
     * org audience (anonymous callers must not be able to distinguish an
     * org-internal share from a nonexistent one; use
     * getSharedProfileForMember instead), or the share link is locked and
     * link_token does not match the share's current status.share_link_token.
     * The cases are deliberately indistinguishable so an unshared, revoked,
     * or rotated URL leaks nothing. Returns INVALID_ARGUMENT when org is
     * empty: org+slug is the shared URL's identity, and cross-org slug
     * matching on a public endpoint would enable enumeration.
     * &#64;internal
     * Public by design (no authentication): enforcement is the app-level
     * sharing gate in the handler, not FGA — see AgentShareSpec for why a
     * share writes no visibility tuples.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.SharedAgentProfile getSharedProfile(ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetSharedProfileMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the profile of a shared agent as a signed-in organization member.
     * This is the resolution path for the hosted chat page when a share has
     * the org audience: the public getSharedProfile deliberately returns
     * NOT_FOUND for such shares, so a signed-in member resolves the same
     * trimmed SharedAgentProfile through this authenticated RPC instead.
     * Also resolves public-audience shares, so an authenticated caller can
     * use one resolution path for any share.
     * Returns NOT_FOUND when the share does not exist, is disabled, the
     * caller is not a member of the sharing organization, or the share is a
     * public-audience share locked with a link token (this tokenless path
     * must not reveal a killed link's profile) — the cases are deliberately
     * indistinguishable so a share URL leaks nothing to non-members.
     * Returns INVALID_ARGUMENT when org is empty.
     * &#64;internal
     * Custom authorization in handler — requires authentication (not
     * is_public), then an app-level organization#member FGA check for org
     * shares. No standard resource_kind/permission config: the sharing gate
     * is app-level by design (see AgentShareSpec), and membership is checked
     * live on every call so revoked members lose access immediately.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.SharedAgentProfile getSharedProfileForMember(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetSharedProfileForMemberMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentShareQueryController.
   * <pre>
   * AgentShareQueryController handles read operations for agent shares.
   * </pre>
   */
  public static final class AgentShareQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentShareQueryControllerBlockingStub> {
    private AgentShareQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentShareQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentShareQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent share by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare get(ai.stigmer.agentic.agentshare.v1.AgentShareId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an agent share by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get all shares of a specific agent.
     * Returns only shares the caller has access to, optionally scoped to
     * one organization via the request's org field.
     * This is how the Share dialog and CLI resolve an agent's existing
     * share regardless of its slug (a renamed share keeps working).
     * &#64;internal
     * Authorization is handled in-handler: FGA-filtered in cloud, unrestricted
     * in OSS (single-user edition).
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShareList getByAgent(ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List agent shares with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShareList list(ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the public profile of a shared agent by the share's org/slug.
     * This is the resolution path for the hosted chat page: anonymous
     * visitors (no Stigmer account, no token) resolve a shared link to the
     * trimmed SharedAgentProfile — never the full Agent, whose spec carries
     * the system prompt, environment declarations, and MCP wiring.
     * Returns NOT_FOUND when the share does not exist, is disabled, has the
     * org audience (anonymous callers must not be able to distinguish an
     * org-internal share from a nonexistent one; use
     * getSharedProfileForMember instead), or the share link is locked and
     * link_token does not match the share's current status.share_link_token.
     * The cases are deliberately indistinguishable so an unshared, revoked,
     * or rotated URL leaks nothing. Returns INVALID_ARGUMENT when org is
     * empty: org+slug is the shared URL's identity, and cross-org slug
     * matching on a public endpoint would enable enumeration.
     * &#64;internal
     * Public by design (no authentication): enforcement is the app-level
     * sharing gate in the handler, not FGA — see AgentShareSpec for why a
     * share writes no visibility tuples.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.SharedAgentProfile getSharedProfile(ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetSharedProfileMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the profile of a shared agent as a signed-in organization member.
     * This is the resolution path for the hosted chat page when a share has
     * the org audience: the public getSharedProfile deliberately returns
     * NOT_FOUND for such shares, so a signed-in member resolves the same
     * trimmed SharedAgentProfile through this authenticated RPC instead.
     * Also resolves public-audience shares, so an authenticated caller can
     * use one resolution path for any share.
     * Returns NOT_FOUND when the share does not exist, is disabled, the
     * caller is not a member of the sharing organization, or the share is a
     * public-audience share locked with a link token (this tokenless path
     * must not reveal a killed link's profile) — the cases are deliberately
     * indistinguishable so a share URL leaks nothing to non-members.
     * Returns INVALID_ARGUMENT when org is empty.
     * &#64;internal
     * Custom authorization in handler — requires authentication (not
     * is_public), then an app-level organization#member FGA check for org
     * shares. No standard resource_kind/permission config: the sharing gate
     * is app-level by design (see AgentShareSpec), and membership is checked
     * live on every call so revoked members lose access immediately.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.SharedAgentProfile getSharedProfileForMember(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetSharedProfileForMemberMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentShareQueryController.
   * <pre>
   * AgentShareQueryController handles read operations for agent shares.
   * </pre>
   */
  public static final class AgentShareQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentShareQueryControllerFutureStub> {
    private AgentShareQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentShareQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentShareQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent share by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentshare.v1.AgentShare> get(
        ai.stigmer.agentic.agentshare.v1.AgentShareId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an agent share by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentshare.v1.AgentShare> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get all shares of a specific agent.
     * Returns only shares the caller has access to, optionally scoped to
     * one organization via the request's org field.
     * This is how the Share dialog and CLI resolve an agent's existing
     * share regardless of its slug (a renamed share keeps working).
     * &#64;internal
     * Authorization is handled in-handler: FGA-filtered in cloud, unrestricted
     * in OSS (single-user edition).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentshare.v1.AgentShareList> getByAgent(
        ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByAgentMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List agent shares with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentshare.v1.AgentShareList> list(
        ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get the public profile of a shared agent by the share's org/slug.
     * This is the resolution path for the hosted chat page: anonymous
     * visitors (no Stigmer account, no token) resolve a shared link to the
     * trimmed SharedAgentProfile — never the full Agent, whose spec carries
     * the system prompt, environment declarations, and MCP wiring.
     * Returns NOT_FOUND when the share does not exist, is disabled, has the
     * org audience (anonymous callers must not be able to distinguish an
     * org-internal share from a nonexistent one; use
     * getSharedProfileForMember instead), or the share link is locked and
     * link_token does not match the share's current status.share_link_token.
     * The cases are deliberately indistinguishable so an unshared, revoked,
     * or rotated URL leaks nothing. Returns INVALID_ARGUMENT when org is
     * empty: org+slug is the shared URL's identity, and cross-org slug
     * matching on a public endpoint would enable enumeration.
     * &#64;internal
     * Public by design (no authentication): enforcement is the app-level
     * sharing gate in the handler, not FGA — see AgentShareSpec for why a
     * share writes no visibility tuples.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentshare.v1.SharedAgentProfile> getSharedProfile(
        ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetSharedProfileMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get the profile of a shared agent as a signed-in organization member.
     * This is the resolution path for the hosted chat page when a share has
     * the org audience: the public getSharedProfile deliberately returns
     * NOT_FOUND for such shares, so a signed-in member resolves the same
     * trimmed SharedAgentProfile through this authenticated RPC instead.
     * Also resolves public-audience shares, so an authenticated caller can
     * use one resolution path for any share.
     * Returns NOT_FOUND when the share does not exist, is disabled, the
     * caller is not a member of the sharing organization, or the share is a
     * public-audience share locked with a link token (this tokenless path
     * must not reveal a killed link's profile) — the cases are deliberately
     * indistinguishable so a share URL leaks nothing to non-members.
     * Returns INVALID_ARGUMENT when org is empty.
     * &#64;internal
     * Custom authorization in handler — requires authentication (not
     * is_public), then an app-level organization#member FGA check for org
     * shares. No standard resource_kind/permission config: the sharing gate
     * is app-level by design (see AgentShareSpec), and membership is checked
     * live on every call so revoked members lose access immediately.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentshare.v1.SharedAgentProfile> getSharedProfileForMember(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetSharedProfileForMemberMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_GET_BY_AGENT = 2;
  private static final int METHODID_LIST = 3;
  private static final int METHODID_GET_SHARED_PROFILE = 4;
  private static final int METHODID_GET_SHARED_PROFILE_FOR_MEMBER = 5;

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
          serviceImpl.get((ai.stigmer.agentic.agentshare.v1.AgentShareId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare>) responseObserver);
          break;
        case METHODID_GET_BY_AGENT:
          serviceImpl.getByAgent((ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShareList>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShareList>) responseObserver);
          break;
        case METHODID_GET_SHARED_PROFILE:
          serviceImpl.getSharedProfile((ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.SharedAgentProfile>) responseObserver);
          break;
        case METHODID_GET_SHARED_PROFILE_FOR_MEMBER:
          serviceImpl.getSharedProfileForMember((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.SharedAgentProfile>) responseObserver);
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
              ai.stigmer.agentic.agentshare.v1.AgentShareId,
              ai.stigmer.agentic.agentshare.v1.AgentShare>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.agentshare.v1.AgentShare>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getGetByAgentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentshare.v1.GetAgentSharesByAgentRequest,
              ai.stigmer.agentic.agentshare.v1.AgentShareList>(
                service, METHODID_GET_BY_AGENT)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentshare.v1.ListAgentSharesRequest,
              ai.stigmer.agentic.agentshare.v1.AgentShareList>(
                service, METHODID_LIST)))
        .addMethod(
          getGetSharedProfileMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentshare.v1.GetSharedProfileRequest,
              ai.stigmer.agentic.agentshare.v1.SharedAgentProfile>(
                service, METHODID_GET_SHARED_PROFILE)))
        .addMethod(
          getGetSharedProfileForMemberMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.agentshare.v1.SharedAgentProfile>(
                service, METHODID_GET_SHARED_PROFILE_FOR_MEMBER)))
        .build();
  }

  private static abstract class AgentShareQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentShareQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentshare.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentShareQueryController");
    }
  }

  private static final class AgentShareQueryControllerFileDescriptorSupplier
      extends AgentShareQueryControllerBaseDescriptorSupplier {
    AgentShareQueryControllerFileDescriptorSupplier() {}
  }

  private static final class AgentShareQueryControllerMethodDescriptorSupplier
      extends AgentShareQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentShareQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentShareQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentShareQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getGetByAgentMethod())
              .addMethod(getListMethod())
              .addMethod(getGetSharedProfileMethod())
              .addMethod(getGetSharedProfileForMemberMethod())
              .build();
        }
      }
    }
    return result;
  }
}
