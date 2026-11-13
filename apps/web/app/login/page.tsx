'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const { adopt } = useSession();
  const [userName, setUserName] = useState('admin');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'credentials' | 'branch'>('credentials');
  const [auth, setAuth] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await apiFetch<any>('/auth/login', {
        method: 'POST',
        body: { userName, password },
      });
      if ((result.branches?.length ?? 0) > 1) {
        setAuth(result);
        setStep('branch');
      } else {
        adopt(result, result.activeBranchId);
        router.push('/');
      }
    } catch (err: any) {
      setError(err?.message ?? 'تعذر تسجيل الدخول');
    } finally {
      setBusy(false);
    }
  }

  function submitBranch(branchId: number) {
    adopt(auth, branchId);
    router.push('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-3xl font-extrabold text-white">واصل <span className="text-brand-400">ERP</span></div>
          <p className="text-slate-400 text-sm mt-1">نظام إدارة المبيعات والمخزون والفروع</p>
        </div>

        <div className="card p-6">
          {step === 'credentials' ? (
            <form onSubmit={submitCredentials} className="space-y-4">
              <div>
                <label className="label">اسم المستخدم</label>
                <input
                  className="input"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  autoComplete="username"
                  required
                  dir="ltr"
                />
              </div>
              <div>
                <label className="label">كلمة المرور</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  dir="ltr"
                />
              </div>

              {error && (
                <div className="rounded-xl bg-rose-50 text-rose-700 text-sm px-4 py-3 border border-rose-200">
                  {error}
                </div>
              )}

              <button className="btn-primary w-full" disabled={busy}>
                {busy ? 'جارٍ الدخول…' : 'تسجيل الدخول'}
              </button>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 font-semibold">اختر الفرع الذي تريد العمل عليه</p>
              {auth.branches.map((branch: any) => (
                <button
                  key={branch.branchId}
                  onClick={() => submitBranch(branch.branchId)}
                  className="w-full text-right card px-4 py-3 hover:border-brand-400 transition flex items-center justify-between"
                >
                  <span className="font-semibold">{branch.name}</span>
                  <span className="text-xs text-slate-400">{branch.code}</span>
                </button>
              ))}
              <button className="btn-soft w-full" onClick={() => setStep('credentials')}>رجوع</button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-500 mt-5">
          © {new Date().getFullYear()} WaselERP — جميع الحقوق محفوظة
        </p>
      </div>
    </div>
  );
}
