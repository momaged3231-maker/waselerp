'use client';

import { useEffect, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import AttachmentsPanel from '@/components/AttachmentsPanel';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { downloadCsv } from '@/lib/export';
import { useSession } from '@/lib/session';

type Tab = 'employees' | 'departments' | 'components' | 'attendance' | 'permissions' | 'tiers' | 'leaves' | 'advances' | 'hrReports' | 'cards' | 'payroll';

const TABS: [Tab, string][] = [
  ['employees', 'الموظفون'],
  ['departments', 'الإدارات'],
  ['components', 'مكونات المرتب'],
  ['attendance', 'الحضور والانصراف'],
  ['permissions', 'أذونات الانصراف المبكر'],
  ['tiers', 'نسب الخصومات'],
  ['leaves', 'الإجازات'],
  ['advances', 'السلف'],
  ['hrReports', 'تقارير الحضور'],
  ['cards', 'كروت الموظفين'],
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
  const [permissionForm, setPermissionForm] = useState({ employeeId: '', permissionDate: new Date().toISOString().slice(0, 10), fromTime: '14:00', toTime: '16:00', reason: '', deductFromSalary: false });
  const [tierForm, setTierForm] = useState<any>({ tierId: 0, fromMinutes: 1, toMinutes: 15, percent: 25, sortOrder: 1 });
  const [permissions, setPermissions] = useState<any[]>([]);
  const [tiers, setTiers] = useState<any[]>([]);
  const [reportKind, setReportKind] = useState<'attendance' | 'early' | 'overtime' | 'leaves'>('attendance');
  const [reportRows, setReportRows] = useState<any[]>([]);
  const [reportSummary, setReportSummary] = useState<any>(null);
  const [reportFrom, setReportFrom] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`);
  const [reportTo, setReportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [reportEmployeeId, setReportEmployeeId] = useState('');
  const [cardEmployeeId, setCardEmployeeId] = useState('');
  const [cardMonth, setCardMonth] = useState(new Date().toISOString().slice(0, 7));
  const [cardRows, setCardRows] = useState<any[]>([]);

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

  async function punchNow(type: 'in' | 'out') {
    if (!attendanceForm.employeeId) { fail({ message: 'اختر الموظف أولًا' }); return; }
    setBusy(true);
    try {
      await apiFetch('/hr/attendance/punch', {
        method: 'POST',
        body: { employeeId: Number(attendanceForm.employeeId), type },
      });
      flash(type === 'in' ? 'تم تسجيل الحضور الآن' : 'تم تسجيل الانصراف الآن');
      await loadAttendance();
    } catch (err: any) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function loadPermissions() {
    const query = new URLSearchParams();
    query.set('from', reportFrom);
    query.set('to', reportTo);
    setPermissions((await apiFetch<any[]>(`/hr/early-permissions?${query.toString()}`)) ?? []);
  }

  async function createPermission(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/hr/early-permissions', {
        method: 'POST',
        body: {
          ...permissionForm,
          employeeId: Number(permissionForm.employeeId),
        },
      });
      flash('تم تسجيل إذن الانصراف المبكر');
      setPermissionForm({ ...permissionForm, reason: '', fromTime: '14:00', toTime: '16:00', deductFromSalary: false });
      await loadPermissions();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function setPermissionStatus(id: number, status: number) {
    try {
      await apiFetch(`/hr/early-permissions/${id}/status`, { method: 'PUT', body: { status } });
      flash(status === 2 ? 'تم اعتماد الإذن' : 'تم رفض الإذن');
      await loadPermissions();
    } catch (err) {
      fail(err);
    }
  }

  async function deletePermission(id: number) {
    if (!window.confirm('حذف هذا الإذن؟')) return;
    try {
      await apiFetch(`/hr/early-permissions/${id}`, { method: 'DELETE' });
      flash('تم حذف الإذن');
      await loadPermissions();
    } catch (err) {
      fail(err);
    }
  }

  async function loadTiers() {
    setTiers((await apiFetch<any[]>('/hr/latency-tiers')) ?? []);
  }

  async function saveTier(event: React.FormEvent) {
    event.preventDefault();
    try {
      const body = {
        fromMinutes: Number(tierForm.fromMinutes) || 0,
        toMinutes: tierForm.toMinutes === '' || tierForm.toMinutes === null || Number.isNaN(Number(tierForm.toMinutes)) ? null : Number(tierForm.toMinutes),
        percent: Number(tierForm.percent) || 0,
        sortOrder: Number(tierForm.sortOrder) || 0,
      };
      if (tierForm.tierId) {
        await apiFetch(`/hr/latency-tiers/${tierForm.tierId}`, { method: 'PUT', body });
        flash('تم حفظ الشريحة');
      } else {
        await apiFetch('/hr/latency-tiers', { method: 'POST', body });
        flash('تم إضافة الشريحة');
      }
      setTierForm({ tierId: 0, fromMinutes: 1, toMinutes: 15, percent: 25, sortOrder: 1 });
      await loadTiers();
    } catch (err) {
      fail(err);
    }
  }

  async function deleteTier(id: number) {
    if (!window.confirm('حذف هذه الشريحة؟')) return;
    try {
      await apiFetch(`/hr/latency-tiers/${id}`, { method: 'DELETE' });
      flash('تم حذف الشريحة');
      await loadTiers();
    } catch (err) {
      fail(err);
    }
  }

  async function loadReport() {
    setError('');
    const query = new URLSearchParams({ from: reportFrom, to: reportTo });
    if (reportEmployeeId) query.set('employeeId', reportEmployeeId);
    try {
      if (reportKind === 'attendance') {
        setReportRows((await apiFetch<any[]>(`/hr/reports/attendance?${query.toString()}`)) ?? []);
        setReportSummary(null);
      } else if (reportKind === 'early') {
        const rows = await apiFetch<any[]>(`/hr/early-permissions?${query.toString()}&status=2`);
        setReportRows(rows ?? []);
        setReportSummary({ count: (rows ?? []).length, minutes: (rows ?? []).reduce((sum: number, row: any) => sum + Number(row.minutes ?? 0), 0) });
      } else if (reportKind === 'overtime') {
        const data = await apiFetch<any>(`/hr/reports/overtime?${query.toString()}`);
        setReportRows(data?.items ?? []);
        setReportSummary(data?.totals ?? null);
      } else {
        const data = await apiFetch<any>(`/hr/reports/leaves-absence?${query.toString()}`);
        setReportRows(data?.items ?? []);
        setReportSummary(data?.totals ?? null);
      }
    } catch (err: any) {
      fail(err);
    }
  }

  async function loadCardData() {
    if (!cardEmployeeId || !cardMonth) return;
    const [year, monthNum] = cardMonth.split('-').map(Number);
    const last = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    const from = `${cardMonth}-01`;
    const to = `${cardMonth}-${String(last).padStart(2, '0')}`;
    try {
      const rows = await apiFetch<any[]>(`/hr/attendance?from=${from}&to=${to}&employeeId=${cardEmployeeId}`);
      setCardRows(rows ?? []);
    } catch (err: any) {
      fail(err);
    }
  }

  const cardRowsByDate = new Map<string, any>(cardRows.map((row: any) => [String(row.workDate).slice(0, 10), row]));
  const cardEmployee = employees.find((row: any) => Number(row.employeeId) === Number(cardEmployeeId));
  const cardDays = cardMonth ? Array.from({ length: Number(new Date(Date.UTC(Number(cardMonth.slice(0, 4)), Number(cardMonth.slice(5, 7)), 0)).getUTCDate()) }, (_, i) => i + 1) : [];

  function printCard() {
    window.print();
  }

  async function exportReportCsv() {
    const filename = `wasel-hr-${reportKind}-${reportFrom}-${reportTo}`;
    const shaped = reportRows.map((row: any) => {
      if (reportKind === 'attendance') {
        return {
          'الكود': row.code ?? '', 'الاسم': row.employeeName, 'التاريخ': String(row.workDate).slice(0, 10),
          'حضور': row.checkIn ? String(row.checkIn).slice(11, 16) : '', 'انصراف': row.checkOut ? String(row.checkOut).slice(11, 16) : '',
          'تأخير (دقيقة)': Number(row.lateMinutes ?? 0), 'قيمة التأخير': Number(row.lateValue ?? 0),
          'انصراف مبكر (دقيقة)': Number(row.earlyMinutes ?? 0), 'قيمة الانصراف المبكر': Number(row.earlyValue ?? 0),
          'ساعات العمل': Number(row.hoursWorked ?? 0), 'الحالة': Number(row.status) === 1 ? 'حاضر' : Number(row.status) === 2 ? 'غائب' : Number(row.status) === 3 ? 'إجازة' : 'عطلة',
        };
      }
      if (reportKind === 'early') {
        return {
          'الموظف': row.employeeName, 'التاريخ': String(row.permissionDate).slice(0, 10),
          'من': String(row.fromTime ?? '').slice(0, 5), 'إلى': String(row.toTime ?? '').slice(0, 5),
          'المدة (دقيقة)': Number(row.minutes ?? 0), 'السبب': row.reason ?? '',
          'يخصم من الراتب': row.deductFromSalary ? 'نعم' : 'لا',
        };
      }
      if (reportKind === 'overtime') {
        return {
          'الموظف': row.employeeName, 'الإضافي (دقيقة)': Number(row.overtimeMinutes ?? 0),
          'الساعات': Number(row.hours ?? 0), 'أيام العمل الإضافي': Number(row.overtimeDays ?? 0),
          'القيمة التقديرية': Number(row.overtimeValue ?? 0),
        };
      }
      return {
        'الموظف': row.employeeName, 'إجازات سنوية': Number(row.annualDays ?? 0),
        'إجازات مرضية': Number(row.sickDays ?? 0), 'بدون راتب': Number(row.unpaidDays ?? 0),
        'إجمالي أيام الإجازات': Number(row.totalLeaveDays ?? 0), 'أيام الغياب': Number(row.absentDays ?? 0),
        'طلبات الإجازات': Number(row.leaveRequests ?? 0),
      };
    });
    downloadCsv(filename, shaped);
  }

  useEffect(() => {
    loadReference();
  }, []);

  useEffect(() => {
    setError('');
    (async () => {
      try {
        if (tab === 'employees') await loadEmployees();
        if (['attendance', 'leaves', 'advances', 'permissions', 'hrReports', 'cards'].includes(tab) && !employees.length) await loadEmployees('');
        if (tab === 'departments') await loadDepartments();
        if (tab === 'components') await loadComponents();
        if (tab === 'attendance') await loadAttendance();
        if (tab === 'leaves') await loadLeaves();
        if (tab === 'advances') await loadAdvances();
        if (tab === 'permissions') await loadPermissions();
        if (tab === 'tiers') await loadTiers();
        if (tab === 'hrReports') await loadReport();
        if (tab === 'cards') await loadCardData();
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
              {employeeForm.employeeId && (
                <AttachmentsPanel entityType="employee" entityId={Number(employeeForm.employeeId)} compact />
              )}
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
                {manage && (
                  <>
                    <button type="button" className="btn-soft text-xs" disabled={busy} onClick={() => punchNow('in')}>حضور الآن</button>
                    <button type="button" className="btn-soft text-xs" disabled={busy} onClick={() => punchNow('out')}>انصراف الآن</button>
                  </>
                )}
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

      {/* -------------------------------------------------------------- early permissions (D11) */}
      {tab === 'permissions' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-title"><span>أذونات الانصراف المبكر — {reportFrom} إلى {reportTo} ({permissions.length})</span></div>
            <div className="p-4 grid sm:grid-cols-4 gap-2 border-b border-slate-100">
              <input className="input" type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
              <input className="input" type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
              <button className="btn-soft text-xs" onClick={loadPermissions}>عرض</button>
              <button className="btn-soft text-xs" onClick={() => downloadCsv(`permissions-${reportFrom}-${reportTo}`, permissions.map((row: any) => ({
                'الموظف': row.employeeName, 'التاريخ': String(row.permissionDate).slice(0, 10),
                'من': String(row.fromTime ?? '').slice(0, 5), 'إلى': String(row.toTime ?? '').slice(0, 5),
                'المدة (دقيقة)': Number(row.minutes ?? 0), 'السبب': row.reason ?? '',
                'يخصم من الراتب': row.deductFromSalary ? 'نعم' : 'لا',
                'الحالة': Number(row.status) === 2 ? 'معتمد' : Number(row.status) === 3 ? 'مرفوض' : 'قيد الانتظار',
              })))}>تصدير CSV</button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الموظف</th><th>التاريخ</th><th>من</th><th>إلى</th><th>الدقائق</th><th>السبب</th><th>الخصم</th><th>الحالة</th>{manage && <th />}</tr></thead>
                <tbody>
                  {permissions.map((row: any) => (
                    <tr key={row.permissionId}>
                      <td className="font-semibold">{row.employeeName}</td>
                      <td>{formatDate(row.permissionDate)}</td>
                      <td dir="ltr" className="text-right">{String(row.fromTime ?? '').slice(0, 5)}</td>
                      <td dir="ltr" className="text-right">{String(row.toTime ?? '').slice(0, 5)}</td>
                      <td>{row.minutes}</td>
                      <td className="text-xs text-slate-500">{row.reason ?? '—'}</td>
                      <td>{row.deductFromSalary ? 'يخصم ✓' : 'بدون خصم'}</td>
                      <td><span className={`badge ${Number(row.status) === 2 ? 'bg-emerald-50 text-emerald-700' : Number(row.status) === 3 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{Number(row.status) === 2 ? 'معتمد' : Number(row.status) === 3 ? 'مرفوض' : 'قيد الانتظار'}</span></td>
                      {manage && (
                        <td className="whitespace-nowrap">
                          {Number(row.status) === 1 && (
                            <>
                              <button className="text-emerald-700 text-xs font-semibold" onClick={() => setPermissionStatus(row.permissionId, 2)}>اعتماد</button>
                              <button className="text-rose-600 text-xs font-semibold mr-2" onClick={() => setPermissionStatus(row.permissionId, 3)}>رفض</button>
                              <button className="text-rose-600 text-xs mr-2" onClick={() => deletePermission(row.permissionId)}>حذف</button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {permissions.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-8">لا توجد أذونات في الفترة</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {manage && (
            <form className="card p-5 space-y-3 h-fit" onSubmit={createPermission}>
              <div className="font-bold">إذن انصراف جديد</div>
              <div>
                <label className="label">الموظف</label>
                <select className="input" value={permissionForm.employeeId} onChange={(e) => setPermissionForm({ ...permissionForm, employeeId: e.target.value })} required>
                  <option value="">— اختر —</option>
                  {employees.map((row) => <option key={row.employeeId} value={row.employeeId}>{row.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">التاريخ</label>
                <input className="input" type="date" value={permissionForm.permissionDate} onChange={(e) => setPermissionForm({ ...permissionForm, permissionDate: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">من</label><input className="input" type="time" value={permissionForm.fromTime} onChange={(e) => setPermissionForm({ ...permissionForm, fromTime: e.target.value })} required /></div>
                <div><label className="label">إلى</label><input className="input" type="time" value={permissionForm.toTime} onChange={(e) => setPermissionForm({ ...permissionForm, toTime: e.target.value })} required /></div>
              </div>
              <div>
                <label className="label">السبب</label>
                <input className="input" placeholder="موعد طبيب / ظرف طارئ…" value={permissionForm.reason} onChange={(e) => setPermissionForm({ ...permissionForm, reason: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={permissionForm.deductFromSalary} onChange={(e) => setPermissionForm({ ...permissionForm, deductFromSalary: e.target.checked })} />يخصم من الراتب (بمعدل أجر الساعة)</label>
              <p className="text-[11px] text-slate-400">بعد الاعتماد والاحتفاظ بالإذن، يُخصم من راتب الشهر القادم تلقائيًا بسطر «إذن انصراف مبكر» في قسيمة المرتب.</p>
              <button type="submit" className="btn-primary w-full" disabled={busy}>تسجيل الإذن</button>
            </form>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------- latency deduction tiers (D11) */}
      {tab === 'tiers' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-title"><span>شرائح خصم التأخير ({tiers.length})</span></div>
            <div className="text-xs text-slate-500 px-5 pt-3 leading-6">الخصم يُحسب على <b>أجر اليوم</b> (الراتب الأساسي ÷ 30) ويظهر بسطر «خصم تأخير» في قسيمة المرتب. تُطبق على <b>أعلى تأخير</b> مسجّل في الشهر. الأثر فوري على مسير المرتبات القادمة.</div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>من (دقيقة)</th><th>إلى (دقيقة)</th><th>نسبة من أجر اليوم %</th><th>الترتيب</th>{manage && <th />}</tr></thead>
                <tbody>
                  {tiers.map((row: any) => (
                    <tr key={row.tierId}>
                      <td dir="ltr" className="text-right">{row.fromMinutes}</td>
                      <td dir="ltr" className="text-right">{row.toMinutes === null || row.toMinutes === undefined ? '∞' : row.toMinutes}</td>
                      <td className="font-bold text-rose-600">{row.percent}%</td>
                      <td>{row.sortOrder}</td>
                      {manage && (
                        <td className="whitespace-nowrap">
                          <button className="text-brand-600 text-xs" onClick={() => setTierForm({ tierId: row.tierId, fromMinutes: row.fromMinutes, toMinutes: row.toMinutes ?? '', percent: Number(row.percent), sortOrder: row.sortOrder })}>تعديل</button>
                          <button className="text-rose-600 text-xs mr-2" onClick={() => deleteTier(row.tierId)}>حذف</button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {tiers.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-8">لا توجد شرائح — أضف الأولى</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {manage && (
            <form className="card p-5 space-y-3 h-fit" onSubmit={saveTier}>
              <div className="font-bold">{tierForm.tierId ? 'تعديل الشريحة' : 'شريحة جديدة'}</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">من (دقيقة)</label><input className="input" type="number" min={0} dir="ltr" value={tierForm.fromMinutes} onChange={(e) => setTierForm({ ...tierForm, fromMinutes: Number(e.target.value) })} required /></div>
                <div><label className="label">إلى (دقيقة — فارغ = ∞)</label><input className="input" type="number" min={0} dir="ltr" value={tierForm.toMinutes as any} onChange={(e) => setTierForm({ ...tierForm, toMinutes: e.target.value === '' ? ('' as any) : Number(e.target.value) })} /></div>
                <div><label className="label">نسبة من أجر اليوم %</label><input className="input" type="number" step="0.01" min={0} max={100} dir="ltr" value={tierForm.percent} onChange={(e) => setTierForm({ ...tierForm, percent: Number(e.target.value) })} required /></div>
                <div><label className="label">الترتيب</label><input className="input" type="number" min={0} dir="ltr" value={tierForm.sortOrder} onChange={(e) => setTierForm({ ...tierForm, sortOrder: Number(e.target.value) })} /></div>
              </div>
              <button type="submit" className="btn-primary w-full">{tierForm.tierId ? 'حفظ التعديل' : 'إضافة'}</button>
              {tierForm.tierId ? <button type="button" className="btn-soft w-full" onClick={() => setTierForm({ tierId: 0, fromMinutes: 1, toMinutes: 15, percent: 25, sortOrder: 1 })}>إلغاء التعديل</button> : null}
            </form>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------- attendance reports (D11) */}
      {tab === 'hrReports' && (
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap items-end gap-2">
            <div className="flex gap-2">
              {([['attendance', 'الحضور والانصراف'], ['early', 'الانصراف المبكر'], ['overtime', 'العمل الإضافي'], ['leaves', 'الإجازات والغياب']] as [typeof reportKind, string][]).map(([k, label]) => (
                <button key={k} className={reportKind === k ? 'btn-primary' : 'btn-soft'} onClick={() => setReportKind(k)}>{label}</button>
              ))}
            </div>
            <div className="flex-1" />
            <div><label className="label">من</label><input className="input" type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} /></div>
            <div><label className="label">إلى</label><input className="input" type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} /></div>
            <div>
              <label className="label">الموظف</label>
              <select className="input w-44" value={reportEmployeeId} onChange={(e) => setReportEmployeeId(e.target.value)}>
                <option value="">الكل</option>
                {employees.map((row) => <option key={row.employeeId} value={row.employeeId}>{row.name}</option>)}
              </select>
            </div>
            <button className="btn-primary" onClick={loadReport}>عرض</button>
            <button className="btn-soft" onClick={exportReportCsv} disabled={reportRows.length === 0}>تصدير CSV</button>
          </div>

          {reportKind === 'attendance' && (
            <div className="card">
              <div className="card-title"><span>تقرير الحضور والانصراف ({reportRows.length})</span></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>الكود</th><th>الاسم</th><th>التاريخ</th><th>حضور</th><th>انصراف</th><th>تأخير (د)</th><th>قيمة التأخير</th><th>انصراف مبكر (د)</th><th>قيمة الانصراف</th><th>الساعات</th><th>الحالة</th></tr></thead>
                  <tbody>
                    {reportRows.map((row: any, i: number) => (
                      <tr key={i}>
                        <td className="font-mono text-xs">{row.code ?? '—'}</td>
                        <td className="font-semibold">{row.employeeName}</td>
                        <td className="text-xs">{String(row.workDate).slice(0, 10)}</td>
                        <td dir="ltr" className="text-right">{row.checkIn ? String(row.checkIn).slice(11, 16) : '—'}</td>
                        <td dir="ltr" className="text-right">{row.checkOut ? String(row.checkOut).slice(11, 16) : '—'}</td>
                        <td className="text-rose-600">{row.lateMinutes}</td>
                        <td className="text-rose-600">{formatMoney(row.lateValue)}</td>
                        <td>{row.earlyMinutes}</td>
                        <td>{formatMoney(row.earlyValue)}</td>
                        <td>{row.hoursWorked}</td>
                        <td>{Number(row.status) === 1 ? 'حاضر' : Number(row.status) === 2 ? 'غائب' : Number(row.status) === 3 ? 'إجازة' : 'عطلة'}</td>
                      </tr>
                    ))}
                    {reportRows.length === 0 && <tr><td colSpan={11} className="text-center text-slate-400 py-8">لا توجد سجلات في الفترة</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportKind === 'early' && (
            <div className="card">
              <div className="card-title"><span>تقرير أذونات الانصراف المبكر ({reportRows.length}{reportSummary ? ` · إجمالي ${reportSummary.minutes} دقيقة` : ''})</span></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>الموظف</th><th>التاريخ</th><th>من</th><th>إلى</th><th>المدة (دقيقة)</th><th>السبب</th><th>يخصم</th></tr></thead>
                  <tbody>
                    {reportRows.map((row: any) => (
                      <tr key={row.permissionId}>
                        <td className="font-semibold">{row.employeeName}</td>
                        <td>{formatDate(row.permissionDate)}</td>
                        <td dir="ltr" className="text-right">{String(row.fromTime ?? '').slice(0, 5)}</td>
                        <td dir="ltr" className="text-right">{String(row.toTime ?? '').slice(0, 5)}</td>
                        <td className="font-bold">{row.minutes}</td>
                        <td className="text-xs text-slate-500">{row.reason ?? '—'}</td>
                        <td>{row.deductFromSalary ? 'نعم ✓' : 'لا'}</td>
                      </tr>
                    ))}
                    {reportRows.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد أذونات معتمدة في الفترة</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportKind === 'overtime' && (
            <div className="card">
              <div className="card-title">
                <span>تقرير العمل الإضافي — تقديري × 1.5 للساعة</span>
                {reportSummary && <span className="text-xs font-normal text-slate-500">{reportSummary.overtimeMinutes} دقيقة · {Number(reportSummary.hours).toFixed(2)} ساعة · {formatMoney(reportSummary.overtimeValue)}</span>}
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>الموظف</th><th>إضافية (دقيقة)</th><th>الساعات</th><th>أيام العمل الإضافي</th><th>أجر الساعة</th><th>القيمة التقديرية</th></tr></thead>
                  <tbody>
                    {reportRows.map((row: any) => (
                      <tr key={row.employeeId}>
                        <td className="font-semibold">{row.employeeName}</td>
                        <td>{row.overtimeMinutes}</td>
                        <td dir="ltr" className="text-right">{row.hours}</td>
                        <td>{row.overtimeDays}</td>
                        <td>{formatMoney(row.hourRate)}</td>
                        <td className="font-bold text-emerald-700">{formatMoney(row.overtimeValue)}</td>
                      </tr>
                    ))}
                    {reportRows.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد ساعات إضافية في الفترة</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportKind === 'leaves' && (
            <div className="card">
              <div className="card-title">
                <span>تقرير الإجازات والغياب</span>
                {reportSummary && <span className="text-xs font-normal text-slate-500">إجمالي أيام الغياب {reportSummary.absentDays} · إجمالي أيام الإجازات {Number(reportSummary.totalLeaveDays).toFixed(1)}</span>}
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>الموظف</th><th>سنوية</th><th>مرضية</th><th>بدون راتب</th><th>إجمالي الإجازات</th><th>أيام الغياب</th><th>طلبات الإجازات</th></tr></thead>
                  <tbody>
                    {reportRows.map((row: any) => (
                      <tr key={row.employeeId}>
                        <td className="font-semibold">{row.employeeName}</td>
                        <td>{row.annualDays}</td>
                        <td>{row.sickDays}</td>
                        <td>{row.unpaidDays}</td>
                        <td>{row.totalLeaveDays}</td>
                        <td className="text-rose-600 font-bold">{row.absentDays}</td>
                        <td>{row.leaveRequests}</td>
                      </tr>
                    ))}
                    {reportRows.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد إجازات أو غياب في الفترة</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------- employee cards (D11) */}
      {tab === 'cards' && (
        <div className="space-y-4">
          <style>{`
            @media print {
              body * { visibility: hidden; }
              .print-card, .print-card * { visibility: visible; }
              .print-card { position: fixed; inset: 0; width: 100%; box-shadow: none !important; border: none !important; overflow: auto; padding: 16px; }
              .no-print { display: none !important; }
            }
          `}</style>
          <div className="card p-4 flex flex-wrap items-end gap-2 no-print">
            <div>
              <label className="label">الموظف</label>
              <select className="input w-56" value={cardEmployeeId} onChange={(e) => setCardEmployeeId(e.target.value)}>
                <option value="">— اختر —</option>
                {employees.map((row) => <option key={row.employeeId} value={row.employeeId}>{row.name}</option>)}
              </select>
            </div>
            <div><label className="label">الشهر</label><input className="input" type="month" value={cardMonth} onChange={(e) => setCardMonth(e.target.value)} onBlur={loadCardData} /></div>
            <button className="btn-primary" onClick={loadCardData}>عرض</button>
            <button className="btn-soft" onClick={printCard} disabled={!cardEmployeeId}>طباعة الكارت</button>
          </div>

          {cardEmployee && (
            <div className="print-card card p-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-slate-800 pb-3 mb-3">
                <div>
                  <div className="text-xs text-slate-500">كارت حضور وانصراف — {cardMonth}</div>
                  <div className="text-2xl font-extrabold text-slate-800">{cardEmployee.name}</div>
                  <div className="text-xs text-slate-500">كود: {cardEmployee.code ?? '—'} · المسمى: {cardEmployee.jobTitle ?? '—'} · الهاتف: {cardEmployee.phone ?? '—'}</div>
                </div>
                <div className="text-left text-xs leading-6">
                  <div>الراتب الأساسي: <b>{formatMoney(cardEmployee.basicSalary ?? 0)}</b></div>
                  <div>البدلات: <b>{formatMoney(cardEmployee.allowances ?? 0)}</b></div>
                  <div>تاريخ التعيين: <b>{cardEmployee.hireDate ? String(cardEmployee.hireDate).slice(0, 10) : '—'}</b></div>
                </div>
              </div>
              <table className="table w-full text-center text-[11px]">
                <thead><tr>{cardDays.map((d) => <th key={d} className="font-bold">{d}</th>)}</tr></thead>
                <tbody>
                  <tr>
                    {cardDays.map((d) => {
                      const date = `${cardMonth}-${String(d).padStart(2, '0')}`;
                      const row = cardRowsByDate.get(date);
                      const st = row ? Number(row.status) : 0;
                      return (
                        <td key={d} className={`align-top border border-slate-200 ${st === 2 ? 'bg-rose-50' : st === 3 ? 'bg-amber-50' : st === 1 ? 'bg-emerald-50' : ''}`}>
                          {row ? (
                            <div className="leading-4 py-0.5">
                              <div dir="ltr" className="font-bold">{row.checkIn ? String(row.checkIn).slice(11, 16) : '—'}</div>
                              <div dir="ltr" className="text-slate-500">{row.checkOut ? String(row.checkOut).slice(11, 16) : '—'}</div>
                              {Number(row.lateMinutes) > 0 && <div className="text-rose-600 text-[9px]">تأخير {row.lateMinutes}د</div>}
                              {Number(row.overtimeMinutes) > 0 && <div className="text-emerald-700 text-[9px]">+{row.overtimeMinutes}د</div>}
                            </div>
                          ) : <div className="text-slate-300">·</div>}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
              <div className="flex flex-wrap gap-4 mt-3 text-xs">
                {(() => {
                  const present = cardRows.filter((r: any) => Number(r.status) === 1).length;
                  const absent = cardRows.filter((r: any) => Number(r.status) === 2).length;
                  const leave = cardRows.filter((r: any) => Number(r.status) === 3).length;
                  const late = cardRows.reduce((s: number, r: any) => s + Number(r.lateMinutes ?? 0), 0);
                  const ot = cardRows.reduce((s: number, r: any) => s + Number(r.overtimeMinutes ?? 0), 0);
                  return (<>
                    <span>حضور: <b className="text-emerald-700">{present} يوم</b></span>
                    <span>غياب: <b className="text-rose-600">{absent} يوم</b></span>
                    <span>إجازة: <b>{leave} يوم</b></span>
                    <span>تأخير: <b>{late} دقيقة</b></span>
                    <span>إضافي: <b>{ot} دقيقة</b></span>
                  </>);
                })()}
              </div>
            </div>
          )}
          {!cardEmployee && <div className="card p-6 text-center text-slate-400">اختر موظفًا وشهرًا لعرض الكارت</div>}
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
