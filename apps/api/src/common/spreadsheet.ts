import * as XLSX from 'xlsx';

/**
 * Shared parser for the import tools (items / parties).
 * Accepts CSV text or an .xlsx (as base64) and normalises both into
 * lowercase, BOM-stripped headers + a string matrix.
 */

export interface ParsedSheet {
  headers: string[];
  /** One record per data row, keyed by normalized header. */
  raw: Record<string, string>[];
}

/** Maps Arabic (and a few English aliases) column headers onto the canonical English keys. */
export function applyHeaderAliases(
  rows: Record<string, string>[],
  aliases: Record<string, string>,
): Record<string, string>[] {
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      const normalized = key.trim().toLowerCase().replace(/\s+/g, '_').replace(/[- ]/g, '_');
      out[aliases[normalized] ?? normalized] = value;
    }
    return out;
  });
}

export const ITEM_IMPORT_ALIASES: Record<string, string> = {
  'الكود': 'code', 'كود': 'code', 'اكود': 'code',
  'الباركود': 'barcode', 'باركود': 'barcode',
  'الاسم': 'name', 'اسم': 'name',
  'الفئة': 'category', 'فئة': 'category', 'التصنيف': 'category',
  'الوحدة': 'unit', 'وحدة': 'unit',
  'سعر_التكلفة': 'cost_price', 'تكلفة': 'cost_price',
  'سعر_البيع': 'sell_price', 'السعر': 'sell_price',
  'الضريبة': 'vat_pct', 'ضريبة': 'vat_pct', 'نسبة_الضريبة': 'vat_pct',
  'حد_الطلب': 'reorder_point', 'اعادة_الطلب': 'reorder_point',
};

export const PARTY_IMPORT_ALIASES: Record<string, string> = {
  'الكود': 'code', 'كود': 'code',
  'الاسم': 'name', 'اسم': 'name',
  'النوع': 'type', 'نوع': 'type',
  'الهاتف': 'phone', 'التليفون': 'phone', 'هاتف': 'phone',
  'الموبايل': 'mobile', 'موبايل': 'mobile', 'الجوال': 'mobile',
  'البريد': 'email', 'الايميل': 'email', 'ايميل': 'email',
  'العنوان': 'address', 'عنوان': 'address',
  'الرقم_الضريبي': 'tax_number', 'رقم_ضريبي': 'tax_number',
  'حد_الائتمان': 'credit_limit', 'الائتمان': 'credit_limit',
  'الخصم': 'discount_pct', 'خصم': 'discount_pct',
  'مجموعة_العملاء': 'customer_group', 'المجموعة': 'customer_group',
  'التصنيف': 'classification', 'تصنيف': 'classification',
  'المندوب': 'sales_rep', 'مندوب': 'sales_rep',
};

const BOM = /^﻿/;

function normalizeHeader(h: unknown): string {
  return String(h ?? '').replace(BOM, '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[- ]/g, '_');
}

/** Proper field-splitting CSV parser (quoted fields, embedded commas/newlines, BOM). */
function properCsv(src: string): { headers: string[]; matrix: string[][] } {
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((cell) => String(cell).trim() !== '')) matrix.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((cell) => String(cell).trim() !== '')) matrix.push(row);
  if (!matrix.length) return { headers: [], matrix: [] };
  const headers = matrix[0].map(normalizeHeader);
  const rest = matrix.slice(1).map((cells) => cells.map((c) => String(c ?? '').trim()));
  return { headers, matrix: rest };
}

function sheetToMatrix(ws: XLSX.WorkSheet): { headers: string[]; matrix: string[][] } {
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: '' });
  if (!aoa.length) return { headers: [], matrix: [] };
  const headers = (aoa[0] ?? []).map(normalizeHeader);
  const matrix = aoa.slice(1)
    .map((cells) => (cells ?? []).map((c: any) => String(c ?? '').trim()))
    .filter((cells) => cells.some((c) => c !== ''));
  return { headers, matrix };
}

export function parseImportFile(input: { csv?: string; xlsxBase64?: string }): ParsedSheet {
  let headers: string[] = [];
  let matrix: string[][] = [];

  if (input.csv && String(input.csv).trim()) {
    ({ headers, matrix } = properCsv(String(input.csv)));
  } else if (input.xlsxBase64) {
    const buffer = Buffer.from(String(input.xlsxBase64).includes(',')
      ? String(input.xlsxBase64).split(',').pop() ?? ''
      : String(input.xlsxBase64), 'base64');
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) throw new Error('ملف Excel فارغ أو بلا أوراق');
    ({ headers, matrix } = sheetToMatrix(wb.Sheets[firstSheet]));
  } else {
    throw new Error('لا توجد بيانات للملف — اختر ملفًا أو الصق نص CSV');
  }

  const raw = matrix.map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => { record[header] = cells[index] ?? ''; });
    return record;
  });
  return { headers, raw };
}

export function buildTemplateXlsx(headers: string[], example: (string | number)[]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, h.length + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
