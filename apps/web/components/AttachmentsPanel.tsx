'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { IconFolder, IconBox } from '@/components/icons';

const MAX_BYTES = 5 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string): string {
  try {
    return new Date(value).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return value;
  }
}

export default function AttachmentsPanel({
  entityType,
  entityId,
  compact = false,
}: {
  entityType: string;
  entityId: number;
  compact?: boolean;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const data = await apiFetch<any[]>(
        `/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${entityId}`,
      );
      setRows(Array.isArray(data) ? data : []);
      setError('');
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل المرفقات');
    }
  }

  useEffect(() => {
    if (entityId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  async function onFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('حجم الملف أكبر من 5MB');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
        reader.readAsDataURL(file);
      });
      await apiFetch('/attachments', {
        method: 'POST',
        body: { entityType, entityId, fileName: file.name, mimeType: file.type || null, contentBase64: base64 },
      });
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'تعذر رفع المرفق');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function download(row: any) {
    setError('');
    try {
      const full = await apiFetch<any>(`/attachments/${row.attachmentId}`);
      const binary = window.atob(String(full.contentBase64 ?? ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: row.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = row.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تنزيل المرفق');
    }
  }

  async function remove(row: any) {
    if (!window.confirm(`حذف المرفق «${row.fileName}»؟`)) return;
    setError('');
    try {
      await apiFetch(`/attachments/${row.attachmentId}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'تعذر الحذف');
    }
  }

  return (
    <div className={compact ? '' : 'mt-4 border-t border-dashed border-slate-300 pt-3'}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="text-sm font-bold inline-flex items-center gap-2">
          <IconFolder className="w-4 h-4 text-slate-400" />
          المرفقات {rows.length > 0 ? `(${rows.length})` : ''}
        </div>
        <label className={`btn-soft text-xs ${busy ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}>
          {busy ? 'جارٍ الرفع…' : 'إرفاق ملف'}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={onFilePicked}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
            disabled={busy}
          />
        </label>
      </div>

      {error && <div className="text-xs text-rose-600 mb-2">{error}</div>}

      {rows.length === 0 ? (
        <div className="text-xs text-slate-400">لا توجد مرفقات — أقصى حجم 5MB (صور، PDF، مستندات).</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.attachmentId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
              <IconBox className="w-4 h-4 text-slate-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-700 truncate" title={row.fileName}>{row.fileName}</div>
                <div className="text-[10px] text-slate-400">{formatSize(Number(row.fileSize))} · {formatDateTime(row.createdAt)}</div>
              </div>
              <button className="text-[11px] font-semibold text-brand-700 hover:underline" onClick={() => download(row)}>تنزيل</button>
              <button className="text-[11px] font-semibold text-rose-600 hover:underline" onClick={() => remove(row)}>حذف</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
