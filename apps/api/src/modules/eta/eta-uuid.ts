import * as crypto from 'node:crypto';

/**
 * Egyptian "Internal UUID".
 *
 * The Egyptian Tax Authority expects a time based UUID (version 1) whose
 * timestamp encodes the moment the invoice was issued, so the identifier
 * itself proves the order of the documents.
 */
export function generateEgyptianUuid(now: Date = new Date()): string {
  // 100-nanosecond intervals since 15 October 1582 (the Gregorian reform).
  const EPOCH = 122192928000000000n;
  const ticks = BigInt(now.getTime()) * 10000n + EPOCH;

  const timeLow = Number(ticks & 0xffffffffn);
  const timeMid = Number((ticks >> 32n) & 0xffffn);
  const timeHigh = Number((ticks >> 48n) & 0x0fffn);

  const bytes = crypto.randomBytes(8);
  // Version 1 in the time_hi field.
  const timeHiAndVersion = ((timeHigh & 0x0fff) | 0x1000) & 0xffff;
  // Clock sequence (14 bits) with the RFC 4122 variant in the two top bits:
  // the first hexadecimal digit of the fourth group is therefore 8, 9, a or b.
  const clockSeq = ((0x2 << 14) | (bytes[0] & 0x0fff)) & 0xffff;

  const hex = (value: number, length: number) =>
    value.toString(16).padStart(length, '0').slice(-length);

  return [
    hex(timeLow, 8),
    hex(timeMid, 4),
    hex(timeHiAndVersion, 4),
    hex(clockSeq, 4),
    hex(bytes[1], 2) + hex(bytes[2], 2) + hex(bytes[3], 2) + hex(bytes[4], 2) + hex(bytes[5], 2) + hex(bytes[6], 2),
  ].join('-');
}

/** The UUID of the seller's registration (EGS) — stable for the company. */
export function sellerEgsUuid(registrationId: string | number): string {
  const seed = `wasel-eta-egs-${registrationId}`;
  const hash = crypto.createHash('sha256').update(seed).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32),
  ].join('-');
}

/** True when the string looks like a version 1 UUID. */
export function isTimeBasedUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? '');
}
