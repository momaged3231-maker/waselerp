'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';

export default function HrPage() {
  const [tab, setTab] = useState<'employees' | 'attendance' | 'salaries'>('employees');
  const [employees, setEmployees] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [salaries, setSalaries] = useState<any[]>([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [search, setSearch] = useState('');

  async function load() {
    if (tab === 'employees') setEmployees(await apiFetch(`/hr/employees?search=${encodeURIComponent(search)}`));
    if (tab === 'attendance') setAttendance(await apiFetch('/hr/attendance'));
    if (tab === 'salaries') setSalaries(await apiFetch(`/hr/salaries?month=${month}`));
  }

  useEffect(() => { load(); }, [tab, search, month]);

  async function addEmployee(event: React.FormEvent) {
    event.preventDefault();
    const form = new FormData(event.target as any);
    await apiFetch('/hr/employees', {
      method: 'POST',
      body: {
        name: form.get('name'), code: form.get('code') || null, jobTitle: form.get('jobTitle') || null,
        phone: form.get('phone') || null, mobile: form.get('mobile') || null,
        basicSalary: Number(form.get('basicSalary') ?? 0), allowances: Number(form.get('allowances') ?? 0),
      },
    });
    (event.target as HTMLFormElement).reset();
    load();
  }

  return (
    <AppShell title="شئون العاملين">
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {([['employees', 'الموظفون'], ['attendance', 'الحضور والانصراف'], ['salaries', 'المرتبات']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={tab === key ? 'btn-primary' : 'btn-soft'}>{label}</button>
        ))}
        <div className="flex-1" />
        {tab === 'employees' && (
          <input className="input w-48 py-1.5" placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        {tab === 'salaries' && (
          <input className="input w-40 py-1.5" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        )}
      </div>

      {tab === 'employees' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-title"><span>الموظفون ({employees.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الكود</th><th>الاسم</th><th>الوظيفة</th><th>القسم</th><th>الفرع</th><th>الأساسي</th><th>حضور اليوم</th></tr></thead>
                <tbody>
                  {employees.map((row) => (
                    <tr key={row.employeeId}>
                      <td className="font-mono text-xs">{row.code ?? '—'}</td>
                      <td className="font-semibold">{row.name}</td>
                      <td>{row.jobTitle ?? '—'}</td>
                      <td className="text-slate-500">{row.departmentName ?? '—'}</td>
                      <td className="text-slate-500">{row.branchName}</td>
                      <td>{formatMoney(row.basicSalary)}</td>
                      <td>
                        {row.todayAttendance ? <span className="badge bg-emerald-50 text-emerald-700">حضر</span>
                          : <span className="badge bg-slate-100 text-slate-500">لم يسجل</span>}
                      </td>
                    </tr>
                  ))}
                  {employees.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا يوجد موظفون</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <form className="card p-5 space-y-3 h-fit" onSubmit={addEmployee}>
            <div className="font-bold">موظف جديد</div>
            <div><label className="label">الاسم</label><input name="name" className="input" required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">الكود</label><input name="code" className="input" dir="ltr" /></div>
              <div><label className="label">الوظيفة</label><input name="jobTitle" className="input" /></div>
              <div><label className="label">الموبايل</label><input name="mobile" className="input" dir="ltr" /></div>
              <div><label className="label">الأساسي</label><input name="basicSalary" type="number" className="input" /></div>
            </div>
            <button className="btn-primary w-full">إضافة</button>
          </form>
        </div>
      )}

      {tab === 'attendance' && (
        <div className="card">
          <div className="card-title"><span>سجل الحضور</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>التاريخ</th><th>الموظف</th><th>الحضور</th><th>الانصراف</th><th>الإضافي</th><th>التأخير</th><th>الحالة</th></tr></thead>
              <tbody>
                {attendance.map((row) => (
                  <tr key={row.attendanceId}>
                    <td>{formatDate(row.workDate)}</td>
                    <td className="font-semibold">{row.employeeName}</td>
                    <td>{row.checkIn ? new Date(row.checkIn).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td>{row.checkOut ? new Date(row.checkOut).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td>{row.overtimeMinutes} د</td>
                    <td>{row.lateMinutes} د</td>
                    <td>
                      <span className={`badge ${row.status === 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                        {row.status === 1 ? 'حاضر' : row.status === 2 ? 'غائب' : row.status === 3 ? 'إجازة' : 'عطلة'}
                      </span>
                    </td>
                  </tr>
                ))}
                {attendance.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد سجلات</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'salaries' && (
        <div className="card">
          <div className="card-title"><span>كشف المرتبات — {month}</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الموظف</th><th>الوظيفة</th><th>الأساسي</th><th>بدلات</th><th>إضافي</th><th>خصومات</th><th>الصافي</th><th>الحالة</th></tr></thead>
              <tbody>
                {salaries.map((row) => {
                  const hourly = Number(row.basicSalary) / 240;
                  const overtimeAmount = (Number(row.overtimeMinutes ?? 0) / 60) * hourly;
                  const net = Number(row.basicSalary) + Number(row.allowances) + overtimeAmount - Number(row.deductions);
                  return (
                    <tr key={row.employeeId}>
                      <td className="font-semibold">{row.name}</td>
                      <td className="text-slate-500">{row.jobTitle ?? '—'}</td>
                      <td>{formatMoney(row.basicSalary)}</td>
                      <td>{formatMoney(row.allowances)}</td>
                      <td>{formatMoney(overtimeAmount)}</td>
                      <td className="text-rose-600">{formatMoney(row.deductions)}</td>
                      <td className="font-bold">{formatMoney(row.netPay ?? net)}</td>
                      <td>
                        <span className={`badge ${row.status === 2 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          {row.status === 2 ? 'مدفوع' : 'مسودة'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {salaries.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">لا يوجد موظفون</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
