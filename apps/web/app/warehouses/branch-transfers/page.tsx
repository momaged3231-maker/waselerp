'use client';

import AppShell from '@/components/AppShell';
import BranchTransferScreen from '@/components/screens/BranchTransferScreen';

export default function BranchTransfersPage() {
  return (
    <AppShell title="التحويلات بين الفروع">
      <BranchTransferScreen />
    </AppShell>
  );
}
