import type { NextApiRequest, NextApiResponse } from 'next';
import XLSX from 'xlsx';
import type { IciMmfResponse } from '@/lib/types';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Date helpers ──────────────────────────────────────────────────────────
function excelSerialToDate(serial: number): string | null {
  // Excel epoch: 1900-01-01 with Lotus 1-2-3 bug (day 60 = Feb 29 1900 doesn't exist)
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
  if (typeof raw === 'number') {
    if (raw > 30000 && raw < 70000) return excelSerialToDate(raw);
    return null;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const d = new Date(raw.trim());
    if (!isNaN(d.getTime()) && d.getFullYear() > 1990) {
      return d.toISOString().split('T')[0];
    }
  }
  return null;
}

// ── Parse a single ICI XLS buffer ─────────────────────────────────────────
function parseExcelBuffer(buffer: ArrayBuffer): IciMmfResponse['data'] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
  } catch {
    return [];
  }

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
    if (rows.length < 3) continue;

    let dateCol = -1;
    let totalCol = -1;
    let dataStartRow = 0;

    // ── Pass 1: look for named header row ──────────────────────────────
    for (let r = 0; r < Math.min(15, rows.length); r++) {
      const row = rows[r] as unknown[];
      if (!row.some(v => v != null)) continue;

      const cells = row.map(c => String(c ?? '').toLowerCase().trim());

      const dIdx = cells.findIndex(c =>
        c === 'reporting date' || c === 'week ending' || c === 'date' ||
        c.includes('week') || c.includes('period') || c.includes('reporting')
      );
      const tIdx = cells.findIndex(c =>
        c === 'total' || c === 'total net assets' || c === 'all funds' ||
        c === 'grand total' ||
        (c.includes('total') && !c.includes('subtotal') && !c.includes('%'))
      );

      if (dIdx >= 0 && tIdx >= 0) {
        dateCol = dIdx;
        totalCol = tIdx;
        dataStartRow = r + 1;
        break;
      }

      // Partial match: header row with only one found — keep scanning
      if (dIdx >= 0 && dateCol < 0) dateCol = dIdx;
      if (tIdx >= 0 && totalCol < 0) totalCol = tIdx;
      if (dateCol >= 0 && totalCol >= 0) {
        dataStartRow = r + 1;
        break;
      }
    }

    // ── Pass 2: detect by data pattern if headers not found ───────────
    if (dateCol < 0 || totalCol < 0) {
      for (let r = 0; r < Math.min(20, rows.length); r++) {
        const row = rows[r] as unknown[];
        if (!row || !row[0]) continue;

        const ds = toDateStr(row[0]);
        if (!ds) continue;

        // First numeric column after the date is likely "Total"
        for (let c = 1; c < Math.min(8, row.length); c++) {
          const v = typeof row[c] === 'number' ? (row[c] as number)
            : parseFloat(String(row[c] ?? '').replace(/[,$]/g, ''));
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

    // Final fallback: assume col 0 = date, col 1 = total, skip first row
    if (dateCol < 0) dateCol = 0;
    if (totalCol < 0) totalCol = 1;
    if (dataStartRow === 0) dataStartRow = 1;

    // ── Extract data rows ──────────────────────────────────────────────
    const data: IciMmfResponse['data'] = [];

    for (let r = dataStartRow; r < rows.length; r++) {
      const row = rows[r] as unknown[];
      if (!row || row.length <= Math.max(dateCol, totalCol)) continue;

      const dateStr = toDateStr(row[dateCol]);
      if (!dateStr) continue;

      const rawV = row[totalCol];
      const value = typeof rawV === 'number'
        ? rawV
        : parseFloat(String(rawV ?? '').replace(/[$, ]/g, ''));

      if (isNaN(value) || value <= 0) continue;

      data.push({ date: dateStr, value });
    }

    if (data.length > 3) {
      // Deduplicate by date, keep last occurrence
      const map = new Map<string, number>();
      for (const p of data) map.set(p.date, p.value);
      return Array.from(map.entries())
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  return [];
}

// ── Fetch one year's XLS file ─────────────────────────────────────────────
async function fetchYear(year: number): Promise<IciMmfResponse['data']> {
  const url = `https://www.ici.org/mm_summary_data_${year}.xls`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.ms-excel,*/*' },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return [];
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 1000) return []; // empty / error page
    return parseExcelBuffer(buf);
  } catch {
    return [];
  }
}

// ── Handler ───────────────────────────────────────────────────────────────
export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<IciMmfResponse | { error: string }>
) {
  const currentYear = new Date().getFullYear();

  // Fetch current year + 2 previous years in parallel (≈ 3 years of weekly data)
  const years = [currentYear, currentYear - 1, currentYear - 2];
  const results = await Promise.all(years.map(fetchYear));

  // Merge & deduplicate across years
  const combined = new Map<string, number>();
  for (const yearData of results) {
    for (const p of yearData) combined.set(p.date, p.value);
  }

  if (combined.size === 0) {
    return res.status(502).json({
      error: `ICI MMF 데이터를 가져올 수 없습니다. (시도한 연도: ${years.join(', ')})`,
    });
  }

  const data = Array.from(combined.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).json({
    data,
    unit: 'millions',
    source: `ICI Weekly (${years.filter((_, i) => results[i].length > 0).join(', ')}년)`,
    lastUpdated: data.at(-1)?.date,
  });
}
