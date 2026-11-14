'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

const STAGES = [
  { id: 0, label: 'الكل' },
  { id: 1, label: 'جديد' },
  { id: 2, label: 'تم التواصل' },
  { id: 3, label: 'مؤهل' },
  { id: 4, label: 'عرض سعر' },
  { id: 5, label: 'مكسوب' },
  { id: 6, label: 'خاسر' },
];
const ACT_TYPES = { 1: 'مكالمة', 2: 'اجتماع', 3: 'ملاحظة', 4: 'مهمة' } as Record<number, string>;
const TICKET_STATUS = { 1: 'مفتوحة', 2: 'قيد المعالجة', 3: 'تم الحل', 4: 'مغلقة' } as Record<number, string>;
const PRIORITY = { 1: 'منخفضة', 2: 'متوسطة', 3: 'عالية' } as Record<number, string>;

export default function CrmPage() {
  const { can } = useSession();
  const canManage = can('crm.manage');
  const [tab, setTab] = useState<'leads' | 'tickets' | 'sources'>('leads');
  const [summary, setSummary] = useState<any>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [stage, setStage] = useState(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [leadForm, setLeadForm] = useState({ name: '', company: '', phone: '', email: '', sourceId: '', expectedValue: '', notes: '' });
  const [activityForm, setActivityForm] = useState({ activityType: 1, subject: '', notes: '', dueAt: '' });
  const [ticketForm, setTicketForm] = useState({ subject: '', description: '', priority: 2, leadId: '', partyId: '' });
  const [sourceName, setSourceName] = useState('');

  async function loadSummary() { setSummary(await apiFetch('/crm/summary')); }
  async function loadLeads() {
    const qs = new URLSearchParams();
    if (stage) qs.set('stage', String(stage));
    if (search.trim()) qs.set('search', search.trim());
    setLeads(await apiFetch(`/crm/leads${qs.toString() ? `?${qs}` : ''}`));
  }
  async function loadTickets() { setTickets(await apiFetch('/crm/tickets')); }
  async function loadSources() { setSources(await apiFetch('/crm/sources')); }
  async function openLead(id: number) { setSelected(await apiFetch(`/crm/leads/${id}`)); }

  async function refresh() {
    await Promise.all([loadSummary(), loadLeads(), loadTickets(), loadSources()]);
    if (selected?.leadId) {
      try { setSelected(await apiFetch(`/crm/leads/${selected.leadId}`)); } catch { setSelected(null); }
    }
  }

  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [stage]);

  async function createLead() {
    setError(''); setMessage('');
    try {
      await apiFetch('/crm/leads', { method: 'POST', body: JSON.stringify({ ...leadForm, sourceId: leadForm.sourceId ? Number(leadForm.sourceId) : null, expectedValue: Number(leadForm.expectedValue || 0) }) });
      setLeadForm({ name: '', company: '', phone: '', email: '', sourceId: '', expectedValue: '', notes: '' });
      setMessage('تمت إضافة العميل المحتمل');
      await refresh();
    } catch (e: any) { setError(e.message); }
  }

  async function updateStage(id: number, newStage: number) {
    try { await apiFetch(`/crm/leads/${id}`, { method: 'PUT', body: JSON.stringify({ stage: newStage }) }); await refresh(); } catch (e: any) { setError(e.message); }
  }

  async function convertLead(id: number) {
    if (!confirm('تحويل العميل المحتمل إلى عميل فعلي؟')) return;
    try { const r: any = await apiFetch(`/crm/leads/${id}/convert`, { method: 'POST' }); setMessage(`تم التحويل إلى عميل: ${r.partyName}`); await refresh(); } catch (e: any) { setError(e.message); }
  }

  async function deleteLead(id: number) {
    if (!confirm('حذف العميل المحتمل وكل أنشطته؟')) return;
    try { await apiFetch(`/crm/leads/${id}`, { method: 'DELETE' }); setSelected(null); await refresh(); } catch (e: any) { setError(e.message); }
  }

  async function addActivity() {
    if (!selected) return;
    setError('');
    try {
      await apiFetch(`/crm/leads/${selected.leadId}/activities`, { method: 'POST', body: JSON.stringify({ ...activityForm, dueAt: activityForm.dueAt || null }) });
      setActivityForm({ activityType: 1, subject: '', notes: '', dueAt: '' });
      await openLead(selected.leadId);
      await loadSummary();
    } catch (e: any) { setError(e.message); }
  }

  async function toggleActivity(id: number, isDone: boolean) {
    try { await apiFetch(`/crm/activities/${id}/done`, { method: 'PUT', body: JSON.stringify({ isDone }) }); if (selected) await openLead(selected.leadId); await loadSummary(); } catch (e: any) { setError(e.message); }
  }

  async function createTicket() {
    setError('');
    try {
      await apiFetch('/crm/tickets', { method: 'POST', body: JSON.stringify({ ...ticketForm, priority: Number(ticketForm.priority), leadId: ticketForm.leadId ? Number(ticketForm.leadId) : null, partyId: ticketForm.partyId ? Number(ticketForm.partyId) : null }) });
      setTicketForm({ subject: '', description: '', priority: 2, leadId: '', partyId: '' });
      setMessage('تم إنشاء التذكرة');
      await loadTickets(); await loadSummary();
    } catch (e: any) { setError(e.message); }
  }

  async function updateTicketStatus(id: number, status: number) {
    try { await apiFetch(`/crm/tickets/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }); await loadTickets(); await loadSummary(); } catch (e: any) { setError(e.message); }
  }

  async function createSource() {
    if (!sourceName.trim()) return;
    try { await apiFetch('/crm/sources', { method: 'POST', body: JSON.stringify({ name: sourceName.trim() }) }); setSourceName(''); await loadSources(); } catch (e: any) { setError(e.message); }
  }

  return (
    <AppShell title="إدارة العملاء CRM">
      <div className="space-y-4">
        {error && <div className="text-red-600 text-sm">{error}</div>}
        {message && <div className="text-green-700 text-sm">{message}</div>}

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card p-3"><div className="text-xs text-slate-500">إجمالي العملاء المحتملين</div><div className="text-xl font-bold">{(summary.byStage ?? []).reduce((s: number, r: any) => s + Number(r.count || 0), 0)}</div></div>
            <div className="card p-3"><div className="text-xs text-slate-500">القيمة المتوقعة</div><div className="text-xl font-bold">{formatMoney((summary.byStage ?? []).reduce((s: number, r: any) => s + Number(r.value || 0), 0))}</div></div>
            <div className="card p-3"><div className="text-xs text-slate-500">تذاكر مفتوحة</div><div className="text-xl font-bold">{summary.openTickets ?? 0}</div></div>
            <div className="card p-3"><div className="text-xs text-slate-500">أنشطة مستحقة (7 أيام)</div><div className="text-xl font-bold">{summary.dueActivities ?? 0}</div></div>
          </div>
        )}

        <div className="flex gap-2">
          {[['leads','العملاء المحتملون'],['tickets','التذاكر'],['sources','المصادر']].map(([k,l]) => (
            <button key={k} className={tab===k ? 'btn-primary' : 'btn-soft'} onClick={() => setTab(k as any)}>{l}</button>
          ))}
        </div>

        {tab === 'leads' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-3">
              <div className="card p-3 flex flex-wrap gap-2 items-center">
                <select className="input w-40" value={stage} onChange={(e) => setStage(Number(e.target.value))}>
                  {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <input className="input flex-1 min-w-40" placeholder="بحث بالاسم/الهاتف/الشركة" value={search} onChange={(e) => setSearch(e.target.value)} />
                <button className="btn-soft" onClick={() => loadLeads().catch((e)=>setError(e.message))}>بحث</button>
              </div>

              {canManage && (
                <div className="card p-3 space-y-2">
                  <div className="font-semibold">عميل محتمل جديد</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <input className="input" placeholder="الاسم *" value={leadForm.name} onChange={(e)=>setLeadForm({...leadForm,name:e.target.value})} />
                    <input className="input" placeholder="الشركة" value={leadForm.company} onChange={(e)=>setLeadForm({...leadForm,company:e.target.value})} />
                    <input className="input" placeholder="الهاتف" value={leadForm.phone} onChange={(e)=>setLeadForm({...leadForm,phone:e.target.value})} />
                    <input className="input" placeholder="البريد" value={leadForm.email} onChange={(e)=>setLeadForm({...leadForm,email:e.target.value})} />
                    <select className="input" value={leadForm.sourceId} onChange={(e)=>setLeadForm({...leadForm,sourceId:e.target.value})}>
                      <option value="">المصدر</option>
                      {sources.map((s:any)=><option key={s.sourceId} value={s.sourceId}>{s.name}</option>)}
                    </select>
                    <input className="input" placeholder="قيمة متوقعة" type="number" value={leadForm.expectedValue} onChange={(e)=>setLeadForm({...leadForm,expectedValue:e.target.value})} />
                  </div>
                  <textarea className="input w-full" placeholder="ملاحظات" value={leadForm.notes} onChange={(e)=>setLeadForm({...leadForm,notes:e.target.value})} />
                  <button className="btn-primary" onClick={createLead}>إضافة</button>
                </div>
              )}

              <div className="card table-wrap">
                <table className="table">
                  <thead><tr><th>الاسم</th><th>الهاتف</th><th>المصدر</th><th>المرحلة</th><th>القيمة</th><th></th></tr></thead>
                  <tbody>
                    {leads.map((l:any)=>(
                      <tr key={l.leadId} className={selected?.leadId===l.leadId?'bg-blue-50':''}>
                        <td className="font-medium">{l.name}{l.company ? <div className="text-xs text-slate-500">{l.company}</div> : null}</td>
                        <td>{l.phone || '-'}</td>
                        <td>{l.sourceName || '-'}</td>
                        <td>{STAGES.find(s=>s.id===l.stage)?.label || l.stage}</td>
                        <td>{formatMoney(Number(l.expectedValue||0))}</td>
                        <td className="space-x-1 space-x-reverse">
                          <button className="text-blue-700 text-xs" onClick={()=>openLead(l.leadId)}>تفاصيل</button>
                        </td>
                      </tr>
                    ))}
                    {leads.length===0 && <tr><td colSpan={6} className="text-center text-slate-400 py-6">لا يوجد عملاء محتملون</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3">
              {!selected && <div className="card p-4 text-slate-500 text-sm">اختر عميلاً محتملاً لعرض التفاصيل والأنشطة.</div>}
              {selected && (
                <>
                  <div className="card p-3 space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-lg">{selected.name}</div>
                        <div className="text-sm text-slate-600">{selected.company || ''} {selected.phone ? `· ${selected.phone}` : ''}</div>
                        {selected.partyId && <div className="text-xs text-green-700 mt-1">تم التحويل إلى عميل #{selected.partyId} {selected.partyName ? `(${selected.partyName})` : ''}</div>}
                      </div>
                      <button className="text-xs text-slate-500" onClick={()=>setSelected(null)}>إغلاق</button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {STAGES.filter(s=>s.id>0).map(s=>(
                        <button key={s.id} disabled={!canManage} className={`text-xs px-2 py-1 rounded border ${selected.stage===s.id?'bg-blue-600 text-white border-blue-600':''}`} onClick={()=>updateStage(selected.leadId,s.id)}>{s.label}</button>
                      ))}
                    </div>
                    {canManage && <div className="flex gap-2 pt-1">
                      {!selected.partyId && <button className="btn-soft text-xs" onClick={()=>convertLead(selected.leadId)}>تحويل إلى عميل</button>}
                      <button className="text-red-600 text-xs" onClick={()=>deleteLead(selected.leadId)}>حذف</button>
                    </div>}
                  </div>

                  <div className="card p-3 space-y-2">
                    <div className="font-semibold">الأنشطة</div>
                    {canManage && (
                      <div className="space-y-1 border-b pb-2">
                        <div className="flex gap-1">
                          <select className="input text-sm" value={activityForm.activityType} onChange={(e)=>setActivityForm({...activityForm,activityType:Number(e.target.value)})}>
                            {Object.entries(ACT_TYPES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                          </select>
                          <input type="datetime-local" className="input text-sm" value={activityForm.dueAt} onChange={(e)=>setActivityForm({...activityForm,dueAt:e.target.value})} />
                        </div>
                        <input className="input w-full text-sm" placeholder="الموضوع *" value={activityForm.subject} onChange={(e)=>setActivityForm({...activityForm,subject:e.target.value})} />
                        <button className="btn-soft text-xs" onClick={addActivity}>إضافة نشاط</button>
                      </div>
                    )}
                    <div className="space-y-2 max-h-80 overflow-auto">
                      {(selected.activities||[]).map((a:any)=>(
                        <div key={a.activityId} className={`text-sm border rounded p-2 ${a.isDone?'opacity-60':''}`}>
                          <div className="flex justify-between"><span className="font-medium">{ACT_TYPES[a.activityType]||'نشاط'}: {a.subject}</span>
                            {canManage && <button className="text-xs text-blue-700" onClick={()=>toggleActivity(a.activityId,!a.isDone)}>{a.isDone?'إلغاء':'تم'}</button>}
                          </div>
                          {a.dueAt && <div className="text-xs text-slate-500">موعد: {formatDate(a.dueAt)}</div>}
                          {a.notes && <div className="text-xs mt-1">{a.notes}</div>}
                        </div>
                      ))}
                      {(!selected.activities || selected.activities.length===0) && <div className="text-xs text-slate-400">لا توجد أنشطة</div>}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === 'tickets' && (
          <div className="space-y-3">
            {canManage && (
              <div className="card p-3 space-y-2">
                <div className="font-semibold">تذكرة جديدة</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input className="input" placeholder="الموضوع *" value={ticketForm.subject} onChange={(e)=>setTicketForm({...ticketForm,subject:e.target.value})} />
                  <select className="input" value={ticketForm.priority} onChange={(e)=>setTicketForm({...ticketForm,priority:Number(e.target.value)})}>
                    <option value={1}>منخفضة</option><option value={2}>متوسطة</option><option value={3}>عالية</option>
                  </select>
                  <input className="input" placeholder="رقم عميل محتمل (اختياري)" value={ticketForm.leadId} onChange={(e)=>setTicketForm({...ticketForm,leadId:e.target.value})} />
                </div>
                <textarea className="input w-full" placeholder="الوصف" value={ticketForm.description} onChange={(e)=>setTicketForm({...ticketForm,description:e.target.value})} />
                <button className="btn-primary" onClick={createTicket}>إنشاء تذكرة</button>
              </div>
            )}
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>#</th><th>الموضوع</th><th>الحالة</th><th>الأولوية</th><th>مرتبط بـ</th><th>التاريخ</th><th></th></tr></thead>
                <tbody>
                  {tickets.map((t:any)=>(
                    <tr key={t.ticketId}>
                      <td>{t.ticketId}</td>
                      <td>{t.subject}</td>
                      <td>{TICKET_STATUS[t.status]||t.status}</td>
                      <td>{PRIORITY[t.priority]||t.priority}</td>
                      <td>{t.leadName ? `عميل محتمل: ${t.leadName}` : t.partyName ? `عميل: ${t.partyName}` : '-'}</td>
                      <td>{formatDate(t.createdAt)}</td>
                      <td>
                        {canManage && (
                          <select className="input text-xs w-32" value={t.status} onChange={(e)=>updateTicketStatus(t.ticketId, Number(e.target.value))}>
                            {Object.entries(TICKET_STATUS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                  {tickets.length===0 && <tr><td colSpan={7} className="text-center text-slate-400 py-6">لا توجد تذاكر</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'sources' && (
          <div className="card p-4 space-y-3">
            {canManage && (
              <div className="flex gap-2">
                <input className="input" placeholder="اسم مصدر جديد" value={sourceName} onChange={(e)=>setSourceName(e.target.value)} />
                <button className="btn-primary" onClick={createSource}>إضافة</button>
              </div>
            )}
            <ul className="space-y-1">
              {sources.map((s:any)=>(<li key={s.sourceId} className="border rounded px-3 py-2 flex justify-between"><span>{s.name}</span><span className="text-xs text-slate-500">{s.isActive ? 'نشط' : 'غير نشط'}</span></li>))}
            </ul>
          </div>
        )}
      </div>
    </AppShell>
  );
}
