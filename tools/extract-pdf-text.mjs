import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

const [, , pdfPath] = process.argv;

if (!pdfPath) {
  console.error("Usage: node tools/extract-pdf-text.mjs <file.pdf>");
  process.exit(1);
}

const pdf = readFileSync(pdfPath);
const latin = pdf.toString("latin1");
const streams = [];
const streamPattern = /<<(.*?)>>\s*stream\r?\n/gms;
let match;

while ((match = streamPattern.exec(latin))) {
  const dict = match[1];
  const streamStart = streamPattern.lastIndex;
  const end = latin.indexOf("endstream", streamStart);
  if (end === -1) break;

  let raw = pdf.subarray(streamStart, end);
  if (raw[raw.length - 1] === 10) raw = raw.subarray(0, -1);
  if (raw[raw.length - 1] === 13) raw = raw.subarray(0, -1);

  if (/FlateDecode/.test(dict)) {
    try {
      streams.push(inflateSync(raw).toString("latin1"));
    } catch {
      // Some PDF streams are images or use predictors. Skip unreadable streams.
    }
  } else {
    streams.push(raw.toString("latin1"));
  }
}

const cmap = buildCMap(streams.join("\n"));
const pages = streams
  .map((stream) => extractTextOperators(stream, cmap))
  .filter(Boolean)
  .join("\n\n")
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

console.log(pages || "No selectable PDF text found. This may be a scanned image PDF.");

function buildCMap(text) {
  const map = new Map();
  const rangePattern = /beginbfchar([\s\S]*?)endbfchar/g;
  let block;

  while ((block = rangePattern.exec(text))) {
    for (const line of block[1].split(/\r?\n/)) {
      const pair = line.match(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/);
      if (pair) map.set(pair[1].toUpperCase(), hexToUnicode(pair[2]));
    }
  }

  return map;
}

function extractTextOperators(stream, cmap) {
  const chunks = [];
  const textBlocks = stream.match(/BT[\s\S]*?ET/g) || [];

  for (const block of textBlocks) {
    const tokens = block.match(/\((?:\\.|[^\\)])*\)\s*Tj|<([0-9A-Fa-f]+)>\s*Tj|\[(?:[\s\S]*?)\]\s*TJ|[-\d.]+\s+[-\d.]+\s+Td|[-\d.]+\s+[-\d.]+\s+TD|T\*/g) || [];
    for (const token of tokens) {
      if (/T\*$|Td$|TD$/.test(token)) {
        chunks.push("\n");
      } else if (token.endsWith("Tj")) {
        chunks.push(decodePdfString(token.replace(/\s*Tj$/, ""), cmap));
      } else if (token.endsWith("TJ")) {
        chunks.push(decodeArray(token.replace(/\s*TJ$/, ""), cmap));
      }
    }
  }

  return cleanText(chunks.join(""));
}

function decodeArray(token, cmap) {
  const strings = token.match(/\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f]+)>/g) || [];
  return strings.map((item) => decodePdfString(item, cmap)).join("");
}

function decodePdfString(token, cmap) {
  const value = token.trim();
  if (value.startsWith("<") && value.endsWith(">")) {
    const hex = value.slice(1, -1).toUpperCase();
    if (cmap.has(hex)) return cmap.get(hex);
    return hexToLatin(hex);
  }

  if (value.startsWith("(") && value.endsWith(")")) {
    return value
      .slice(1, -1)
      .replace(/\\([nrtbf()\\])/g, (_, char) => {
        const escapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
        return escapes[char] || char;
      })
      .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  }

  return "";
}

function hexToUnicode(hex) {
  const points = [];
  for (let i = 0; i < hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isNaN(code)) points.push(String.fromCodePoint(code));
  }
  return points.join("");
}

function hexToLatin(hex) {
  const chars = [];
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (!Number.isNaN(code)) chars.push(String.fromCharCode(code));
  }
  return chars.join("");
}

function cleanText(text) {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
