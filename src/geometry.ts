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

// 把 SVG 空间的矩形映射回节点自身的属性坐标系；映射后出现旋转时返回 null（写不成矩形属性）。
function localSpaceBox(
  node: EditableElement,
  x: number,
  y: number,
  width: number,
  height: number,
): BBox | null {
  const svg = node.ownerSVGElement;
  const nodeMatrix = node.getScreenCTM();
  const svgMatrix = svg?.getScreenCTM();
  if (!nodeMatrix || !svgMatrix) return null;

  const toLocal = svgMatrix.inverse().multiply(nodeMatrix).inverse();
  const p0 = new DOMPoint(x, y).matrixTransform(toLocal);
  const p1 = new DOMPoint(x + width, y).matrixTransform(toLocal);
  const p3 = new DOMPoint(x, y + height).matrixTransform(toLocal);

  if (Math.abs(p0.y - p1.y) > 0.5 || Math.abs(p0.x - p3.x) > 0.5) return null;

  const minX = Math.min(p0.x, p1.x);
  const maxX = Math.max(p0.x, p1.x);
  const minY = Math.min(p0.y, p3.y);
  const maxY = Math.max(p0.y, p3.y);
  const widthLocal = maxX - minX;
  const heightLocal = maxY - minY;
  if (widthLocal <= 0 || heightLocal <= 0) return null;

  return {
    x: minX,
    y: minY,
    width: widthLocal,
    height: heightLocal,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function mapCoord(value: number, from: BBox, to: BBox, horizontal: boolean): number {
  if (horizontal) {
    const factor = from.width > 0 ? to.width / from.width : 1;
    return to.x + (value - from.x) * factor;
  }
  const factor = from.height > 0 ? to.height / from.height : 1;
  return to.y + (value - from.y) * factor;
}

function aspectChanged(from: BBox, to: BBox): boolean {
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return true;
  const before = from.width / from.height;
  const after = to.width / to.height;
  return Math.abs(before - after) / Math.max(before, after) > 0.02;
}

const NUMBER_LIST_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

// 把缩放结果写成原生几何属性（r / rx / ry / x1-y2 / points / x-y-width-height），
// 导出文件里就不会残留一串无意义的 scale(...)。写不成时返回 false，由调用方回退到 transform。
// from / to 均为 SVG 空间，内部会映射回节点的属性坐标系。
function writeNativeGeometry(node: EditableElement, from: BBox, to: BBox): boolean {
  const type = node.tagName.toLowerCase();
  if (!Number.isFinite(to.width) || !Number.isFinite(to.height)) return false;

  // 圆没有 ry，非等比缩放会把它拉成椭圆，只能走 transform。
  if (type === "circle" && aspectChanged(from, to)) return false;

  const localFrom = localSpaceBox(node, from.x, from.y, from.width, from.height);
  const localTo = localSpaceBox(node, to.x, to.y, to.width, to.height);
  if (!localFrom || !localTo) return false;

  if (type === "circle") {
    node.setAttribute("cx", String(round(localTo.cx)));
    node.setAttribute("cy", String(round(localTo.cy)));
    node.setAttribute("r", String(round(Math.max(0.1, localTo.width / 2))));
    return true;
  }

  if (type === "ellipse") {
    node.setAttribute("cx", String(round(localTo.cx)));
    node.setAttribute("cy", String(round(localTo.cy)));
    node.setAttribute("rx", String(round(Math.max(0.1, localTo.width / 2))));
    node.setAttribute("ry", String(round(Math.max(0.1, localTo.height / 2))));
    return true;
  }

  if (type === "rect") {
    node.setAttribute("x", String(round(localTo.x)));
    node.setAttribute("y", String(round(localTo.y)));
    node.setAttribute("width", String(round(Math.max(0.1, localTo.width))));
    node.setAttribute("height", String(round(Math.max(0.1, localTo.height))));
    if (node.hasAttribute("rx")) {
      node.setAttribute("rx", String(round(parseNumber(node.getAttribute("rx")) * (localFrom.width > 0 ? localTo.width / localFrom.width : 1))));
    }
    if (node.hasAttribute("ry")) {
      node.setAttribute("ry", String(round(parseNumber(node.getAttribute("ry")) * (localFrom.height > 0 ? localTo.height / localFrom.height : 1))));
    }
    return true;
  }

  if (type === "image") {
    node.setAttribute("x", String(round(localTo.x)));
    node.setAttribute("y", String(round(localTo.y)));
    node.setAttribute("width", String(round(Math.max(0.1, localTo.width))));
    node.setAttribute("height", String(round(Math.max(0.1, localTo.height))));
    return true;
  }

  if (type === "line") {
    node.setAttribute("x1", String(round(mapCoord(parseNumber(node.getAttribute("x1"), localFrom.x), localFrom, localTo, true))));
    node.setAttribute("y1", String(round(mapCoord(parseNumber(node.getAttribute("y1"), localFrom.y), localFrom, localTo, false))));
    node.setAttribute("x2", String(round(mapCoord(parseNumber(node.getAttribute("x2"), localFrom.x), localFrom, localTo, true))));
    node.setAttribute("y2", String(round(mapCoord(parseNumber(node.getAttribute("y2"), localFrom.y), localFrom, localTo, false))));
    return true;
  }

  if (type === "polygon" || type === "polyline") {
    const nums = (node.getAttribute("points") || "").match(NUMBER_LIST_RE);
    if (!nums || nums.length < 2) return false;
    const pairs: string[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = Number(nums[i]);
      const y = Number(nums[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      pairs.push(`${round(mapCoord(x, localFrom, localTo, true))},${round(mapCoord(y, localFrom, localTo, false))}`);
    }
    node.setAttribute("points", pairs.join(" "));
    return true;
  }

  return false;
}

// 把手柄缩放的结果写回原生几何属性（circle 的 r、ellipse 的 rx/ry、line 的 x1-y2 等）。
// 不能原生表达时（text、g、path、祖先带旋转）返回 false，调用方保留 transform。
// 调用前需要先把拖拽期间挂上去的 transform 移除，让节点回到 from 对应的几何状态。
export function bakeResizeToNative(node: EditableElement, from: BBox, to: BBox): boolean {
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return false;
  if (!Number.isFinite(to.width) || !Number.isFinite(to.height)) return false;
  return writeNativeGeometry(node, from, to);
}

export function scaleNodeAbout(
  node: EditableElement,
  cx: number,
  cy: number,
  factor: number,
): void {
  if (!Number.isFinite(factor) || factor <= 0) return;

  // 没有 transform 时优先写原生属性，避免批量缩放把每个图元都堆上 scale(...)。
  if (!node.getAttribute("transform")) {
    const from = visualBBox(node);
    if (from.width > 0 && from.height > 0) {
      const to: BBox = {
        x: cx + (from.x - cx) * factor,
        y: cy + (from.y - cy) * factor,
        width: from.width * factor,
        height: from.height * factor,
        cx: cx + (from.cx - cx) * factor,
        cy: cy + (from.cy - cy) * factor,
      };
      if (writeNativeGeometry(node, from, to)) return;
    }
  }

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

  // 还没有 transform 时优先写原生属性：拖圆形的句柄会真正改 r，导出文件也更干净。
  if (!node.getAttribute("transform")) {
    const to: BBox = {
      x: box.x,
      y: box.y,
      width: newWidth,
      height: newHeight,
      cx: box.x + newWidth / 2,
      cy: box.y + newHeight / 2,
    };
    if (writeNativeGeometry(node, box, to)) return;
  }

  appendTransform(
    node,
    `translate(${round(box.x)} ${round(box.y)}) scale(${round(sx)} ${round(sy)}) translate(${round(-box.x)} ${round(-box.y)})`,
  );
}
