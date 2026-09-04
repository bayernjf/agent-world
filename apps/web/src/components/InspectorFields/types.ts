import type { Graph, GraphNode } from "@agent-world/core";
import type { TFunction } from "i18next";
import type { Modality } from "../../lib/api";

/** A flattened model option shown in the per-node model selects. */
export interface ModelOption {
  model: string;
  provider: string;
  modality: Modality;
}

/**
 * Shared props passed to every node-field component. A field component only
 * reads the slice it needs; the full set is threaded from Inspector so the
 * field components stay stateless and pure.
 */
export interface FieldsProps {
  node: GraphNode;
  graph: Graph;
  updateNode: (id: string, patch: Partial<GraphNode>) => void;
  beginEdit: () => void;
  commitEdit: () => void;
  t: TFunction;
  onOpenSettings: () => void;
  textModelOptions: ModelOption[];
  imageModelOptions: ModelOption[];
  videoModelOptions: ModelOption[];
  audioModelOptions: ModelOption[];
  /** Saved graphs for the subprocess node's graph picker. */
  graphs: { id: string; name: string }[];
  duplicateLanes: (fanoutId: string) => void;
  arrangeLanes: (fanoutId: string) => void;
}
