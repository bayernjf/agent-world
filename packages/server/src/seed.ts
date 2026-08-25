import { Graph } from "@agent-world/core";

/** Smallest graph that still exercises the rework loop: forge -> gate -> back to forge. */
export const SEED_GRAPH = Graph.parse({
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
      agent: {
        model: "agnes-2.0-flash",
        prompt:
          "You are a writer on an assembly line. Given the task brief from intake, produce a concise first draft in 2-3 sentences.",
        skills: [],
      },
    },
    {
      id: "critic",
      kind: "gate",
      name: "CRITIC",
      x: 720,
      y: 300,
      gate: {
        maxAttempts: 3,
        criterion: "The draft must be at least 2 sentences and mention the core subject.",
        onExhausted: "halt",
      },
    },
    {
      id: "shipyard",
      kind: "agent",
      name: "SHIPYARD",
      x: 1000,
      y: 300,
      agent: {
        model: "agnes-2.0-flash",
        prompt: "Polish the approved draft into final form. Keep it under 5 sentences.",
        skills: [],
      },
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
});
