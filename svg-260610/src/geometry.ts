import { SIMPLE_POSITION_TAGS } from "./constants";
import { scalePathData, translatePathData } from "./pathData";
import type { BBox, EditableElement } from "./types";

export function parseNumber(value: string | null | undefined, fallback = 0): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : fallback;
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function safeBBox(node: EditableElement): BBox {
  try {
    const b = node.getBBox();
    return {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      cx: b.x + b.width / 2,
      cy: b.y + b.height / 2,
    };
  } catch {
    return { x: 0, y: 0, width: 0, height: 0, cx: 0, cy: 0 };
  }
}

function cornersOf(box: BBox): DOMPoint[] {
  return [
    new DOMPoint(box.x, box.y),
    new DOMPoint(box.x + box.width, box.y),
    new DOMPoint(box.x + box.width, box.y + box.height),
    new DOMPoint(box.x, box.y + box.height),
  ];
}

export function visualBBox(node: EditableElement): BBox {
  const box = safeBBox(node);
  const svg = node.ownerSVGElement;
  const nodeMatrix = node.getScreenCTM();
  const svgMatrix = svg?.getScreenCTM();
  if (!nodeMatrix || !svgMatrix) return box;

  const toSvg = svgMatrix.inverse().multiply(nodeMatrix);
  const points = cornersOf(box).map((point) => point.matrixTransform(toSvg));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

export function unionBBox(nodes: EditableElement[]): BBox | null {
  const boxes = nodes.map(visualBBox).filter((b) => Number.isFinite(b.x));
  if (!boxes.length) return null;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function appendTransform(node: EditableElement, transform: string): void {
  const old = node.getAttribute("transform") || "";
  node.setAttribute("transform", `${transform} ${old}`.trim());
}

function parseTranslate(transform: string): { dx: number; dy: number; rest: string } | null {
  const match = transform.match(/^\s*translate\(\s*([+-]?(?:\d*\.)?\d+(?:e[-+]?\d+)?)(?:[\s,]+([+-]?(?:\d*\.)?\d+(?:e[-+]?\d+)?))?\s*\)\s*/i);
  if (!match) return null;

  const dx = Number(match[1]);
  const dy = match[2] == null ? 0 : Number(match[2]);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return { dx, dy, rest: transform.slice(match[0].length).trim() };
}

function setTransformOrRemove(node: EditableElement, transform: string): void {
  const value = transform.trim();
  if (value) node.setAttribute("transform", value);
  else node.removeAttribute("transform");
}

export function addTranslate(node: EditableElement, dx: number, dy: number): void {
  if (!dx && !dy) return;
  const old = node.getAttribute("transform") || "";
  const leading = parseTranslate(old);
  if (!leading) {
    appendTransform(node, `translate(${round(dx)} ${round(dy)})`);
    return;
  }

  const nextDx = round(leading.dx + dx);
  const nextDy = round(leading.dy + dy);
  const merged = nextDx || nextDy ? `translate(${nextDx} ${nextDy})` : "";
  setTransformOrRemove(node, `${merged} ${leading.rest}`);
}

function translatePoints(points: string, dx: number, dy: number): string {
  const nums = points.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!nums || nums.length < 2) return points;

  const translated: string[] = [];
  for (let i = 0; i < nums.length; i += 2) {
    const x = Number(nums[i]);
    const y = Number(nums[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    translated.push(`${round(x + dx)},${round(y + dy)}`);
  }
  return translated.join(" ");
}

export function moveNode(node: EditableElement, dx: number, dy: number): void {
  if (!dx && !dy) return;

  if (node.getAttribute("transform")) {
    addTranslate(node, dx, dy);
    return;
  }

  const type = node.tagName.toLowerCase();
  if (type === "path" && !node.getAttribute("transform")) {
    const d = node.getAttribute("d");
    const moved = d ? translatePathData(d, dx, dy) : null;
    if (moved) {
      node.setAttribute("d", moved);
      return;
    }
  }

  if (SIMPLE_POSITION_TAGS.has(type)) {
    const box = safeBBox(node);
    node.setAttribute("x", String(round(parseNumber(node.getAttribute("x"), box.x) + dx)));
    node.setAttribute("y", String(round(parseNumber(node.getAttribute("y"), box.y) + dy)));
    return;
  }

  if (type === "circle" || type === "ellipse") {
    const box = safeBBox(node);
    node.setAttribute("cx", String(round(parseNumber(node.getAttribute("cx"), box.cx) + dx)));
    node.setAttribute("cy", String(round(parseNumber(node.getAttribute("cy"), box.cy) + dy)));
    return;
  }

  if (type === "line") {
    ["x1", "x2"].forEach((attr) => {
      node.setAttribute(attr, String(round(parseNumber(node.getAttribute(attr)) + dx)));
    });
    ["y1", "y2"].forEach((attr) => {
      node.setAttribute(attr, String(round(parseNumber(node.getAttribute(attr)) + dy)));
    });
    return;
  }

  if (type === "polygon" || type === "polyline") {
    node.setAttribute("points", translatePoints(node.getAttribute("points") || "", dx, dy));
    return;
  }

  addTranslate(node, dx, dy);
}

export function scaleNodeAbout(
  node: EditableElement,
  cx: number,
  cy: number,
  factor: number,
): void {
  if (!Number.isFinite(factor) || factor <= 0) return;
  if (node.tagName.toLowerCase() === "path" && !node.getAttribute("transform")) {
    const d = node.getAttribute("d");
    const scaled = d ? scalePathData(d, cx, cy, factor) : null;
    if (scaled) {
      node.setAttribute("d", scaled);
      return;
    }
  }
  appendTransform(
    node,
    `translate(${round(cx)} ${round(cy)}) scale(${round(factor)}) translate(${round(-cx)} ${round(-cy)})`,
  );
}

export function scaleNodeAboutWithTransform(
  node: EditableElement,
  cx: number,
  cy: number,
  factor: number,
): void {
  if (!Number.isFinite(factor) || factor <= 0) return;
  appendTransform(
    node,
    `translate(${round(cx)} ${round(cy)}) scale(${round(factor)}) translate(${round(-cx)} ${round(-cy)})`,
  );
}

export function scaleNodeToBox(
  node: EditableElement,
  box: BBox,
  newWidth: number,
  newHeight: number,
): void {
  if (box.width <= 0 || box.height <= 0) return;
  const sx = newWidth / box.width;
  const sy = newHeight / box.height;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return;
  appendTransform(
    node,
    `translate(${round(box.x)} ${round(box.y)}) scale(${round(sx)} ${round(sy)}) translate(${round(-box.x)} ${round(-box.y)})`,
  );
}
