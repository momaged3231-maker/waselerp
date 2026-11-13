'use client';

const AGENT_BASE = process.env.NEXT_PUBLIC_AGENT_BASE ?? 'http://127.0.0.1:4100';
const AGENT_TOKEN = process.env.NEXT_PUBLIC_AGENT_TOKEN ?? 'wasel-local-agent';

async function agent(path: string, options: { method?: string; body?: any } = {}) {
  const response = await fetch(`${AGENT_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-token': AGENT_TOKEN,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error ?? `الوكيل رفض الطلب (${response.status})`);
  return data;
}

export type PrinterTarget =
  | { type: 'windows'; name: string; driver?: string; port?: string }
  | { type: 'network'; host: string; port: number; name?: string };

export async function agentHealth(): Promise<{ ok: boolean; version?: string } | null> {
  try {
    return await agent('/health');
  } catch {
    return null;
  }
}

export async function listPrinters(): Promise<PrinterTarget[]> {
  const data = await agent('/printers');
  return data.printers ?? [];
}

export async function getAgentConfig(): Promise<any> {
  const data = await agent('/config');
  return data.config;
}

export async function saveAgentConfig(config: any) {
  return agent('/config', { method: 'POST', body: config });
}

export async function printReceipt(receipt: any, printer?: PrinterTarget) {
  return agent('/print', { method: 'POST', body: { receipt, printer } });
}

export async function openDrawer(printer?: PrinterTarget) {
  return agent('/open-drawer', { method: 'POST', body: { printer } });
}
