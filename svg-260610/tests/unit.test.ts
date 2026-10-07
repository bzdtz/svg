import { addTranslate, bakeResizeToNative, moveNode } from "../src/geometry";
import { scalePathData, translatePathData } from "../src/pathData";
import type { BBox, EditableElement } from "../src/types";

// Node 里没有 SVG DOM，只补被测代码真正用到的那几个接口。

class ShimMatrix {
  constructor(
    public a = 1,
    public b = 0,
    public c = 0,
    public d = 1,
    public e = 0,
    public f = 0,
  ) {}

  multiply(m: ShimMatrix): ShimMatrix {
    return new ShimMatrix(
      this.a * m.a + this.c * m.b,
      this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d,
      this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e,
      this.b * m.e + this.d * m.f + this.f,
    );
  }

  inverse(): ShimMatrix {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) return new ShimMatrix();
    return new ShimMatrix(
      this.d / det,
      -this.b / det,
      -this.c / det,
      this.a / det,
      (this.c * this.f - this.d * this.e) / det,
      (this.b * this.e - this.a * this.f) / det,
    );
  }
}

class ShimPoint {
  constructor(public x: number, public y: number) {}

  matrixTransform(m: ShimMatrix): ShimPoint {
    return new ShimPoint(this.x * m.a + this.y * m.c + m.e, this.x * m.b + this.y * m.d + m.f);
  }
}

const globals = globalThis as { DOMPoint?: unknown; DOMMatrix?: unknown };
globals.DOMPoint = ShimPoint;
globals.DOMMatrix = ShimMatrix;

class FakeElement {
  private attrs = new Map<string, string>();
  private readonly tag: string;
  private readonly parentCtm: ShimMatrix;

  constructor(attrs: Record<string, string> = {}, tag = "g", parentCtm = new ShimMatrix()) {
    Object.entries(attrs).forEach(([key, value]) => this.attrs.set(key, value));
    this.tag = tag;
    this.parentCtm = parentCtm;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  get tagName(): string {
    return this.tag;
  }

  get ownerSVGElement() {
    return { getScreenCTM: () => new ShimMatrix() } as unknown as SVGSVGElement;
  }

  // 被测的节点自身不带 transform，它的 user space 就是父级 CTM 作用之后的空间。
  getScreenCTM(): ShimMatrix {
    return this.parentCtm;
  }
}

function fakeElement(attrs: Record<string, string> = {}, tag = "g"): EditableElement {
  return new FakeElement(attrs, tag) as unknown as EditableElement;
}

function fakeElementInGroup(
  attrs: Record<string, string>,
  tag: string,
  parentTransform: ShimMatrix,
): EditableElement {
  return new FakeElement(attrs, tag, parentTransform) as unknown as EditableElement;
}

function test(name: string, run: () => void): void {
  run();
  console.log(`ok - ${name}`);
}

function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function attr(node: EditableElement, name: string, expected: string): void {
  const actual = node.getAttribute(name);
  if (actual !== expected) {
    throw new Error(`${name}: expected ${expected}, received ${actual}`);
  }
}

function box(x: number, y: number, width: number, height: number): BBox {
  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
}

test("translatePathData moves absolute commands", () => {
  const d = "M10 20 L30 40 H50 V60 C1 2 3 4 5 6 S7 8 9 10 Q11 12 13 14 T15 16 A4 5 0 0 1 17 18 Z";
  equal(
    translatePathData(d, 2, -3),
    "M12 17 L32 37 H52 V57 C3 -1 5 1 7 3 S9 5 11 7 Q13 9 15 11 T17 13 A4 5 0 0 1 19 15 Z",
  );
});

test("translatePathData keeps relative commands relative after the first moveto", () => {
  equal(translatePathData("m10 20 l5 6 h7 v8", 2, 3), "m12 23 l5 6 h7 v8");
});

test("scalePathData scales absolute and relative path segments", () => {
  equal(scalePathData("M10 10 L20 30 l5 6 h8 v10 A4 6 0 0 1 30 40", 10, 10, 2), "M10 10 L30 50 l10 12 h16 v20 A8 12 0 0 1 50 70");
});

test("addTranslate merges a leading translate instead of appending another one", () => {
  const node = fakeElement({ transform: "translate(4 5) rotate(30)" });
  addTranslate(node, 2, -3);
  equal(node.getAttribute("transform"), "translate(6 2) rotate(30)");
});

test("addTranslate removes a leading translate when movement cancels it out", () => {
  const node = fakeElement({ transform: "translate(4 5) rotate(30)" });
  addTranslate(node, -4, -5);
  equal(node.getAttribute("transform"), "rotate(30)");
});

test("moveNode with an existing transform reuses merged translate behavior", () => {
  const node = fakeElement({ transform: "translate(1 2) scale(2)" });
  moveNode(node, 3, 4);
  equal(node.getAttribute("transform"), "translate(4 6) scale(2)");
});

test("bakeResizeToNative writes r for a circle", () => {
  // 句柄缩放以框的左上角为锚点，所以半径变大时圆心跟着往右下走。
  const node = fakeElement({ cx: "100", cy: "100", r: "20" }, "circle");
  equal(bakeResizeToNative(node, box(80, 80, 40, 40), box(80, 80, 80, 80)), true);
  attr(node, "cx", "120");
  attr(node, "cy", "120");
  attr(node, "r", "40");
});

test("bakeResizeToNative falls back to transform for a non-uniform circle resize", () => {
  const node = fakeElement({ cx: "100", cy: "100", r: "20" }, "circle");
  equal(bakeResizeToNative(node, box(80, 80, 40, 40), box(80, 80, 80, 40)), false);
  attr(node, "cx", "100");
  attr(node, "cy", "100");
  attr(node, "r", "20");
});

test("bakeResizeToNative writes rx/ry for an ellipse", () => {
  const node = fakeElement({ cx: "100", cy: "100", rx: "20", ry: "10" }, "ellipse");
  equal(bakeResizeToNative(node, box(80, 80, 40, 20), box(80, 80, 80, 40)), true);
  attr(node, "cx", "120");
  attr(node, "cy", "100");
  attr(node, "rx", "40");
  attr(node, "ry", "20");
});

test("bakeResizeToNative writes rect geometry and scales rx proportionally", () => {
  const node = fakeElement({ x: "10", y: "20", width: "100", height: "50", rx: "5" }, "rect");
  equal(bakeResizeToNative(node, box(10, 20, 100, 50), box(10, 20, 200, 100)), true);
  attr(node, "x", "10");
  attr(node, "y", "20");
  attr(node, "width", "200");
  attr(node, "height", "100");
  attr(node, "rx", "10");
});

test("bakeResizeToNative rescales line endpoints", () => {
  const node = fakeElement({ x1: "0", y1: "10", x2: "10", y2: "0" }, "line");
  equal(bakeResizeToNative(node, box(0, 0, 10, 10), box(0, 0, 20, 20)), true);
  attr(node, "x1", "0");
  attr(node, "y1", "20");
  attr(node, "x2", "20");
  attr(node, "y2", "0");
});

test("bakeResizeToNative rescales polygon points", () => {
  const node = fakeElement({ points: "0,0 10,0 5,10" }, "polygon");
  equal(bakeResizeToNative(node, box(0, 0, 10, 10), box(0, 0, 20, 20)), true);
  attr(node, "points", "0,0 20,0 10,20");
});

test("bakeResizeToNative leaves text untouched", () => {
  const node = fakeElement({ x: "10", y: "20" }, "text");
  equal(bakeResizeToNative(node, box(10, 20, 40, 20), box(10, 20, 80, 40)), false);
  attr(node, "x", "10");
  attr(node, "y", "20");
});

test("bakeResizeToNative writes attributes in the node's own coordinate space", () => {
  // 节点在 translate(100 50) 的 <g> 里：视觉框在 SVG 空间是 (100 50 40 20)，
  // 但属性必须写成本地坐标 (0 0 40 20)，否则整体会被父级平移顶飞。
  const node = fakeElementInGroup(
    { cx: "20", cy: "10", rx: "20", ry: "10" },
    "ellipse",
    new ShimMatrix(1, 0, 0, 1, 100, 50),
  );
  equal(bakeResizeToNative(node, box(100, 50, 40, 20), box(100, 50, 80, 40)), true);
  attr(node, "cx", "40");
  attr(node, "cy", "20");
  attr(node, "rx", "40");
  attr(node, "ry", "20");
});
