'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Reminder {
  reminderId: number;
  title: string;
  description?: string;
  remindAt: string;
  isDone: boolean;
  doneAt?: string;
  createdAt: string;
  createdBy?: string;
}

export default function RemindersPage() {
  const { can } = useSession();
  const [rows, setRows] = useState<Reminder[]>([]);
  const [upcoming, setUpcoming] = useState<Reminder[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ title: '', description: '', remindAt: '' });
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');

  async function load() {
    const doneParam = filter === 'all' ? '' : filter === 'done' ? 'true' : 'false';
    const qs = doneParam ? `?done=${doneParam}` : '';
    const [list, up] = await Promise.all([
      apiFetch<Reminder[]>(`/reminders${qs}`),
      apiFetch<Reminder[]>('/reminders/upcoming'),
    ]);
    setRows(list);
    setUpcoming(up);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, [filter]);

  async function create() {
    setError(''); setMessage('');
    if (!form.title.trim() || !form.remindAt) { setError('العنوان والوقت مطلوبان'); return; }
    try {
      await apiFetch('/reminders', { method: 'POST', body: JSON.stringify(form) });
      setMessage('تم إنشاء التذكير');
      setForm({ title: '', description: '', remindAt: '' });
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function toggleDone(r: Reminder) {
    setError(''); setMessage('');
    try {
      await apiFetch(`/reminders/${r.reminderId}/done`, { method: 'PUT', body: JSON.stringify({ isDone: !r.isDone }) });
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function remove(r: Reminder) {
    if (!confirm('حذف التذكير؟')) return;
    setError(''); setMessage('');
    try {
      await apiFetch(`/reminders/${r.reminderId}`, { method: 'DELETE' });
      setMessage('تم الحذف');
      await load();
    } catch (e: any) { setError(e.message); }
  }

  const canManage = can('settings.manage');

  return (
    <AppShell>
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-bold">التذكيرات</h1>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        {message && <div className="text-green-600 text-sm">{message}</div>}

        {upcoming.length > 0 && (
          <div className="border rounded p-3 bg-yellow-50">
            <h2 className="font-semibold mb-2">تذكيرات قادمة (7 أيام)</h2>
            <ul className="space-y-1">
              {upcoming.map((r) => (
                <li key={r.reminderId} className="flex justify-between items-center text-sm">
                  <span>{r.title} — {formatDate(r.remindAt)}</span>
                  <button className="text-blue-600 text-xs" onClick={() => toggleDone(r)}>تم</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canManage && (
          <div className="border rounded p-3 space-y-2">
            <h2 className="font-semibold">تذكير جديد</h2>
            <input className="border rounded px-2 py-1 w-full" placeholder="العنوان" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <textarea className="border rounded px-2 py-1 w-full" placeholder="الوصف" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <input type="datetime-local" className="border rounded px-2 py-1" value={form.remindAt} onChange={(e) => setForm({ ...form, remindAt: e.target.value })} />
            <button className="bg-blue-600 text-white px-3 py-1 rounded text-sm" onClick={create}>حفظ</button>
          </div>
        )}

        <div className="flex gap-2">
          {(['all', 'pending', 'done'] as const).map((f) => (
            <button key={f} className={`px-3 py-1 rounded text-sm border ${filter === f ? 'bg-blue-600 text-white' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'الكل' : f === 'pending' ? 'معلقة' : 'منجزة'}
            </button>
          ))}
        </div>

        <table className="w-full text-sm border">
          <thead>
            <tr className="bg-gray-100">
              <th className="p-2 text-right">العنوان</th>
              <th className="p-2 text-right">الوقت</th>
              <th className="p-2 text-right">الحالة</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.reminderId} className="border-t">
                <td className="p-2">{r.title}</td>
                <td className="p-2">{formatDate(r.remindAt)}</td>
                <td className="p-2">{r.isDone ? '✅ منجز' : '⏳ معلق'}</td>
                <td className="p-2 flex gap-1">
                  <button className="text-blue-600 text-xs" onClick={() => toggleDone(r)}>{r.isDone ? 'إلغاء' : 'تم'}</button>
                  {canManage && <button className="text-red-600 text-xs" onClick={() => remove(r)}>حذف</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}