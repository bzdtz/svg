import { EDITABLE_SELECTOR, SVG_NS, XLINK_NS } from "./constants";
import { parseNumber } from "./geometry";
import type { EditableElement, ParseError, ParseSvgResult } from "./types";

const DANGEROUS_ELEMENTS = "script, foreignObject, iframe, object, embed";
const URL_ATTRS = new Set(["href", "xlink:href", "src"]);
const DANGEROUS_CSS_RE = /(?:javascript:|vbscript:|data:text\/html|expression\s*\(|@import\b|-moz-binding\s*:|behavior\s*:)/i;

function parseFailure(message: string): ParseError {
  return { ok: false, message };
}

function isDangerousUrl(value: string): boolean {
  const compact = value.replace(/[\u0000-\u001F\u007F\s]+/g, "").toLowerCase();
  if (compact.startsWith("javascript:") || compact.startsWith("vbscript:")) return true;
  if (compact.startsWith("data:text/html")) return true;
  if (compact.startsWith("data:image/svg+xml")) return true;
  if (compact.startsWith("data:") && !/^data:image\/(?:png|jpe?g|gif|webp);/.test(compact)) return true;
  return false;
}

function hasDangerousCss(value: string): boolean {
  return DANGEROUS_CSS_RE.test(value.replace(/[\u0000-\u001F\u007F]+/g, ""));
}

function extractSvgMarkup(source: string): string {
  const withoutBom = source.replace(/^\uFEFF/, "").trim();
  const fenced = withoutBom.match(/```(?:svg|xml)?\s*([\s\S]*?)```/i);
  let candidate = (fenced ? fenced[1] : withoutBom).trim();
  if (!/<svg\b/i.test(candidate) && /&lt;svg\b/i.test(candidate)) {
    candidate = candidate
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&amp;/gi, "&");
  }
  const start = candidate.search(/<svg\b/i);
  const end = candidate.toLowerCase().lastIndexOf("</svg>");

  if (start >= 0 && end >= start) {
    return candidate.slice(start, end + "</svg>".length).trim();
  }

  return candidate;
}

function escapeTextValue(value: string): string {
  return value
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function repairCommonTextIssues(source: string): string {
  return source.replace(/(<text\b[^>]*>)([\s\S]*?)(<\/text>)/gi, (_match, open: string, text: string, close: string) => {
    return `${open}${escapeTextValue(text)}${close}`;
  });
}

function parseSvgDocument(source: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(source, "image/svg+xml");
}

export function sanitizeSvg(svg: SVGSVGElement): SVGSVGElement {
  svg.querySelectorAll(DANGEROUS_ELEMENTS).forEach((node) => node.remove());
  svg.querySelectorAll("style").forEach((node) => {
    if (hasDangerousCss(node.textContent || "")) node.remove();
  });

  [svg, ...Array.from(svg.querySelectorAll("*"))].forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name;
      const lowerName = name.toLowerCase();
      const value = attr.value;

      if (lowerName.startsWith("on")) {
        node.removeAttribute(name);
        return;
      }

      if (URL_ATTRS.has(lowerName) && isDangerousUrl(value)) {
        node.removeAttribute(name);
        if (lowerName === "xlink:href") node.removeAttributeNS(XLINK_NS, "href");
        return;
      }

      if (lowerName === "style" && hasDangerousCss(value)) {
        node.removeAttribute(name);
      }
    });
  });

  if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", SVG_NS);
  return svg;
}

export function parseSvgSource(source: string): ParseSvgResult {
  const code = extractSvgMarkup(source);
  if (!code) return parseFailure("请先粘贴 SVG 代码");

  let doc = parseSvgDocument(code);
  if (doc.querySelector("parsererror")) {
    const repaired = repairCommonTextIssues(code);
    if (repaired !== code) {
      doc = parseSvgDocument(repaired);
    }
  }

  if (doc.querySelector("parsererror")) {
    return parseFailure("SVG 解析失败，请检查代码");
  }

  const svg = doc.querySelector("svg");
  if (!svg) return parseFailure("没有找到 <svg> 根节点");
  return sanitizeSvg(svg as SVGSVGElement);
}

export function normalizeSvgSize(svg: SVGSVGElement): void {
  if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", SVG_NS);
  let width = parseNumber(svg.getAttribute("width"), 0);
  let height = parseNumber(svg.getAttribute("height"), 0);
  const viewBox = svg.getAttribute("viewBox");

  if ((!width || !height) && viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      width = width || parts[2];
      height = height || parts[3];
    }
  }

  width = width || 900;
  height = height || 600;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  if (!viewBox) svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
}

export function getEditableElements(svg: SVGSVGElement | null): EditableElement[] {
  if (!svg) return [];
  return Array.from(svg.querySelectorAll(EDITABLE_SELECTOR)).filter((node) => node !== svg) as EditableElement[];
}

export function cleanClone(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll("[data-editor-id], [data-editor-locked]").forEach((node) => {
    node.removeAttribute("data-editor-id");
    node.removeAttribute("data-editor-locked");
    node.classList.remove("editor-selected");
    if (!node.getAttribute("class")) node.removeAttribute("class");
  });
  return sanitizeSvg(clone);
}

export function serializeSvg(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(cleanClone(svg));
}

export function serializeSvgForHistory(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll("[data-editor-locked]").forEach((node) => node.removeAttribute("data-editor-locked"));
  return new XMLSerializer().serializeToString(sanitizeSvg(clone));
}
