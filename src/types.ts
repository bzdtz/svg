export interface ViewState {
  scale: number;
  x: number;
  y: number;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export type EditableElement = SVGGraphicsElement & SVGElement;

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export interface HistorySnapshot {
  svg: string;
  selectedIds: string[];
  lockedIds: string[];
}

export interface WheelScaleTarget {
  node: EditableElement;
  transform: string | null;
}

export interface WheelScaleSession {
  targetIds: string[];
  targets: WheelScaleTarget[];
  cx: number;
  cy: number;
  factor: number;
}

export type PointerState =
  | {
      type: "drag";
      start: DOMPoint;
      dx: number;
      dy: number;
      moved: boolean;
      targets: DragTarget[];
      frame: number | null;
    }
  | {
      type: "pan";
      startX: number;
      startY: number;
      viewX: number;
      viewY: number;
    }
  | {
      type: "box";
      startX: number;
      startY: number;
      areaLeft: number;
      areaTop: number;
    }
  | {
      type: "resize";
      node: EditableElement;
      handle: ResizeHandle;
      start: DOMPoint;
      box: BBox;
      transform: string | null;
      moved: boolean;
    };

export interface EditorState {
  svg: SVGSVGElement | null;
  selected: Set<string>;
  locked: Set<string>;
  history: HistorySnapshot[];
  redo: HistorySnapshot[];
  view: ViewState;
  pointer: PointerState | null;
  idSeed: number;
  lastSnapshot: string;
  propertyCommitTimer?: number;
  wheelScaleTimer?: number;
  wheelScaleSession?: WheelScaleSession;
}

export interface DragTarget {
  node: EditableElement;
  transform: string | null;
  start: DOMPoint;
  dx: number;
  dy: number;
}

export interface ParseError {
  ok: false;
  message: string;
}

export type ParseSvgResult = SVGSVGElement | ParseError;

export function isParseError(result: ParseSvgResult): result is ParseError {
  return "ok" in result && result.ok === false;
}
