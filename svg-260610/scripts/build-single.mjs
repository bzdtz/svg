import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, "dist");
const indexPath = join(distDir, "index.html");
const outputPath = join(distDir, "svg-editor-standalone.html");
const attribution = "小红书号：5407847824";

function assetPathFromUrl(url) {
  return join(distDir, url.replace(/^\//, ""));
}

let html = await readFile(indexPath, "utf8");

const scriptRe = /<script\s+type="module"[^>]*\ssrc="([^"]+)"[^>]*><\/script>/g;
const styleRe = /<link\s+rel="stylesheet"[^>]*\shref="([^"]+)"[^>]*>/g;

html = await replaceAsync(html, styleRe, async (_match, href) => {
  const css = await readFile(assetPathFromUrl(href), "utf8");
  return `<style>\n${css}\n</style>`;
});

html = await replaceAsync(html, scriptRe, async (_match, src) => {
  const js = await readFile(assetPathFromUrl(src), "utf8");
  return `<script type="module">\n${js}\n</script>`;
});

html = html.replace("<!DOCTYPE html>", `<!DOCTYPE html>\n<!-- AI SVG 二次优化编辑器｜${attribution} -->`);

await writeFile(outputPath, html, "utf8");
console.log(`Standalone HTML written to ${outputPath}`);

async function replaceAsync(input, pattern, replacer) {
  const matches = Array.from(input.matchAll(pattern));
  let output = "";
  let lastIndex = 0;

  for (const match of matches) {
    output += input.slice(lastIndex, match.index);
    output += await replacer(...match);
    lastIndex = match.index + match[0].length;
  }

  return output + input.slice(lastIndex);
}
