/** Shared Arabic labels for stock/voucher enums (mirrors apps/api/src/common/stock.ts and stock-voucher.slice.ts). */

export const MOVE_LABELS: Record<number, string> = {
  1: 'شراء', 2: 'بيع', 3: 'مرتجع بيع', 4: 'مرتجع شراء',
  5: 'تحويل داخل', 6: 'تحويل خارج', 7: 'زيادة جرد', 8: 'عجز جرد', 9: 'رصيد افتتاحي', 10: 'تسوية', 11: 'تسوية صرف',
};

export const VOUCHER_TYPE_LABELS: Record<number, string> = {
  1: 'وارد', 2: 'صادر', 3: 'تالف', 4: 'افتتاحي',
};

export const VOUCHER_STATUS_LABELS: Record<number, string> = {
  1: 'مسودة', 2: 'معتمد', 3: 'ملغى',
};
