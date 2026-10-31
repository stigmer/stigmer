// `get environment`: what a conversation's sandbox may reach and what it has
// installed. The network (unrestricted, or limited to its hosts, with the
// package registries and the agent's MCP servers reachable or not), the
// hosts a limited sandbox may reach, and the packages by manager
// (apis/ai/stigmer/agentic/environment/v1/spec.proto). `list environments`
// counts the hosts and packages; this is where they are listed.

import { obj, str } from "../render.js";
import type { Field, KindView } from "./view.js";
import { strings } from "./words.js";

// The managers in the order the proto declares them.
const MANAGERS = ["apt", "cargo", "gem", "go", "npm", "pip"] as const;

export const environmentView: KindView = {
  sections: (json) => {
    const spec = obj(json, "spec");
    const networking = obj(spec, "networking");
    const packages = obj(spec, "packages");
    const limited = str(networking, "type") === "limited";
    return [
      {
        fields: [
          ["Description", str(spec, "description")],
          ["Network", limited ? "limited to its hosts" : "unrestricted"],
          ["Package registries", limited ? reachable(networking.allow_package_managers === true) : undefined],
          ["MCP servers", limited ? reachable(networking.allow_mcp_servers === true) : undefined],
        ],
      },
      { title: "Allowed hosts", lines: strings(networking.allowed_hosts) },
      {
        title: "Packages",
        fields: MANAGERS.map((manager): Field => [manager, strings(packages[manager]).join(", ")]),
      },
    ];
  },
};

function reachable(allowed: boolean): string {
  return allowed ? "reachable" : "not reachable";
}
