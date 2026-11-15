'use client';

import { useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';

/** Full backup / restore of the whole database (download JSON, upload with confirmation + audit). */
export default function BackupScreen() {
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNote, setBackupNote] = useState('');
  const restoreInputRef = useRef<HTMLInputElement>(null);

  async function downloadBackup() {
    setBackupBusy(true);
    setBackupNote('');
    try {
      const data = await apiFetch<any>('/admin/backup');
      const json = JSON.stringify(data);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      anchor.href = url;
      anchor.download = `wasel-backup-${stamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      const meta = data?.meta;
      const kb = Math.max(1, Math.round(blob.size / 1024));
      setBackupNote(meta
        ? `تم تنزيل النسخة الاحتياطية: ${meta.tables} جدول، ${meta.rows.toLocaleString('ar-EG')} سطر، ${kb.toLocaleString('ar-EG')} كيلوبايت`
        : 'تم تنزيل النسخة الاحتياطية بنجاح');
    } catch (err: any) {
      setBackupNote(err?.message ?? 'تعذر إنشاء النسخة');
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBackupBusy(true);
    setBackupNote('');
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const confirmed = window.confirm(
        'سيتم استبدال كل بيانات قاعدة البيانات بالنسخة المرفوعة — هذا الإجراء لا يمكن التراجع عنه. هل أنت متأكد؟',
      );
      if (!confirmed) return;
      const result = await apiFetch<any>('/admin/backup/restore', { method: 'POST', body: payload });
      const skipped: string[] = Array.isArray(result?.skipped) ? result.skipped : [];
      setBackupNote(
        `تمت الاستعادة: ${result?.tables ?? 0} جدول، ${(Number(result?.rows) || 0).toLocaleString('ar-EG')} سطر`
        + (skipped.length ? ` — تم تجاهل ${skipped.length} جدول غير معروف (${skipped.slice(0, 5).join('، ')})` : ''),
      );
    } catch (err: any) {
      setBackupNote(err?.message ?? 'تعذر الاستعادة — تأكد أن الملف نسخة احتياطية صالحة');
    } finally {
      setBackupBusy(false);
      if (restoreInputRef.current) restoreInputRef.current.value = '';
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card p-5 border-amber-300 bg-amber-50">
        <div className="font-extrabold text-amber-900 inline-flex items-center gap-2">
          <span aria-hidden="true">⚠</span> قبل أي عملية استعادة
        </div>
        <p className="text-xs text-amber-900 mt-2 leading-6">
          الاستعادة تستبدل كل جداول قاعدة البيانات بالكامل (مسح كامل ثم إعادة إدخال من الملف).
          نزّل نسخة جديدة قبل الاستعادة، وتأكد أن الجهاز الهدف هو نفسه بيئة الإنتاج. تُسجَّل العملية في سجل العمليات.
        </p>
        <p className="text-xs text-amber-800 mt-2 leading-6 font-semibold">
          الضوابط المطبقة: يُرفض أي ملف ليس نسخة من هذا النظام (إصدار غير معروف) أو ملف فارغ بلا جداول،
          والجداول غير المعروفة في الملف تُتجاهل دون إيقاف الاستعادة.
        </p>
      </div>

      <div className="card p-6 space-y-3">
        <div className="font-bold text-slate-800">تنزيل نسخة احتياطية كاملة</div>
        <div className="text-xs text-slate-500 leading-6">
          ملف JSON واحد يحتوي كل الجداول (المبيعات، المخزون، الخزينة، القيود المحاسبية…) مع بيانات وصفية:
          تاريخ الإنشاء وعدد الجداول والسطور. مناسب للأرشفة قبل أي تحديث كبير.
        </div>
        <button className="btn-primary" onClick={downloadBackup} disabled={backupBusy}>
          {backupBusy ? 'جارٍ إنشاء النسخة…' : 'تنزيل النسخة الآن'}
        </button>
      </div>

      <div className="card p-6 space-y-3">
        <div className="font-bold text-rose-700">استعادة من نسخة احتياطية</div>
        <div className="text-xs text-slate-500 leading-6">
          اختر ملف JSON تم تنزيله من هذا الزر نفسه. بعد التأكيد ستُستبدل كل البيانات الحالية،
          وتظهر بعدها ملخصًا بعدد الجداول والسطور المستعادة (وأي جداول تجُاهلت).
        </div>
        <label className={`btn-danger inline-flex ${backupBusy ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}>
          {backupBusy ? 'جارٍ التنفيذ…' : 'اختيار ملف النسخة للاستعادة…'}
          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={restoreBackup}
          />
        </label>
      </div>

      {backupNote && (
        <div className={`rounded-xl text-sm px-4 py-3 border ${backupNote.includes('تعذر') ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}>
          {backupNote}
        </div>
      )}
    </div>
  );
}
