'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function InstallmentsPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [due, setDue] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [parties, setParties] = useState<any[]>([]);
  const [cashAccounts, setCashAccounts] = useState<any[]>([]);
  const [form, setForm] = useState({
    partyId: 0, title: '', totalAmount: 0, downPayment: 0, installmentCount: 3, frequency: 1, startDate: '',
    guarantorName: '', guarantorPhone: '', guarantorIdNumber: '',
  });
  const [message, setMessage] = useState('');

  async function load() {
    setPlans(await apiFetch('/installments/plans'));
    setDue(await apiFetch('/installments/due?days=14'));
    apiFetch('/parties?type=0&pageSize=100').then((data: any) => setParties(data.items ?? [])).catch(() => {});
    apiFetch('/treasury/accounts').then(setCashAccounts).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  async function open(id: number) {
    setDetail(await apiFetch(`/installments/plans/${id}`));
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      await apiFetch('/installments/plans', { method: 'POST', body: { ...form, partyId: Number(form.partyId) } });
      setMessage('تم إنشاء خطة التقسيط');
      setForm({ ...form, title: '', totalAmount: 0, downPayment: 0, guarantorName: '', guarantorPhone: '', guarantorIdNumber: '' });
      load();
    } catch (error: any) {
      setMessage(error?.message ?? 'تعذر إنشاء الخطة');
    }
  }

  async function pay(scheduleId: number, cashAccountId: number) {
    setMessage('');
    try {
      const amount = Number(prompt('المبلغ المدفوع', '0') ?? '0');
      if (!(amount > 0)) return;
      await apiFetch(`/installments/schedule/${scheduleId}/pay`, {
        method: 'POST',
        body: { amount, cashAccountId: cashAccountId || undefined },
      });
      setMessage('تم تسجيل السداد');
      if (detail) open(detail.plan.planId);
      load();
    } catch (error: any) {
      setMessage(error?.message ?? 'تعذر تسجيل السداد');
    }
  }

  return (
    <AppShell title="التقسيط">
      <div className="space-y-4">
        {message && (
          <div className="rounded-xl bg-brand-50 text-brand-800 text-sm px-4 py-3 border border-brand-200">{message}</div>
        )}

        {due.length > 0 && (
          <div className="card">
            <div className="card-title"><span>أقساط مستحقة خلال 14 يوم ({due.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>العميل</th><th>الخطة</th><th>رقم القسط</th><th>تاريخ الاستحقاق</th><th>المتبقي</th></tr></thead>
                <tbody>
                  {due.map((row) => (
                    <tr key={row.scheduleId}>
                      <td className="font-semibold">{row.partyName}<div className="text-[10px] text-slate-400">{row.phone}</div></td>
                      <td className="font-mono text-xs">{row.planNo}</td>
                      <td>{row.installmentNo}</td>
                      <td>{formatDate(row.dueDate)}</td>
                      <td className="font-bold text-rose-600">{formatMoney(row.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-title"><span>خطط التقسيط ({plans.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>الرقم</th><th>العميل</th><th>الإجمالي</th><th>المقدمة</th><th>الأقساط</th><th>المسدد</th><th>المتبقي</th><th /></tr>
                </thead>
                <tbody>
                  {plans.map((row) => (
                    <tr key={row.planId}>
                      <td className="font-mono text-xs">{row.planNo}</td>
                      <td className="font-semibold">{row.partyName}</td>
                      <td>{formatMoney(row.totalAmount)}</td>
                      <td>{formatMoney(row.downPayment)}</td>
                      <td>{row.installmentCount}</td>
                      <td className="text-emerald-700">{formatMoney(row.paidAmount)}</td>
                      <td className="font-bold text-rose-600">{formatMoney(Number(row.scheduledAmount) - Number(row.paidAmount))}</td>
                      <td><button className="text-brand-600 text-xs font-semibold" onClick={() => open(row.planId)}>عرض</button></td>
                    </tr>
                  ))}
                  {plans.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">لا توجد خطط تقسيط</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <form className="card p-5 space-y-3 h-fit" onSubmit={create}>
            <div className="font-bold">خطة تقسيط جديدة</div>
            <div>
              <label className="label">العميل</label>
              <select className="input" value={form.partyId} onChange={(e) => setForm({ ...form, partyId: Number(e.target.value) })} required>
                <option value={0}>— اختر —</option>
                {parties.map((party) => <option key={party.partyId} value={party.partyId}>{party.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">البيان</label>
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="تقسيط فاتورة" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">إجمالي المبلغ</label>
                <input className="input" type="number" value={form.totalAmount}
                  onChange={(e) => setForm({ ...form, totalAmount: Number(e.target.value) })} required />
              </div>
              <div>
                <label className="label">دفعة مقدمة</label>
                <input className="input" type="number" value={form.downPayment}
                  onChange={(e) => setForm({ ...form, downPayment: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">عدد الأقساط</label>
                <input className="input" type="number" min="1" value={form.installmentCount}
                  onChange={(e) => setForm({ ...form, installmentCount: Number(e.target.value) })} required />
              </div>
              <div>
                <label className="label">البداية</label>
                <input className="input" type="date" value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
              </div>
            </div>
            <div className="border-t pt-3">
              <div className="font-semibold text-sm mb-2">بيانات الضامن (اختياري)</div>
              <div className="grid grid-cols-1 gap-2">
                <input className="input" placeholder="اسم الضامن" value={form.guarantorName}
                  onChange={(e) => setForm({ ...form, guarantorName: e.target.value })} />
                <input className="input" placeholder="هاتف الضامن" dir="ltr" value={form.guarantorPhone}
                  onChange={(e) => setForm({ ...form, guarantorPhone: e.target.value })} />
                <input className="input" placeholder="الرقم القومي/الهوية" dir="ltr" value={form.guarantorIdNumber}
                  onChange={(e) => setForm({ ...form, guarantorIdNumber: e.target.value })} />
              </div>
            </div>
            <button className="btn-primary w-full">إنشاء الخطة</button>
          </form>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="card w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-extrabold">{detail.plan.planNo} — {detail.plan.partyName}</div>
                <div className="text-xs text-slate-500">
                  إجمالي {formatMoney(detail.plan.totalAmount)} · مقدمة {formatMoney(detail.plan.downPayment)}
                </div>
                {(detail.plan.guarantorName || detail.plan.guarantorPhone || detail.plan.guarantorIdNumber) && (
                  <div className="text-xs text-slate-600 mt-1">
                    الضامن: {detail.plan.guarantorName || '—'} {detail.plan.guarantorPhone ? `· ${detail.plan.guarantorPhone}` : ''} {detail.plan.guarantorIdNumber ? `· ${detail.plan.guarantorIdNumber}` : ''}
                  </div>
                )}
              </div>
              <button className="btn-soft" onClick={() => setDetail(null)}>إغلاق</button>
            </div>

            <table className="table">
              <thead><tr><th>#</th><th>الاستحقاق</th><th>المبلغ</th><th>المسدد</th><th>الحالة</th><th /></tr></thead>
              <tbody>
                {detail.schedule.map((row: any) => (
                  <tr key={row.scheduleId}>
                    <td>{row.installmentNo}</td>
                    <td>{formatDate(row.dueDate)}</td>
                    <td>{formatMoney(row.amount)}</td>
                    <td className="text-emerald-700">{formatMoney(row.paidAmount)}</td>
                    <td>
                      <span className={`badge ${row.status === 2 ? 'bg-emerald-50 text-emerald-700' : row.status === 3 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                        {row.status === 2 ? 'مسدد' : row.status === 3 ? 'جزئي' : 'مستحق'}
                      </span>
                    </td>
                    <td>
                      {row.status !== 2 && (
                        <select
                          className="input w-32 py-1 text-xs"
                          value=""
                          onChange={(e) => e.target.value && pay(row.scheduleId, Number(e.target.value))}
                        >
                          <option value="">سداد →</option>
                          {cashAccounts.map((account) => (
                            <option key={account.cashAccountId} value={account.cashAccountId}>{account.name}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
