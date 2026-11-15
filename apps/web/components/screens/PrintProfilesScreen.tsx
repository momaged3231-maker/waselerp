'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import DeleteButton from '@/components/DeleteButton';

const PAPER_SIZE_LABEL: Record<string, string> = {
  thermal80: 'حراري 80مم',
  thermal58: 'حراري 58مم',
  a5: 'ورق A5 (متصفح)',
  a4: 'ورق A4 (متصفح)',
};

/** Print profiles (stations) — per-station printer/paper/copies/kitchen/overrides, merged into print-context. */
export default function PrintProfilesScreen() {
  const [printProfiles, setPrintProfiles] = useState<any[]>([]);
  const [printForm, setPrintForm] = useState<any>(null);
  const [printEditingId, setPrintEditingId] = useState<number | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setPrintProfiles(await apiFetch('/settings/print-profiles'));
  }

  useEffect(() => { load().catch((e) => setError(e?.message ?? 'تعذر التحميل')); }, []);

  function openPrintEditor(profile: any | null) {
    setError('');
    setPrintEditingId(profile?.profileId ?? null);
    setPrintForm(profile ? { ...profile } : {
      name: '', code: '', defaultPrinter: '', paperSize: 'thermal80',
      receiptCopies: 1, autoOpenDrawer: true, receiptWidth: 42,
      kitchenTicketEnabled: false, kitchenTicketCopies: 1, kitchenPrinterName: '',
      showTaxOnReceipt: null, receiptShowBranchName: null, receiptShowPartyName: null,
      receiptShowTotals: null, isDefault: false,
    });
  }

  function setPrintField(key: string, value: any) {
    setPrintForm((f: any) => ({ ...f, [key]: value }));
  }

  /** '' → null (follow global), '1' → true, '0' → false */
  function triState(value: any): boolean | null {
    if (value === '' || value === null || value === undefined) return null;
    return value === '1' || value === true;
  }

  async function savePrintProfile() {
    if (!printForm) return;
    setPrintBusy(true);
    setError('');
    try {
      const body = {
        ...printForm,
        showTaxOnReceipt: triState(printForm.showTaxOnReceipt),
        receiptShowBranchName: triState(printForm.receiptShowBranchName),
        receiptShowPartyName: triState(printForm.receiptShowPartyName),
        receiptShowTotals: triState(printForm.receiptShowTotals),
      };
      if (printEditingId) {
        await apiFetch(`/settings/print-profiles/${printEditingId}`, { method: 'PUT', body });
      } else {
        await apiFetch('/settings/print-profiles', { method: 'POST', body });
      }
      setPrintForm(null);
      setPrintEditingId(null);
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حفظ ملف الطباعة');
    } finally {
      setPrintBusy(false);
    }
  }

  async function removePrintProfile(id: number) {
    setError('');
    try {
      await apiFetch(`/settings/print-profiles/${id}`, { method: 'DELETE' });
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حذف ملف الطباعة');
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-500 leading-6">
        ملف الطباعة = إعداد محطة (كاشير/مطبخ): الطابعة، المقاس، عدد النسخ، تذكرة المطبخ وإظهار/إخفاء أقسام الإيصال.
        في نقطة البيع يختار كل جهاز ملفه ويُحفظ على الجهاز؛ بدونه تُستخدم «افتراضي الفرع» ثم إعدادات النظام العامة.
      </div>
      {error && <div className="rounded-xl bg-rose-50 text-rose-700 text-sm px-4 py-3 border border-rose-200">{error}</div>}

      {printForm ? (
        <div className="card p-4 space-y-4">
          <div className="card-title">
            <span>{printEditingId ? `تعديل ملف الطباعة: ${printForm.name}` : 'ملف طباعة جديد'}</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="label">اسم الملف *</label>
              <input className="input" value={printForm.name} placeholder="مثال: كاشير الصالة 1"
                onChange={(e) => setPrintField('name', e.target.value)} />
            </div>
            <div>
              <label className="label">كود المحطة (اختياري)</label>
              <input className="input" dir="ltr" value={printForm.code ?? ''} placeholder="POS-01"
                onChange={(e) => setPrintField('code', e.target.value)} />
            </div>
            <div>
              <label className="label">طابعة الإيصال (اسم Windows)</label>
              <input className="input" dir="ltr" value={printForm.defaultPrinter ?? ''}
                placeholder="اتركه فارغًا = طابعة الوكيل الافتراضية"
                onChange={(e) => setPrintField('defaultPrinter', e.target.value)} />
            </div>
            <div>
              <label className="label">مقاس الورق</label>
              <select className="input" value={printForm.paperSize}
                onChange={(e) => setPrintField('paperSize', e.target.value)}>
                {Object.entries(PAPER_SIZE_LABEL).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">عدد نسخ الإيصال</label>
              <input className="input" type="number" min={1} max={5} dir="ltr" value={printForm.receiptCopies}
                onChange={(e) => setPrintField('receiptCopies', Number(e.target.value))} />
            </div>
            <div>
              <label className="label">عرض الورق (أحرف 20–48)</label>
              <input className="input" type="number" min={20} max={48} dir="ltr" value={printForm.receiptWidth}
                onChange={(e) => setPrintField('receiptWidth', Number(e.target.value))} />
            </div>
            <div>
              <label className="label">تذكرة المطبخ</label>
              <select className="input" value={printForm.kitchenTicketEnabled ? '1' : '0'}
                onChange={(e) => setPrintField('kitchenTicketEnabled', e.target.value === '1')}>
                <option value="0">معطلة</option>
                <option value="1">مفعلة عند «إرسال للمطبخ»</option>
              </select>
            </div>
            <div>
              <label className="label">نسخ تذكرة المطبخ</label>
              <input className="input" type="number" min={1} max={3} dir="ltr" value={printForm.kitchenTicketCopies}
                onChange={(e) => setPrintField('kitchenTicketCopies', Number(e.target.value))} />
            </div>
            <div>
              <label className="label">طابعة المطبخ (اسم Windows)</label>
              <input className="input" dir="ltr" value={printForm.kitchenPrinterName ?? ''}
                placeholder="فارغ = طابعة الوكيل الافتراضية"
                onChange={(e) => setPrintField('kitchenPrinterName', e.target.value)} />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {([['showTaxOnReceipt', 'سطر الضريبة'], ['receiptShowBranchName', 'اسم الفرع'],
               ['receiptShowPartyName', 'اسم العميل'], ['receiptShowTotals', 'الإجماليات']] as const).map(([key, label]) => (
              <div key={key}>
                <label className="label">{label}</label>
                <select className="input" value={printForm[key] === null || printForm[key] === undefined ? '' : (printForm[key] ? '1' : '0')}
                  onChange={(e) => setPrintField(key, e.target.value)}>
                  <option value="">افتراضي النظام</option>
                  <option value="1">إظهار</option>
                  <option value="0">إخفاء</option>
                </select>
              </div>
            ))}
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                <input type="checkbox" checked={!!printForm.isDefault}
                  onChange={(e) => setPrintField('isDefault', e.target.checked)} />
                افتراضي الفرع
              </label>
            </div>
          </div>
          <div className="text-[11px] text-slate-500">
            «افتراضي النظام» يعني أن الملف لا يتدخل في هذا البند ويُستخدم الإعداد العام من التبويب المختص في «الإعدادات».
          </div>

          <div className="flex gap-2">
            <button className="btn-primary" onClick={savePrintProfile} disabled={printBusy || !String(printForm.name).trim()}>
              {printBusy ? 'جارٍ الحفظ…' : 'حفظ الملف'}
            </button>
            <button className="btn-soft" onClick={() => { setPrintForm(null); setPrintEditingId(null); }}>إلغاء</button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-title">
            <span>ملفات الطباعة ({printProfiles.length})</span>
            <button className="btn-primary text-xs" onClick={() => openPrintEditor(null)}>+ ملف جديد</button>
          </div>
          {printProfiles.length === 0 ? (
            <div className="text-sm text-slate-500 p-3">لا توجد ملفات طباعة بعد — كل المحطات تستخدم إعدادات النظام العامة.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>الاسم</th><th>الكود</th><th>الطابعة</th><th>المقاس</th><th>نسخ</th>
                    <th>مطبخ</th><th>افتراضي</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {printProfiles.map((p) => (
                    <tr key={p.profileId}>
                      <td className="font-bold">{p.name}</td>
                      <td dir="ltr">{p.code ?? '—'}</td>
                      <td dir="ltr">{p.defaultPrinter || '—'}</td>
                      <td>{PAPER_SIZE_LABEL[p.paperSize] ?? p.paperSize}</td>
                      <td dir="ltr">{p.receiptCopies}</td>
                      <td>{p.kitchenTicketEnabled ? `✓ (${p.kitchenTicketCopies})` : '—'}</td>
                      <td>{p.isDefault ? '⭐' : ''}</td>
                      <td className="flex gap-1">
                        <button className="btn-soft text-xs" onClick={() => openPrintEditor(p)}>تعديل</button>
                        <DeleteButton screenKey="printProfiles" className="btn-soft text-xs text-rose-600" confirmText="حذف ملف الطباعة؟" onDelete={() => removePrintProfile(p.profileId)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
