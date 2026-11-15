'use client';

import { useRef, useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';
import { downloadBase64File } from '@/lib/export';

/** Tools → «استيراد أصناف» — CSV or XLSX upload with server-side preview + apply. */
export default function ItemImportScreen() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [payload, setPayload] = useState<any>(null); // { csv? } | { xlsxBase64? }
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function downloadTemplate(format: 'csv' | 'xlsx') {
    setError('');
    try {
      const file = await apiFetch<{ fileName: string; mimeType: string; base64: string }>(`/items/import/template?format=${format}`);
      downloadBase64File(file.fileName, file.mimeType, file.base64);
    } catch (e: any) {
      setError(e?.message ?? 'تعذر التنزيل');
    }
  }

  async function onFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setResult(null);
    setPreview(null);
    setError('');
    setFileName(file.name);
    try {
      const isCsv = /\.csv$/i.test(file.name);
      if (isCsv) {
        const csvText = await file.text();
        setPayload({ csv: csvText });
        await run('preview', { csv: csvText });
      } else {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
          reader.readAsDataURL(file);
        });
        setPayload({ xlsxBase64: base64 });
        await run('preview', { xlsxBase64: base64 });
      }
    } catch (e: any) {
      setError(e?.message ?? 'تعذر قراءة الملف');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function run(mode: 'preview' | 'apply', body?: any) {
    if (!body && !payload) { setError('اختر ملفًا أولًا'); return; }
    setBusy(true);
    setError('');
    try {
      const data = await apiFetch<any>('/items/import', { method: 'POST', body: { mode, ...(body ?? payload) } });
      if (mode === 'preview') setPreview(data);
      else { setResult(data); setPreview(null); }
    } catch (e: any) {
      setError(e?.message ?? 'تعذر التشغيل');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="font-bold text-slate-800 mb-1">استيراد أصناف من ملف (CSV أو Excel)</div>
        <p className="text-xs text-slate-500 leading-6 mb-3">
          الصفوف تحتوي: الكود (فارغ = تلقائي إن كان «كود الصنف تلقائيًا» مفعّلًا)، الباركود، الاسم، الفئة، الوحدة، تكلفة، سعر بيع، ضريبة، حد الطلب.
          الأسماء العربية للأعمدة مسموحة (الاسم، الكود، سعر البيع…). الصنف الموجود (بنفس الكود) يُحدَّث، وغيره يُنشأ.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-soft text-sm" onClick={() => downloadTemplate('csv')}>تنزيل قالب CSV</button>
          <button className="btn-soft text-sm" onClick={() => downloadTemplate('xlsx')}>تنزيل قالب Excel</button>
          <label className="btn-primary text-sm cursor-pointer">
            اختيار ملف (.csv / .xlsx)
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFilePicked} />
          </label>
          {fileName && <span className="text-xs text-slate-500 font-mono">{fileName}</span>}
        </div>
        {error && <div className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
      </div>

      {preview && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="font-bold">معاينة: {preview.valid} صالح من {preview.total} — {preview.invalid} مرفوض</div>
            <button className="btn-primary text-sm" disabled={!preview.valid || busy} onClick={() => run('apply')}>{busy ? 'جارٍ التطبيق…' : 'تطبيق الاستيراد'}</button>
            <button className="btn-soft text-sm" onClick={() => { setPreview(null); setPayload(null); setFileName(''); }}>إلغاء</button>
          </div>
          {Array.isArray(preview.errors) && preview.errors.length > 0 && (
            <ul className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3 space-y-1 max-h-40 overflow-auto">
              {preview.errors.map((e: any, i: number) => <li key={i}>صف {e.row}: {e.message}</li>)}
            </ul>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الكود</th><th>الاسم</th><th>الفئة</th><th>الوحدة</th><th>تكلفة</th><th>بيع</th><th>ضريبة</th><th>حد الطلب</th></tr></thead>
              <tbody>
                {(preview.sample ?? []).map((row: any, i: number) => (
                  <tr key={i}>
                    <td className="font-mono text-xs">{row.code || '(تلقائي)'}</td>
                    <td className="font-semibold">{row.name}</td>
                    <td>{row.categoryId ?? '—'}</td>
                    <td>{row.baseUnitId}</td>
                    <td>{row.costPrice}</td>
                    <td className="font-semibold">{formatMoney(row.sellPrice)}</td>
                    <td>{row.vatPct}</td>
                    <td>{row.reorderPoint}</td>
                  </tr>
                ))}
                {(preview.sample ?? []).length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-6">لا توجد صفوف صالحة</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div className="card p-5 border-emerald-200 bg-emerald-50">
          <div className="font-extrabold text-emerald-800">تم الاستيراد: {result.created} جديد · {result.updated} محدّث · {result.failed?.length ?? 0} فاشل</div>
          {Array.isArray(result.failed) && result.failed.length > 0 && (
            <ul className="text-xs text-rose-700 mt-2 space-y-1 max-h-40 overflow-auto">
              {result.failed.map((e: any, i: number) => <li key={i}>صف {e.row}: {e.message}</li>)}
            </ul>
          )}
          <div className="text-xs text-emerald-800 mt-2">راجع الشاشة من «الأصناف» في البيانات الأساسية.</div>
        </div>
      )}
    </div>
  );
}
