// Minimal .xlsx reader for pSEO content trees — no extra dependency: an .xlsx
// is a zip of XML parts, read with JSZip + cheerio (both already used by the
// Site Builder). Handles shared strings (incl. rich text runs), inline
// strings, numbers, booleans and date-formatted numbers.
import JSZip from "jszip";
import * as cheerio from "cheerio";

export type Sheet = {
  name: string;
  /** Every row as an array of cell strings (sparse cells filled with ""). */
  rows: string[][];
};

export type Workbook = { sheets: Sheet[] };

function colIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel serial date → YYYY-MM-DD (1900 date system). */
function serialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? String(serial) : d.toISOString().slice(0, 10);
}

const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

export async function readWorkbook(data: Buffer | Uint8Array | ArrayBuffer): Promise<Workbook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error("That file isn't a readable .xlsx workbook.");
  }
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : null);

  const workbookXml = await read("xl/workbook.xml");
  if (!workbookXml) throw new Error("That file isn't a readable .xlsx workbook.");
  const relsXml = (await read("xl/_rels/workbook.xml.rels")) || "";

  // Shared strings.
  const shared: string[] = [];
  const sst = await read("xl/sharedStrings.xml");
  if (sst) {
    const $ = cheerio.load(sst, { xml: true });
    $("si").each((_, si) => {
      shared.push(
        $(si)
          .find("t")
          .map((__, t) => $(t).text())
          .get()
          .join(""),
      );
    });
  }

  // Which cell styles are dates.
  const dateStyles = new Set<number>();
  const stylesXml = await read("xl/styles.xml");
  if (stylesXml) {
    const $ = cheerio.load(stylesXml, { xml: true });
    const customDate = new Set<number>();
    $("numFmts numFmt").each((_, el) => {
      const code = ($(el).attr("formatCode") || "").toLowerCase();
      if (/[dmy]/.test(code.replace(/\[[^\]]*\]|"[^"]*"/g, "")) && !/h|s/.test(code)) customDate.add(Number($(el).attr("numFmtId")));
    });
    $("cellXfs xf").each((i, el) => {
      const id = Number($(el).attr("numFmtId") || 0);
      if (DATE_FORMAT_IDS.has(id) || customDate.has(id)) dateStyles.add(i);
    });
  }

  const rels = new Map<string, string>();
  {
    const $ = cheerio.load(relsXml, { xml: true });
    $("Relationship").each((_, el) => {
      rels.set($(el).attr("Id") || "", $(el).attr("Target") || "");
    });
  }

  const $wb = cheerio.load(workbookXml, { xml: true });
  const sheets: Sheet[] = [];
  const sheetEls = $wb("sheets sheet").toArray();
  for (const el of sheetEls) {
    const name = $wb(el).attr("name") || "";
    const rid = $wb(el).attr("r:id") || "";
    let target = rels.get(rid) || "";
    if (!target) continue;
    target = target.replace(/^\//, "");
    const path = target.startsWith("xl/") ? target : `xl/${target}`;
    const xml = await read(path);
    if (!xml) continue;
    const $ = cheerio.load(xml, { xml: true });
    const rows: string[][] = [];
    $("sheetData row").each((_, rowEl) => {
      const r = Number($(rowEl).attr("r") || rows.length + 1) - 1;
      const cells: string[] = rows[r] || [];
      $(rowEl)
        .children("c")
        .each((i, c) => {
          const ref = $(c).attr("r");
          const col = ref ? colIndex(ref) : i;
          const type = $(c).attr("t") || "";
          const style = Number($(c).attr("s") || -1);
          let value = "";
          if (type === "s") value = shared[Number($(c).children("v").text())] ?? "";
          else if (type === "inlineStr") value = $(c).find("is t").map((__, t) => $(t).text()).get().join("");
          else if (type === "b") value = $(c).children("v").text() === "1" ? "TRUE" : "FALSE";
          else {
            value = $(c).children("v").text();
            if (value && dateStyles.has(style) && /^\d+(\.\d+)?$/.test(value)) value = serialToDate(Number(value));
          }
          cells[col] = value;
        });
      for (let k = 0; k < cells.length; k++) if (cells[k] === undefined) cells[k] = "";
      rows[r] = cells;
    });
    for (let k = 0; k < rows.length; k++) if (!rows[k]) rows[k] = [];
    sheets.push({ name, rows });
  }
  return { sheets };
}

/**
 * A pSEO content-tree table: row 4 holds the headers, data starts at row 5
 * and a blank row ends the block (the build brief's reading rule).
 */
export function tableOf(sheet: Sheet | undefined, headerRow = 4): Array<Record<string, string>> {
  if (!sheet) return [];
  const header = (sheet.rows[headerRow - 1] || []).map((h) => (h || "").trim());
  const out: Array<Record<string, string>> = [];
  for (let i = headerRow; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || [];
    if (!row.some((c) => (c || "").trim())) break;
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => {
      if (h) rec[h] = (row[idx] || "").trim();
    });
    out.push(rec);
  }
  return out;
}

export function findSheet(wb: Workbook, prefix: string): Sheet | undefined {
  return wb.sheets.find((s) => s.name.startsWith(prefix));
}

/** First column whose normalised header starts with any of `names`. */
export function col(row: Record<string, string>, ...names: string[]): string {
  const keys = Object.keys(row);
  for (const name of names) {
    const want = norm(name);
    const key = keys.find((k) => norm(k) === want) ?? keys.find((k) => norm(k).startsWith(want));
    if (key && row[key]) return row[key];
  }
  return "";
}

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
