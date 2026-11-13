import * as crypto from 'node:crypto';
import QRCode from 'qrcode';

export interface ZatcaConfigRow {
  config_id: number;
  seller_name: string;
  seller_vat_number: string;
  seller_address: string | null;
  seller_email: string | null;
  seller_phone: string | null;
  seller_logo: string | null;
  environment: string;
  csid_token: string | null;
  csid_secret: string | null;
  private_key: string | null;
  certificate: string | null;
  ecdsa_private_key: string | null;
  ecdsa_public_key: string | null;
  is_active: boolean;
}

/** TLV (tag-length-value) encoding used by the ZATCA QR code. */
export function encodeTlv(fields: { tag: number; value: string }[]): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    const value = Buffer.from(field.value, 'utf8');
    parts.push(Buffer.from([field.tag, value.length]), value);
  }
  return Buffer.concat(parts);
}

/**
 * Builds the ZATCA QR payload for a standard (tax) invoice — 8 tags:
 * seller, VAT number, timestamp, totals, invoice hash, ECDSA signature,
 * ECDSA public key and the RSA signature of the cryptographic stamp.
 */
export function buildQrPayload(input: {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: number;
  vatTotal: number;
  invoiceHash: string;
  ecdsaSignature: string;
  ecdsaPublicKey: string;
  rsaSignature: string;
}): Buffer {
  return encodeTlv([
    { tag: 1, value: input.sellerName },
    { tag: 2, value: input.vatNumber },
    { tag: 3, value: input.timestamp },
    { tag: 4, value: `${input.totalWithVat.toFixed(2)} ${input.vatTotal.toFixed(2)}` },
    { tag: 5, value: input.invoiceHash },
    { tag: 6, value: input.ecdsaSignature },
    { tag: 7, value: input.ecdsaPublicKey },
    { tag: 8, value: input.rsaSignature },
  ]);
}

/** Simplified invoice QR — 5 tags (no signatures). */
export function buildSimplifiedQrPayload(input: {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: number;
  vatTotal: number;
  invoiceHash: string;
}): Buffer {
  return encodeTlv([
    { tag: 1, value: input.sellerName },
    { tag: 2, value: input.vatNumber },
    { tag: 3, value: input.timestamp },
    { tag: 4, value: `${input.totalWithVat.toFixed(2)} ${input.vatTotal.toFixed(2)}` },
    { tag: 5, value: input.invoiceHash },
  ]);
}

export interface CryptographicStamp {
  invoiceHash: string;
  ecdsaSignature: string;
  ecdsaPublicKey: string;
  rsaSignature: string;
}

/**
 * Computes the ZATCA cryptographic stamp:
 *  - invoice hash  = SHA-256 of the invoice XML (base64)
 *  - ECDSA stamp   = ECDSA-SHA256 over the hash bytes (P-256, raw r||s)
 *  - RSA stamp     = RSA-SHA256 over (hash bytes + ECDSA signature bytes)
 */
export function computeCryptographicStamp(xml: string, config: ZatcaConfigRow): CryptographicStamp {
  const invoiceHash = crypto.createHash('sha256').update(Buffer.from(xml, 'utf8')).digest('base64');

  if (!config.ecdsa_private_key) {
    return { invoiceHash, ecdsaSignature: '', ecdsaPublicKey: config.ecdsa_public_key ?? '', rsaSignature: '' };
  }

  const ecdsaSignature = crypto
    .sign('sha256', Buffer.from(invoiceHash, 'utf8'), {
      key: config.ecdsa_private_key,
      dsaEncoding: 'ieee-p1363',
    })
    .toString('base64');

  let rsaSignature = '';
  if (config.private_key) {
    const stamp = Buffer.concat([Buffer.from(invoiceHash, 'utf8'), Buffer.from(ecdsaSignature, 'base64')]);
    rsaSignature = crypto.sign('sha256', stamp, config.private_key).toString('base64');
  }

  const ecdsaPublicKey = config.ecdsa_public_key ?? (config.ecdsa_private_key
    ? crypto.createPublicKey(config.ecdsa_private_key).export({ type: 'spki', format: 'pem' }).toString()
    : '');

  return { invoiceHash, ecdsaSignature, ecdsaPublicKey, rsaSignature };
}

export async function qrToPngBase64(payload: Buffer): Promise<string> {
  // byte mode so the binary TLV payload survives encoding
  return QRCode.toDataURL([{ data: payload, mode: 'byte' }], { type: 'image/png', margin: 1, width: 420 });
}
