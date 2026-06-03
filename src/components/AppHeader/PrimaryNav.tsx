/**
 * PrimaryNav
 *
 * Persistent top-level app navigation shown in the AppHeader on every page.
 * Surfaces the core destinations (Dashboard, Skills, Habits, History) so they
 * are one click from anywhere, replacing the per-page ProfileNav sidebar and
 * the duplicate "Learning" group that previously lived in the avatar menu.
 */

'use client';

import { CopilotIcon, FlameIcon, HistoryIcon, HomeIcon, MortarBoardIcon } from '@primer/octicons-react';
import { UnderlineNav } from '@primer/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface PrimaryNavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}

const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  { href: '/', label: 'Dashboard', icon: HomeIcon },
  { href: '/chat', label: 'Chat', icon: CopilotIcon },
  { href: '/skills', label: 'Skills', icon: MortarBoardIcon },
  { href: '/habits', label: 'Habits', icon: FlameIcon },
  { href: '/history', label: 'History', icon: HistoryIcon },
];

/**
 * Horizontal primary navigation backed by Primer's UnderlineNav, which handles
 * the "you are here" indicator and collapses overflowing items into a menu on
 * narrow viewports. The current item is matched exactly against the pathname,
 * so query-only changes (e.g. /history?tab=stats) keep History highlighted.
 */
export function PrimaryNav() {
  const pathname = usePathname();

  return (
    <UnderlineNav aria-label="Primary navigation" variant="flush">
      {PRIMARY_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <UnderlineNav.Item
            key={item.href}
            as={Link}
            href={item.href}
            aria-current={pathname === item.href ? 'page' : undefined}
            leadingVisual={<Icon />}
          >
            {item.label}
          </UnderlineNav.Item>
        );
      })}
    </UnderlineNav>
  );
}
