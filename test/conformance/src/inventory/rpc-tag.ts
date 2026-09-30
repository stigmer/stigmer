// The RPC contract tag: `[rpc:<Service>.<method>]` in a test or describe
// title claims that the test pins that RPC's promise and sends it.
// Domain: conformance inventory (the RPC contract).
//
// One grammar for both readers: the static contract check scans suite
// sources with it, and the call verdict reads a running test's full name with
// it, so the two can never disagree on what a tag is. A leaf module with no
// imports on purpose: the recorder loads it into every conformance worker,
// and the checker's YAML and schema machinery has no business there.
//
// <Service> is the service's short name (the last segment of its proto type
// name, unique across the API) and <method> the proto method name, exactly as
// the generated descriptors spell them: `[rpc:AgentCommandController.create]`.
const SERVICE = "[A-Z][A-Za-z0-9]*";
const METHOD = "[a-z][A-Za-z0-9]*";
const RPC_TAG_PATTERN = new RegExp(`\\[rpc:(${SERVICE})\\.(${METHOD})\\]`, "g");

// A bare `<Service>.<method>` key, as the waiver file names an RPC.
export const RPC_KEY_PATTERN = new RegExp(`^${SERVICE}\\.${METHOD}$`);

// The `<Service>.<method>` key of every tag in `text`, in order of
// appearance, repeats included.
export function extractRpcTags(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(RPC_TAG_PATTERN)) {
    keys.push(`${match[1]}.${match[2]}`);
  }
  return keys;
}

// The key an RPC is recorded and tagged under, from its descriptor's fully
// qualified service type name and its method name.
export function rpcKey(serviceTypeName: string, methodName: string): string {
  const service = serviceTypeName.slice(serviceTypeName.lastIndexOf(".") + 1);
  return `${service}.${methodName}`;
}
