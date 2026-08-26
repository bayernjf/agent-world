import { useStore } from "zustand";
import { useGraph } from "../store/graph";
import Tooltip from "./Tooltip";

/**
 * Undo/redo controls for the graph document. History lengths come from zundo,
 * while the graph actions ensure undo/redo also triggers autosave. Runtime
 * state is intentionally not undoable.
 */
export default function UndoRedo() {
  const pastLen = useStore(useGraph.temporal, (s) => s.pastStates.length);
  const futureLen = useStore(useGraph.temporal, (s) => s.futureStates.length);
  const undo = useGraph((s) => s.undo);
  const redo = useGraph((s) => s.redo);
  const canUndo = pastLen > 0;
  const canRedo = futureLen > 0;

  return (
    <div className="undo-redo">
      <Tooltip content={canUndo ? "撤销 (⌘Z)" : "暂无可撤销操作"}>
        <button
          type="button"
          className="icon-btn"
          onClick={() => undo()}
          disabled={!canUndo}
          aria-label="撤销"
        >
          ↶
        </button>
      </Tooltip>
      <Tooltip content={canRedo ? "重做 (⌘⇧Z)" : "暂无可重做操作"}>
        <button
          type="button"
          className="icon-btn"
          onClick={() => redo()}
          disabled={!canRedo}
          aria-label="重做"
        >
          ↷
        </button>
      </Tooltip>
    </div>
  );
}
