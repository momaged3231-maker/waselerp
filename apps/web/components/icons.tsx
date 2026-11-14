import type { ReactNode } from 'react';

type IconProps = { className?: string };

function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className ?? 'w-5 h-5'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9.5h4.5V14h3v5.5H18V10" />
    </Icon>
  );
}

export function IconCart(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 4h2l2.4 12.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L21 8H6" />
      <circle cx="10.5" cy="21" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="21" r="0.6" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconUtensils(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3" />
      <path d="M9 12v9" />
      <path d="M16 3c-1.7 0-3 1.6-3 4v4a2 2 0 0 0 2 2h1v8" />
      <path d="M16 3v18" />
    </Icon>
  );
}

export function IconWrench(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.7 6.3a4.5 4.5 0 0 0-6 5.6L3 17.6a2 2 0 1 0 2.8 2.8l5.7-5.7a4.5 4.5 0 0 0 5.6-6l-3 3-2.8-.6-.6-2.8 4-4Z" />
    </Icon>
  );
}

export function IconReceipt(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4L10 21l-2-1.4L6 21V3Z" />
      <path d="M9.5 8h5M9.5 12h5M9.5 16h3" />
    </Icon>
  );
}

export function IconFileText(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3h7l4 4v14H7V3Z" />
      <path d="M14 3v4h4" />
      <path d="M10 12h4M10 16h4" />
    </Icon>
  );
}

export function IconBox(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </Icon>
  );
}

export function IconTag(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12V4h8l9 9-8 8-9-9Z" />
      <circle cx="7.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconWarehouse(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10v10h14V10" />
      <path d="M8.5 20v-5h7v5M8.5 12h7" />
    </Icon>
  );
}

export function IconClipboardCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4h6v3H9z" />
      <path d="m9.7 13.5 2 2 3.6-4" />
    </Icon>
  );
}

export function IconPackage(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="8" width="17" height="12" rx="1.5" />
      <path d="M3.5 12.5h17M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8" />
    </Icon>
  );
}

export function IconArrowsSwitch(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4v13" />
      <path d="m4 7 3-3 3 3" />
      <path d="M17 20V7" />
      <path d="m14 17 3 3 3-3" />
    </Icon>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3.5 20c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="17.5" cy="9.5" r="2.6" />
      <path d="M16 15.2c2.5.3 3.9 2.2 4.3 4.8" />
    </Icon>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </Icon>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M16 12.5h5" />
      <circle cx="16" cy="12.5" r="0.4" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconBookOpen(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v15H6.5A2.5 2.5 0 0 0 4 21V6.5Z" />
      <path d="M4 19a2.5 2.5 0 0 1 2.5-2H20" />
    </Icon>
  );
}

export function IconChartBar(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h16" />
      <path d="M7 16v-5M12 16V8M17 16v-8" />
    </Icon>
  );
}

export function IconBriefcase(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="8" width="17" height="12" rx="2" />
      <path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8M3.5 13.5h17" />
    </Icon>
  );
}

export function IconPrinter(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 8V3.5h10V8" />
      <rect x="3" y="8" width="18" height="9" rx="1.5" />
      <rect x="7" y="13.5" width="10" height="7" rx="1" />
    </Icon>
  );
}

export function IconBarcode(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6v12M7.5 6v12M11 6v12M13.5 6v12M16.5 6v12M20 6v12" />
    </Icon>
  );
}

export function IconDeviceMobile(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </Icon>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 19a2.2 2.2 0 0 0 4 0" />
    </Icon>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h4L12.5 8H18A2.5 2.5 0 0 1 20.5 10.5V17a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17V7Z" />
    </Icon>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19 12a7 7 0 0 0-.15-1.4l2-1.5-1.9-3.3-2.4 1a7 7 0 0 0-1.2-.7L15 3h-6l-.35 2.6a7 7 0 0 0-1.2.7l-2.4-1-1.9 3.3 2 1.5A7 7 0 0 0 5 12c0 .5.05.9.15 1.4l-2 1.5 1.9 3.3 2.4-1c.4.3.8.55 1.2.7L9 21h6l.35-2.6c.45-.15.8-.4 1.2-.7l2.4 1 1.9-3.3-2-1.5c.1-.5.15-.9.15-1.4Z" />
    </Icon>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4H7a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 7 20h7" />
      <path d="M10 12h10" />
      <path d="m17 8.5 3.5 3.5-3.5 3.5" />
    </Icon>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function IconCloudUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 18a4.5 4.5 0 0 1 .4-9A6 6 0 0 1 18.6 11 3.8 3.8 0 0 1 17.5 18H7Z" />
      <path d="M12 12.5v6M9.5 15.5 12 13l2.5 2.5" />
    </Icon>
  );
}

export function IconWifiOff(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12a10 10 0 0 1 3-2.2M12 6.5c2.6 0 5 .8 7 2.2M8.5 15.5a5.5 5.5 0 0 1 3-1.5M13 14c.8 0 1.6.2 2.3.6" />
      <path d="M4 4l16 16" />
      <circle cx="12" cy="19" r="0.6" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconBuilding(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20" />
      <path d="M15 9h3.5A1.5 1.5 0 0 1 20 10.5V20" />
      <path d="M3.5 20h17M8 8h3M8 12h3M8 16h3" />
    </Icon>
  );
}

export function IconTrendUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 17l6-6 4 4 6-7" />
      <path d="M15 8h5v5" />
    </Icon>
  );
}

export function IconInboxDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 13 6 6.5h12L20.5 13" />
      <path d="M3.5 13v4a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4h-6a3 3 0 0 1-6 0h-6Z" />
      <path d="M12 9v5M9.8 11.9 12 14l2.2-2.1" />
    </Icon>
  );
}

export function IconReceiptTax(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4L10 21l-2-1.4L6 21V3Z" />
      <path d="M9.5 9h5M9.5 13h5" />
    </Icon>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}
