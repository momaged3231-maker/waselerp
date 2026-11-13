'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

const LIST_TYPES: Record<number, string> = {
  1: 'نقدي', 2: 'جملة', 3: 'نصف جملة',
};

type Tab = 'lists' | 'coupons' | 'offers';

export default function PricingPage() {
  const { can } = useSession();
  const canManage = can('items.manage');

  const [tab, setTab] = useState<Tab>('lists');
  const [lists, setLists] = useState<any[]>([]);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [offers, setOffers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', listType: 1, priority: 0, discountPct: 0 });
  const [couponForm, setCouponForm] = useState({
    code: '', name: '', discountType: 1, discountValue: 0, minInvoiceAmount: 0,
  });
  const [offerForm, setOfferForm] = useState({
    name: '', sourceItemId: 0, sourceQuantity: 1, giftItemId: 0, giftQuantity: 1,
  });

  async function loadLists() {
    const rows = await apiFetch<any[]>('/pricing/lists');
    setLists(rows);
    setSelected((current) => current ?? (rows.length ? Number(rows[0].priceListId) : null));
  }

  async function loadGrid() {
    if (!selected) return;
    const [itemRows, listRows] = await Promise.all([
      apiFetch<any>(`/items?pageSize=200&search=${encodeURIComponent(search)}`),
      apiFetch<any>(`/pricing/lists/${selected}/items`),
    ]);
    const all = itemRows.items ?? itemRows;
    const existing = new Map<number, any>(listRows.map((row: any) => [Number(row.itemId), row]));
    setItems(all.map((item: any) => ({
      ...item,
      listPrice: existing.get(Number(item.itemId))?.price ?? '',
      listUnitId: existing.get(Number(item.itemId))?.unitId ?? null,
    })));
    setPrices(Object.fromEntries(listRows.map((row: any) => [Number(row.itemId), String(row.price)])));
  }

  async function loadPromotions() {
    const [couponRows, offerRows, itemRows] = await Promise.all([
      apiFetch<any[]>('/pricing/coupons'),
      apiFetch<any[]>('/pricing/gift-offers'),
      apiFetch<any>('/items?pageSize=200'),
    ]);
    setCoupons(couponRows);
    setOffers(offerRows);
    setItems(itemRows.items ?? itemRows);
  }

  useEffect(() => { loadLists().catch((e) => setError(e.message)); }, []);
  useEffect(() => { loadPromotions().catch((e) => setError(e.message)); }, []);
  useEffect(() => { loadGrid().catch((e) => setError(e.message)); }, [selected, search]);

  async function saveList() {
    setError('');
    setMessage('');
    try {
      const result = await apiFetch('/pricing/lists', { method: 'POST', body: form });
      setShowForm(false);
      setForm({ name: '', code: '', listType: 1, priority: 0, discountPct: 0 });
      await loadLists();
      setSelected(Number(result.priceListId));
      setMessage('تم إنشاء قائمة الأسعار');
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removeList(id: number) {
    setError('');
    try {
      await apiFetch(`/pricing/lists/${id}`, { method: 'DELETE' });
      setSelected(null);
      await loadLists();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function savePrices() {
    setError('');
    setMessage('');
    try {
      const lines = Object.entries(prices)
        .filter(([, price]) => price !== '' && price !== undefined)
        .map(([itemId, price]) => ({ itemId: Number(itemId), price: Number(price) }));
      await apiFetch(`/pricing/lists/${selected}/lines`, { method: 'POST', body: { lines } });
      setMessage('تم حفظ الأسعار');
      await loadGrid();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveCoupon() {
    setError('');
    setMessage('');
    try {
      await apiFetch('/pricing/coupons', { method: 'POST', body: couponForm });
      setCouponForm({ code: '', name: '', discountType: 1, discountValue: 0, minInvoiceAmount: 0 });
      await loadPromotions();
      setMessage('تم إنشاء الكوبون');
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removeCoupon(id: number) {
    setError('');
    try {
      await apiFetch(`/pricing/coupons/${id}`, { method: 'DELETE' });
      await loadPromotions();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveOffer() {
    setError('');
    setMessage('');
    try {
      await apiFetch('/pricing/gift-offers', { method: 'POST', body: offerForm });
      setOfferForm({ name: '', sourceItemId: 0, sourceQuantity: 1, giftItemId: 0, giftQuantity: 1 });
      await loadPromotions();
      setMessage('تم إنشاء عرض الهدية');
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removeOffer(id: number) {
    setError('');
    try {
      await apiFetch(`/pricing/gift-offers/${id}`, { method: 'DELETE' });
      await loadPromotions();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const current = lists.find((row) => Number(row.priceListId) === selected);

  return (
    <AppShell title="الأسعار والترويج">
      {error && <div className="card p-3 mb-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}
      {message && <div className="card p-3 mb-3 border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{message}</div>}

      <div className="flex gap-2 mb-4">
        <button className={tab === 'lists' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('lists')}>
          قوائم الأسعار
        </button>
        <button className={tab === 'coupons' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('coupons')}>
          الكوبونات
        </button>
        <button className={tab === 'offers' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('offers')}>
          عروض الهدايا
        </button>
      </div>

      {tab === 'lists' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card h-fit">
            <div className="card-title">
              <span>القوائم</span>
              {canManage && (
                <button className="btn-soft text-xs" onClick={() => setShowForm((v) => !v)}>
                  {showForm ? 'إلغاء' : '+ قائمة'}
                </button>
              )}
            </div>

            {showForm && (
              <div className="p-4 space-y-2 border-b border-slate-100">
                <input className="input" placeholder="الاسم" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input className="input" placeholder="الكود" value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })} />
                <select className="input" value={form.listType}
                  onChange={(e) => setForm({ ...form, listType: Number(e.target.value) })}>
                  {[1, 2, 3].map((key) => (
                    <option key={key} value={key}>{LIST_TYPES[key]}</option>
                  ))}
                </select>
                <input className="input" type="number" placeholder="الأولوية" value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
                <button className="btn-primary w-full" disabled={!form.name} onClick={saveList}>حفظ</button>
              </div>
            )}

            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الاسم</th><th>النوع</th><th>أولوية</th><th></th></tr></thead>
                <tbody>
                  {lists.map((row) => (
                    <tr key={row.priceListId}
                      className={`cursor-pointer ${selected === Number(row.priceListId) ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                      onClick={() => setSelected(Number(row.priceListId))}>
                      <td className="text-xs font-semibold">
                        {row.name}
                        <div className="text-slate-400">{row.lineCount} صنف · {row.partyCount} عميل</div>
                      </td>
                      <td className="text-xs">{LIST_TYPES[row.listType] ?? row.listType}</td>
                      <td className="text-xs">{row.priority}</td>
                      <td>
                        {canManage && (
                          <button className="text-rose-500 text-xs"
                            onClick={(e) => { e.stopPropagation(); removeList(Number(row.priceListId)); }}>
                            حذف
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {lists.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-6">لا توجد قوائم</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-2 card">
            <div className="card-title">
              <span>{current ? `أسعار — ${current.name}` : 'اختر قائمة'}</span>
              {canManage && selected && (
                <button className="btn-primary text-xs" onClick={savePrices}>حفظ الأسعار</button>
              )}
            </div>
            <div className="p-3 border-b border-slate-100">
              <input className="input w-full" placeholder="بحث عن صنف…" value={search}
                onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="table-wrap" style={{ maxHeight: '62vh' }}>
              <table className="table">
                <thead><tr><th>الكود</th><th>الصنف</th><th>سعر البطاقة</th><th>سعر القائمة</th></tr></thead>
                <tbody>
                  {items.map((item: any) => (
                    <tr key={item.itemId}>
                      <td className="font-mono text-xs">{item.code}</td>
                      <td className="text-xs">{item.name}</td>
                      <td className="text-xs text-slate-500">{formatMoney(item.sellPrice)}</td>
                      <td>
                        {canManage ? (
                          <input
                            className="input py-1 text-xs w-28" type="number" step="0.01"
                            value={prices[item.itemId] ?? ''}
                            onChange={(e) => setPrices((p) => ({ ...p, [item.itemId]: e.target.value }))}
                          />
                        ) : (
                          <span className="text-xs">{prices[item.itemId] ?? '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-8">لا توجد أصناف</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'coupons' && (
        <div className="grid lg:grid-cols-3 gap-4">
          {canManage && (
            <div className="card p-4 space-y-3 h-fit">
              <div className="font-bold">كوبون جديد</div>
              <div>
                <label className="label">الكود</label>
                <input className="input" value={couponForm.code} dir="ltr"
                  onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <label className="label">الاسم</label>
                <input className="input" value={couponForm.name}
                  onChange={(e) => setCouponForm({ ...couponForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">نوع الخصم</label>
                  <select className="input" value={couponForm.discountType}
                    onChange={(e) => setCouponForm({ ...couponForm, discountType: Number(e.target.value) })}>
                    <option value={1}>نسبة %</option>
                    <option value={2}>مبلغ ثابت</option>
                  </select>
                </div>
                <div>
                  <label className="label">قيمة الخصم</label>
                  <input className="input" type="number" step="0.01" value={couponForm.discountValue}
                    onChange={(e) => setCouponForm({ ...couponForm, discountValue: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className="label">أقل قيمة للفاتورة</label>
                <input className="input" type="number" step="0.01" value={couponForm.minInvoiceAmount}
                  onChange={(e) => setCouponForm({ ...couponForm, minInvoiceAmount: Number(e.target.value) })} />
              </div>
              <button className="btn-primary w-full" disabled={!couponForm.code} onClick={saveCoupon}>حفظ الكوبون</button>
            </div>
          )}

          <div className={`card ${canManage ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
            <div className="card-title"><span>الكوبونات ({coupons.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الكود</th><th>الاسم</th><th>الخصم</th><th>الحد الأدنى</th><th>المستخدم</th><th></th></tr></thead>
                <tbody>
                  {coupons.map((row) => (
                    <tr key={row.couponId}>
                      <td className="font-mono text-xs">{row.code}</td>
                      <td className="text-xs">{row.name ?? '—'}</td>
                      <td className="text-xs">
                        {row.discountType === 1 ? `${Number(row.discountValue)}%` : formatMoney(row.discountValue)}
                      </td>
                      <td className="text-xs">{Number(row.minInvoiceAmount) > 0 ? formatMoney(row.minInvoiceAmount) : '—'}</td>
                      <td className="text-xs">
                        {row.usedCount}{row.usageLimit ? ` / ${row.usageLimit}` : ''}
                      </td>
                      <td>
                        {canManage && (
                          <button className="text-rose-500 text-xs" onClick={() => removeCoupon(row.couponId)}>حذف</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {coupons.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد كوبونات</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'offers' && (
        <div className="grid lg:grid-cols-3 gap-4">
          {canManage && (
            <div className="card p-4 space-y-3 h-fit">
              <div className="font-bold">عرض هدية جديد</div>
              <div>
                <label className="label">الاسم</label>
                <input className="input" value={offerForm.name}
                  onChange={(e) => setOfferForm({ ...offerForm, name: e.target.value })} />
              </div>
              <div>
                <label className="label">الصنف المطلوب</label>
                <select className="input" value={offerForm.sourceItemId}
                  onChange={(e) => setOfferForm({ ...offerForm, sourceItemId: Number(e.target.value) })}>
                  <option value={0}>— اختر —</option>
                  {items.map((item: any) => (
                    <option key={item.itemId} value={item.itemId}>{item.code} — {item.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">الكمية المطلوبة</label>
                <input className="input" type="number" step="0.001" value={offerForm.sourceQuantity}
                  onChange={(e) => setOfferForm({ ...offerForm, sourceQuantity: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">صنف الهدية</label>
                <select className="input" value={offerForm.giftItemId}
                  onChange={(e) => setOfferForm({ ...offerForm, giftItemId: Number(e.target.value) })}>
                  <option value={0}>— اختر —</option>
                  {items.map((item: any) => (
                    <option key={item.itemId} value={item.itemId}>{item.code} — {item.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">كمية الهدية</label>
                <input className="input" type="number" step="0.001" value={offerForm.giftQuantity}
                  onChange={(e) => setOfferForm({ ...offerForm, giftQuantity: Number(e.target.value) })} />
              </div>
              <button className="btn-primary w-full"
                disabled={!offerForm.sourceItemId || !offerForm.giftItemId}
                onClick={saveOffer}>
                حفظ العرض
              </button>
            </div>
          )}

          <div className={`card ${canManage ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
            <div className="card-title"><span>عروض الهدايا ({offers.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الاسم</th><th>المطلوب</th><th>الكمية</th><th>الهدية</th><th>الكمية</th><th></th></tr></thead>
                <tbody>
                  {offers.map((row) => (
                    <tr key={row.giftOfferId}>
                      <td className="text-xs font-semibold">{row.name}</td>
                      <td className="text-xs">{row.sourceItemName}</td>
                      <td className="text-xs">{Number(row.sourceQuantity)}</td>
                      <td className="text-xs">{row.giftItemName}</td>
                      <td className="text-xs">{Number(row.giftQuantity)}</td>
                      <td>
                        {canManage && (
                          <button className="text-rose-500 text-xs" onClick={() => removeOffer(row.giftOfferId)}>حذف</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {offers.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد عروض</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
