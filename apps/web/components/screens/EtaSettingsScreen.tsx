'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

/** ETA (Egypt) e-invoice configuration — credentials authorize the Egyptian Tax Authority gateway; real submission stays deferred. */
export default function EtaSettingsScreen() {
  const [eta, setEta] = useState<any>({});
  const [etaStatus, setEtaStatus] = useState<any>(null);
  const [etaDocuments, setEtaDocuments] = useState<any[]>([]);
  const [error, setError] = useState('');

  async function load() {
    setEta(await apiFetch('/eta/config') ?? {});
    setEtaStatus(await apiFetch('/eta/status'));
    setEtaDocuments(await apiFetch('/eta/invoices?limit=50'));
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
            await apiFetch('/eta/config', { method: 'PUT', body: eta });
            setEtaStatus(await apiFetch('/eta/status'));
          } catch (err: any) { setError(err?.message ?? 'تعذر الحفظ'); }
        }}
      >
        <div className="font-bold">فاتورة إلكترونية مصرية (ETA)</div>

        {etaStatus && (
          <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-1">
            <div>الحالة: <b>{etaStatus.configured ? 'مُهيّأة' : 'غير مُهيّأة'}</b></div>
            <div>البيئة: {etaStatus.environment}</div>
            <div>الشهادة: {etaStatus.hasCertificate ? 'موجودة' : 'غير موجودة'} · المفتاح: {etaStatus.hasPrivateKey ? 'موجود' : 'غير موجود'}</div>
            <div>UUID تسجيل البائع: {etaStatus.egsUuid ?? 'يُشتق من رقم التسجيل'}</div>
          </div>
        )}
        {error && <div className="text-sm text-rose-600">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">اسم البائع</label>
            <input className="input" value={eta.seller_name ?? ''}
              onChange={(e) => setEta({ ...eta, seller_name: e.target.value })} />
          </div>
          <div>
            <label className="label">الرقم الضريبي</label>
            <input className="input" value={eta.seller_vat_number ?? ''} dir="ltr"
              onChange={(e) => setEta({ ...eta, seller_vat_number: e.target.value })} />
          </div>
          <div>
            <label className="label">رقم التسجيل التجاري</label>
            <input className="input" value={eta.seller_registration_id ?? ''} dir="ltr"
              onChange={(e) => setEta({ ...eta, seller_registration_id: e.target.value })} />
          </div>
          <div>
            <label className="label">UUID تسجيل البائع (EGS)</label>
            <input className="input" value={eta.egs_uuid ?? ''} dir="ltr"
              onChange={(e) => setEta({ ...eta, egs_uuid: e.target.value })} />
          </div>
          <div>
            <label className="label">البريد الإلكتروني</label>
            <input className="input" value={eta.seller_email ?? ''} dir="ltr"
              onChange={(e) => setEta({ ...eta, seller_email: e.target.value })} />
          </div>
          <div>
            <label className="label">التليفون</label>
            <input className="input" value={eta.seller_phone ?? ''} dir="ltr"
              onChange={(e) => setEta({ ...eta, seller_phone: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="label">العنوان</label>
          <input className="input" value={eta.seller_address ?? ''}
            onChange={(e) => setEta({ ...eta, seller_address: e.target.value })} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">البيئة</label>
            <select className="input" value={eta.environment ?? 'sandbox'}
              onChange={(e) => setEta({ ...eta, environment: e.target.value })}>
              <option value="sandbox">اختبار</option>
              <option value="production">إنتاج</option>
            </select>
          </div>
          <div>
            <label className="label">عنوان بوابة ETA</label>
            <input className="input" value={eta.api_base_url ?? ''} dir="ltr"
              onChange={(e) => setEta({ ...eta, api_base_url: e.target.value })} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">معرّف العميل</label>
            <input className="input" value={eta.client_id ?? ''} dir="ltr"
              onChange={(e) => setEta({ ...eta, client_id: e.target.value })} />
          </div>
          <div>
            <label className="label">سر العميل</label>
            <input className="input" value={eta.client_secret ?? ''} dir="ltr"
              onChange={(e) => setEta({ ...eta, client_secret: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="label">المفتاح الخاص (RSA)</label>
          <textarea className="input h-28 font-mono text-[10px]" value={eta.private_key ?? ''}
            onChange={(e) => setEta({ ...eta, private_key: e.target.value })} />
        </div>
        <div>
          <label className="label">الشهادة الرقمية</label>
          <textarea className="input h-24 font-mono text-[10px]" value={eta.certificate ?? ''}
            onChange={(e) => setEta({ ...eta, certificate: e.target.value })} />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!eta.is_active}
            onChange={(e) => setEta({ ...eta, is_active: e.target.checked })} />
          تفعيل الربط مع هيئة الضرائب المصرية
        </label>

        <button className="btn-primary">حفظ إعدادات ETA</button>
      </form>

      <div className="card">
        <div className="card-title"><span>مستندات ETA</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الفاتورة</th><th>UUID</th><th>الإجمالي</th><th>الحالة</th></tr></thead>
            <tbody>
              {etaDocuments.map((row: any) => (
                <tr key={row.etaInvoiceId}>
                  <td className="text-xs font-mono">{row.invoiceNo}</td>
                  <td className="text-[10px] font-mono">{row.invoiceUuid}</td>
                  <td className="text-xs font-bold">{Number(row.totalAmount).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${row.status === 1 ? 'bg-amber-50 text-amber-700'
                      : row.status === 4 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {row.status === 1 ? 'في انتظار الإرسال' : row.status === 2 ? 'مُسلَّم' : row.status === 3 ? 'مُبلَّغ' : 'مرفوض'}
                    </span>
                  </td>
                </tr>
              ))}
              {etaDocuments.length === 0 && (
                <tr><td colSpan={4} className="text-center text-slate-400 py-8">لا توجد مستندات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
