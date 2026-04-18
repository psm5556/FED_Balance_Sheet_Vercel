import type { NextApiRequest, NextApiResponse } from 'next';
import XLSX from 'xlsx';
import type { IciMmfResponse } from '@/lib/types';

const ICI_BASE = 'https://www.ici.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Excel date serial → YYYY-MM-DD ────────────────────────────────────────
function excelSerialToDate(serial: number): string | null {
  // Excel epoch offset (days from 1900-01-01, with Lotus 1-2-3 leap-year bug → subtract 25569 for Unix epoch)
  const ms = (serial - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function toDateStr(raw: unknown): string | null {
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return raw.toISOString().split('T')[0];
  }
  if (typeof raw === 'number' && raw > 30000 && raw < 60000) {
    return excelSerialToDate(raw);
  }
  if (typeof raw === 'string' && raw.trim()) {
    const d = new Date(raw.trim());
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return null;
}

// ── Parse Excel buffer ────────────────────────────────────────────────────
function parseExcelBuffer(buffer: ArrayBuffer): IciMmfResponse['data'] {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
    if (rows.length < 5) continue;

    // ── Find header row: look for "week" / "date" and "total" keywords ──
    let dateCol = -1;
    let totalCol = -1;
    let dataStartRow = 0;

    for (let r = 0; r < Math.min(20, rows.length); r++) {
      const row = rows[r] as (unknown)[];
      if (!row.some(Boolean)) continue;

      let dIdx = -1, tIdx = -1;
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] ?? '').toLowerCase().trim();
        if (dIdx < 0 && (cell.includes('week') || cell.includes('date') || cell.includes('period'))) dIdx = c;
        if (tIdx < 0 && cell === 'total') tIdx = c;
        // ICI sometimes uses "All Funds" or "Grand Total"
        if (tIdx < 0 && (cell === 'all funds' || cell.includes('grand total'))) tIdx = c;
      }

      if (dIdx >= 0 && tIdx >= 0) {
        dateCol = dIdx;
        totalCol = tIdx;
        dataStartRow = r + 1;
        break;
      }
    }

    // If no header match, try heuristic: first date-looking col + largest number col
    if (dateCol < 0 || totalCol < 0) {
      for (let r = 0; r < Math.min(10, rows.length); r++) {
        const row = rows[r] as unknown[];
        const ds = toDateStr(row[0]);
        if (!ds) continue;
        // Found a date row — look for the biggest number nearby (Total is usually first numeric col)
        for (let c = 1; c < Math.min(8, row.length); c++) {
          const v = typeof row[c] === 'number' ? (row[c] as number) : parseFloat(String(row[c] ?? '').replace(/,/g, ''));
          if (!isNaN(v) && v > 100) {
            dateCol = 0;
            totalCol = c;
            dataStartRow = r;
            break;
          }
        }
        if (dateCol >= 0) break;
      }
    }

    if (dateCol < 0 || totalCol < 0) continue;

    // ── Extract data ──
    const data: IciMmfResponse['data'] = [];
    for (let r = dataStartRow; r < rows.length; r++) {
      const row = rows[r] as unknown[];
      if (!row || row.length <= Math.max(dateCol, totalCol)) continue;

      const dateStr = toDateStr(row[dateCol]);
      if (!dateStr) continue;

      const rawV = row[totalCol];
      const value = typeof rawV === 'number'
        ? rawV
        : parseFloat(String(rawV ?? '').replace(/[$,%]/g, '').replace(/,/g, ''));
      if (isNaN(value) || value <= 0) continue;

      data.push({ date: dateStr, value });
    }

    if (data.length > 10) {
      return data.sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  return [];
}

// ── Find Excel links from ICI HTML ────────────────────────────────────────
function findExcelUrls(html: string): string[] {
  const found = new Set<string>();
  // Various patterns observed on ICI's site
  const re = /href="([^"]*(?:data_mm|mmf)[^"]*\.xlsx?)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    found.add(href.startsWith('http') ? href : `${ICI_BASE}${href}`);
  }
  // Also try generic xlsx/xls in the /system/files/ path (ICI's file server)
  const re2 = /href="(\/system\/files\/[^"]*\.xlsx?)"/gi;
  while ((m = re2.exec(html)) !== null) {
    found.add(`${ICI_BASE}${m[1]}`);
  }
  return Array.from(found);
}

// ── HTML table fallback (recent weeks only) ───────────────────────────────
function parseHtmlTable(html: string): IciMmfResponse['data'] {
  const data: IciMmfResponse['data'] = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tableRe.exec(html)) !== null) {
    const table = tableMatch[0];
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    let dateColIdx = 0, totalColIdx = 1;
    let headerFound = false;
    const tableData: IciMmfResponse['data'] = [];

    while ((rowMatch = rowRe.exec(table)) !== null) {
      const cells = (rowMatch[0].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? [])
        .map(c => c.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim());

      if (!headerFound) {
        const lc = cells.map(c => c.toLowerCase());
        const wi = lc.findIndex(c => c.includes('week') || c.includes('date'));
        const ti = lc.findIndex(c => c === 'total' || c.includes('all funds'));
        if (wi >= 0 || ti >= 0) {
          if (wi >= 0) dateColIdx = wi;
          if (ti >= 0) totalColIdx = ti;
          headerFound = true;
          continue;
        }
      }

      if (cells.length <= Math.max(dateColIdx, totalColIdx)) continue;
      const ds = toDateStr(cells[dateColIdx]);
      const v = parseFloat((cells[totalColIdx] ?? '').replace(/[$,]/g, ''));
      if (ds && !isNaN(v) && v > 0) tableData.push({ date: ds, value: v });
    }

    if (tableData.length > 3) data.push(...tableData);
  }

  return data.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Handler ───────────────────────────────────────────────────────────────
export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<IciMmfResponse | { error: string }>
) {
  const headers = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' };

  // 1. Fetch ICI page HTML
  let html: string | null = null;
  try {
    const r = await fetch(`${ICI_BASE}/research/stats/mmf`, {
      headers, signal: AbortSignal.timeout(12000),
    });
    if (r.ok) html = await r.text();
  } catch { /* fallthrough */ }

  if (html) {
    // 2. Try Excel files
    const excelUrls = findExcelUrls(html);

    // Sort: prefer "historical" files (more data)
    excelUrls.sort((a, b) => {
      const aH = a.toLowerCase().includes('historical') ? -1 : 1;
      const bH = b.toLowerCase().includes('historical') ? -1 : 1;
      return aH - bH;
    });

    for (const url of excelUrls) {
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(25000),
        });
        if (!r.ok) continue;

        const buf = await r.arrayBuffer();
        const data = parseExcelBuffer(buf);

        if (data.length > 0) {
          res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
          return res.status(200).json({
            data,
            unit: 'millions',
            source: `ICI Weekly (Excel)`,
            lastUpdated: data.at(-1)?.date,
          });
        }
      } catch { /* try next */ }
    }

    // 3. HTML table fallback
    const tableData = parseHtmlTable(html);
    if (tableData.length > 0) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).json({
        data: tableData,
        unit: 'millions',
        source: 'ICI (HTML table)',
        lastUpdated: tableData.at(-1)?.date,
      });
    }
  }

  return res.status(502).json({ error: 'ICI MMF 데이터를 불러올 수 없습니다.' });
}
