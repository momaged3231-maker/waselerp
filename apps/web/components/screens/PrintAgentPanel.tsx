'use client';

import { useEffect, useState } from 'react';
import { agentHealth, getAgentConfig, listPrinters, openDrawer, saveAgentConfig, testPrint } from '@/lib/print';

/** Print agent panel — printer defaults on THIS device (per-station, mirrors «اعدادات الطابعه» in Ezees). */
export default function PrintAgentPanel() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [version, setVersion] = useState('');
  const [config, setConfig] = useState<any>(null);
  const [printers, setPrinters] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [netName, setNetName] = useState('');
  const [netHost, setNetHost] = useState('');
  const [netPort, setNetPort] = useState('9100');
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState('');

  async function refresh() {
    setError('');
    const health = await agentHealth();
    setOnline(!!health?.ok);
    setVersion(health?.version ?? '');
    if (health?.ok) {
      const [cfg, printers] = await Promise.all([
        getAgentConfig().catch(() => null),
        listPrinters().catch(() => []),
      ]);
      setConfig(cfg ?? { defaultPrinter: '', autoOpenDrawer: true, paperWidth: 42, networkPrinters: [] });
      setPrinters(printers);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!config) return;
    setBusy(true);
    setError('');
    try {
      await saveAgentConfig(config);
      const fresh = await getAgentConfig().catch(() => config);
      setConfig(fresh ?? config);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حفظ إعدادات الوكيل');
    } finally {
      setBusy(false);
    }
  }

  function addNetworkPrinter() {
    setError('');
    if (!netHost.trim()) { setError('اكتب عنوان الطابعة الشبكية'); return; }
    setConfig({
      ...config,
      networkPrinters: [
        ...(config?.networkPrinters ?? []),
        { type: 'network', name: netName.trim() || netHost.trim(), host: netHost.trim(), port: Number(netPort) || 9100 },
      ],
    });
    setNetName('');
    setNetHost('');
    setNetPort('9100');
  }

  async function runTest(printer: any, key: string) {
    setTestingKey(key);
    setTestMsg('');
    try {
      await testPrint(printer);
      setTestMsg(`✓ طباعة اختبار ناجحة — ${printer?.name ?? printer?.host ?? ''}`);
    } catch (err: any) {
      setTestMsg(`✗ ${err?.message ?? 'فشل الاختبار'}`);
    } finally {
      setTestingKey(null);
    }
  }

  function removeNetworkPrinter(index: number) {
    const next = [...(config?.networkPrinters ?? [])];
    next.splice(index, 1);
    setConfig({ ...config, networkPrinters: next });
  }

  const printerOptions = [
    ...printers.map((p: any) => ({
      value: p.name ?? p.host,
      label: `${p.name ?? p.host}${p.type === 'network' ? ' (شبكة)' : ' (Windows)'}`,
    })),
    ...(config?.networkPrinters ?? []).map((p: any) => ({
      value: p.name,
      label: `${p.name} (مواصفة شبكية)`,
    })),
  ];

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-bold text-slate-800">وكيل الطباعة — على هذا الجهاز فقط</div>
          <div className="text-xs text-slate-500 mt-0.5">طابعة الكاشير ودرج النقود — مشابهة لتبويب «اعدادات الطابعه» في Ezees (تُحفظ للجهاز الحالي، وتُضبط على كل محطة طباعة على حدة)</div>
        </div>
        <span className={`badge ${online ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {online === null ? 'جارٍ الفحص…' : online ? `وكيل متصل${version ? ` · v${version}` : ''}` : 'وكيل غير متصل'}
        </span>
      </div>

      {online === false && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 mt-4">
          وكيل الطباعة غير يعمل — للتشغيل:
          <code dir="ltr" className="block bg-amber-100 text-amber-900 px-3 py-2 rounded-lg mt-2 font-mono text-xs">cd apps\print-agent && npm install && node server.js</code>
          يعمل على <code dir="ltr" className="bg-amber-100 px-1 py-0.5 rounded">http://127.0.0.1:4100</code>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <div>
          <label className="label">الطابعة الافتراضية</label>
          <input
            className="input"
            list="wasel-printers"
            disabled={!online}
            value={config?.defaultPrinter ?? ''}
            onChange={(e) => setConfig({ ...config, defaultPrinter: e.target.value })}
            placeholder="اختر من القائمة أو اكتب اسم الطابعة"
          />
          <datalist id="wasel-printers">
            {printerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </datalist>
          <div className="text-[11px] text-slate-500 mt-1">تُستخدم للإيصالات وأذون المخزن ما لم تُحدد طابعة أخرى.</div>
        </div>

        <div>
          <label className="label">مقاس الإيصال الحراري</label>
          <div className="grid grid-cols-2 gap-2">
            {[{ value: 42, label: '80 ملم' }, { value: 32, label: '58 ملم' }].map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!online}
                onClick={() => setConfig({ ...config, paperWidth: option.value })}
                className={`py-2 rounded-xl text-sm font-bold transition disabled:opacity-50 ${
                  Number(config?.paperWidth ?? 42) === option.value
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4 sm:col-span-2 cursor-pointer hover:border-slate-300">
          <span>
            <span className="block text-sm font-bold text-slate-700">فتح درج النقود تلقائيًا بعد الطباعة</span>
            <span className="block text-xs text-slate-500 mt-1">يرسل ESC/POS لفتح الدرج بعد كل إيصال مطبوع (مشابه لـ autoOpenDrawer)</span>
          </span>
          <input
            type="checkbox"
            className="w-5 h-5 accent-brand-600 shrink-0"
            disabled={!online}
            checked={!!config?.autoOpenDrawer}
            onChange={() => setConfig({ ...config, autoOpenDrawer: !config?.autoOpenDrawer })}
          />
        </label>
      </div>

      <div className="mt-4">
        <label className="label">طابعات Windows المكتشفة</label>
        <div className="text-[11px] text-slate-500 mb-2">يتم كشفها تلقائيًا من جهاز Windows (USB/شبكة/مشاركة). اضغط «اختبار طباعة» للتأكد من عمل الطابعة.</div>
        <div className="space-y-2">
          {printers.length === 0 && (
            <div className="text-xs text-slate-400">لا توجد طابعات مكتشفة (أو الوكيل غير متصل)</div>
          )}
          {printers.map((p: any, index: number) => (
            <div key={`win-${p.name}-${index}`} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <b>{p.name}</b>
                {p.driver && <span className="text-slate-400 text-xs"> — {p.driver}</span>}
                {p.port && <span className="text-slate-400 text-xs"> ({p.port})</span>}
              </span>
              <button
                type="button"
                className="btn-soft text-xs"
                disabled={!online || testingKey === `win-${index}`}
                onClick={() => runTest({ type: 'windows', name: p.name }, `win-${index}`)}
              >
                {testingKey === `win-${index}` ? 'جارٍ…' : 'اختبار طباعة'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <label className="label">طابعات الشبكة (TCP 9100)</label>
        <div className="space-y-2 mt-1">
          {(config?.networkPrinters ?? []).map((p: any, index: number) => (
            <div key={`${p.host}:${p.port}:${index}`} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1"><b>{p.name}</b> — <span dir="ltr" className="text-slate-500">{p.host}:{p.port}</span></span>
              <button type="button" className="btn-soft text-xs" disabled={!online || testingKey === `net-${index}`} onClick={() => runTest(p, `net-${index}`)}>
                {testingKey === `net-${index}` ? 'جارٍ…' : 'اختبار طباعة'}
              </button>
              <button type="button" className="w-8 h-8 rounded-lg text-rose-500 hover:bg-rose-50 flex items-center justify-center" onClick={() => removeNetworkPrinter(index)} aria-label="حذف">×</button>
            </div>
          ))}
          {(config?.networkPrinters ?? []).length === 0 && (
            <div className="text-xs text-slate-400">لا توجد طابعات شبكية مُعرّفة</div>
          )}
        </div>
        <div className="grid grid-cols-[1fr_1fr_80px_auto] gap-2 mt-2">
          <input className="input" disabled={!online} placeholder="اسم الطابعة" value={netName} onChange={(e) => setNetName(e.target.value)} />
          <input className="input" disabled={!online} dir="ltr" placeholder="العنوان 192.168.1.50" value={netHost} onChange={(e) => setNetHost(e.target.value)} />
          <input className="input" disabled={!online} dir="ltr" type="number" value={netPort} onChange={(e) => setNetPort(e.target.value)} />
          <button type="button" className="btn-soft" disabled={!online} onClick={addNetworkPrinter}>إضافة</button>
        </div>
      </div>

      {testMsg && (
        <div className={`mt-3 text-xs font-bold ${testMsg.startsWith('✓') ? 'text-emerald-600' : 'text-rose-600'}`}>{testMsg}</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mt-5 border-t border-slate-100 pt-4">
        <button className="btn-soft text-xs" disabled={!online} onClick={() => openDrawer().catch(() => {})}>اختبار درج الكاشير</button>
        <div className="flex items-center gap-2">
          {saved && <span className="badge bg-emerald-50 text-emerald-700">✓ تم الحفظ على هذا الجهاز</span>}
          {error && <span className="text-xs text-rose-600">{error}</span>}
          <button className="btn-primary" onClick={save} disabled={!online || busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ إعدادات الوكيل'}</button>
        </div>
      </div>
    </div>
  );
}
