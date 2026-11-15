'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useScreenDeletionEnabled } from '@/lib/delete-toggles';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  screenKey: string;
  onDelete: () => void;
  confirmText?: string;
  label?: string;
  children?: ReactNode;
};

/**
 * Shared delete button (D29). Hides itself when the «الحذف» switches in
 * Settings disable deletion for this screen — the API double-checks too.
 */
export default function DeleteButton({
  screenKey,
  onDelete,
  confirmText,
  label = 'حذف',
  className,
  children,
  ...rest
}: Props) {
  const enabled = useScreenDeletionEnabled(screenKey);
  if (!enabled) return null;

  return (
    <button
      type="button"
      className={className ?? 'text-rose-600 text-xs font-semibold hover:underline cursor-pointer'}
      title="حذف — يتحكم فيه من «الإعدادات ← الحذف»"
      onClick={() => {
        if (confirmText && !window.confirm(confirmText)) return;
        onDelete();
      }}
      {...rest}
    >
      {children ?? label}
    </button>
  );
}
