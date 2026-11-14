'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch } from '@/lib/api';
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

export default function LabelsPage() {
  const { can } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [labelFormat, setLabelFormat] = useState<'small' | 'medium' | 'large'>('medium');

  const canManage = can('stock.view');

  async function load() {
    try {
      const data: any = await apiFetch(`/items?pageSize=500&search=${encodeURIComponent(search)}`);
      const rows = data.items ?? data;
      setItems(rows);
    } catch (e: any) { setError(e.message); }
  }

  useEffect(() => { load().catch(() => {}); }, [search]);

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
    const selItems = items.filter((i) => selected.has(i.itemId));
    setMessage(`جاري طباعة ${selItems.length} ملصق...`);
    window.print();
  }

  return (
    <AppShell>
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-bold">طباعة ملصقات الأصناف</h1>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        {message && <div className="text-green-600 text-sm">{message}</div>}

        <div className="flex gap-2 items-center">
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
    </AppShell>
  );
}
