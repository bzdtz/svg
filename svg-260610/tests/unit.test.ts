import { addTranslate, moveNode } from "../src/geometry";
import { scalePathData, translatePathData } from "../src/pathData";
import type { EditableElement } from "../src/types";

class FakeElement {
  private attrs = new Map<string, string>();

  constructor(attrs: Record<string, string> = {}) {
    Object.entries(attrs).forEach(([key, value]) => this.attrs.set(key, value));
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  get tagName(): string {
    return "g";
  }
}

function fakeElement(attrs: Record<string, string> = {}): EditableElement {
  return new FakeElement(attrs) as unknown as EditableElement;
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
