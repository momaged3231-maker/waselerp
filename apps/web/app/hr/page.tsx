'use client';

import { useEffect, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

type Tab = 'employees' | 'departments' | 'components' | 'attendance' | 'leaves' | 'advances' | 'payroll';

const TABS: [Tab, string][] = [
  ['employees', 'الموظفون'],
  ['departments', 'الإدارات'],
  ['components', 'مكونات المرتب'],
  ['attendance', 'الحضور والانصراف'],
  ['leaves', 'الإجازات'],
  ['advances', 'السلف'],
  ['payroll', 'المرتبات'],
];

const emptyEmployee = {
  employeeId: undefined as number | undefined,
  code: '', name: '', departmentId: '' as any, jobTitle: '', nationalId: '',
  phone: '', mobile: '', address: '', hireDate: '', basicSalary: 0,
  allowances: 0, deductions: 0, isActive: true, notes: '',
};

const emptyAdvance = { employeeId: '', amount: 0, monthlyDeduction: 0, advanceDate: '', notes: '' };
const emptyLeave = { employeeId: '', leaveType: 1, startDate: '', endDate: '', notes: '' };
const emptyComponent = { componentId: undefined as number | undefined, name: '', componentType: 1, calcType: 1, amount: 0, isActive: true };

function monthBounds(month: string): { from: string; to: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return { from: '', to: '' };
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export default function HrPage() {
  const { can } = useSession();
  const manage = can('hr.manage');

  const [tab, setTab] = useState<Tab>('employees');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [employees, setEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [cashAccounts, setCashAccounts] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [advances, setAdvances] = useState<any[]>([]);
  const [salaries, setSalaries] = useState<any[]>([]);
  const [payrollSummary, setPayrollSummary] = useState<any>(null);

  const [employeeForm, setEmployeeForm] = useState<any>(emptyEmployee);
  const [departmentName, setDepartmentName] = useState('');
  const [componentForm, setComponentForm] = useState<any>(emptyComponent);
  const [advanceForm, setAdvanceForm] = useState<any>(emptyAdvance);
  const [leaveForm, setLeaveForm] = useState<any>(emptyLeave);
  const [attendanceForm, setAttendanceForm] = useState({ employeeId: '', workDate: new Date().toISOString().slice(0, 10), status: 1 });

  const [cashAccountId, setCashAccountId] = useState<number | ''>('');
  const [selectedSalaries, setSelectedSalaries] = useState<number[]>([]);
  const [payslip, setPayslip] = useState<any>(null);
  const [employeeComponents, setEmployeeComponents] = useState<{ employeeId: number; employeeName: string; rows: any[] } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const { from, to } = monthBounds(month);

  function flash(text: string) {
    setMessage(text);
    setError('');
    window.setTimeout(() => setMessage(''), 4000);
  }
  function fail(err: any) {
    setError(err?.message ?? 'حدث خطأ غير متوقع');
  }

  async function loadReference() {
    const [dep, comp, accounts] = await Promise.all([
      apiFetch<any[]>('/hr/departments').catch(() => []),
      apiFetch<any[]>('/hr/components').catch(() => []),
      apiFetch<any[]>('/treasury/accounts').catch(() => []),
    ]);
    setDepartments(dep ?? []);
    setComponents(comp ?? []);
    setCashAccounts(accounts ?? []);
  }

  async function loadEmployees(term = search) {
    setEmployees((await apiFetch<any[]>(`/hr/employees?search=${encodeURIComponent(term)}`)) ?? []);
  }
  async function loadDepartments() {
    setDepartments((await apiFetch<any[]>('/hr/departments')) ?? []);
  }
  async function loadComponents() {
    setComponents((await apiFetch<any[]>('/hr/components')) ?? []);
  }
  async function loadAttendance() {
    const query = new URLSearchParams({ from, to });
    const [rows, summary] = await Promise.all([
      apiFetch<any[]>(`/hr/attendance?${query.toString()}`),
      apiFetch<any[]>(`/hr/reports/attendance-summary?${query.toString()}`).catch(() => []),
    ]);
    setAttendance(rows ?? []);
    setAttendanceSummary(summary ?? []);
  }
  async function loadLeaves() {
    setLeaves((await apiFetch<any[]>('/hr/leaves')) ?? []);
  }
  async function loadAdvances() {
    setAdvances((await apiFetch<any[]>('/hr/advances')) ?? []);
  }
  async function loadSalaries() {
    const [rows, summary] = await Promise.all([
      apiFetch<any[]>(`/hr/salaries?month=${month}`),
      apiFetch<any>(`/hr/reports/payroll-summary?month=${month}`).catch(() => null),
    ]);
    setSalaries(rows ?? []);
    setPayrollSummary(summary);
    setSelectedSalaries([]);
  }

  useEffect(() => {
    loadReference();
  }, []);

  useEffect(() => {
    setError('');
    (async () => {
      try {
        if (tab === 'employees') await loadEmployees();
        if (['attendance', 'leaves', 'advances'].includes(tab) && !employees.length) await loadEmployees('');
        if (tab === 'departments') await loadDepartments();
        if (tab === 'components') await loadComponents();
        if (tab === 'attendance') await loadAttendance();
        if (tab === 'leaves') await loadLeaves();
        if (tab === 'advances') await loadAdvances();
        if (tab === 'payroll') {
          if (!employees.length) await loadEmployees('');
          await loadSalaries();
        }
      } catch (err) {
        fail(err);
      }
    })();
  }, [tab, month]);

  // ---------------------------------------------------------------- employees
  async function saveEmployee(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        ...employeeForm,
        departmentId: employeeForm.departmentId ? Number(employeeForm.departmentId) : null,
        basicSalary: Number(employeeForm.basicSalary ?? 0),
        allowances: Number(employeeForm.allowances ?? 0),
        deductions: Number(employeeForm.deductions ?? 0),
        hireDate: employeeForm.hireDate || null,
      };
      if (employeeForm.employeeId) {
        await apiFetch(`/hr/employees/${employeeForm.employeeId}`, { method: 'PUT', body });
        flash('تم تحديث بيانات الموظف');
      } else {
        await apiFetch('/hr/employees', { method: 'POST', body });
        flash('تم إضافة الموظف');
      }
      setEmployeeForm(emptyEmployee);
      await loadEmployees();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function editEmployee(row: any) {
    setEmployeeForm({
      employeeId: row.employeeId, code: row.code ?? '', name: row.name, departmentId: row.departmentId ?? '',
      jobTitle: row.jobTitle ?? '', nationalId: row.nationalId ?? '', phone: row.phone ?? '',
      mobile: row.mobile ?? '', address: row.address ?? '', hireDate: row.hireDate ? String(row.hireDate).slice(0, 10) : '',
      basicSalary: Number(row.basicSalary ?? 0), allowances: Number(row.allowances ?? 0),
      deductions: Number(row.deductions ?? 0), isActive: row.isActive !== false, notes: row.notes ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function openEmployeeComponents(row: any) {
    try {
      const rows = await apiFetch<any[]>(`/hr/employees/${row.employeeId}/components`);
      setEmployeeComponents({
        employeeId: row.employeeId,
        employeeName: row.name,
        rows: (rows ?? []).map((component) => ({
          ...component,
          assigned: !!component.assigned,
          amountOverride: component.amountOverride === null || component.amountOverride === undefined ? '' : Number(component.amountOverride),
        })),
      });
    } catch (err) {
      fail(err);
    }
  }

  async function saveEmployeeComponents() {
    if (!employeeComponents) return;
    setBusy(true);
    try {
      await apiFetch(`/hr/employees/${employeeComponents.employeeId}/components`, {
        method: 'PUT',
        body: {
          components: employeeComponents.rows
            .filter((row) => row.assigned)
            .map((row) => ({
              componentId: row.componentId,
              amountOverride: row.amountOverride === '' ? null : Number(row.amountOverride),
              assigned: true,
            })),
        },
      });
      flash('تم حفظ مكونات المرتب للموظف');
      setEmployeeComponents(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- departments
  async function addDepartment(event: React.FormEvent) {
    event.preventDefault();
    if (!departmentName.trim()) return;
    try {
      await apiFetch('/hr/departments', { method: 'POST', body: { name: departmentName.trim() } });
      setDepartmentName('');
      flash('تم إضافة الإدارة');
      await loadDepartments();
    } catch (err) {
      fail(err);
    }
  }
  async function removeDepartment(row: any) {
    if (!window.confirm(`حذف إدارة ${row.name}؟`)) return;
    try {
      await apiFetch(`/hr/departments/${row.departmentId}`, { method: 'DELETE' });
      await loadDepartments();
    } catch (err) {
      fail(err);
    }
  }

  // ---------------------------------------------------------------- components
  async function saveComponent(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: componentForm.name,
        componentType: Number(componentForm.componentType),
        calcType: Number(componentForm.calcType),
        amount: Number(componentForm.amount ?? 0),
        isActive: componentForm.isActive,
      };
      if (componentForm.componentId) {
        await apiFetch(`/hr/components/${componentForm.componentId}`, { method: 'PUT', body });
      } else {
        await apiFetch('/hr/components', { method: 'POST', body });
      }
      setComponentForm(emptyComponent);
      flash('تم حفظ المكوّن');
      await loadComponents();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  async function removeComponent(row: any) {
    if (!window.confirm(`حذف المكوّن ${row.name}؟`)) return;
    try {
      await apiFetch(`/hr/components/${row.componentId}`, { method: 'DELETE' });
      await loadComponents();
    } catch (err) {
      fail(err);
    }
  }

  // ---------------------------------------------------------------- attendance
  async function saveAttendance(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiFetch('/hr/attendance', {
        method: 'POST',
        body: { ...attendanceForm, employeeId: Number(attendanceForm.employeeId), status: Number(attendanceForm.status) },
      });
      flash('تم تسجيل الحضور');
      await loadAttendance();
    } catch (err) {
      fail(err);
    }
  }
  async function importAttendance(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const csv = await file.text();
      const result = await apiFetch<any>('/hr/attendance/import', { method: 'POST', body: { csv } });
      flash(`تم استيراد ${result.imported} سجل — تم تجاهل ${result.skipped}`);
      if (Array.isArray(result.errors) && result.errors.length) setError(result.errors.slice(0, 5).join(' • '));
      await loadAttendance();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  // ---------------------------------------------------------------- leaves
  async function saveLeave(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiFetch('/hr/leaves', {
        method: 'POST',
        body: { ...leaveForm, employeeId: Number(leaveForm.employeeId), leaveType: Number(leaveForm.leaveType) },
      });
      setLeaveForm(emptyLeave);
      flash('تم تسجيل طلب الإجازة');
      await loadLeaves();
    } catch (err) {
      fail(err);
    }
  }
  async function setLeaveStatus(row: any, status: number) {
    try {
      await apiFetch(`/hr/leaves/${row.leaveId}/status`, { method: 'PUT', body: { status } });
      await loadLeaves();
    } catch (err) {
      fail(err);
    }
  }

  // ---------------------------------------------------------------- advances
  async function saveAdvance(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiFetch('/hr/advances', {
        method: 'POST',
        body: {
          ...advanceForm,
          employeeId: Number(advanceForm.employeeId),
          amount: Number(advanceForm.amount ?? 0),
          monthlyDeduction: Number(advanceForm.monthlyDeduction ?? 0),
          advanceDate: advanceForm.advanceDate || null,
        },
      });
      setAdvanceForm(emptyAdvance);
      flash('تم تسجيل السلفة');
      await loadAdvances();
    } catch (err) {
      fail(err);
    }
  }
  async function payAdvance(row: any) {
    if (!cashAccountId) {
      setError('اختر صندوق الصرف أولًا');
      return;
    }
    try {
      await apiFetch(`/hr/advances/${row.advanceId}/pay`, { method: 'POST', body: { cashAccountId: Number(cashAccountId) } });
      flash('تم صرف السلفة وترحيل القيد');
      await loadAdvances();
    } catch (err) {
      fail(err);
    }
  }
  async function cancelAdvance(row: any) {
    if (!window.confirm('إلغاء السلفة؟')) return;
    try {
      await apiFetch(`/hr/advances/${row.advanceId}`, { method: 'DELETE' });
      await loadAdvances();
    } catch (err) {
      fail(err);
    }
  }

  // ---------------------------------------------------------------- payroll
  async function generatePayroll() {
    if (!window.confirm(`توليد مرتبات شهر ${month}؟`)) return;
    setBusy(true);
    try {
      const result = await apiFetch<any>('/hr/payroll/generate', { method: 'POST', body: { periodMonth: month } });
      flash(`تم توليد ${result.generated} مرتب — تم تخطي ${result.skipped} — صافي ${formatMoney(result.totalNet)}`);
      await loadSalaries();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  async function paySalaries(ids?: number[]) {
    if (!cashAccountId) {
      setError('اختر صندوق صرف المرتبات أولًا');
      return;
    }
    const target = ids ?? selectedSalaries;
    if (!target.length) {
      setError('اختر مرتبًا واحدًا على الأقل');
      return;
    }
    if (!window.confirm(`صرف ${target.length} مرتب من الخزينة؟`)) return;
    setBusy(true);
    try {
      const result = await apiFetch<any>('/hr/payroll/pay', {
        method: 'POST',
        body: { cashAccountId: Number(cashAccountId), salaryPayIds: target },
      });
      flash(`تم صرف ${result.paid} مرتب بإجمالي ${formatMoney(result.total)}`);
      await loadSalaries();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  async function openPayslip(row: any) {
    try {
      setPayslip(await apiFetch<any>(`/hr/salaries/${row.salaryPayId}/payslip`));
    } catch (err) {
      fail(err);
    }
  }

  function toggleSalary(salaryPayId: number) {
    setSelectedSalaries((current) =>
      current.includes(salaryPayId) ? current.filter((id) => id !== salaryPayId) : [...current, salaryPayId],
    );
  }

  const draftSalaries = salaries.filter((row) => Number(row.status) === 1);

  return (
    <AppShell title="الموارد البشرية">
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={tab === key ? 'btn-primary' : 'btn-soft'}>{label}</button>
        ))}
        <div className="flex-1" />
        <label className="text-xs text-slate-500">الشهر</label>
        <input className="input w-40 py-1.5" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        {tab === 'employees' && (
          <div className="flex gap-2">
            <input
              className="input w-48 py-1.5"
              placeholder="بحث بالاسم أو الكود"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadEmployees()}
            />
            <button className="btn-soft" onClick={() => loadEmployees()}>بحث</button>
          </div>
        )}      </div>

      {message && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}
      {error && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      {/* ------------------------------------------------------------ employees */}
      {tab === 'employees' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-title"><span>الموظفون ({employees.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>الكود</th><th>الاسم</th><th>الإدارة</th><th>الوظيفة</th><th>الأساسي</th>
                    <th>السلف</th><th>حضور اليوم</th>{manage && <th>إجراءات</th>}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((row) => (
                    <tr key={row.employeeId}>
                      <td className="font-mono text-xs">{row.code ?? '—'}</td>
                      <td className="font-semibold">
                        {row.name}
                        <div className="text-[10px] text-slate-400" dir="ltr">{row.mobile ?? row.phone ?? ''}</div>
                      </td>
                      <td className="text-xs">{row.departmentName ?? '—'}</td>
                      <td className="text-xs">{row.jobTitle ?? '—'}</td>
                      <td>{formatMoney(row.basicSalary)}</td>
                      <td className={Number(row.advanceBalance) > 0 ? 'text-rose-600 font-semibold' : ''}>
                        {formatMoney(row.advanceBalance)}
                      </td>
                      <td>
                        <span className={`badge ${row.todayAttendance ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {row.todayAttendance ? 'حاضر' : '—'}
                        </span>
                      </td>
                      {manage && (
                        <td className="whitespace-nowrap">
                          <button className="text-brand-600 text-xs font-semibold" onClick={() => editEmployee(row)}>تعديل</button>
                          <button className="text-slate-500 text-xs font-semibold mr-3" onClick={() => openEmployeeComponents(row)}>المكونات</button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {employees.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">لا يوجد موظفون</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {manage && (
            <form className="card p-5 space-y-3 h-fit" onSubmit={saveEmployee}>
              <div className="font-bold">{employeeForm.employeeId ? 'تعديل موظف' : 'موظف جديد'}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">الاسم</label>
                  <input className="input" value={employeeForm.name} onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })} required />
                </div>
                <div>
                  <label className="label">الكود</label>
                  <input className="input" dir="ltr" value={employeeForm.code} onChange={(e) => setEmployeeForm({ ...employeeForm, code: e.target.value })} />
                </div>
                <div>
                  <label className="label">الإدارة</label>
                  <select className="input" value={employeeForm.departmentId} onChange={(e) => setEmployeeForm({ ...employeeForm, departmentId: e.target.value })}>
                    <option value="">— بدون —</option>
                    {departments.map((row) => <option key={row.departmentId} value={row.departmentId}>{row.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">الوظيفة</label>
                  <input className="input" value={employeeForm.jobTitle} onChange={(e) => setEmployeeForm({ ...employeeForm, jobTitle: e.target.value })} />
                </div>
                <div>
                  <label className="label">الموبايل</label>
                  <input className="input" dir="ltr" value={employeeForm.mobile} onChange={(e) => setEmployeeForm({ ...employeeForm, mobile: e.target.value })} />
                </div>
                <div>
                  <label className="label">تاريخ التعيين</label>
                  <input className="input" type="date" value={employeeForm.hireDate} onChange={(e) => setEmployeeForm({ ...employeeForm, hireDate: e.target.value })} />
                </div>
                <div>
                  <label className="label">الراتب الأساسي</label>
                  <input className="input" type="number" step="0.01" value={employeeForm.basicSalary} onChange={(e) => setEmployeeForm({ ...employeeForm, basicSalary: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="label">بدلات ثابتة</label>
                  <input className="input" type="number" step="0.01" value={employeeForm.allowances} onChange={(e) => setEmployeeForm({ ...employeeForm, allowances: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="label">خصومات ثابتة</label>
                  <input className="input" type="number" step="0.01" value={employeeForm.deductions} onChange={(e) => setEmployeeForm({ ...employeeForm, deductions: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="label">الرقم القومي</label>
                  <input className="input" dir="ltr" value={employeeForm.nationalId} onChange={(e) => setEmployeeForm({ ...employeeForm, nationalId: e.target.value })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={employeeForm.isActive} onChange={(e) => setEmployeeForm({ ...employeeForm, isActive: e.target.checked })} />
                نشط
              </label>
              <div className="flex gap-2">
                <button className="btn-primary flex-1" disabled={busy}>حفظ</button>
                {employeeForm.employeeId && <button type="button" className="btn-soft" onClick={() => setEmployeeForm(emptyEmployee)}>جديد</button>}
              </div>
            </form>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- departments */}
      {tab === 'departments' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-title"><span>الإدارات ({departments.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الإدارة</th><th>عدد الموظفين</th><th>الحالة</th>{manage && <th />}</tr></thead>
                <tbody>
                  {departments.map((row) => (
                    <tr key={row.departmentId}>
                      <td className="font-semibold">{row.name}</td>
                      <td>{row.employeeCount ?? 0}</td>
                      <td>{row.isActive ? 'نشطة' : 'موقوفة'}</td>
                      {manage && <td><button className="text-rose-600 text-xs font-semibold" onClick={() => removeDepartment(row)}>حذف</button></td>}
                    </tr>
                  ))}
                  {departments.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-8">لا توجد إدارات</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {manage && (
            <form className="card p-5 space-y-3 h-fit" onSubmit={addDepartment}>
              <div className="font-bold">إدارة جديدة</div>
              <div>
                <label className="label">اسم الإدارة</label>
                <input className="input" value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} required />
              </div>
              <button className="btn-primary w-full">إضافة</button>
            </form>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ components */}
      {tab === 'components' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-title"><span>مكونات المرتب ({components.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الاسم</th><th>النوع</th><th>الحساب</th><th>القيمة</th><th>الموظفون</th>{manage && <th />}</tr></thead>
                <tbody>
                  {components.map((row) => (
                    <tr key={row.componentId}>
                      <td className="font-semibold">{row.name}</td>
                      <td className="text-xs">{Number(row.componentType) === 1 ? 'بدل' : Number(row.componentType) === 2 ? 'خصم' : 'حصة الشركة'}</td>
                      <td className="text-xs">{Number(row.calcType) === 2 ? 'نسبة من الأساسي' : 'مبلغ ثابت'}</td>
                      <td className="font-bold">{Number(row.calcType) === 2 ? `${Number(row.amount)}%` : formatMoney(row.amount)}</td>
                      <td>{row.employeeCount ?? 0}</td>
                      {manage && (
                        <td className="whitespace-nowrap">
                          <button className="text-brand-600 text-xs font-semibold" onClick={() => setComponentForm({ ...row })}>تعديل</button>
                          <button className="text-rose-600 text-xs font-semibold mr-3" onClick={() => removeComponent(row)}>حذف</button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {components.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد مكونات</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {manage && (
            <form className="card p-5 space-y-3 h-fit" onSubmit={saveComponent}>
              <div className="font-bold">{componentForm.componentId ? 'تعديل مكوّن' : 'مكوّن جديد'}</div>
              <div>
                <label className="label">الاسم</label>
                <input className="input" value={componentForm.name} onChange={(e) => setComponentForm({ ...componentForm, name: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">النوع</label>
                  <select className="input" value={componentForm.componentType} onChange={(e) => setComponentForm({ ...componentForm, componentType: Number(e.target.value) })}>
                    <option value={1}>بدل</option>
                    <option value={2}>خصم</option>
                    <option value={3}>حصة الشركة</option>
                  </select>
                </div>
                <div>
                  <label className="label">طريقة الحساب</label>
                  <select className="input" value={componentForm.calcType} onChange={(e) => setComponentForm({ ...componentForm, calcType: Number(e.target.value) })}>
                    <option value={1}>مبلغ ثابت</option>
                    <option value={2}>نسبة % من الأساسي</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">القيمة</label>
                <input className="input" type="number" step="0.01" value={componentForm.amount} onChange={(e) => setComponentForm({ ...componentForm, amount: Number(e.target.value) })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={componentForm.isActive} onChange={(e) => setComponentForm({ ...componentForm, isActive: e.target.checked })} />
                نشط
              </label>
              <div className="flex gap-2">
                <button className="btn-primary flex-1" disabled={busy}>حفظ</button>
                {componentForm.componentId && <button type="button" className="btn-soft" onClick={() => setComponentForm(emptyComponent)}>جديد</button>}
              </div>
            </form>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- attendance */}
      {tab === 'attendance' && (
        <div className="space-y-4">
          {manage && (
            <div className="card p-4 flex flex-wrap items-end gap-3">
              <form className="flex flex-wrap items-end gap-3" onSubmit={saveAttendance}>
                <div>
                  <label className="label">الموظف</label>
                  <select className="input w-52" value={attendanceForm.employeeId} onChange={(e) => setAttendanceForm({ ...attendanceForm, employeeId: e.target.value })} required>
                    <option value="">— اختر —</option>
                    {employees.map((row) => <option key={row.employeeId} value={row.employeeId}>{row.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">التاريخ</label>
                  <input className="input w-40" type="date" value={attendanceForm.workDate} onChange={(e) => setAttendanceForm({ ...attendanceForm, workDate: e.target.value })} required />
                </div>
                <div>
                  <label className="label">الحالة</label>
                  <select className="input w-32" value={attendanceForm.status} onChange={(e) => setAttendanceForm({ ...attendanceForm, status: Number(e.target.value) })}>
                    <option value={1}>حاضر</option>
                    <option value={2}>غائب</option>
                    <option value={3}>إجازة</option>
                    <option value={4}>عطلة</option>
                  </select>
                </div>
                <button className="btn-primary">تسجيل</button>
              </form>
              <div className="flex-1" />
              <label className={`btn-soft text-xs ${busy ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}>
                استيراد CSV (بصمة)
                <input ref={importRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importAttendance} disabled={busy} />
              </label>
            </div>
          )}

          <div className="card">
            <div className="card-title"><span>ملخص الحضور — {month}</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الموظف</th><th>حضور</th><th>غياب</th><th>إجازات</th><th>إضافي (دقيقة)</th><th>تأخير (دقيقة)</th></tr></thead>
                <tbody>
                  {attendanceSummary.map((row) => (
                    <tr key={row.employeeId}>
                      <td className="font-semibold">{row.employeeName}</td>
                      <td className="text-emerald-700">{row.presentDays}</td>
                      <td className="text-rose-600">{row.absentDays}</td>
                      <td>{row.leaveDays}</td>
                      <td>{row.overtimeMinutes}</td>
                      <td>{row.lateMinutes}</td>
                    </tr>
                  ))}
                  {attendanceSummary.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد سجلات حضور</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title"><span>سجلات الحضور ({attendance.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الموظف</th><th>التاريخ</th><th>الحضور</th><th>الانصراف</th><th>الحالة</th><th>إضافي</th><th>تأخير</th></tr></thead>
                <tbody>
                  {attendance.slice(0, 200).map((row) => (
                    <tr key={row.attendanceId}>
                      <td className="font-semibold">{row.employeeName}</td>
                      <td>{formatDate(row.workDate)}</td>
                      <td dir="ltr" className="text-right">{row.checkIn ? String(row.checkIn).slice(11, 16) : '—'}</td>
                      <td dir="ltr" className="text-right">{row.checkOut ? String(row.checkOut).slice(11, 16) : '—'}</td>
                      <td>{Number(row.status) === 1 ? 'حاضر' : Number(row.status) === 2 ? 'غائب' : Number(row.status) === 3 ? 'إجازة' : 'عطلة'}</td>
                      <td>{row.overtimeMinutes}</td>
                      <td>{row.lateMinutes}</td>
                    </tr>
                  ))}
                  {attendance.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد سجلات</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------- leaves */}
      {tab === 'leaves' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-title"><span>الإجازات ({leaves.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الموظف</th><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>الحالة</th>{manage && <th />}</tr></thead>
                <tbody>
                  {leaves.map((row) => (
                    <tr key={row.leaveId}>
                      <td className="font-semibold">{row.employeeName}</td>
                      <td className="text-xs">{Number(row.leaveType) === 3 ? 'بدون راتب' : Number(row.leaveType) === 2 ? 'مرضية' : 'سنوية'}</td>
                      <td>{formatDate(row.startDate)}</td>
                      <td>{formatDate(row.endDate)}</td>
                      <td>{row.days}</td>
                      <td>
                        <span className={`badge ${Number(row.status) === 2 ? 'bg-emerald-50 text-emerald-700' : Number(row.status) === 3 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                          {Number(row.status) === 2 ? 'معتمدة' : Number(row.status) === 3 ? 'مرفوضة' : 'معلّقة'}
                        </span>
                      </td>
                      {manage && (
                        <td className="whitespace-nowrap">
                          {Number(row.status) === 1 && (
                            <>
                              <button className="text-emerald-600 text-xs font-semibold" onClick={() => setLeaveStatus(row, 2)}>اعتماد</button>
                              <button className="text-rose-600 text-xs font-semibold mr-3" onClick={() => setLeaveStatus(row, 3)}>رفض</button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {leaves.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد إجازات</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {manage && (
            <form className="card p-5 space-y-3 h-fit" onSubmit={saveLeave}>
              <div className="font-bold">طلب إجازة</div>
              <div>
                <label className="label">الموظف</label>
                <select className="input" value={leaveForm.employeeId} onChange={(e) => setLeaveForm({ ...leaveForm, employeeId: e.target.value })} required>
                  <option value="">— اختر —</option>
                  {employees.map((row) => <option key={row.employeeId} value={row.employeeId}>{row.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">النوع</label>
                <select className="input" value={leaveForm.leaveType} onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: Number(e.target.value) })}>
                  <option value={1}>سنوية</option>
                  <option value={2}>مرضية</option>
                  <option value={3}>بدون راتب</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">من</label>
                  <input className="input" type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })} required />
                </div>
                <div>
                  <label className="label">إلى</label>
                  <input className="input" type="date" value={leaveForm.endDate} onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })} required />
                </div>
              </div>
              <div>
                <label className="label">ملاحظات</label>
                <input className="input" value={leaveForm.notes} onChange={(e) => setLeaveForm({ ...leaveForm, notes: e.target.value })} />
              </div>
              <button className="btn-primary w-full">تسجيل الطلب</button>
              <p className="text-[11px] text-slate-400">الإجازة «بدون راتب» المعتمدة تُخصم تلقائيًا في توليد المرتبات.</p>
            </form>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- advances */}
      {tab === 'advances' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-title">
              <span>السلف ({advances.length})</span>
              <select className="input w-48 py-1.5" value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— صندوق الصرف —</option>
                {cashAccounts.map((row) => <option key={row.cashAccountId} value={row.cashAccountId}>{row.name}</option>)}
              </select>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الموظف</th><th>التاريخ</th><th>المبلغ</th><th>الخصم الشهري</th><th>المسدد</th><th>المتبقي</th><th>الحالة</th>{manage && <th />}</tr></thead>
                <tbody>
                  {advances.map((row) => (
                    <tr key={row.advanceId}>
                      <td className="font-semibold">{row.employeeName}</td>
                      <td>{formatDate(row.advanceDate)}</td>
                      <td>{formatMoney(row.amount)}</td>
                      <td>{formatMoney(row.monthlyDeduction)}</td>
                      <td className="text-emerald-700">{formatMoney(row.deductedAmount)}</td>
                      <td className="font-bold text-rose-600">{formatMoney(row.remaining)}</td>
                      <td>
                        <span className={`badge ${Number(row.status) === 1 ? 'bg-amber-50 text-amber-700' : Number(row.status) === 2 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {Number(row.status) === 1 ? (row.glJournalId ? 'مصروفة' : 'مفتوحة') : Number(row.status) === 2 ? 'مغلقة' : 'ملغاة'}
                        </span>
                      </td>
                      {manage && (
                        <td className="whitespace-nowrap">
                          {Number(row.status) === 1 && !row.glJournalId && (
                            <button className="text-brand-600 text-xs font-semibold" onClick={() => payAdvance(row)}>صرف</button>
                          )}
                          {Number(row.status) === 1 && !row.glJournalId && (
                            <button className="text-rose-600 text-xs font-semibold mr-3" onClick={() => cancelAdvance(row)}>إلغاء</button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {advances.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">لا توجد سلف</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {manage && (
            <form className="card p-5 space-y-3 h-fit" onSubmit={saveAdvance}>
              <div className="font-bold">سلفة جديدة</div>
              <div>
                <label className="label">الموظف</label>
                <select className="input" value={advanceForm.employeeId} onChange={(e) => setAdvanceForm({ ...advanceForm, employeeId: e.target.value })} required>
                  <option value="">— اختر —</option>
                  {employees.map((row) => <option key={row.employeeId} value={row.employeeId}>{row.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">المبلغ</label>
                <input className="input" type="number" step="0.01" value={advanceForm.amount} onChange={(e) => setAdvanceForm({ ...advanceForm, amount: Number(e.target.value) })} required />
              </div>
              <div>
                <label className="label">الخصم الشهري</label>
                <input className="input" type="number" step="0.01" value={advanceForm.monthlyDeduction} onChange={(e) => setAdvanceForm({ ...advanceForm, monthlyDeduction: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">التاريخ</label>
                <input className="input" type="date" value={advanceForm.advanceDate} onChange={(e) => setAdvanceForm({ ...advanceForm, advanceDate: e.target.value })} />
              </div>
              <div>
                <label className="label">ملاحظات</label>
                <input className="input" value={advanceForm.notes} onChange={(e) => setAdvanceForm({ ...advanceForm, notes: e.target.value })} />
              </div>
              <button className="btn-primary w-full">حفظ السلفة</button>
              <p className="text-[11px] text-slate-400">بعد الحفظ اضغط «صرف» لإنشاء قيد: مدين سلف الموظفين / دائن الخزينة.</p>
            </form>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------- payroll */}
      {tab === 'payroll' && (
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap items-center gap-3">
            <div className="font-bold">مرتبات {month}</div>
            <div className="flex-1" />
            <select className="input w-52 py-1.5" value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— صندوق صرف المرتبات —</option>
              {cashAccounts.map((row) => <option key={row.cashAccountId} value={row.cashAccountId}>{row.name}</option>)}
            </select>
            {manage && <button className="btn-soft" onClick={generatePayroll} disabled={busy}>توليد المرتبات</button>}
            {manage && (
              <button className="btn-primary" onClick={() => paySalaries()} disabled={busy || selectedSalaries.length === 0}>
                صرف المحدد ({selectedSalaries.length})
              </button>
            )}
            {manage && draftSalaries.length > 0 && (
              <button className="btn-soft" onClick={() => paySalaries(draftSalaries.map((row) => row.salaryPayId))} disabled={busy}>
                صرف كل المسودات ({draftSalaries.length})
              </button>
            )}
          </div>

          {payrollSummary?.totals && (
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="card p-4"><div className="text-xs text-slate-400">عدد المرتبات</div><div className="text-xl font-bold">{payrollSummary.totals.employees}</div></div>
              <div className="card p-4"><div className="text-xs text-slate-400">إجمالي الإجمالي</div><div className="text-xl font-bold">{formatMoney(payrollSummary.totals.totalGross)}</div></div>
              <div className="card p-4"><div className="text-xs text-slate-400">إجمالي الصافي</div><div className="text-xl font-bold text-emerald-700">{formatMoney(payrollSummary.totals.totalNet)}</div></div>
            </div>
          )}

          <div className="card">
            <div className="card-title"><span>مسير الرواتب ({salaries.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {manage && <th />}
                    <th>الموظف</th><th>الأساسي</th><th>بدلات</th><th>إضافي</th><th>خصومات</th>
                    <th>تأمينات</th><th>سلف</th><th>الصافي</th><th>الحالة</th><th />
                  </tr>
                </thead>
                <tbody>
                  {salaries.map((row) => (
                    <tr key={row.salaryPayId}>
                      {manage && (
                        <td>
                          {Number(row.status) === 1 && (
                            <input type="checkbox" checked={selectedSalaries.includes(row.salaryPayId)} onChange={() => toggleSalary(row.salaryPayId)} />
                          )}
                        </td>
                      )}
                      <td className="font-semibold">
                        {row.employeeName}
                        <div className="text-[10px] text-slate-400">{row.jobTitle ?? ''}</div>
                      </td>
                      <td>{formatMoney(row.basicSalary)}</td>
                      <td>{formatMoney(row.allowances)}</td>
                      <td>{formatMoney(row.overtimeAmount)}</td>
                      <td>{formatMoney(row.deductions)}</td>
                      <td>{formatMoney(row.insuranceEmployee)}</td>
                      <td>{formatMoney(row.advanceDeduction)}</td>
                      <td className="font-bold text-emerald-700">{formatMoney(row.netPay)}</td>
                      <td>
                        <span className={`badge ${Number(row.status) === 2 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          {Number(row.status) === 2 ? 'مصروف' : 'مسودة'}
                        </span>
                      </td>
                      <td>
                        <button className="text-brand-600 text-xs font-semibold" onClick={() => openPayslip(row)}>قسيمة</button>
                      </td>
                    </tr>
                  ))}
                  {salaries.length === 0 && <tr><td colSpan={manage ? 11 : 10} className="text-center text-slate-400 py-8">لا توجد مرتبات لهذا الشهر — اضغط «توليد المرتبات»</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- employee components */}
      {employeeComponents && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-print" onClick={() => setEmployeeComponents(null)}>
          <div className="card w-full max-w-xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="font-bold">مكونات مرتب — {employeeComponents.employeeName}</div>
              <button className="text-slate-400 text-sm" onClick={() => setEmployeeComponents(null)}>إغلاق</button>
            </div>
            <div className="table-wrap max-h-80 overflow-auto">
              <table className="table">
                <thead><tr><th>مفعل</th><th>المكوّن</th><th>النوع</th><th>القيمة</th><th>تجاوز القيمة</th></tr></thead>
                <tbody>
                  {employeeComponents.rows.map((row, index) => (
                    <tr key={row.componentId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.assigned}
                          onChange={(e) => setEmployeeComponents({
                            ...employeeComponents,
                            rows: employeeComponents.rows.map((item, i) => (i === index ? { ...item, assigned: e.target.checked } : item)),
                          })}
                        />
                      </td>
                      <td className="font-semibold">{row.name}</td>
                      <td className="text-xs">{Number(row.componentType) === 1 ? 'بدل' : Number(row.componentType) === 2 ? 'خصم' : 'حصة الشركة'}</td>
                      <td>{Number(row.calcType) === 2 ? `${Number(row.baseAmount)}%` : formatMoney(row.baseAmount)}</td>
                      <td>
                        <input
                          className="input px-2 py-1 text-xs w-28"
                          type="number" step="0.01"
                          value={row.amountOverride}
                          placeholder="—"
                          disabled={!row.assigned}
                          onChange={(e) => setEmployeeComponents({
                            ...employeeComponents,
                            rows: employeeComponents.rows.map((item, i) => (i === index ? { ...item, amountOverride: e.target.value } : item)),
                          })}
                        />
                      </td>
                    </tr>
                  ))}
                  {employeeComponents.rows.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-6">لا توجد مكونات معرّفة — أضفها من تبويب «مكونات المرتب»</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-soft" onClick={() => setEmployeeComponents(null)}>إلغاء</button>
              <button className="btn-primary" onClick={saveEmployeeComponents} disabled={busy}>حفظ</button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------- payslip */}
      {payslip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setPayslip(null)}>
          <div className="card w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-center border-b border-slate-100 pb-3">
              <div className="text-lg font-bold">قسيمة راتب</div>
              <div className="text-xs text-slate-500">{String(payslip.periodMonth).slice(0, 7)} — {payslip.branchName ?? ''}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-slate-400">الموظف:</span> {payslip.employeeName}</div>
              <div><span className="text-slate-400">الكود:</span> {payslip.employeeCode ?? '—'}</div>
              <div><span className="text-slate-400">الوظيفة:</span> {payslip.jobTitle ?? '—'}</div>
              <div><span className="text-slate-400">الإدارة:</span> {payslip.departmentName ?? '—'}</div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>البند</th><th>النوع</th><th>المبلغ</th></tr></thead>
                <tbody>
                  {(payslip.lines ?? []).map((line: any, index: number) => (
                    <tr key={index}>
                      <td>{line.name}</td>
                      <td className={Number(line.lineType) === 1 ? 'text-emerald-700' : 'text-rose-600'}>
                        {Number(line.lineType) === 1 ? 'استحقاق' : 'خصم'}
                      </td>
                      <td className="font-semibold">{formatMoney(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between text-sm font-bold border-t border-slate-100 pt-3">
              <span>الإجمالي: {formatMoney(payslip.grossPay)}</span>
              <span className="text-emerald-700">الصافي: {formatMoney(payslip.netPay)}</span>
            </div>
            <div className="flex gap-2 justify-end no-print">
              <button className="btn-soft" onClick={() => setPayslip(null)}>إغلاق</button>
              <button className="btn-primary" onClick={() => window.print()}>طباعة</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
