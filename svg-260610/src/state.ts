import type { EditorState } from "./types";

export function createEditorState(): EditorState {
  return {
    svg: null,
    selected: new Set<string>(),
    locked: new Set<string>(),
    history: [],
    redo: [],
    view: { scale: 1, x: 40, y: 40 },
    pointer: null,
    idSeed: 1,
    lastSnapshot: "",
  };
}
