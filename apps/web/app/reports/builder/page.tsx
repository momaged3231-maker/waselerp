'use client';

import { useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { downloadBase64File } from '@/lib/export';

type Dataset = { key: string; title: string; supportsDate: boolean; columns: { id: string; label: string; type: string }[] };
type Definition = { definitionId: number; name: string; dataset: string; config: { columns?: string[]; groupBy?: string } };

export default function ReportBuilderPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [dataset, setDataset] = useState('sales_invoices');
  const [name, setName] = useState('');
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function loadDefs() {
    const [ds, defs] = await Promise.all([
      apiFetch<Dataset[]>('/reports/builder/datasets'),
      apiFetch<Definition[]>('/reports/builder/definitions'),
    ]);
    setDatasets(ds);
    setDefinitions(defs);
    if (!selectedCols.length && ds.length) {
      const d = ds.find((x) => x.key === dataset) ?? ds[0];
      setDataset(d.key);
      setSelectedCols(d.columns.slice(0, 8).map((c) => c.id));
    }
  }

  useEffect(() => { loadDefs().catch((e) => setError(e.message)); }, []);

  const current = useMemo(() => datasets.find((d) => d.key === dataset), [datasets, dataset]);

  function onDatasetChange(key: string) {
    setDataset(key);
    const d = datasets.find((x) => x.key === key);
    setSelectedCols(d ? d.columns.slice(0, 8).map((c) => c.id) : []);
    setGroupBy('');
    setResult(null);
  }

  function toggleCol(id: string) {
    setSelectedCols((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function run() {
    setError(''); setMessage(''); setLoading(true);
    try {
      const data = await apiFetch('/reports/builder/run', {
        method: 'POST',
        body: JSON.stringify({ dataset, columns: selectedCols, from, to, ...(groupBy ? { groupBy } : {}) }),
      });
      setResult(data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  async function saveDefinition() {
    setError(''); setMessage('');
    if (!name.trim()) { setError('أدخل اسم التقرير'); return; }
    try {
      await apiFetch('/reports/builder/definitions', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), dataset, columns: selectedCols, ...(groupBy ? { groupBy } : {}) }),
      });
      setName('');
      setMessage('تم حفظ تعريف التقرير');
      await loadDefs();
    } catch (e: any) { setError(e.message); }
  }

  async function applyDefinition(def: Definition) {
    setDataset(def.dataset);
    const cols = def.config?.columns;
    if (Array.isArray(cols) && cols.length) setSelectedCols(cols.map(String));
    setGroupBy(def.config?.groupBy ? String(def.config.groupBy) : '');
    setName(def.name);
    setResult(null);
  }

  async function removeDefinition(id: number) {
    if (!confirm('حذف تعريف التقرير؟')) return;
    try {
      await apiFetch(`/reports/builder/definitions/${id}`, { method: 'DELETE' });
      await loadDefs();
    } catch (e: any) { setError(e.message); }
  }

  async function exportXlsx() {
    setError('');
    try {
      const qs = new URLSearchParams({ dataset, from, to, columns: selectedCols.join(',') });
      if (groupBy) qs.set('groupBy', groupBy);
      const file = await apiFetch<{ fileName: string; mimeType: string; base64: string }>(`/reports/builder/export-xlsx?${qs.toString()}`);
      downloadBase64File(file.fileName, file.mimeType, file.base64);
    } catch (e: any) { setError(e.message); }
  }

  function renderCell(value: any, type?: string) {
    if (value == null) return '';
    if (type === 'number') return formatMoney(Number(value));
    if (type === 'date') return formatDate(String(value));
    return String(value);
  }

  return (
    <AppShell title="منشئ التقارير">
      <div className="space-y-4">
        {error && <div className="text-red-600 text-sm">{error}</div>}
        {message && <div className="text-green-700 text-sm">{message}</div>}

        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <label className="block">
              <div className="text-sm mb-1">مصدر البيانات</div>
              <select className="input w-56" value={dataset} onChange={(e) => onDatasetChange(e.target.value)}>
                {datasets.map((d) => <option key={d.key} value={d.key}>{d.title}</option>)}
              </select>
            </label>
            {current?.supportsDate && <>
              <label className="block"><div className="text-sm mb-1">من</div><input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="block"><div className="text-sm mb-1">إلى</div><input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </>}
            <button className="btn-primary" onClick={run} disabled={loading || !selectedCols.length}>{loading ? 'جارٍ التشغيل...' : 'تشغيل التقرير'}</button>
            <button className="btn-soft" onClick={exportXlsx} disabled={!selectedCols.length}>تصدير Excel</button>
          </div>

          <div>
            <div className="text-sm font-semibold mb-2">الأعمدة</div>
            <div className="flex flex-wrap gap-2">
              {(current?.columns ?? []).map((c) => (
                <label key={c.id} className={`px-2 py-1 border rounded text-sm cursor-pointer ${selectedCols.includes(c.id) ? 'bg-blue-600 text-white border-blue-600' : ''}`}>
                  <input type="checkbox" className="hidden" checked={selectedCols.includes(c.id)} onChange={() => toggleCol(c.id)} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-end">
            <label className="block">
              <div className="text-sm mb-1">تجميع حسب (اختياري — لإظهار مجاميع)</div>
              <select className="input w-56" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="">بدون تجميع</option>
                {(current?.columns ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            {groupBy && <div className="text-xs text-slate-500 pb-2">سيتم تجميع الصفوف حسب العمود المحدد مع جمع/عد الأعمدة الأخرى.</div>}
          </div>

          <div className="flex flex-wrap gap-2 items-end border-t pt-3">
            <label className="block">
              <div className="text-sm mb-1">حفظ كتعريف تقرير</div>
              <input className="input w-64" placeholder="اسم التقرير" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="btn-soft" onClick={saveDefinition}>حفظ التعريف</button>
          </div>
        </div>

        {definitions.length > 0 && (
          <div className="card p-4">
            <h2 className="font-semibold mb-2">التقارير المحفوظة</h2>
            <div className="flex flex-wrap gap-2">
              {definitions.map((d) => (
                <div key={d.definitionId} className="border rounded px-3 py-2 flex items-center gap-2">
                  <button className="text-blue-700 font-medium" onClick={() => applyDefinition(d)}>{d.name}</button>
                  <span className="text-xs text-slate-500">({d.dataset})</span>
                  <button className="text-red-600 text-xs" onClick={() => removeDefinition(d.definitionId)}>حذف</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {result && (
          <div className="card">
            <div className="p-3 border-b font-semibold">{result.title} — {result.rows?.length ?? 0} صف</div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>{(result.columns ?? []).map((c: any) => <th key={c.key}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {(result.rows ?? []).map((row: any, i: number) => (
                    <tr key={i}>{(result.columns ?? []).map((c: any) => <td key={c.key}>{renderCell(row[c.key], c.type)}</td>)}</tr>
                  ))}
                  {(!result.rows || result.rows.length === 0) && <tr><td colSpan={(result.columns ?? []).length || 1} className="text-center text-slate-400 py-6">لا توجد بيانات</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
