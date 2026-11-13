import * as crypto from 'node:crypto';
import QRCode from 'qrcode';

/**
 * QR payload of the Egyptian e-invoice.
 *
 * TLV encoding (tag, length, value) exactly like the ZATCA one, but with the
 * tag order required by the Egyptian Tax Authority:
 *   1 seller name            2 VAT number        3 timestamp
 *   4 total (with VAT)       5 VAT total         6 EGS UUID (seller)
 *   7 invoice internal UUID  8 ETA public UUID (after submission)
 */
export function encodeTlv(fields: { tag: number; value: string }[]): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    if (field.value === undefined || field.value === null) continue;
    const value = Buffer.from(field.value, 'utf8');
    parts.push(Buffer.from([field.tag, value.length]), value);
  }
  return Buffer.concat(parts);
}

export interface EtaQrInput {
  sellerName: string;
  vatNumber: string;
  timestamp: string;          // ISO 8601 UTC, e.g. 2026-11-13T10:15:30Z
  totalWithVat: number;
  vatTotal: number;
  egsUuid: string;            // the seller registration UUID
  invoiceUuid: string;        // internal UUID of the invoice
  publicId?: string | null;   // ETA public UUID, present after submission
}

/** QR payload of a standard (tax) invoice. */
export function buildEtaQrPayload(input: EtaQrInput): Buffer {
  return encodeTlv([
    { tag: 1, value: input.sellerName },
    { tag: 2, value: input.vatNumber },
    { tag: 3, value: input.timestamp },
    { tag: 4, value: input.totalWithVat.toFixed(2) },
    { tag: 5, value: input.vatTotal.toFixed(2) },
    { tag: 6, value: input.egsUuid },
    { tag: 7, value: input.invoiceUuid },
    { tag: 8, value: input.publicId ?? '' },
  ]);
}

/**
 * QR payload of a simplified invoice: same as the standard one but without the
 * invoice UUID tags (the EGS UUID identifies the document).
 */
export function buildSimplifiedEtaQrPayload(input: EtaQrInput): Buffer {
  return encodeTlv([
    { tag: 1, value: input.sellerName },
    { tag: 2, value: input.vatNumber },
    { tag: 3, value: input.timestamp },
    { tag: 4, value: input.totalWithVat.toFixed(2) },
    { tag: 5, value: input.vatTotal.toFixed(2) },
    { tag: 6, value: input.egsUuid },
  ]);
}

/** SHA-256 hash (base64) of the invoice XML — the document fingerprint. */
export function computeInvoiceHash(xml: string): string {
  return crypto.createHash('sha256').update(Buffer.from(xml, 'utf8')).digest('base64');
}

/** RSA-SHA256 signature of the invoice hash, base64 encoded. */
export function signInvoiceHash(hashBase64: string, privateKey: string): string {
  return crypto
    .sign('sha256', Buffer.from(hashBase64, 'base64'), privateKey)
    .toString('base64');
}

export async function qrToPngBase64(payload: Buffer): Promise<string> {
  // byte mode so the binary TLV payload survives the encoding
  return QRCode.toDataURL([{ data: payload, mode: 'byte' }], { type: 'image/png', margin: 1, width: 420 });
}
