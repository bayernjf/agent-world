import { useStore } from "zustand";
import { useGraph } from "../store/graph";

/**
 * Undo/redo controls for the graph document. zundo exposes a vanilla StoreApi
 * at useGraph.temporal, so we read it with useStore to stay reactive. Runtime
 * state is intentionally not undoable.
 */
export default function UndoRedo() {
  const pastLen = useStore(useGraph.temporal, (s) => s.pastStates.length);
  const futureLen = useStore(useGraph.temporal, (s) => s.futureStates.length);
  const undo = useStore(useGraph.temporal, (s) => s.undo);
  const redo = useStore(useGraph.temporal, (s) => s.redo);

  return (
    <div className="undo-redo">
      <button
        className="icon-btn"
        onClick={() => undo()}
        disabled={pastLen === 0}
        title="撤销 (⌘Z)"
        aria-label="撤销"
      >
        ↶
      </button>
      <button
        className="icon-btn"
        onClick={() => redo()}
        disabled={futureLen === 0}
        title="重做 (⌘⇧Z)"
        aria-label="重做"
      >
        ↷
      </button>
    </div>
  );
}
