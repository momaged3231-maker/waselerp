'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatDateTime, useDisplayTimezone } from '@/lib/time';

function ZatcaList() {
  const timeZone = useDisplayTimezone();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    apiFetch('/zatca/invoices').then(setRows).catch(() => {});
  }, []);

  if (rows.length === 0) {
    return <div className="text-sm text-slate-400 py-6 text-center">لا توجد مستندات بعد</div>;
  }

  const labels: Record<number, string> = { 1: 'بانتظار', 2: 'تم التخليص', 3: 'تم الإبلاغ', 4: 'مرفوض' };

  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>الفاتورة</th><th>النوع</th><th>UUID</th><th>الحالة</th><th>التاريخ</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.zatcaInvoiceId}>
              <td className="font-mono text-xs">{row.invoiceNo ?? '—'}</td>
              <td>
                <span className="badge bg-slate-100 text-slate-600">
                  {row.invoiceType === 1 ? 'مبسطة' : 'ضريبية'}
                </span>
              </td>
              <td className="font-mono text-[10px]">{String(row.invoiceUuid).slice(0, 18)}…</td>
              <td>
                <span className={`badge ${row.status === 4 ? 'bg-rose-50 text-rose-700' : row.status === 1 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {labels[row.status] ?? row.status}
                </span>
              </td>
              <td className="whitespace-nowrap">{formatDateTime(row.createdAt, timeZone, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** ZATCA (Saudi e-invoicing) configuration — onboarding/CSID keys; production use requires a real CSID. */
export default function ZatcaSettingsScreen() {
  const [zatca, setZatca] = useState<any>({});
  const [zatcaStatus, setZatcaStatus] = useState<any>(null);
  const [error, setError] = useState('');

  async function load() {
    setZatca(await apiFetch('/zatca/config') ?? {});
    setZatcaStatus(await apiFetch('/zatca/status'));
  }

  useEffect(() => { load().catch((e) => setError(e?.message ?? 'تعذر التحميل')); }, []);

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <form
        className="card p-5 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            await apiFetch('/zatca/config', { method: 'PUT', body: zatca });
            setZatcaStatus(await apiFetch('/zatca/status'));
          } catch (err: any) { setError(err?.message ?? 'تعذر الحفظ'); }
        }}
      >
        <div className="font-bold">بيانات البائع وربط ZATCA</div>

        {zatcaStatus && (
          <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-1">
            <div>الحالة: <b>{zatcaStatus.configured ? 'مُهيّأة' : 'غير مُهيّأة'}</b></div>
            <div>البيئة: {zatcaStatus.environment}</div>
            <div>CSID: {zatcaStatus.hasCsid ? 'موجود' : 'غير موجود'} · الشهادة: {zatcaStatus.hasCertificate ? 'موجودة' : 'غير موجودة'}</div>
            <div>مفتاح ECDSA: {zatcaStatus.hasEcdsaKey ? 'موجود' : 'غير موجود'}</div>
          </div>
        )}
        {error && <div className="text-sm text-rose-600">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">اسم البائع</label>
            <input className="input" value={zatca.seller_name ?? ''}
              onChange={(e) => setZatca({ ...zatca, seller_name: e.target.value })} />
          </div>
          <div>
            <label className="label">الرقم الضريبي</label>
            <input className="input" value={zatca.seller_vat_number ?? ''} dir="ltr"
              onChange={(e) => setZatca({ ...zatca, seller_vat_number: e.target.value })} />
          </div>
          <div>
            <label className="label">البريد</label>
            <input className="input" value={zatca.seller_email ?? ''} dir="ltr"
              onChange={(e) => setZatca({ ...zatca, seller_email: e.target.value })} />
          </div>
          <div>
            <label className="label">الهاتف</label>
            <input className="input" value={zatca.seller_phone ?? ''} dir="ltr"
              onChange={(e) => setZatca({ ...zatca, seller_phone: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="label">العنوان</label>
          <input className="input" value={zatca.seller_address ?? ''}
            onChange={(e) => setZatca({ ...zatca, seller_address: e.target.value })} />
        </div>

        <div>
          <label className="label">البيئة</label>
          <select className="input" value={zatca.environment ?? 'sandbox'}
            onChange={(e) => setZatca({ ...zatca, environment: e.target.value })}>
            <option value="sandbox">Simulation (اختبار)</option>
            <option value="production">Production (إنتاج)</option>
          </select>
        </div>

        <details className="rounded-xl border border-slate-200 p-3">
          <summary className="text-sm font-semibold cursor-pointer">بيانات CSID والمفاتيح (من بوابة ZATCA)</summary>
          <div className="space-y-3 mt-3">
            <div>
              <label className="label">CSID Token</label>
              <textarea className="input h-20 font-mono text-xs" value={zatca.csid_token ?? ''}
                onChange={(e) => setZatca({ ...zatca, csid_token: e.target.value })} />
            </div>
            <div>
              <label className="label">CSID Secret</label>
              <textarea className="input h-20 font-mono text-xs" value={zatca.csid_secret ?? ''}
                onChange={(e) => setZatca({ ...zatca, csid_secret: e.target.value })} />
            </div>
            <div>
              <label className="label">المفتاح الخاص (RSA PEM)</label>
              <textarea className="input h-28 font-mono text-[10px]" value={zatca.private_key ?? ''}
                onChange={(e) => setZatca({ ...zatca, private_key: e.target.value })} />
            </div>
            <div>
              <label className="label">الشهادة (PEM)</label>
              <textarea className="input h-24 font-mono text-[10px]" value={zatca.certificate ?? ''}
                onChange={(e) => setZatca({ ...zatca, certificate: e.target.value })} />
            </div>
            <div>
              <label className="label">مفتاح ECDSA الخاص (PEM)</label>
              <textarea className="input h-24 font-mono text-[10px]" value={zatca.ecdsa_private_key ?? ''}
                onChange={(e) => setZatca({ ...zatca, ecdsa_private_key: e.target.value })} />
            </div>
            <div>
              <label className="label">مفتاح ECDSA العام (PEM)</label>
              <textarea className="input h-24 font-mono text-[10px]" value={zatca.ecdsa_public_key ?? ''}
                onChange={(e) => setZatca({ ...zatca, ecdsa_public_key: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!zatca.is_active}
                onChange={(e) => setZatca({ ...zatca, is_active: e.target.checked })} />
              تفعيل الربط مع ZATCA
            </label>
          </div>
        </details>

        <button className="btn-primary">حفظ</button>
      </form>

      <div className="card p-5">
        <div className="font-bold mb-2">مستندات ZATCA</div>
        <ZatcaList />
      </div>
    </div>
  );
}
