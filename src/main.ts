import "./styles.css";

import { createEditorState } from "./state";
import { cleanClone, parseSvgSource, normalizeSvgSize, getEditableElements, serializeSvg, serializeSvgForHistory } from "./svg";
import {
  bakeResizeToNative,
  moveNode,
  parseNumber,
  round,
  scaleNodeAbout,
  scaleNodeAboutWithTransform,
  scaleNodeToBox,
  unionBBox,
  visualBBox,
} from "./geometry";
import {
  isParseError,
  type BBox,
  type DragTarget,
  type EditableElement,
  type HistorySnapshot,
  type PointerState,
  type ResizeHandle,
  type WheelScaleSession,
} from "./types";

const state = createEditorState();
let shouldRevealSelectedLayer = false;

interface Elements {
  landing: HTMLElement;
  app: HTMLElement;
  sourceInput: HTMLTextAreaElement;
  fileInput: HTMLInputElement;
  canvasArea: HTMLElement;
  canvasStage: HTMLElement;
  svgHost: HTMLElement;
  overlay: HTMLElement;
  rubberBand: HTMLElement;
  layerList: HTMLElement;
  layerSearch: HTMLInputElement;
  layerCount: HTMLElement;
  selectedCount: HTMLElement;
  emptyState: HTMLElement;
  singlePanel: HTMLElement;
  multiPanel: HTMLElement;
  textSection: HTMLElement;
  mixedState: HTMLElement;
  paintState: HTMLElement;
  toast: HTMLElement;
  statusText: HTMLElement;
  zoomText: HTMLElement;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const el: Elements = {
  landing: byId("landing"),
  app: byId("app"),
  sourceInput: byId<HTMLTextAreaElement>("sourceInput"),
  fileInput: byId<HTMLInputElement>("fileInput"),
  canvasArea: byId("canvasArea"),
  canvasStage: byId("canvasStage"),
  svgHost: byId("svgHost"),
  overlay: byId("selectionOverlay"),
  rubberBand: byId("rubberBand"),
  layerList: byId("layerList"),
  layerSearch: byId<HTMLInputElement>("layerSearch"),
  layerCount: byId("layerCount"),
  selectedCount: byId("selectedCount"),
  emptyState: byId("emptyState"),
  singlePanel: byId("singlePanel"),
  multiPanel: byId("multiPanel"),
  textSection: byId("textSection"),
  mixedState: byId("mixedState"),
  paintState: byId("paintState"),
  toast: byId("toast"),
  statusText: byId("statusText"),
  zoomText: byId("zoomText"),
};

const resizeHandles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const sampleSvg = `<svg width="900" height="520" viewBox="0 0 900 520" xmlns="http://www.w3.org/2000/svg">
  <rect width="900" height="520" fill="#f8fafc"/>
  <rect x="70" y="80" width="760" height="330" rx="28" fill="#ffffff" stroke="#cbd5e1" stroke-width="3"/>
  <text x="118" y="145" fill="#111827" font-size="42" font-weight="700" font-family="serif">AI Generated SVG</text>
  <text x="128" y="203" fill="#334155" font-size="24" font-family="Times New Roman">文字可能字体不合适，也可能没有对齐</text>
  <rect x="125" y="265" width="185" height="86" rx="16" fill="#2563eb"/>
  <rect x="356" y="250" width="185" height="86" rx="16" fill="#14b8a6"/>
  <rect x="590" y="272" width="185" height="86" rx="16" fill="#f59e0b"/>
  <text x="166" y="318" fill="#ffffff" font-size="22" font-family="Arial">错位</text>
  <text x="406" y="302" fill="#ffffff" font-size="22" font-family="Arial">间距</text>
  <text x="642" y="328" fill="#ffffff" font-size="22" font-family="Arial">字号</text>
</svg>`;

function toast(message: string): void {
  el.toast.textContent = message;
  el.toast.style.display = "block";
  window.clearTimeout((toast as { timer?: number }).timer);
  (toast as { timer?: number }).timer = window.setTimeout(() => {
    el.toast.style.display = "none";
  }, 1800);
}

function getId(node: Element): string | null {
  return node.getAttribute("data-editor-id");
}

function getSelectedElements(): EditableElement[] {
  if (!state.svg) return [];
  return Array.from(state.selected)
    .map((id) => state.svg?.querySelector(`[data-editor-id="${id}"]`) as EditableElement | null)
    .filter((node): node is EditableElement => Boolean(node));
}

function isLocked(nodeOrId: Element | string | null): boolean {
  const id = typeof nodeOrId === "string" ? nodeOrId : nodeOrId ? getId(nodeOrId) : null;
  return Boolean(id && state.locked.has(id));
}

function getEditableSelectedElements(): EditableElement[] {
  return getSelectedElements().filter((node) => !isLocked(node));
}

function selectedIds(): string[] {
  return Array.from(state.selected);
}

function lockedIds(): string[] {
  return Array.from(state.locked);
}

function serializeHistorySvg(): string {
  return state.svg ? serializeSvgForHistory(state.svg) : "";
}

function createHistorySnapshot(): HistorySnapshot | null {
  const svg = serializeHistorySvg();
  if (!svg) return null;
  return {
    svg,
    selectedIds: selectedIds(),
    lockedIds: lockedIds(),
  };
}

function snapshotKey(snapshot: HistorySnapshot): string {
  return JSON.stringify(snapshot);
}

const DRAFT_KEY = "ai-svg-editor:draft:v1";

interface DraftRecord {
  svg: string;
  selectedIds: string[];
  lockedIds: string[];
  savedAt: number;
}

function readDraft(): DraftRecord | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<DraftRecord>;
    if (!data || typeof data.svg !== "string" || !data.svg.trim()) return null;
    const stringIds = (list: unknown) =>
      Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
    return {
      svg: data.svg,
      selectedIds: stringIds(data.selectedIds),
      lockedIds: stringIds(data.lockedIds),
      savedAt: typeof data.savedAt === "number" ? data.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function writeDraft(snapshot: HistorySnapshot): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...snapshot, savedAt: Date.now() }));
  } catch {
    // 隐私模式或配额超限时静默放弃：草稿只是便利功能，不该挡住编辑。
  }
}

function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

function refreshDraftButton(): void {
  byId<HTMLButtonElement>("restoreDraftBtn").classList.toggle("hidden", readDraft() === null);
}

function saveHistory(label?: string): void {
  const snapshot = createHistorySnapshot();
  if (!snapshot) return;
  const key = snapshotKey(snapshot);
  if (key === state.lastSnapshot) return;
  state.history.push(snapshot);
  if (state.history.length > 80) state.history.shift();
  state.redo = [];
  state.lastSnapshot = key;
  updateHistoryButtons();
  if (label) el.statusText.textContent = label;
  writeDraft(snapshot);
}

function filterExistingIds(ids: string[]): string[] {
  if (!state.svg) return [];
  const existing = new Set(getEditableElements(state.svg).map((node) => getId(node)).filter((id): id is string => Boolean(id)));
  return ids.filter((id) => existing.has(id));
}

function restoreSnapshot(snapshot: HistorySnapshot): void {
  const result = parseSvgSource(snapshot.svg);
  if (isParseError(result)) return;
  loadSvgElement(result, false, snapshot);
  state.lastSnapshot = snapshotKey(snapshot);
  updateHistoryButtons();
}

function undo(): void {
  if (state.history.length <= 1) return;
  const current = state.history.pop();
  if (current) state.redo.push(current);
  const previous = state.history[state.history.length - 1];
  restoreSnapshot(previous);
  toast("已撤销");
}

function redo(): void {
  if (!state.redo.length) return;
  const next = state.redo.pop();
  if (!next) return;
  state.history.push(next);
  restoreSnapshot(next);
  toast("已重做");
}

function updateHistoryButtons(): void {
  byId<HTMLButtonElement>("undoBtn").disabled = state.history.length <= 1;
  byId<HTMLButtonElement>("redoBtn").disabled = state.redo.length === 0;
}

function assignEditorIds(preserveExisting = false): void {
  const used = new Set<string>();
  let next = 1;
  const nextId = () => {
    let id = `e${next++}`;
    while (used.has(id)) id = `e${next++}`;
    used.add(id);
    return id;
  };

  getEditableElements(state.svg).forEach((node) => {
    const existing = preserveExisting ? getId(node) : null;
    if (existing && !used.has(existing)) {
      used.add(existing);
      const match = existing.match(/^e(\d+)$/);
      if (match) next = Math.max(next, Number(match[1]) + 1);
      return;
    }
    node.setAttribute("data-editor-id", nextId());
  });
  state.idSeed = next;
}

function clearElementChildren(node: HTMLElement): void {
  node.replaceChildren();
}

function loadSvgElement(svg: SVGSVGElement, resetHistory = true, snapshot?: HistorySnapshot): void {
  normalizeSvgSize(svg);
  clearElementChildren(el.svgHost);
  const imported = document.importNode(svg, true);
  el.svgHost.appendChild(imported);
  state.svg = imported;
  assignEditorIds(!resetHistory);
  state.selected = new Set(snapshot ? filterExistingIds(snapshot.selectedIds) : []);
  state.locked = resetHistory ? new Set<string>() : new Set(snapshot ? filterExistingIds(snapshot.lockedIds) : lockedIds());
  bindSvgEvents();
  fitView();
  renderAll();
  el.landing.classList.add("hidden");
  el.app.classList.remove("hidden");
  if (resetHistory) {
    state.history = [];
    state.redo = [];
    state.lastSnapshot = "";
    saveHistory("已导入 SVG");
  }
}

function loadSvgFromText(text: string): void {
  const result = parseSvgSource(text);
  if (isParseError(result)) {
    toast(result.message);
    return;
  }
  loadSvgElement(result, true);
}

function restoreDraft(): void {
  const record = readDraft();
  if (!record) {
    toast("没有可恢复的草稿");
    return;
  }
  const result = parseSvgSource(record.svg);
  if (isParseError(result)) {
    clearDraft();
    refreshDraftButton();
    toast(result.message);
    return;
  }
  // resetHistory=false 才会保留草稿里的 data-editor-id，选中和锁定才能对上号。
  loadSvgElement(result, false, {
    svg: record.svg,
    selectedIds: record.selectedIds,
    lockedIds: record.lockedIds,
  });
  state.history = [];
  state.redo = [];
  state.lastSnapshot = "";
  saveHistory("已恢复草稿");
  toast("已恢复上次草稿");
}

function bindSvgEvents(): void {
  if (!state.svg) return;
  state.svg.addEventListener("mousedown", (event) => {
    const source = event.target;
    if (!(source instanceof Element)) return;
    const target = source.closest("[data-editor-id]") as EditableElement | null;
    if (!target || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (isLocked(target)) {
      beginBoxSelect(event);
      return;
    }
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    if (additive) {
      selectElement(target, true);
      return;
    }
    const id = getId(target);
    if (id && !state.selected.has(id)) {
      selectElement(target, false);
    }
    beginElementDrag(event);
  });
}

function fitView(): void {
  if (!state.svg) return;
  const area = el.canvasArea.getBoundingClientRect();
  const svgBox = state.svg.getBoundingClientRect();
  const w = parseNumber(state.svg.getAttribute("width"), svgBox.width || 900);
  const h = parseNumber(state.svg.getAttribute("height"), svgBox.height || 600);
  const scale = Math.min((area.width - 80) / w, (area.height - 80) / h, 1.2);
  state.view.scale = Math.max(0.1, Number.isFinite(scale) ? scale : 1);
  state.view.x = Math.max(24, (area.width - w * state.view.scale) / 2);
  state.view.y = Math.max(24, (area.height - h * state.view.scale) / 2);
  applyView();
}

function applyView(): void {
  el.canvasStage.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`;
  el.zoomText.textContent = `${Math.round(state.view.scale * 100)}%`;
  updateSelectionOverlay();
}

function focusElementInView(node: EditableElement): void {
  const box = visualBBox(node);
  if (box.width <= 0 && box.height <= 0) return;
  const area = el.canvasArea.getBoundingClientRect();
  state.view.x = area.width / 2 - box.cx * state.view.scale;
  state.view.y = area.height / 2 - box.cy * state.view.scale;
  applyView();
}

function requestSelectedLayerReveal(): void {
  shouldRevealSelectedLayer = true;
}

function selectElement(node: Element, additive = false): void {
  const id = getId(node);
  if (!id) return;
  if (!additive) state.selected.clear();
  if (additive && state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    state.selected.add(id);
  }
  requestSelectedLayerReveal();
  renderAll();
}

function selectOnlyIds(ids: string[]): void {
  state.selected = new Set(ids);
  requestSelectedLayerReveal();
  renderAll();
}

function clearSelection(): void {
  state.selected.clear();
  renderAll();
}

function toggleLock(id: string): void {
  if (state.locked.has(id)) {
    state.locked.delete(id);
    toast("已解锁元素");
  } else {
    state.locked.add(id);
    toast("已锁定元素");
  }
  renderAll();
}

function syncLockedDomState(): void {
  getEditableElements(state.svg).forEach((node) => {
    const id = getId(node);
    if (id && state.locked.has(id)) node.setAttribute("data-editor-locked", "true");
    else node.removeAttribute("data-editor-locked");
  });
}

function renderAll(): void {
  syncLockedDomState();
  updateLayerList();
  updatePanels();
  updateSelectionOverlay();
  updateHistoryButtons();
}

function updateLayerList(): void {
  const nodes = getEditableElements(state.svg);
  const query = el.layerSearch.value.trim().toLowerCase();
  const visible = query
    ? nodes.filter((node) => `${node.tagName} ${layerName(node)}`.toLowerCase().includes(query))
    : nodes;

  el.layerCount.textContent = String(nodes.length);
  clearElementChildren(el.layerList);

  visible.slice().reverse().forEach((node) => {
    const id = getId(node);
    if (!id) return;

    const item = document.createElement("div");
    item.className = `layer-item${state.selected.has(id) ? " selected" : ""}${state.locked.has(id) ? " locked" : ""}`;
    item.dataset.id = id;

    const type = node.tagName.toLowerCase();
    const typeBadge = document.createElement("span");
    typeBadge.className = `layer-type type-${type}`;
    typeBadge.textContent = typeLabel(type);

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layerName(node);

    const actions = document.createElement("span");
    actions.className = "layer-actions";
    actions.append(makeLockButton(id), makeLayerHint("眼", "隐藏图层预留"));

    item.append(typeBadge, name, actions);
    item.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
      } else {
        state.selected.clear();
        state.selected.add(id);
      }
      focusElementInView(node);
      renderAll();
    });
    el.layerList.appendChild(item);
  });

  if (shouldRevealSelectedLayer) {
    const selectedItem = el.layerList.querySelector<HTMLElement>(".layer-item.selected");
    selectedItem?.scrollIntoView({ block: "center" });
    shouldRevealSelectedLayer = false;
  }
}

function makeLockButton(id: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `layer-hint${state.locked.has(id) ? " active" : ""}`;
  button.type = "button";
  button.textContent = "锁";
  button.title = state.locked.has(id) ? "点击解锁该元素" : "点击锁定该元素";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleLock(id);
  });
  return button;
}

function makeLayerHint(text: string, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "layer-hint";
  button.type = "button";
  button.textContent = text;
  button.title = title;
  button.disabled = true;
  return button;
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    text: "文",
    rect: "矩",
    circle: "圆",
    ellipse: "椭",
    line: "线",
    polygon: "多",
    polyline: "折",
    path: "径",
    g: "组",
    image: "图",
  };
  return map[type] || type.slice(0, 2);
}

function layerName(node: EditableElement): string {
  const type = node.tagName.toLowerCase();
  if (type === "text") return (node.textContent || "文本").trim().slice(0, 42) || "空文本";
  if (node.getAttribute("id")) return `${type} #${node.getAttribute("id")}`;
  if (type === "image") return node.getAttribute("href") || node.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "图片";
  return `${type} ${getId(node)}`;
}

function updateSelectionOverlay(): void {
  clearElementChildren(el.overlay);
  if (!state.svg) return;
  const area = el.canvasArea.getBoundingClientRect();
  const selected = getSelectedElements();
  selected.forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const box = document.createElement("div");
    box.className = `select-rect${isLocked(node) ? " locked" : ""}`;
    box.style.left = `${rect.left - area.left}px`;
    box.style.top = `${rect.top - area.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    if (selected.length === 1 && !isLocked(node)) {
      resizeHandles.forEach((handle) => box.appendChild(makeResizeHandle(handle, node)));
    }
    el.overlay.appendChild(box);
  });
}

function makeResizeHandle(handle: ResizeHandle, node: EditableElement): HTMLDivElement {
  const control = document.createElement("div");
  control.className = `resize-handle handle-${handle}`;
  control.title = "拖动调整尺寸";
  control.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    beginResize(event, node, handle);
  });
  return control;
}

function updatePanels(): void {
  const selected = getSelectedElements();
  el.selectedCount.textContent = String(selected.length);
  el.emptyState.classList.toggle("hidden", selected.length > 0);
  el.singlePanel.classList.toggle("hidden", selected.length !== 1);
  el.multiPanel.classList.toggle("hidden", selected.length < 2);
  el.textSection.classList.add("hidden");
  if (selected.length === 1) fillSinglePanel(selected[0]);
  if (selected.length > 1) fillMultiPanel(selected);
}

function fillSinglePanel(node: EditableElement): void {
  const box = visualBBox(node);
  setInputValue("propX", round(box.x));
  setInputValue("propY", round(box.y));
  setInputValue("propW", round(box.width));
  setInputValue("propH", round(box.height));
  setInputValue("propOpacity", node.getAttribute("opacity") || node.style.opacity || "1");

  const fill = readPaint(node, "fill");
  const stroke = readPaint(node, "stroke");
  setInputValue("propFill", toHex(fill, "#111827"));
  setInputValue("propStroke", toHex(stroke, "#111827"));
  setInputValue("propStrokeWidth", readAttr(node, "stroke-width", "0"));
  setInputValue("propRadius", node.getAttribute("rx") || "0");
  updatePaintState(fill, stroke);

  if (node.tagName.toLowerCase() === "text") {
    el.textSection.classList.remove("hidden");
    setInputValue("propText", node.textContent || "");
    setInputValue("propFont", readAttr(node, "font-family", "Microsoft YaHei, Arial, sans-serif"));
    setInputValue("propFontSize", readAttr(node, "font-size", "24"));
    setInputValue("propFontWeight", readAttr(node, "font-weight", "400"));
    setInputValue("propTextAnchor", readAttr(node, "text-anchor", "start"));
  }
}

function fillMultiPanel(nodes: EditableElement[]): void {
  const mixed = ["fill", "stroke", "font-family", "font-size"]
    .filter((attr) => hasMixedValue(nodes, attr))
    .map((attr) => attr.replace("font-", ""));
  el.mixedState.textContent = mixed.length
    ? `混合属性：${mixed.join(" / ")}。批量修改会覆盖对应值。`
    : "选区属性较一致，可直接批量优化。";
}

function hasMixedValue(nodes: EditableElement[], attr: string): boolean {
  const values = new Set(nodes.map((node) => readAttr(node, attr, "")));
  return values.size > 1;
}

function setInputValue(id: string, value: string | number): void {
  const input = byId<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id);
  input.value = String(value);
}

function readAttr(node: EditableElement, attr: string, fallback: string): string {
  const styleValue = node.style.getPropertyValue(attr) || node.style.getPropertyValue(attrToStyle(attr));
  return node.getAttribute(attr) || styleValue || fallback;
}

function readPaint(node: EditableElement, attr: "fill" | "stroke"): string {
  return node.getAttribute(attr) || node.style.getPropertyValue(attr) || "#111827";
}

function shouldPaintStroke(node: EditableElement): boolean {
  const type = node.tagName.toLowerCase();
  const fill = readPaint(node, "fill").trim();
  const stroke = readPaint(node, "stroke").trim();
  if (type === "line" || type === "polyline") return true;
  if (type !== "path") return false;
  if (fill === "none") return true;
  if (!fill && stroke && stroke !== "none") return true;
  return false;
}

function attrToStyle(attr: string): string {
  return attr.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function toHex(value: string, fallback: string): string {
  if (!value || value === "none" || value.startsWith("url(")) return fallback;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("")}`;
  }
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return fallback;
  ctx.fillStyle = fallback;
  ctx.fillStyle = value;
  return ctx.fillStyle;
}

function updatePaintState(fill: string, stroke: string): void {
  const special = [fill, stroke].some((value) => value === "none" || value.startsWith("url("));
  el.paintState.textContent = special ? "当前颜色含 none 或渐变/图案；修改颜色会替换原效果。" : "";
  el.paintState.classList.toggle("hidden", !special);
}

function screenToSvg(clientX: number, clientY: number): DOMPoint {
  if (!state.svg) return new DOMPoint(clientX, clientY);
  const pt = state.svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const matrix = state.svg.getScreenCTM();
  return matrix ? pt.matrixTransform(matrix.inverse()) : new DOMPoint(clientX, clientY);
}

function screenToParent(node: EditableElement, clientX: number, clientY: number): DOMPoint {
  const parent = node.parentElement;
  const matrix =
    parent instanceof SVGGraphicsElement || parent instanceof SVGSVGElement
      ? parent.getScreenCTM()
      : state.svg?.getScreenCTM();
  const point = new DOMPoint(clientX, clientY);
  return matrix ? point.matrixTransform(matrix.inverse()) : point;
}

function beginElementDrag(event: MouseEvent): void {
  const start = screenToSvg(event.clientX, event.clientY);
  state.pointer = {
    type: "drag",
    start,
    dx: 0,
    dy: 0,
    moved: false,
    targets: getEditableSelectedElements().map((node) => ({
      node,
      transform: node.getAttribute("transform"),
      start: screenToParent(node, event.clientX, event.clientY),
      dx: 0,
      dy: 0,
    })),
    frame: null,
  };
  window.addEventListener("mousemove", handleWindowMove);
  window.addEventListener("mouseup", endPointer);
}

function setTransformPreview(target: DragTarget, dx: number, dy: number): void {
  const preview = `translate(${round(dx)} ${round(dy)})`;
  target.node.setAttribute("transform", `${preview} ${target.transform || ""}`.trim());
}

function restoreDragTargets(targets: DragTarget[]): void {
  targets.forEach(({ node, transform }) => {
    if (transform) node.setAttribute("transform", transform);
    else node.removeAttribute("transform");
  });
}

function restoreTransform(node: EditableElement, transform: string | null): void {
  if (transform) node.setAttribute("transform", transform);
  else node.removeAttribute("transform");
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function beginResize(event: MouseEvent, node: EditableElement, handle: ResizeHandle): void {
  const box = visualBBox(node);
  if (box.width <= 0 || box.height <= 0) {
    toast("该元素尺寸过小，暂时无法拖拽缩放");
    return;
  }

  state.pointer = {
    type: "resize",
    node,
    handle,
    start: screenToSvg(event.clientX, event.clientY),
    box,
    transform: node.getAttribute("transform"),
    moved: false,
  };
  window.addEventListener("mousemove", handleWindowMove);
  window.addEventListener("mouseup", endPointer);
}

function getResizedBox(box: BBox, handle: ResizeHandle, dx: number, dy: number): BBox {
  const minSize = 4;
  let x = box.x;
  let y = box.y;
  let width = box.width;
  let height = box.height;

  if (handle.includes("e")) width = box.width + dx;
  if (handle.includes("s")) height = box.height + dy;
  if (handle.includes("w")) {
    x = box.x + dx;
    width = box.width - dx;
  }
  if (handle.includes("n")) {
    y = box.y + dy;
    height = box.height - dy;
  }

  if (width < minSize) {
    if (handle.includes("w")) x = box.x + box.width - minSize;
    width = minSize;
  }
  if (height < minSize) {
    if (handle.includes("n")) y = box.y + box.height - minSize;
    height = minSize;
  }

  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
}

function applyResize(pointer: Extract<PointerState, { type: "resize" }>, box: BBox): void {
  const sx = box.width / pointer.box.width;
  const sy = box.height / pointer.box.height;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return;

  const dx = box.x - pointer.box.x;
  const dy = box.y - pointer.box.y;
  const resizeTransform = [
    `translate(${round(dx)} ${round(dy)})`,
    `translate(${round(pointer.box.x)} ${round(pointer.box.y)})`,
    `scale(${round(sx)} ${round(sy)})`,
    `translate(${round(-pointer.box.x)} ${round(-pointer.box.y)})`,
    pointer.transform || "",
  ]
    .join(" ")
    .trim();

  pointer.node.setAttribute("transform", resizeTransform);
  updateSelectionOverlay();
}

function previewDrag(pointer: Extract<PointerState, { type: "drag" }>): void {
  pointer.targets.forEach((target) => setTransformPreview(target, target.dx, target.dy));
  if (pointer.frame != null) return;
  pointer.frame = window.requestAnimationFrame(() => {
    pointer.frame = null;
    updateSelectionOverlay();
  });
}

function beginPan(event: MouseEvent): void {
  state.pointer = {
    type: "pan",
    startX: event.clientX,
    startY: event.clientY,
    viewX: state.view.x,
    viewY: state.view.y,
  };
  window.addEventListener("mousemove", handleWindowMove);
  window.addEventListener("mouseup", endPointer);
}

function beginBoxSelect(event: MouseEvent): void {
  const area = el.canvasArea.getBoundingClientRect();
  state.pointer = {
    type: "box",
    startX: event.clientX,
    startY: event.clientY,
    areaLeft: area.left,
    areaTop: area.top,
  };
  el.rubberBand.style.display = "block";
  el.rubberBand.style.left = `${event.clientX - area.left}px`;
  el.rubberBand.style.top = `${event.clientY - area.top}px`;
  el.rubberBand.style.width = "0px";
  el.rubberBand.style.height = "0px";
  window.addEventListener("mousemove", handleWindowMove);
  window.addEventListener("mouseup", endPointer);
}

function handleWindowMove(event: MouseEvent): void {
  if (!state.pointer) return;
  if (state.pointer.type === "drag") {
    const now = screenToSvg(event.clientX, event.clientY);
    const dx = now.x - state.pointer.start.x;
    const dy = now.y - state.pointer.start.y;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      state.pointer.dx = dx;
      state.pointer.dy = dy;
      state.pointer.moved = true;
      state.pointer.targets.forEach((target) => {
        const current = screenToParent(target.node, event.clientX, event.clientY);
        target.dx = current.x - target.start.x;
        target.dy = current.y - target.start.y;
      });
      previewDrag(state.pointer);
    }
  }
  if (state.pointer.type === "resize") {
    const now = screenToSvg(event.clientX, event.clientY);
    const dx = now.x - state.pointer.start.x;
    const dy = now.y - state.pointer.start.y;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      state.pointer.moved = true;
      applyResize(state.pointer, getResizedBox(state.pointer.box, state.pointer.handle, dx, dy));
      updatePanels();
    }
  }
  if (state.pointer.type === "pan") {
    state.view.x = state.pointer.viewX + event.clientX - state.pointer.startX;
    state.view.y = state.pointer.viewY + event.clientY - state.pointer.startY;
    applyView();
  }
  if (state.pointer.type === "box") {
    const left = Math.min(state.pointer.startX, event.clientX) - state.pointer.areaLeft;
    const top = Math.min(state.pointer.startY, event.clientY) - state.pointer.areaTop;
    const width = Math.abs(event.clientX - state.pointer.startX);
    const height = Math.abs(event.clientY - state.pointer.startY);
    el.rubberBand.style.left = `${left}px`;
    el.rubberBand.style.top = `${top}px`;
    el.rubberBand.style.width = `${width}px`;
    el.rubberBand.style.height = `${height}px`;
  }
}

function endPointer(): void {
  if (!state.pointer) return;
  if (state.pointer.type === "drag") {
    if (state.pointer.frame != null) {
      window.cancelAnimationFrame(state.pointer.frame);
    }
    const { moved, targets } = state.pointer;
    restoreDragTargets(targets);
    if (moved) {
      targets.forEach((target) => moveNode(target.node, target.dx, target.dy));
      renderAll();
      saveHistory("已移动元素");
    }
  }
  if (state.pointer.type === "resize") {
    const pointer = state.pointer;
    if (pointer.moved) {
      if (!pointer.transform) {
        // 原本没有 transform：撤掉拖拽期间的预览 transform，把缩放结果写回原生几何属性。
        const finalBox = visualBBox(pointer.node);
        pointer.node.removeAttribute("transform");
        bakeResizeToNative(pointer.node, pointer.box, finalBox);
      }
      renderAll();
      saveHistory("已调整尺寸");
    } else {
      restoreTransform(pointer.node, pointer.transform);
      updateSelectionOverlay();
    }
  }
  if (state.pointer.type === "box") finishBoxSelect();
  state.pointer = null;
  window.removeEventListener("mousemove", handleWindowMove);
  window.removeEventListener("mouseup", endPointer);
}

function finishBoxSelect(): void {
  const band = el.rubberBand.getBoundingClientRect();
  el.rubberBand.style.display = "none";
  if (band.width < 4 && band.height < 4) {
    clearSelection();
    return;
  }
  const ids: string[] = [];
  getEditableElements(state.svg).forEach((node) => {
    const r = node.getBoundingClientRect();
    const hit = !(r.right < band.left || r.left > band.right || r.bottom < band.top || r.top > band.bottom);
    const id = getId(node);
    if (hit && id && !isLocked(id)) ids.push(id);
  });
  selectOnlyIds(ids);
}

function moveSelected(dx: number, dy: number): void {
  getEditableSelectedElements().forEach((node) => moveNode(node, dx, dy));
}

function applySingleGeometry(): void {
  const node = getEditableSelectedElements()[0];
  if (!node) return;
  const box = visualBBox(node);
  const newX = parseNumber(byId<HTMLInputElement>("propX").value, box.x);
  const newY = parseNumber(byId<HTMLInputElement>("propY").value, box.y);
  const newW = parseNumber(byId<HTMLInputElement>("propW").value, box.width);
  const newH = parseNumber(byId<HTMLInputElement>("propH").value, box.height);
  moveNode(node, newX - box.x, newY - box.y);
  const movedBox = visualBBox(node);
  if (Math.abs(newW - movedBox.width) > 0.01 || Math.abs(newH - movedBox.height) > 0.01) {
    scaleNodeToBox(node, movedBox, newW, newH);
  }
  renderAll();
  saveHistory("已更新尺寸");
}

function commitHistorySoon(label: string): void {
  window.clearTimeout(state.propertyCommitTimer);
  state.propertyCommitTimer = window.setTimeout(() => saveHistory(label), 240);
}

function setAttrForSelected(attr: string, value: string, live = false): void {
  getEditableSelectedElements().forEach((node) => {
    if (value === "" || value == null) node.removeAttribute(attr);
    else node.setAttribute(attr, value);
  });
  renderAll();
  if (live) commitHistorySoon("已更新属性");
  else saveHistory("已更新属性");
}

function applyTextProps(live = false): void {
  const node = getEditableSelectedElements()[0];
  if (!node || node.tagName.toLowerCase() !== "text") return;
  node.textContent = byId<HTMLTextAreaElement>("propText").value;
  node.setAttribute("font-family", byId<HTMLSelectElement>("propFont").value);
  node.setAttribute("font-size", byId<HTMLInputElement>("propFontSize").value);
  node.setAttribute("font-weight", byId<HTMLSelectElement>("propFontWeight").value);
  node.setAttribute("text-anchor", byId<HTMLSelectElement>("propTextAnchor").value);
  if (live) {
    updateLayerList();
    updateSelectionOverlay();
    commitHistorySoon("已更新文本");
  } else {
    renderAll();
    saveHistory("已更新文本");
  }
}

function alignSelected(kind: string): void {
  const nodes = getEditableSelectedElements();
  if (nodes.length < 2) {
    toast("至少选择两个元素");
    return;
  }
  const all = unionBBox(nodes);
  if (!all) return;
  const boxes = nodes.map((node) => ({ node, box: visualBBox(node) }));
  const target = {
    left: Math.min(...boxes.map((i) => i.box.x)),
    right: Math.max(...boxes.map((i) => i.box.x + i.box.width)),
    top: Math.min(...boxes.map((i) => i.box.y)),
    bottom: Math.max(...boxes.map((i) => i.box.y + i.box.height)),
    hcenter: all.cx,
    vcenter: all.cy,
  };
  boxes.forEach(({ node, box }) => {
    let dx = 0;
    let dy = 0;
    if (kind === "left") dx = target.left - box.x;
    if (kind === "right") dx = target.right - (box.x + box.width);
    if (kind === "hcenter") dx = target.hcenter - box.cx;
    if (kind === "top") dy = target.top - box.y;
    if (kind === "bottom") dy = target.bottom - (box.y + box.height);
    if (kind === "vcenter") dy = target.vcenter - box.cy;
    moveNode(node, dx, dy);
  });
  renderAll();
  saveHistory("已对齐元素");
}

function distributeSelected(axis: "x" | "y"): void {
  const nodes = getEditableSelectedElements();
  if (nodes.length < 3) {
    toast("至少选择三个元素");
    return;
  }
  const key: keyof BBox = axis === "x" ? "cx" : "cy";
  const items = nodes.map((node) => ({ node, box: visualBBox(node) })).sort((a, b) => a.box[key] - b.box[key]);
  const first = items[0].box[key];
  const last = items[items.length - 1].box[key];
  const gap = (last - first) / (items.length - 1);
  items.forEach((item, index) => {
    if (index === 0 || index === items.length - 1) return;
    const target = first + gap * index;
    if (axis === "x") moveNode(item.node, target - item.box.cx, 0);
    else moveNode(item.node, 0, target - item.box.cy);
  });
  renderAll();
  saveHistory("已等距分布");
}

function duplicateSelected(): void {
  const nodes = getEditableSelectedElements();
  if (!nodes.length) return;
  const clones: string[] = [];
  const assignFreshCloneIds = (clone: EditableElement) => {
    [clone, ...Array.from(clone.querySelectorAll("[data-editor-id]"))].forEach((node) => {
      node.setAttribute("data-editor-id", `e${state.idSeed++}`);
    });
  };

  nodes.forEach((node) => {
    const clone = node.cloneNode(true) as EditableElement;
    assignFreshCloneIds(clone);
    node.parentNode?.insertBefore(clone, node.nextSibling);
    moveNode(clone, 16, 16);
    const id = getId(clone);
    if (id) clones.push(id);
  });
  selectOnlyIds(clones);
  saveHistory("已复制元素");
}

function deleteSelected(): void {
  const nodes = getEditableSelectedElements();
  if (!nodes.length) return;
  nodes.forEach((node) => node.remove());
  state.selected.clear();
  renderAll();
  saveHistory("已删除元素");
}

function reorderSelected(mode: "top" | "bottom" | "forward" | "backward"): void {
  const nodes = getEditableSelectedElements();
  if (!nodes.length) return;
  if (mode === "top") nodes.forEach((node) => node.parentNode?.appendChild(node));
  if (mode === "bottom") nodes.slice().reverse().forEach((node) => node.parentNode?.insertBefore(node, node.parentNode.firstChild));
  if (mode === "forward") {
    nodes.forEach((node) => {
      const next = node.nextElementSibling;
      if (next) node.parentNode?.insertBefore(next, node);
    });
  }
  if (mode === "backward") {
    nodes.forEach((node) => {
      const prev = node.previousElementSibling;
      if (prev) node.parentNode?.insertBefore(node, prev);
    });
  }
  renderAll();
  saveHistory("已调整层级");
}

function unifyFont(): void {
  const texts = getEditableSelectedElements().filter((node) => node.tagName.toLowerCase() === "text");
  if (!texts.length) {
    toast("选区中没有文本");
    return;
  }
  texts.forEach((node) => {
    node.setAttribute("font-family", "Microsoft YaHei, Arial, sans-serif");
    if (!node.getAttribute("font-weight")) node.setAttribute("font-weight", "500");
  });
  renderAll();
  saveHistory("已统一字体");
}

function unifyColor(): void {
  const color = byId<HTMLInputElement>("batchColorInput").value;
  getEditableSelectedElements().forEach((node) => {
    if (shouldPaintStroke(node)) node.setAttribute("stroke", color);
    else node.setAttribute("fill", color);
  });
  renderAll();
  saveHistory("已统一颜色");
}

function scaleSelected(): void {
  const nodes = getEditableSelectedElements();
  const factor = parseNumber(byId<HTMLInputElement>("scaleInput").value, 1);
  const box = unionBBox(nodes);
  if (!box || factor <= 0) return;
  nodes.forEach((node) => scaleNodeAbout(node, box.cx, box.cy, factor));
  renderAll();
  saveHistory("已缩放选区");
}

function zoomViewAt(clientX: number, clientY: number, deltaY: number, fine = false): void {
  const rect = el.canvasArea.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  const oldScale = state.view.scale;
  const step = fine ? 0.04 : 0.1;
  const factor = deltaY > 0 ? 1 - step : 1 + step;
  const newScale = Math.max(0.08, Math.min(8, oldScale * factor));
  state.view.x = mx - (mx - state.view.x) * (newScale / oldScale);
  state.view.y = my - (my - state.view.y) * (newScale / oldScale);
  state.view.scale = newScale;
  applyView();
}

function scaleSelectedByWheel(deltaY: number, fine = false): void {
  const nodes = getEditableSelectedElements();
  const box = unionBBox(nodes);
  if (!box) return;
  const step = fine ? 0.02 : 0.08;
  const factor = deltaY > 0 ? 1 - step : 1 + step;
  const targetIds = nodes.map((node) => getId(node)).filter((id): id is string => Boolean(id));
  let session: WheelScaleSession | undefined = state.wheelScaleSession;
  if (!session || !sameIds(session.targetIds, targetIds)) {
    session = {
      targetIds,
      targets: nodes.map((node) => ({ node, transform: node.getAttribute("transform") })),
      cx: box.cx,
      cy: box.cy,
      factor: 1,
    };
    state.wheelScaleSession = session;
  }

  session.factor *= factor;
  session.targets.forEach(({ node, transform }) => {
    restoreTransform(node, transform);
    scaleNodeAboutWithTransform(node, session.cx, session.cy, session.factor);
  });
  renderAll();
  el.statusText.textContent = `滚轮缩放选区：${Math.round(factor * 100)}%`;
  window.clearTimeout(state.wheelScaleTimer);
  state.wheelScaleTimer = window.setTimeout(() => {
    saveHistory("已缩放选区");
    state.wheelScaleSession = undefined;
  }, 220);
}

function getCanvasBox(svg: SVGSVGElement): BBox {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return {
      x: viewBox.x,
      y: viewBox.y,
      width: viewBox.width,
      height: viewBox.height,
      cx: viewBox.x + viewBox.width / 2,
      cy: viewBox.y + viewBox.height / 2,
    };
  }

  const width = parseNumber(svg.getAttribute("width"), 900);
  const height = parseNumber(svg.getAttribute("height"), 600);
  return { x: 0, y: 0, width, height, cx: width / 2, cy: height / 2 };
}

function isCanvasBackground(node: EditableElement, canvas: BBox): boolean {
  if (node.tagName.toLowerCase() !== "rect" || node.getAttribute("transform")) return false;

  const x = parseNumber(node.getAttribute("x"), 0);
  const y = parseNumber(node.getAttribute("y"), 0);
  const width = parseNumber(node.getAttribute("width"), 0);
  const height = parseNumber(node.getAttribute("height"), 0);
  const fill = readPaint(node, "fill").trim();
  const stroke = readPaint(node, "stroke").trim();
  const strokeWidth = parseNumber(readAttr(node, "stroke-width", "0"), 0);
  const tolerance = 1;

  const coversCanvas =
    x <= canvas.x + tolerance &&
    y <= canvas.y + tolerance &&
    x + width >= canvas.x + canvas.width - tolerance &&
    y + height >= canvas.y + canvas.height - tolerance;

  return coversCanvas && fill !== "none" && (!stroke || stroke === "none" || strokeWidth === 0);
}

function getContentElements(svg: SVGSVGElement): EditableElement[] {
  const nodes = getEditableElements(svg);
  const canvas = getCanvasBox(svg);
  const content = nodes.filter((node) => !isCanvasBackground(node, canvas));
  return content.length ? content : nodes;
}

function paddedContentBox(box: BBox): BBox {
  const pad = Math.max(16, Math.round(Math.max(box.width, box.height) * 0.04));
  const x = round(box.x - pad);
  const y = round(box.y - pad);
  const width = round(box.width + pad * 2);
  const height = round(box.height + pad * 2);
  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
}

function applyCanvasBox(svg: SVGSVGElement, box: BBox): void {
  svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  svg.setAttribute("width", String(Math.round(box.width)));
  svg.setAttribute("height", String(Math.round(box.height)));
}

function normalizeCanvas(): void {
  if (!state.svg) return;
  const selected = getSelectedElements();
  const targets = selected.length ? selected : getContentElements(state.svg);
  const box = unionBBox(targets);
  if (!box || box.width <= 0 || box.height <= 0) {
    toast("没有可归整的内容");
    return;
  }
  applyCanvasBox(state.svg, paddedContentBox(box));
  fitView();
  renderAll();
  saveHistory("已归整画布");
}

// 导出用的副本：清掉编辑器标记并按内容归整画布。下载和复制共用，保证两者产物一致。
function buildExportSvg(): SVGSVGElement | null {
  if (!state.svg) return null;
  const clone = cleanClone(state.svg);
  const box = unionBBox(getContentElements(state.svg));
  if (box && box.width > 0 && box.height > 0) {
    applyCanvasBox(clone, paddedContentBox(box));
  }
  return clone;
}

function exportSvg(): void {
  const svg = buildExportSvg();
  if (!svg) return;
  const data = serializeSvg(svg);
  const blob = new Blob([data], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ai-svg-optimized.svg";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  clearDraft();
  toast("已导出 SVG");
}

// 复制文本比下载文件更贴「改完贴回 AI 对话」的流程。
async function copySvgCode(): Promise<void> {
  const svg = buildExportSvg();
  if (!svg) return;
  const data = serializeSvg(svg);

  const fallbackCopy = (): boolean => {
    const area = document.createElement("textarea");
    area.value = data;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-9999px";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  };

  try {
    await navigator.clipboard.writeText(data);
    toast("已复制 SVG 代码");
  } catch {
    toast(fallbackCopy() ? "已复制 SVG 代码" : "复制失败，可改用导出文件");
  }
}

function bindPropertyInputs(): void {
  ["propX", "propY", "propW", "propH"].forEach((id) => {
    byId<HTMLInputElement>(id).addEventListener("change", applySingleGeometry);
  });
  const bindLiveAttr = (id: string, attr: string) => {
    const input = byId<HTMLInputElement>(id);
    const update = (event: Event) => setAttrForSelected(attr, (event.target as HTMLInputElement).value, true);
    input.addEventListener("input", update);
    input.addEventListener("change", update);
  };
  bindLiveAttr("propOpacity", "opacity");
  bindLiveAttr("propFill", "fill");
  bindLiveAttr("propStroke", "stroke");
  bindLiveAttr("propStrokeWidth", "stroke-width");
  const updateRadius = (event: Event) => {
    getEditableSelectedElements().forEach((node) => {
      if (node.tagName.toLowerCase() === "rect") node.setAttribute("rx", (event.target as HTMLInputElement).value);
    });
    renderAll();
    commitHistorySoon("已更新圆角");
  };
  byId<HTMLInputElement>("propRadius").addEventListener("input", updateRadius);
  byId<HTMLInputElement>("propRadius").addEventListener("change", updateRadius);
  ["propText", "propFont", "propFontSize", "propFontWeight", "propTextAnchor"].forEach((id) => {
    const input = byId<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id);
    const update = () => applyTextProps(true);
    input.addEventListener("input", update);
    input.addEventListener("change", update);
  });
}

function togglePanel(side: "left" | "right"): void {
  el.app.classList.toggle(`${side}-collapsed`);
  updateSelectionOverlay();
}

function bindControls(): void {
  byId<HTMLButtonElement>("loadSampleBtn").onclick = () => {
    el.sourceInput.value = sampleSvg;
  };
  byId<HTMLButtonElement>("clearSourceBtn").onclick = () => {
    el.sourceInput.value = "";
  };
  byId<HTMLButtonElement>("restoreDraftBtn").onclick = restoreDraft;
  byId<HTMLButtonElement>("uploadBtn").onclick = () => el.fileInput.click();
  byId<HTMLButtonElement>("enterBtn").onclick = () => loadSvgFromText(el.sourceInput.value);
  byId<HTMLButtonElement>("backBtn").onclick = () => {
    el.app.classList.add("hidden");
    el.landing.classList.remove("hidden");
    refreshDraftButton();
  };
  byId<HTMLButtonElement>("toggleLeftPanelBtn").onclick = () => togglePanel("left");
  byId<HTMLButtonElement>("toggleRightPanelBtn").onclick = () => togglePanel("right");
  el.layerSearch.addEventListener("input", updateLayerList);
  el.fileInput.onchange = (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      el.sourceInput.value = result;
      loadSvgFromText(result);
    };
    reader.readAsText(file);
  };

  byId<HTMLButtonElement>("undoBtn").onclick = undo;
  byId<HTMLButtonElement>("redoBtn").onclick = redo;
  byId<HTMLButtonElement>("duplicateBtn").onclick = duplicateSelected;
  byId<HTMLButtonElement>("deleteBtn").onclick = deleteSelected;
  byId<HTMLButtonElement>("bringForwardBtn").onclick = () => reorderSelected("forward");
  byId<HTMLButtonElement>("sendBackwardBtn").onclick = () => reorderSelected("backward");
  byId<HTMLButtonElement>("bringTopBtn").onclick = () => reorderSelected("top");
  byId<HTMLButtonElement>("sendBottomBtn").onclick = () => reorderSelected("bottom");
  document.querySelectorAll<HTMLButtonElement>("[data-align]").forEach((btn) => {
    btn.onclick = () => alignSelected(btn.dataset.align || "");
  });
  byId<HTMLButtonElement>("distributeHBtn").onclick = () => distributeSelected("x");
  byId<HTMLButtonElement>("distributeVBtn").onclick = () => distributeSelected("y");
  byId<HTMLButtonElement>("normalizeBtn").onclick = normalizeCanvas;
  byId<HTMLButtonElement>("resetViewBtn").onclick = fitView;
  byId<HTMLButtonElement>("copyBtn").onclick = () => void copySvgCode();
  byId<HTMLButtonElement>("exportBtn").onclick = exportSvg;
  byId<HTMLButtonElement>("unifyFontBtn").onclick = unifyFont;
  byId<HTMLButtonElement>("unifyColorBtn").onclick = unifyColor;
  byId<HTMLButtonElement>("scaleSelectedBtn").onclick = scaleSelected;
}

function bindCanvas(): void {
  el.canvasArea.addEventListener("mousedown", (event) => {
    if (!state.svg) return;
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
      beginPan(event);
      return;
    }
    const canStartBoxSelect =
      event.target === el.canvasArea ||
      event.target === el.canvasStage ||
      event.target === el.svgHost ||
      event.target === state.svg;
    if (event.button === 0 && canStartBoxSelect) {
      beginBoxSelect(event);
    }
  });
  el.canvasArea.addEventListener("contextmenu", (event) => event.preventDefault());
  el.canvasArea.addEventListener(
    "wheel",
    (event) => {
      if (!state.svg) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey || state.selected.size === 0) {
        zoomViewAt(event.clientX, event.clientY, event.deltaY, event.shiftKey);
        return;
      }
      scaleSelectedByWheel(event.deltaY, event.shiftKey);
    },
    { passive: false },
  );
  window.addEventListener("resize", updateSelectionOverlay);
}

function bindKeyboard(): void {
  window.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    const isTyping = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (isTyping || !state.svg) return;
    const step = event.shiftKey ? 10 : 1;
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (map[event.key]) {
      event.preventDefault();
      moveSelected(map[event.key][0], map[event.key][1]);
      renderAll();
      saveHistory("已微调位置");
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
    }
  });
}

bindControls();
bindCanvas();
bindKeyboard();
bindPropertyInputs();
updateHistoryButtons();
refreshDraftButton();
