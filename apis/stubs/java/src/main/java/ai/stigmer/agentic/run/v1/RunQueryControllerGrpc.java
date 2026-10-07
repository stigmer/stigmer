package ai.stigmer.agentic.run.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * RunQueryController handles read operations for runs.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class RunQueryControllerGrpc {

  private RunQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.run.v1.RunQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.RunId,
      ai.stigmer.agentic.run.v1.Run> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.run.v1.RunId.class,
      responseType = ai.stigmer.agentic.run.v1.Run.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.RunId,
      ai.stigmer.agentic.run.v1.Run> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.RunId, ai.stigmer.agentic.run.v1.Run> getGetMethod;
    if ((getGetMethod = RunQueryControllerGrpc.getGetMethod) == null) {
      synchronized (RunQueryControllerGrpc.class) {
        if ((getGetMethod = RunQueryControllerGrpc.getGetMethod) == null) {
          RunQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.RunId, ai.stigmer.agentic.run.v1.Run>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.RunId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setSchemaDescriptor(new RunQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.ListRunsRequest,
      ai.stigmer.agentic.run.v1.RunList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.run.v1.ListRunsRequest.class,
      responseType = ai.stigmer.agentic.run.v1.RunList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.ListRunsRequest,
      ai.stigmer.agentic.run.v1.RunList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.ListRunsRequest, ai.stigmer.agentic.run.v1.RunList> getListMethod;
    if ((getListMethod = RunQueryControllerGrpc.getListMethod) == null) {
      synchronized (RunQueryControllerGrpc.class) {
        if ((getListMethod = RunQueryControllerGrpc.getListMethod) == null) {
          RunQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.ListRunsRequest, ai.stigmer.agentic.run.v1.RunList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.ListRunsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.RunList.getDefaultInstance()))
              .setSchemaDescriptor(new RunQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.ListRunsBySessionRequest,
      ai.stigmer.agentic.run.v1.RunList> getListBySessionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listBySession",
      requestType = ai.stigmer.agentic.run.v1.ListRunsBySessionRequest.class,
      responseType = ai.stigmer.agentic.run.v1.RunList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.ListRunsBySessionRequest,
      ai.stigmer.agentic.run.v1.RunList> getListBySessionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.ListRunsBySessionRequest, ai.stigmer.agentic.run.v1.RunList> getListBySessionMethod;
    if ((getListBySessionMethod = RunQueryControllerGrpc.getListBySessionMethod) == null) {
      synchronized (RunQueryControllerGrpc.class) {
        if ((getListBySessionMethod = RunQueryControllerGrpc.getListBySessionMethod) == null) {
          RunQueryControllerGrpc.getListBySessionMethod = getListBySessionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.ListRunsBySessionRequest, ai.stigmer.agentic.run.v1.RunList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listBySession"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.ListRunsBySessionRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.RunList.getDefaultInstance()))
              .setSchemaDescriptor(new RunQueryControllerMethodDescriptorSupplier("listBySession"))
              .build();
        }
      }
    }
    return getListBySessionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.RunId,
      ai.stigmer.agentic.run.v1.Run> getSubscribeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "subscribe",
      requestType = ai.stigmer.agentic.run.v1.RunId.class,
      responseType = ai.stigmer.agentic.run.v1.Run.class,
      methodType = io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.RunId,
      ai.stigmer.agentic.run.v1.Run> getSubscribeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.RunId, ai.stigmer.agentic.run.v1.Run> getSubscribeMethod;
    if ((getSubscribeMethod = RunQueryControllerGrpc.getSubscribeMethod) == null) {
      synchronized (RunQueryControllerGrpc.class) {
        if ((getSubscribeMethod = RunQueryControllerGrpc.getSubscribeMethod) == null) {
          RunQueryControllerGrpc.getSubscribeMethod = getSubscribeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.RunId, ai.stigmer.agentic.run.v1.Run>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "subscribe"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.RunId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.Run.getDefaultInstance()))
              .setSchemaDescriptor(new RunQueryControllerMethodDescriptorSupplier("subscribe"))
              .build();
        }
      }
    }
    return getSubscribeMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest,
      ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse> getGetArtifactDownloadUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getArtifactDownloadUrl",
      requestType = ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest.class,
      responseType = ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest,
      ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse> getGetArtifactDownloadUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest, ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse> getGetArtifactDownloadUrlMethod;
    if ((getGetArtifactDownloadUrlMethod = RunQueryControllerGrpc.getGetArtifactDownloadUrlMethod) == null) {
      synchronized (RunQueryControllerGrpc.class) {
        if ((getGetArtifactDownloadUrlMethod = RunQueryControllerGrpc.getGetArtifactDownloadUrlMethod) == null) {
          RunQueryControllerGrpc.getGetArtifactDownloadUrlMethod = getGetArtifactDownloadUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest, ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getArtifactDownloadUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse.getDefaultInstance()))
              .setSchemaDescriptor(new RunQueryControllerMethodDescriptorSupplier("getArtifactDownloadUrl"))
              .build();
        }
      }
    }
    return getGetArtifactDownloadUrlMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetArtifactContentRequest,
      ai.stigmer.agentic.run.v1.GetArtifactContentResponse> getGetArtifactContentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getArtifactContent",
      requestType = ai.stigmer.agentic.run.v1.GetArtifactContentRequest.class,
      responseType = ai.stigmer.agentic.run.v1.GetArtifactContentResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetArtifactContentRequest,
      ai.stigmer.agentic.run.v1.GetArtifactContentResponse> getGetArtifactContentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetArtifactContentRequest, ai.stigmer.agentic.run.v1.GetArtifactContentResponse> getGetArtifactContentMethod;
    if ((getGetArtifactContentMethod = RunQueryControllerGrpc.getGetArtifactContentMethod) == null) {
      synchronized (RunQueryControllerGrpc.class) {
        if ((getGetArtifactContentMethod = RunQueryControllerGrpc.getGetArtifactContentMethod) == null) {
          RunQueryControllerGrpc.getGetArtifactContentMethod = getGetArtifactContentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.GetArtifactContentRequest, ai.stigmer.agentic.run.v1.GetArtifactContentResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getArtifactContent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetArtifactContentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetArtifactContentResponse.getDefaultInstance()))
              .setSchemaDescriptor(new RunQueryControllerMethodDescriptorSupplier("getArtifactContent"))
              .build();
        }
      }
    }
    return getGetArtifactContentMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetRunUsageReportInput,
      ai.stigmer.agentic.run.v1.GetRunUsageReportOutput> getGetRunUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getRunUsageReport",
      requestType = ai.stigmer.agentic.run.v1.GetRunUsageReportInput.class,
      responseType = ai.stigmer.agentic.run.v1.GetRunUsageReportOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetRunUsageReportInput,
      ai.stigmer.agentic.run.v1.GetRunUsageReportOutput> getGetRunUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetRunUsageReportInput, ai.stigmer.agentic.run.v1.GetRunUsageReportOutput> getGetRunUsageReportMethod;
    if ((getGetRunUsageReportMethod = RunQueryControllerGrpc.getGetRunUsageReportMethod) == null) {
      synchronized (RunQueryControllerGrpc.class) {
        if ((getGetRunUsageReportMethod = RunQueryControllerGrpc.getGetRunUsageReportMethod) == null) {
          RunQueryControllerGrpc.getGetRunUsageReportMethod = getGetRunUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.GetRunUsageReportInput, ai.stigmer.agentic.run.v1.GetRunUsageReportOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getRunUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetRunUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetRunUsageReportOutput.getDefaultInstance()))
              .setSchemaDescriptor(new RunQueryControllerMethodDescriptorSupplier("getRunUsageReport"))
              .build();
        }
      }
    }
    return getGetRunUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetSessionUsageReportInput,
      ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput> getGetSessionUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getSessionUsageReport",
      requestType = ai.stigmer.agentic.run.v1.GetSessionUsageReportInput.class,
      responseType = ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetSessionUsageReportInput,
      ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput> getGetSessionUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetSessionUsageReportInput, ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput> getGetSessionUsageReportMethod;
    if ((getGetSessionUsageReportMethod = RunQueryControllerGrpc.getGetSessionUsageReportMethod) == null) {
      synchronized (RunQueryControllerGrpc.class) {
        if ((getGetSessionUsageReportMethod = RunQueryControllerGrpc.getGetSessionUsageReportMethod) == null) {
          RunQueryControllerGrpc.getGetSessionUsageReportMethod = getGetSessionUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.GetSessionUsageReportInput, ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getSessionUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetSessionUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput.getDefaultInstance()))
              .setSchemaDescriptor(new RunQueryControllerMethodDescriptorSupplier("getSessionUsageReport"))
              .build();
        }
      }
    }
    return getGetSessionUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetAgentUsageReportInput,
      ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput> getGetAgentUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getAgentUsageReport",
      requestType = ai.stigmer.agentic.run.v1.GetAgentUsageReportInput.class,
      responseType = ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetAgentUsageReportInput,
      ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput> getGetAgentUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetAgentUsageReportInput, ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput> getGetAgentUsageReportMethod;
    if ((getGetAgentUsageReportMethod = RunQueryControllerGrpc.getGetAgentUsageReportMethod) == null) {
      synchronized (RunQueryControllerGrpc.class) {
        if ((getGetAgentUsageReportMethod = RunQueryControllerGrpc.getGetAgentUsageReportMethod) == null) {
          RunQueryControllerGrpc.getGetAgentUsageReportMethod = getGetAgentUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.GetAgentUsageReportInput, ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getAgentUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetAgentUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput.getDefaultInstance()))
              .setSchemaDescriptor(new RunQueryControllerMethodDescriptorSupplier("getAgentUsageReport"))
              .build();
        }
      }
    }
    return getGetAgentUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetOrgUsageReportInput,
      ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput> getGetOrgUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getOrgUsageReport",
      requestType = ai.stigmer.agentic.run.v1.GetOrgUsageReportInput.class,
      responseType = ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetOrgUsageReportInput,
      ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput> getGetOrgUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetOrgUsageReportInput, ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput> getGetOrgUsageReportMethod;
    if ((getGetOrgUsageReportMethod = RunQueryControllerGrpc.getGetOrgUsageReportMethod) == null) {
      synchronized (RunQueryControllerGrpc.class) {
        if ((getGetOrgUsageReportMethod = RunQueryControllerGrpc.getGetOrgUsageReportMethod) == null) {
          RunQueryControllerGrpc.getGetOrgUsageReportMethod = getGetOrgUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.GetOrgUsageReportInput, ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getOrgUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetOrgUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput.getDefaultInstance()))
              .setSchemaDescriptor(new RunQueryControllerMethodDescriptorSupplier("getOrgUsageReport"))
              .build();
        }
      }
    }
    return getGetOrgUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetRunSummaryRequest,
      ai.stigmer.agentic.run.v1.RunSummary> getGetRunSummaryMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getRunSummary",
      requestType = ai.stigmer.agentic.run.v1.GetRunSummaryRequest.class,
      responseType = ai.stigmer.agentic.run.v1.RunSummary.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetRunSummaryRequest,
      ai.stigmer.agentic.run.v1.RunSummary> getGetRunSummaryMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.run.v1.GetRunSummaryRequest, ai.stigmer.agentic.run.v1.RunSummary> getGetRunSummaryMethod;
    if ((getGetRunSummaryMethod = RunQueryControllerGrpc.getGetRunSummaryMethod) == null) {
      synchronized (RunQueryControllerGrpc.class) {
        if ((getGetRunSummaryMethod = RunQueryControllerGrpc.getGetRunSummaryMethod) == null) {
          RunQueryControllerGrpc.getGetRunSummaryMethod = getGetRunSummaryMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.run.v1.GetRunSummaryRequest, ai.stigmer.agentic.run.v1.RunSummary>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getRunSummary"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.GetRunSummaryRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.run.v1.RunSummary.getDefaultInstance()))
              .setSchemaDescriptor(new RunQueryControllerMethodDescriptorSupplier("getRunSummary"))
              .build();
        }
      }
    }
    return getGetRunSummaryMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static RunQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunQueryControllerStub>() {
        @java.lang.Override
        public RunQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunQueryControllerStub(channel, callOptions);
        }
      };
    return RunQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static RunQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public RunQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return RunQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static RunQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunQueryControllerBlockingStub>() {
        @java.lang.Override
        public RunQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return RunQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static RunQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunQueryControllerFutureStub>() {
        @java.lang.Override
        public RunQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunQueryControllerFutureStub(channel, callOptions);
        }
      };
    return RunQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * RunQueryController handles read operations for runs.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single run by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.run.v1.RunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all runs with pagination and optional filtering.
     * </pre>
     */
    default void list(ai.stigmer.agentic.run.v1.ListRunsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.RunList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all runs in a specific session.
     * </pre>
     */
    default void listBySession(ai.stigmer.agentic.run.v1.ListRunsBySessionRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.RunList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListBySessionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time run updates (streaming).
     * </pre>
     */
    default void subscribe(ai.stigmer.agentic.run.v1.RunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubscribeMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a presigned download URL for a run artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during the run, or an attachment submitted with the
     * run. The URL can be used with a simple HTTP GET request without
     * authentication.
     * </pre>
     */
    default void getArtifactDownloadUrl(ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetArtifactDownloadUrlMethod(), responseObserver);
    }

    /**
     * <pre>
     * Read the raw content of a run artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * </pre>
     */
    default void getArtifactContent(ai.stigmer.agentic.run.v1.GetArtifactContentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetArtifactContentResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetArtifactContentMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for a single run.
     * Returns aggregated tokens, cost, and per-model breakdown for one run.
     * </pre>
     */
    default void getRunUsageReport(ai.stigmer.agentic.run.v1.GetRunUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetRunUsageReportOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetRunUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-run breakdown.
     * </pre>
     */
    default void getSessionUsageReport(ai.stigmer.agentic.run.v1.GetSessionUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetSessionUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's runs of the agent. Requires can_view on the
     * organization named in org; runs outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * </pre>
     */
    default void getAgentUsageReport(ai.stigmer.agentic.run.v1.GetAgentUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetAgentUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    default void getOrgUsageReport(ai.stigmer.agentic.run.v1.GetOrgUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetOrgUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get aggregated run statistics for an organization's runs.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    default void getRunSummary(ai.stigmer.agentic.run.v1.GetRunSummaryRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.RunSummary> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetRunSummaryMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service RunQueryController.
   * <pre>
   * RunQueryController handles read operations for runs.
   * </pre>
   */
  public static abstract class RunQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return RunQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service RunQueryController.
   * <pre>
   * RunQueryController handles read operations for runs.
   * </pre>
   */
  public static final class RunQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<RunQueryControllerStub> {
    private RunQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single run by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.run.v1.RunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all runs with pagination and optional filtering.
     * </pre>
     */
    public void list(ai.stigmer.agentic.run.v1.ListRunsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.RunList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all runs in a specific session.
     * </pre>
     */
    public void listBySession(ai.stigmer.agentic.run.v1.ListRunsBySessionRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.RunList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListBySessionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time run updates (streaming).
     * </pre>
     */
    public void subscribe(ai.stigmer.agentic.run.v1.RunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run> responseObserver) {
      io.grpc.stub.ClientCalls.asyncServerStreamingCall(
          getChannel().newCall(getSubscribeMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a presigned download URL for a run artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during the run, or an attachment submitted with the
     * run. The URL can be used with a simple HTTP GET request without
     * authentication.
     * </pre>
     */
    public void getArtifactDownloadUrl(ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetArtifactDownloadUrlMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Read the raw content of a run artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * </pre>
     */
    public void getArtifactContent(ai.stigmer.agentic.run.v1.GetArtifactContentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetArtifactContentResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetArtifactContentMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for a single run.
     * Returns aggregated tokens, cost, and per-model breakdown for one run.
     * </pre>
     */
    public void getRunUsageReport(ai.stigmer.agentic.run.v1.GetRunUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetRunUsageReportOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetRunUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-run breakdown.
     * </pre>
     */
    public void getSessionUsageReport(ai.stigmer.agentic.run.v1.GetSessionUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetSessionUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's runs of the agent. Requires can_view on the
     * organization named in org; runs outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * </pre>
     */
    public void getAgentUsageReport(ai.stigmer.agentic.run.v1.GetAgentUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetAgentUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    public void getOrgUsageReport(ai.stigmer.agentic.run.v1.GetOrgUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetOrgUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get aggregated run statistics for an organization's runs.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    public void getRunSummary(ai.stigmer.agentic.run.v1.GetRunSummaryRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.RunSummary> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetRunSummaryMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service RunQueryController.
   * <pre>
   * RunQueryController handles read operations for runs.
   * </pre>
   */
  public static final class RunQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<RunQueryControllerBlockingV2Stub> {
    private RunQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single run by ID.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run get(ai.stigmer.agentic.run.v1.RunId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all runs with pagination and optional filtering.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.RunList list(ai.stigmer.agentic.run.v1.ListRunsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all runs in a specific session.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.RunList listBySession(ai.stigmer.agentic.run.v1.ListRunsBySessionRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListBySessionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time run updates (streaming).
     * </pre>
     */
    @io.grpc.ExperimentalApi("https://github.com/grpc/grpc-java/issues/10918")
    public io.grpc.stub.BlockingClientCall<?, ai.stigmer.agentic.run.v1.Run>
        subscribe(ai.stigmer.agentic.run.v1.RunId request) {
      return io.grpc.stub.ClientCalls.blockingV2ServerStreamingCall(
          getChannel(), getSubscribeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a presigned download URL for a run artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during the run, or an attachment submitted with the
     * run. The URL can be used with a simple HTTP GET request without
     * authentication.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse getArtifactDownloadUrl(ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetArtifactDownloadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Read the raw content of a run artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.GetArtifactContentResponse getArtifactContent(ai.stigmer.agentic.run.v1.GetArtifactContentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetArtifactContentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for a single run.
     * Returns aggregated tokens, cost, and per-model breakdown for one run.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.GetRunUsageReportOutput getRunUsageReport(ai.stigmer.agentic.run.v1.GetRunUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetRunUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-run breakdown.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput getSessionUsageReport(ai.stigmer.agentic.run.v1.GetSessionUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetSessionUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's runs of the agent. Requires can_view on the
     * organization named in org; runs outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput getAgentUsageReport(ai.stigmer.agentic.run.v1.GetAgentUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetAgentUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput getOrgUsageReport(ai.stigmer.agentic.run.v1.GetOrgUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetOrgUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get aggregated run statistics for an organization's runs.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.RunSummary getRunSummary(ai.stigmer.agentic.run.v1.GetRunSummaryRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetRunSummaryMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service RunQueryController.
   * <pre>
   * RunQueryController handles read operations for runs.
   * </pre>
   */
  public static final class RunQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<RunQueryControllerBlockingStub> {
    private RunQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single run by ID.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.Run get(ai.stigmer.agentic.run.v1.RunId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all runs with pagination and optional filtering.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.RunList list(ai.stigmer.agentic.run.v1.ListRunsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all runs in a specific session.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.RunList listBySession(ai.stigmer.agentic.run.v1.ListRunsBySessionRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListBySessionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time run updates (streaming).
     * </pre>
     */
    public java.util.Iterator<ai.stigmer.agentic.run.v1.Run> subscribe(
        ai.stigmer.agentic.run.v1.RunId request) {
      return io.grpc.stub.ClientCalls.blockingServerStreamingCall(
          getChannel(), getSubscribeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a presigned download URL for a run artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during the run, or an attachment submitted with the
     * run. The URL can be used with a simple HTTP GET request without
     * authentication.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse getArtifactDownloadUrl(ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetArtifactDownloadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Read the raw content of a run artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.GetArtifactContentResponse getArtifactContent(ai.stigmer.agentic.run.v1.GetArtifactContentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetArtifactContentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for a single run.
     * Returns aggregated tokens, cost, and per-model breakdown for one run.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.GetRunUsageReportOutput getRunUsageReport(ai.stigmer.agentic.run.v1.GetRunUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetRunUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-run breakdown.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput getSessionUsageReport(ai.stigmer.agentic.run.v1.GetSessionUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetSessionUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's runs of the agent. Requires can_view on the
     * organization named in org; runs outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput getAgentUsageReport(ai.stigmer.agentic.run.v1.GetAgentUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetAgentUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput getOrgUsageReport(ai.stigmer.agentic.run.v1.GetOrgUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetOrgUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get aggregated run statistics for an organization's runs.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    public ai.stigmer.agentic.run.v1.RunSummary getRunSummary(ai.stigmer.agentic.run.v1.GetRunSummaryRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetRunSummaryMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service RunQueryController.
   * <pre>
   * RunQueryController handles read operations for runs.
   * </pre>
   */
  public static final class RunQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<RunQueryControllerFutureStub> {
    private RunQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single run by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.Run> get(
        ai.stigmer.agentic.run.v1.RunId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all runs with pagination and optional filtering.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.RunList> list(
        ai.stigmer.agentic.run.v1.ListRunsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all runs in a specific session.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.RunList> listBySession(
        ai.stigmer.agentic.run.v1.ListRunsBySessionRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListBySessionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a presigned download URL for a run artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during the run, or an attachment submitted with the
     * run. The URL can be used with a simple HTTP GET request without
     * authentication.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse> getArtifactDownloadUrl(
        ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetArtifactDownloadUrlMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Read the raw content of a run artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.GetArtifactContentResponse> getArtifactContent(
        ai.stigmer.agentic.run.v1.GetArtifactContentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetArtifactContentMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a usage report for a single run.
     * Returns aggregated tokens, cost, and per-model breakdown for one run.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.GetRunUsageReportOutput> getRunUsageReport(
        ai.stigmer.agentic.run.v1.GetRunUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetRunUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-run breakdown.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput> getSessionUsageReport(
        ai.stigmer.agentic.run.v1.GetSessionUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetSessionUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's runs of the agent. Requires can_view on the
     * organization named in org; runs outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput> getAgentUsageReport(
        ai.stigmer.agentic.run.v1.GetAgentUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetAgentUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput> getOrgUsageReport(
        ai.stigmer.agentic.run.v1.GetOrgUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetOrgUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get aggregated run statistics for an organization's runs.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.run.v1.RunSummary> getRunSummary(
        ai.stigmer.agentic.run.v1.GetRunSummaryRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetRunSummaryMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST = 1;
  private static final int METHODID_LIST_BY_SESSION = 2;
  private static final int METHODID_SUBSCRIBE = 3;
  private static final int METHODID_GET_ARTIFACT_DOWNLOAD_URL = 4;
  private static final int METHODID_GET_ARTIFACT_CONTENT = 5;
  private static final int METHODID_GET_RUN_USAGE_REPORT = 6;
  private static final int METHODID_GET_SESSION_USAGE_REPORT = 7;
  private static final int METHODID_GET_AGENT_USAGE_REPORT = 8;
  private static final int METHODID_GET_ORG_USAGE_REPORT = 9;
  private static final int METHODID_GET_RUN_SUMMARY = 10;

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
          serviceImpl.get((ai.stigmer.agentic.run.v1.RunId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.run.v1.ListRunsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.RunList>) responseObserver);
          break;
        case METHODID_LIST_BY_SESSION:
          serviceImpl.listBySession((ai.stigmer.agentic.run.v1.ListRunsBySessionRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.RunList>) responseObserver);
          break;
        case METHODID_SUBSCRIBE:
          serviceImpl.subscribe((ai.stigmer.agentic.run.v1.RunId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.Run>) responseObserver);
          break;
        case METHODID_GET_ARTIFACT_DOWNLOAD_URL:
          serviceImpl.getArtifactDownloadUrl((ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse>) responseObserver);
          break;
        case METHODID_GET_ARTIFACT_CONTENT:
          serviceImpl.getArtifactContent((ai.stigmer.agentic.run.v1.GetArtifactContentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetArtifactContentResponse>) responseObserver);
          break;
        case METHODID_GET_RUN_USAGE_REPORT:
          serviceImpl.getRunUsageReport((ai.stigmer.agentic.run.v1.GetRunUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetRunUsageReportOutput>) responseObserver);
          break;
        case METHODID_GET_SESSION_USAGE_REPORT:
          serviceImpl.getSessionUsageReport((ai.stigmer.agentic.run.v1.GetSessionUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput>) responseObserver);
          break;
        case METHODID_GET_AGENT_USAGE_REPORT:
          serviceImpl.getAgentUsageReport((ai.stigmer.agentic.run.v1.GetAgentUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput>) responseObserver);
          break;
        case METHODID_GET_ORG_USAGE_REPORT:
          serviceImpl.getOrgUsageReport((ai.stigmer.agentic.run.v1.GetOrgUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput>) responseObserver);
          break;
        case METHODID_GET_RUN_SUMMARY:
          serviceImpl.getRunSummary((ai.stigmer.agentic.run.v1.GetRunSummaryRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.run.v1.RunSummary>) responseObserver);
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
              ai.stigmer.agentic.run.v1.RunId,
              ai.stigmer.agentic.run.v1.Run>(
                service, METHODID_GET)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.ListRunsRequest,
              ai.stigmer.agentic.run.v1.RunList>(
                service, METHODID_LIST)))
        .addMethod(
          getListBySessionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.ListRunsBySessionRequest,
              ai.stigmer.agentic.run.v1.RunList>(
                service, METHODID_LIST_BY_SESSION)))
        .addMethod(
          getSubscribeMethod(),
          io.grpc.stub.ServerCalls.asyncServerStreamingCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.RunId,
              ai.stigmer.agentic.run.v1.Run>(
                service, METHODID_SUBSCRIBE)))
        .addMethod(
          getGetArtifactDownloadUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlRequest,
              ai.stigmer.agentic.run.v1.GetArtifactDownloadUrlResponse>(
                service, METHODID_GET_ARTIFACT_DOWNLOAD_URL)))
        .addMethod(
          getGetArtifactContentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.GetArtifactContentRequest,
              ai.stigmer.agentic.run.v1.GetArtifactContentResponse>(
                service, METHODID_GET_ARTIFACT_CONTENT)))
        .addMethod(
          getGetRunUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.GetRunUsageReportInput,
              ai.stigmer.agentic.run.v1.GetRunUsageReportOutput>(
                service, METHODID_GET_RUN_USAGE_REPORT)))
        .addMethod(
          getGetSessionUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.GetSessionUsageReportInput,
              ai.stigmer.agentic.run.v1.GetSessionUsageReportOutput>(
                service, METHODID_GET_SESSION_USAGE_REPORT)))
        .addMethod(
          getGetAgentUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.GetAgentUsageReportInput,
              ai.stigmer.agentic.run.v1.GetAgentUsageReportOutput>(
                service, METHODID_GET_AGENT_USAGE_REPORT)))
        .addMethod(
          getGetOrgUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.GetOrgUsageReportInput,
              ai.stigmer.agentic.run.v1.GetOrgUsageReportOutput>(
                service, METHODID_GET_ORG_USAGE_REPORT)))
        .addMethod(
          getGetRunSummaryMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.run.v1.GetRunSummaryRequest,
              ai.stigmer.agentic.run.v1.RunSummary>(
                service, METHODID_GET_RUN_SUMMARY)))
        .build();
  }

  private static abstract class RunQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    RunQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.run.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("RunQueryController");
    }
  }

  private static final class RunQueryControllerFileDescriptorSupplier
      extends RunQueryControllerBaseDescriptorSupplier {
    RunQueryControllerFileDescriptorSupplier() {}
  }

  private static final class RunQueryControllerMethodDescriptorSupplier
      extends RunQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    RunQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (RunQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new RunQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListMethod())
              .addMethod(getListBySessionMethod())
              .addMethod(getSubscribeMethod())
              .addMethod(getGetArtifactDownloadUrlMethod())
              .addMethod(getGetArtifactContentMethod())
              .addMethod(getGetRunUsageReportMethod())
              .addMethod(getGetSessionUsageReportMethod())
              .addMethod(getGetAgentUsageReportMethod())
              .addMethod(getGetOrgUsageReportMethod())
              .addMethod(getGetRunSummaryMethod())
              .build();
        }
      }
    }
    return result;
  }
}
