import "server-only";
import { inflateRawSync } from "node:zlib";

// Reads a members spreadsheet into text cells: CSV (comma, semicolon or tab; UTF-8, with or
// without BOM) or Excel .xlsx (first sheet). No library: an .xlsx file is a zip of XML files.
// Every cell comes back as text exactly as the club typed it; the database decides what it means
// (import_members): Excel dates arrive as day numbers (46371), which import_date understands.

export interface Sheet {
  headers: string[];
  rows: string[][];
}

export const MAX_ROWS = 2000;

export class SheetError extends Error {}

export function readSpreadsheet(name: string, bytes: Buffer): Sheet {
  const lower = name.toLowerCase();
  const isZip = bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50;
  if (lower.endsWith(".xls") && !isZip) throw new SheetError("Old .xls files can't be read. Save it as .xlsx or CSV and upload that.");
  const table = isZip ? readXlsx(bytes) : readCsv(bytes.toString("utf8"));
  // The first row with anything in it holds the column names.
  const nonEmpty = table.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) throw new SheetError("That file is empty.");
  const [head, ...rest] = nonEmpty;
  const width = Math.max(head.length, ...rest.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => (head[i] ?? "").trim() || `Column ${i + 1}`);
  if (rest.length === 0) throw new SheetError("There's only a header row. Add the members below it.");
  if (rest.length > MAX_ROWS) throw new SheetError(`That's ${rest.length} rows. Import at most ${MAX_ROWS} at a time: split the file.`);
  const rows = rest.map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim().slice(0, 500)));
  return { headers, rows };
}

// ---------------------------------------------------------------- CSV

function readCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------- XLSX

function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: the last 0x06054b50 signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SheetError("That file can't be read. Save it as .xlsx or CSV and try again.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    // Only the files we need, so a crafted zip can't make us inflate everything.
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    files.set(name, method === 0 ? data : inflateRawSync(data, { maxOutputLength: 50 * 1024 * 1024 }));
  }
  return files;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf);
  const workbook = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  // The first sheet in the workbook, through its relationship id.
  const rid = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = rid ? rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ??
    rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1] : undefined;
  const sheetPath = target ? `xl/${target.replace(/^\/?xl\//, "").replace(/^\//, "")}` : "xl/worksheets/sheet1.xml";
  const sheet = (files.get(sheetPath) ?? files.get("xl/worksheets/sheet1.xml"))?.toString("utf8");
  if (!sheet) throw new SheetError("That Excel file has no sheet we can read. Save it as CSV and try again.");
  const shared = [...(files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    for (const cm of (rm[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else value = v !== undefined ? decode(v) : "";
      const at = ref ? colIndex(ref) : row.length;
      if (at > 200) continue;
      while (row.length < at) row.push("");
      row[at] = value;
    }
    rows.push(row);
  }
  return rows;
}
