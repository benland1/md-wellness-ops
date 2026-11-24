import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const r = (f) => readFileSync("src/" + f, "utf8");
const css = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "").replace(/\s*([{};,>])\s*/g, "$1").replace(/;}/g, "}");
async function js(files) {
  mkdirSync(".tmp", { recursive: true });
  writeFileSync(".tmp/in.js", files.map(r).join("\n"));
  const out = await Bun.build({ entrypoints: [".tmp/in.js"], minify: true, target: "browser", format: "iife" });
  if (!out.success) throw new Error(out.logs.join("\n"));
  return (await out.outputs[0].text()).replace(/<\/script/g, "<\\/script");
}
const FONTS = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=IBM+Plex+Mono:wght@400;500&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">';
const html = async (title, cssFiles, jsFiles) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title>${FONTS}<style>${css(cssFiles.map(r).join("\n"))}</style></head><body><div id="app"></div><script>${await js(jsFiles)}</script></body></html>`;
const pages = { admin: await html("MD Wellness — Operations", ["shared.css", "admin.css"], ["shared.js", "admin.js"]), portal: await html("MD Wellness — Wholesale Ordering", ["shared.css", "portal.css"], ["shared.js", "portal.js"]), catalog: r("catalog.json") };
const assets = {};
for (const k in pages) { assets[k] = gzipSync(pages[k], { level: 9 }).toString("base64"); console.log(k, pages[k].length, "->", assets[k].length); writeFileSync(".tmp/" + k + ".html", pages[k]); }
let server = r("server.js").replace("/*__ASSETS__*/ {}", JSON.stringify(assets));
writeFileSync(".tmp/server.js", server);
const sb = await Bun.build({ entrypoints: [".tmp/server.js"], minify: { whitespace: true, syntax: true }, target: "bun", external: ["node:*"] });
if (!sb.success) throw new Error(sb.logs.join("\n"));
const code = await sb.outputs[0].text();
writeFileSync("dist/index.ts", code);
console.log("dist/index.ts", Buffer.byteLength(code), "bytes", Buffer.byteLength(code) < 96000 ? "OK" : "TOO BIG");
