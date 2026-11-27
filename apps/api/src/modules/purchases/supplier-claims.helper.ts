import { PoolClient } from 'pg';
import { postJournal, requireMapping } from '../../common/posting';

/**
 * TD-53/54 Phase 1 — supplier-claim journal helpers.
 * Both helpers use the standard `postJournal` engine; `common/posting.ts`
 * is NOT modified (TD-53/54 constraint).
 */

/**
 * P1-02 — record a supplier claim: the defective goods leave inventory and
 * become a receivable owed by the supplier.
 *   Dr 2108 Claim Receivable (party + branch) / Cr 1104 Inventory (branch)
 */
export async function postSupplierClaimJournal(
  client: PoolClient,
  params: {
    branchId: number;
    supplierId: number;
    claimId: number;
    amount: number;
    description: string;
  },
): Promise<number> {
  const claim = await requireMapping(client, 'SUPPLIER_CLAIM_RECEIVABLE', 'ذمم مطالبات الموردين');
  const inventory = await requireMapping(client, 'INVENTORY', 'المخزون');
  return postJournal(client, {
    branchId: params.branchId,
    journalType: 2,
    description: params.description,
    sourceType: 'supplier_claim',
    sourceId: params.claimId,
    lines: [
      { accountId: claim.accountId, debit: params.amount, credit: 0, partyId: params.supplierId,
        description: params.description },
      { accountId: inventory.accountId, debit: 0, credit: params.amount, description: params.description },
    ],
  });
}

/**
 * P1-03 — reverse the VAT input originally capitalised on a supplier invoice
 * when a supplier credit note is received.
 *   Dr 2101 AP (party + branch) / Cr 1105 VAT Input (branch)
 */
export async function reverseSupplierVat(
  client: PoolClient,
  params: {
    branchId: number;
    supplierId: number;
    supplierInvoiceId: number;
    vatAmount: number;
    description: string;
  },
): Promise<number> {
  const ap = await requireMapping(client, 'AP', 'ذمم الموردين');
  const vatInput = await requireMapping(client, 'VAT_INPUT', 'ضريبة القيمة المضافة (مدخلات)');
  return postJournal(client, {
    branchId: params.branchId,
    journalType: 2,
    description: params.description,
    sourceType: 'supplier_vat_reversal',
    sourceId: params.supplierInvoiceId,
    lines: [
      { accountId: ap.accountId, debit: params.vatAmount, credit: 0, partyId: params.supplierId,
        description: params.description },
      { accountId: vatInput.accountId, debit: 0, credit: params.vatAmount, description: params.description },
    ],
  });
}
