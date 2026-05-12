import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const appJs = readFileSync(join(root, "app.js"), "utf-8");
const htmlPath = join(root, "index.html");
const html = readFileSync(htmlPath, "utf-8");

const marker = '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>';
const markerIdx = html.indexOf(marker);
if (markerIdx === -1) throw new Error("CDN script tag not found");

const openTag = "<script>";
const closeTag = "</script>";

const openIdx = html.indexOf(openTag, markerIdx + marker.length);
if (openIdx === -1) throw new Error("Inline <script> open not found");

const contentStart = openIdx + openTag.length;
const closeIdx = html.indexOf(closeTag, contentStart);
if (closeIdx === -1) throw new Error("Inline </script> close not found");

const result = html.slice(0, contentStart) + "\n" + appJs.trimEnd() + "\n" + html.slice(closeIdx);
writeFileSync(htmlPath, result, "utf-8");
console.log("Inlined app.js → index.html");
