import type { Graph } from "@agent-world/core";

/** Smallest graph that still exercises the rework loop: forge -> gate -> back to forge. */
export const SEED_GRAPH: Graph = {
  id: "seed",
  name: "Pilot Line",
  nodes: [
    { id: "intake", kind: "source", name: "INTAKE", x: 120, y: 300 },
    {
      id: "forge",
      kind: "agent",
      name: "FORGE",
      x: 420,
      y: 300,
      agent: { model: "claude-sonnet-5", prompt: "Draft the artifact.", skills: [] },
    },
    {
      id: "critic",
      kind: "gate",
      name: "CRITIC",
      x: 720,
      y: 300,
      gate: { maxAttempts: 3, criterion: "Is the artifact complete?", onExhausted: "halt" },
    },
    {
      id: "shipyard",
      kind: "agent",
      name: "SHIPYARD",
      x: 1000,
      y: 300,
      agent: { model: "claude-sonnet-5", prompt: "Package for delivery.", skills: [] },
    },
    { id: "depot", kind: "sink", name: "DEPOT", x: 1260, y: 300 },
  ],
  edges: [
    { id: "e1", from: "intake", to: "forge", kind: "flow" },
    { id: "e2", from: "forge", to: "critic", kind: "flow" },
    { id: "e3", from: "critic", to: "shipyard", kind: "flow" },
    { id: "e4", from: "shipyard", to: "depot", kind: "flow" },
    { id: "r1", from: "critic", to: "forge", kind: "rework" },
  ],
};
