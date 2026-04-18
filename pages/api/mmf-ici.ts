import type { NextApiRequest, NextApiResponse } from 'next';
import XLSX from 'xlsx';
import type { IciMmfResponse, IciMmfPoint } from '@/lib/types';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function excelSerialToDate(serial: number): string | null {
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
    const s = raw.trim();
    // MM/DD/YYYY
    const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
      const d = new Date(`${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    const d = new Date(s);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1990) {
      return d.toISOString().split('T')[0];
    }
  }
  return null;
}

function toNum(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return parseFloat(raw.replace(/[$, ]/g, ''));
  return NaN;
}

// Find column indices for Total All, Government Total, Prime Total
// Strategy: scan header rows for keywords, then verify with value ranges
function parseExcelBuffer(buffer: ArrayBuffer): IciMmfPoint[] {
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
    if (rows.length < 5) continue;

    let dateCol = -1;
    let totalCol = -1;
    let govCol = -1;
    let primeCol = -1;
    let dataStartRow = 0;

    // Scan header rows
    for (let r = 0; r < Math.min(20, rows.length); r++) {
      const row = rows[r] as unknown[];
      if (!row || !row.some(v => v != null)) continue;

      const cells = row.map(c => String(c ?? '').toLowerCase().trim());

      // Look for date column
      if (dateCol < 0) {
        const dIdx = cells.findIndex(c =>
          c === 'reporting date' || c === 'week ending' || c === 'date' ||
          c.includes('week') || c.includes('period') || c.includes('reporting')
        );
        if (dIdx >= 0) dateCol = dIdx;
      }

      // Look for Total All column — "total all" or just "total" (not subtotal, not %)
      if (totalCol < 0) {
        for (let c = 0; c < cells.length; c++) {
          const cell = cells[c];
          if (cell === 'total all' || cell === 'all' ||
              (cell === 'total' && !cell.includes('%') && !cell.includes('sub'))) {
            totalCol = c;
            break;
          }
        }
        // Also try "total all funds" or combined
        if (totalCol < 0) {
          for (let c = 0; c < cells.length; c++) {
            if (cells[c].includes('total') && cells[c].includes('all')) {
              totalCol = c;
              break;
            }
          }
        }
      }

      // Government Total
      if (govCol < 0) {
        for (let c = 0; c < cells.length; c++) {
          const cell = cells[c];
          if (cell === 'government total' || cell === 'government' ||
              (cell.includes('gov') && cell.includes('total'))) {
            govCol = c;
            break;
          }
        }
        if (govCol < 0) {
          for (let c = 0; c < cells.length; c++) {
            if (cells[c].includes('government') || cells[c] === 'govt') {
              govCol = c;
              break;
            }
          }
        }
      }

      // Prime Total
      if (primeCol < 0) {
        for (let c = 0; c < cells.length; c++) {
          const cell = cells[c];
          if (cell === 'prime total' || (cell.includes('prime') && cell.includes('total'))) {
            primeCol = c;
            break;
          }
        }
        if (primeCol < 0) {
          for (let c = 0; c < cells.length; c++) {
            if (cells[c] === 'prime' || cells[c].includes('prime')) {
              primeCol = c;
              break;
            }
          }
        }
      }

      // Once we have a date col, check if this row or the next is the start of data
      if (dateCol >= 0) {
        // Check a few rows below to see if data starts
        for (let rr = r + 1; rr < Math.min(r + 5, rows.length); rr++) {
          const testRow = rows[rr] as unknown[];
          if (testRow && toDateStr(testRow[dateCol]) !== null) {
            dataStartRow = rr;
            break;
          }
        }
        if (dataStartRow > 0) break;
      }
    }

    // If we couldn't find columns by header, try value-based detection on first data row
    if (dateCol < 0 || totalCol < 0) {
      for (let r = 0; r < Math.min(25, rows.length); r++) {
        const row = rows[r] as unknown[];
        if (!row || !row[0]) continue;
        const ds = toDateStr(row[0]);
        if (!ds) continue;

        // Found a data row — now identify columns by value magnitude and ratios
        // Total All ~7,000,000+, Gov ~60-90% of total, Prime ~5-20% of total
        const nums: { col: number; val: number }[] = [];
        for (let c = 1; c < row.length; c++) {
          const v = toNum(row[c]);
          if (!isNaN(v) && v > 100000) nums.push({ col: c, val: v });
        }

        if (nums.length >= 2) {
          nums.sort((a, b) => b.val - a.val);
          const maxVal = nums[0].val;
          // Total = largest
          totalCol = nums[0].col;
          dateCol = 0;
          dataStartRow = r;

          // Government = second largest that is 60-95% of total
          for (const n of nums.slice(1)) {
            const ratio = n.val / maxVal;
            if (ratio >= 0.55 && ratio <= 0.97 && govCol < 0) {
              govCol = n.col;
            } else if (ratio >= 0.03 && ratio <= 0.40 && primeCol < 0) {
              primeCol = n.col;
            }
          }
          break;
        }
      }
    }

    if (dateCol < 0) continue;
    if (dataStartRow === 0) dataStartRow = 1;

    // Extract data
    const map = new Map<string, IciMmfPoint>();

    for (let r = dataStartRow; r < rows.length; r++) {
      const row = rows[r] as unknown[];
      if (!row) continue;

      const dateStr = toDateStr(row[dateCol]);
      if (!dateStr) continue;

      const total = totalCol >= 0 ? toNum(row[totalCol]) : NaN;
      if (isNaN(total) || total <= 0) continue;

      const government = govCol >= 0 ? toNum(row[govCol]) : NaN;
      const prime = primeCol >= 0 ? toNum(row[primeCol]) : NaN;

      map.set(dateStr, {
        date: dateStr,
        total,
        government: isNaN(government) ? 0 : government,
        prime: isNaN(prime) ? 0 : prime,
      });
    }

    if (map.size > 3) {
      return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  return [];
}

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<IciMmfResponse | { error: string }>
) {
  const currentYear = new Date().getFullYear();
  const url = `https://www.ici.org/mm_summary_data_${currentYear}.xls`;

  let data: IciMmfPoint[] = [];
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.ms-excel,*/*' },
      signal: AbortSignal.timeout(20000),
    });
    if (r.ok) {
      const buf = await r.arrayBuffer();
      if (buf.byteLength >= 1000) {
        data = parseExcelBuffer(buf);
      }
    }
  } catch {
    // fall through to error
  }

  if (data.length === 0) {
    return res.status(502).json({
      error: `ICI MMF 데이터를 가져올 수 없습니다. (${currentYear}년)`,
    });
  }

  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).json({
    data,
    unit: 'millions',
    source: `ICI Weekly (${currentYear}년)`,
    lastUpdated: data.at(-1)?.date,
  });
}
