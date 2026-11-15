'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Item {
  itemId: number;
  code: string;
  name: string;
  baseUnitId: number;
  unitName?: string;
  barcode?: string;
  sellPrice?: number;
}

function Barcode({ code }: { code: string }) {
  const digits = code.replace(/\D/g, '').padStart(12, '0');
  return (
    <>
      {digits.split('').map((d, i) => (
        <div key={i} className="w-1 h-full bg-black inline-block mr-0.5" />
      ))}
    </>
  );
}

const FORMAT_WIDTH: Record<'small' | 'medium' | 'large', string> = {
  small: 'w-36',
  medium: 'w-52',
  large: 'w-72',
};

/** Labels — settings-driven (BarcodeLabelFormat/Copies/ShowName/ShowCode/ShowPrice from «الإعدادات ← طباعة الباركود»). */
export default function LabelsScreen() {
  const { can } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [labelFormat, setLabelFormat] = useState<'small' | 'medium' | 'large'>('medium');
  const [copies, setCopies] = useState(1);
  const [showName, setShowName] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [showPrice, setShowPrice] = useState(true);

  const canManage = can('stock.view');

  async function load() {
    try {
      const data: any = await apiFetch(`/items?pageSize=500&search=${encodeURIComponent(search)}`);
      const rows = data.items ?? data;
      setItems(rows);
    } catch (e: any) { setError(e.message); }
  }

  useEffect(() => { load().catch(() => {}); }, [search]);

  // Consume the barcode settings (seeded defaults: medium / 1 copy / show all)
  useEffect(() => {
    apiFetch<Record<string, string>>('/admin/settings').then((settings) => {
      const format = ['small', 'medium', 'large'].includes(settings?.BarcodeLabelFormat) ? (settings.BarcodeLabelFormat as any) : 'medium';
      setLabelFormat(format);
      setCopies(Math.min(10, Math.max(1, Number(settings?.BarcodeLabelCopies ?? 1) || 1)));
      setShowName(settings?.BarcodeShowName !== 'false');
      setShowCode(settings?.BarcodeShowCode !== 'false');
      setShowPrice(settings?.BarcodeShowPrice !== 'false');
    }).catch(() => {});
  }, []);

  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.itemId)), [items, selected]);

  function toggleItem(id: number) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  }

  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.itemId)));
  }

  function printLabels() {
    if (selected.size === 0) { setError('اختر أصنافًا على الأقل'); return; }
    setMessage(`جاري طباعة ${selectedItems.length * copies} ملصق...`);
    window.print();
  }

  return (
    <>
      <div className="p-4 space-y-4 no-print">
        <h1 className="text-xl font-bold">طباعة ملصقات الأصناف</h1>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        {message && <div className="text-green-600 text-sm">{message}</div>}

        <div className="flex gap-2 items-center flex-wrap">
          <input
            className="border rounded px-3 py-2 w-64"
            placeholder="بحث عن صنف..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="text-sm font-medium">
            حجم الملصق:
            <select
              className="ml-2 border rounded px-2 py-1"
              value={labelFormat}
              onChange={(e) => setLabelFormat(e.target.value as any)}
            >
              <option value="small">صغير</option>
              <option value="medium">متوسط</option>
              <option value="large">كبير</option>
            </select>
          </label>
          <span className="text-xs text-slate-500">عدد النسخ لكل ملصق: {copies} (من «الإعدادات ← طباعة الباركود»)</span>
          <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={toggleAll} disabled={!canManage}>
            تحديد الكل ({selected.size}/{items.length})
          </button>
          <button className="bg-green-600 text-white px-4 py-2 rounded" onClick={printLabels} disabled={selected.size === 0 || !canManage}>
            طباعة الملصقات المحددة
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {items.map((item) => (
            <div
              key={item.itemId}
              className={`border rounded p-2 ${
                selected.has(item.itemId) ? 'bg-blue-50 ring-2 ring-blue-600' : 'bg-white'
              }`}
            >
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selected.has(item.itemId)}
                  onChange={() => toggleItem(item.itemId)}
                  disabled={!canManage}
                />
                <span className="text-sm font-medium truncate block">{item.name}</span>
              </label>
              <div className="text-xs text-gray-600 mt-1">{item.code}</div>
              <div className="mt-2 flex items-center justify-center gap-1">
                <Barcode code={item.code} />
              </div>
              <div className="text-xs text-center mt-1">{item.code}</div>
              <div className="text-sm font-semibold mt-1">
                {item.sellPrice != null ? item.sellPrice.toLocaleString() + ' ج.م' : '-'}
              </div>
            </div>
          ))}
        </div>
        {items.length === 0 && <div className="text-gray-500 text-sm">لا توجد أصناف</div>}
      </div>

      {/* Print-only sheet: one block per selected item × configured copies */}
      <div className="labels-print-only">
        <div className="flex flex-wrap gap-2 p-2">
          {selectedItems.flatMap((item) =>
            Array.from({ length: copies }, (_, index) => (
              <div key={`${item.itemId}-${index}`} className={`border border-black rounded p-2 text-center ${FORMAT_WIDTH[labelFormat]} break-inside-avoid`}>
                {showName && <div className="text-[11px] font-bold leading-tight truncate">{item.name}</div>}
                <div className="my-1 h-10 flex items-stretch justify-center gap-0.5">
                  <Barcode code={item.code} />
                </div>
                {showCode && <div className="text-[10px] font-mono tracking-widest">{item.code}</div>}
                {showPrice && item.sellPrice != null && <div className="text-xs font-extrabold mt-0.5">{Number(item.sellPrice).toLocaleString()} ج.م</div>}
              </div>
            )),
          )}
        </div>
      </div>
    </>
  );
}
