'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

/** «كارت التصنيع» — define assembled items (أصناف مجمعة) and edit their BOM components. */
export default function AssemblyScreen() {
  const { can } = useSession();
  const manage = can('items.manage');
  const [grouped, setGrouped] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [picker, setPicker] = useState({ search: '', results: [] as any[] });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [newItem, setNewItem] = useState({ code: '', name: '', baseUnitId: 1, sellPrice: 0 });

  async function loadGrouped(focusId?: number) {
    const rows = await apiFetch<any[]>('/items/grouped');
    setGrouped(rows);
    const focus = focusId ?? selectedId ?? (rows[0] ? Number(rows[0].itemId) : null);
    setSelectedId(focus);
    return rows;
  }

  useEffect(() => {
    apiFetch('/catalog/units').then(setUnits).catch(() => {});
    loadGrouped().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) { setLines([]); return; }
    setError(''); setNotice('');
    apiFetch<any[]>(`/items/${selectedId}/components`).then((rows) => {
      setLines(rows.map((row) => ({
        childItemId: Number(row.childItemId),
        code: row.code,
        name: row.name,
        quantity: Number(row.quantity),
        unitId: Number(row.unitId),
        unitName: row.unitName,
        childCostPrice: Number(row.childCostPrice ?? 0),
      })));
    }).catch((e) => setError(e.message));
  }, [selectedId]);

  async function searchChildren(term: string) {
    setPicker((p) => ({ ...p, search: term }));
    if (term.trim().length < 1) { setPicker({ search: term, results: [] }); return; }
    const data = await apiFetch<any>(`/items?search=${encodeURIComponent(term.trim())}&pageSize=10`);
    const results = (data.items ?? []).filter((item: any) => Number(item.itemId) !== selectedId);
    setPicker((p) => ({ ...p, results }));
  }

  function addLine(item: any) {
    if (lines.some((line) => Number(line.childItemId) === Number(item.itemId))) return;
    setLines([...lines, {
      childItemId: Number(item.itemId),
      code: item.code,
      name: item.name,
      quantity: 1,
      unitId: item.baseUnitId,
      unitName: item.baseUnitName ?? units.find((u) => u.unitId === item.baseUnitId)?.name ?? '',
      childCostPrice: Number(item.costPrice ?? 0),
    }]);
    setPicker({ search: '', results: [] });
  }

  const costTotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.childCostPrice || 0), 0);

  async function saveComponents() {
    if (!selectedId || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await apiFetch<any>(`/items/${selectedId}/components`, {
        method: 'PUT',
        body: { lines: lines.map((line) => ({ childItemId: line.childItemId, quantity: Number(line.quantity), unitId: line.unitId })) },
      });
      setNotice(`تم الحفظ — عدد المكونات ${result?.componentsCount ?? lines.length}، تكلفة المكونات ${formatMoney(result?.costPrice ?? costTotal)}`);
      await loadGrouped(selectedId);
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الحفظ');
    } finally {
      setSaving(false);
    }
  }

  async function createGrouped(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setNotice('');
    try {
      const created = await apiFetch<any>('/items', {
        method: 'POST',
        body: {
          code: newItem.code.trim() || undefined,
          name: newItem.name.trim(),
          baseUnitId: newItem.baseUnitId,
          costPrice: 0,
          sellPrice: Number(newItem.sellPrice) || 0,
          isGrouped: true,
        },
      });
      const id = created?.itemId;
      setNewItem({ code: '', name: '', baseUnitId: 1, sellPrice: 0 });
      await loadGrouped(id ? Number(id) : undefined);
      setNotice('تم إنشاء الصنف المجمع — أضف مكوناته الآن');
    } catch (err: any) {
      setError(err?.message ?? 'تعذر إنشاء الصنف المجمع');
    }
  }

  const selected = grouped.find((row) => Number(row.itemId) === selectedId);

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="card">
        <div className="card-title"><span>الأصناف المجمعة ({grouped.length})</span></div>
        <div className="table-wrap max-h-96 overflow-y-auto">
          <table className="table">
            <thead><tr><th>الكود</th><th>الصنف</th><th>مكونات</th><th>تكلفة المكونات</th></tr></thead>
            <tbody>
              {grouped.map((row) => (
                <tr key={row.itemId} className={`cursor-pointer ${Number(row.itemId) === selectedId ? 'bg-brand-50' : ''}`} onClick={() => setSelectedId(Number(row.itemId))}>
                  <td className="font-mono text-xs">{row.code}</td>
                  <td className="font-semibold">{row.name}</td>
                  <td>{row.componentsCount}</td>
                  <td>{formatMoney(row.componentsCost)}</td>
                </tr>
              ))}
              {grouped.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-8">لا توجد أصناف مجمعة بعد — أنشئ أول صنف بالأسفل</td></tr>}
            </tbody>
          </table>
        </div>

        {manage && (
          <form className="border-t border-slate-100 p-4 space-y-2" onSubmit={createGrouped}>
            <div className="text-sm font-bold">صنف مجمع جديد (كارت التصنيع)</div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="الكود (فارغ = تلقائي)" value={newItem.code} onChange={(e) => setNewItem({ ...newItem, code: e.target.value })} dir="ltr" />
              <select className="input" value={newItem.baseUnitId} onChange={(e) => setNewItem({ ...newItem, baseUnitId: Number(e.target.value) })}>
                {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.name}</option>)}
              </select>
            </div>
            <input className="input" placeholder="اسم الصنف المجمع" required value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2 items-center">
              <label className="label mb-0">سعر البيع</label>
              <input className="input" type="number" min="0" step="0.01" value={newItem.sellPrice} onChange={(e) => setNewItem({ ...newItem, sellPrice: Number(e.target.value) })} />
            </div>
            <button className="btn-primary w-full">إنشاء صنف مجمع + فتح كارت التصنيع</button>
          </form>
        )}
      </div>

      <div className="card lg:col-span-2">
        <div className="card-title flex-wrap gap-2">
          <span>{selected ? `كارت التصنيع — ${selected.name}` : 'كارت التصنيع'}</span>
          {selected && <span className="badge bg-emerald-50 text-emerald-700">تكلفة المكونات {formatMoney(costTotal)}</span>}
        </div>

        {!selected && <div className="p-8 text-center text-slate-400 text-sm">اختر صنفًا مجمعًا من القائمة لعرض مكوناته</div>}

        {selected && (
          <>
            {manage && (
              <div className="p-4 border-b border-slate-100 relative">
                <label className="label">إضافة مكوّن (ابحث باسم أو كود الصنف)</label>
                <input
                  className="input"
                  placeholder="اكتب للبحث عن صنف مكوِّن…"
                  value={picker.search}
                  onChange={(e) => searchChildren(e.target.value)}
                />
                {picker.results.length > 0 && (
                  <div className="absolute z-10 left-4 right-4 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                    {picker.results.map((item) => (
                      <button key={item.itemId} type="button" className="w-full text-right px-3 py-2 text-sm hover:bg-brand-50 flex justify-between gap-2" onClick={() => addLine(item)}>
                        <span className="font-semibold">{item.name}</span>
                        <span className="font-mono text-xs text-slate-400 self-center">{item.code} · {formatMoney(item.costPrice)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الكود</th><th>المكوّن</th><th>الكمية</th><th>الوحدة</th><th>تكلفة المكوّن</th><th>إجمالي السطر</th>{manage && <th></th>}</tr></thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={`${line.childItemId}-${index}`}>
                      <td className="font-mono text-xs">{line.code}</td>
                      <td className="font-semibold">{line.name}</td>
                      <td>
                        <input
                          className="input w-24 py-1"
                          type="number" min="0.000001" step="0.000001"
                          value={line.quantity}
                          disabled={!manage}
                          onChange={(e) => setLines(lines.map((l, i) => (i === index ? { ...l, quantity: Number(e.target.value) } : l)))}
                        />
                      </td>
                      <td>
                        <select className="input w-28 py-1" value={line.unitId} disabled={!manage}
                          onChange={(e) => setLines(lines.map((l, i) => (i === index ? { ...l, unitId: Number(e.target.value), unitName: units.find((u) => u.unitId === Number(e.target.value))?.name ?? l.unitName } : l)))}>
                          {units.map((u) => <option key={u.unitId} value={u.unitId}>{u.name}</option>)}
                        </select>
                      </td>
                      <td>{formatMoney(line.childCostPrice)}</td>
                      <td className="font-bold">{formatMoney(Number(line.quantity || 0) * Number(line.childCostPrice || 0))}</td>
                      {manage && (
                        <td><button className="text-rose-500 text-xs font-semibold" onClick={() => setLines(lines.filter((_, i) => i !== index))}>إزالة</button></td>
                      )}
                    </tr>
                  ))}
                  {lines.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد مكونات — أضف مكوّنًا واحدًا على الأقل</td></tr>}
                </tbody>
                {lines.length > 0 && (
                  <tfoot>
                    <tr className="font-bold"><td colSpan={5}>إجمالي تكلفة المكونات (يُعتمد كسعر شراء للصنف)</td><td colSpan={2}>{formatMoney(costTotal)}</td></tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="p-4 flex items-center gap-3 flex-wrap border-t border-slate-100">
              {manage && <button className="btn-primary" onClick={saveComponents} disabled={saving || lines.length === 0}>{saving ? 'جارٍ الحفظ…' : 'حفظ كارت التصنيع'}</button>}
              <span className="text-xs text-slate-400">تكلفة الصنف المجمع = مجموع تكاليف المكونات، وتُحدَّث تلقائيًا عند الحفظ</span>
            </div>
          </>
        )}

        {error && <div className="mx-4 mb-4 text-sm text-rose-600">{error}</div>}
        {notice && <div className="mx-4 mb-4 text-sm text-emerald-700">{notice}</div>}
      </div>
    </div>
  );
}
