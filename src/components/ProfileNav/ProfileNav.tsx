/**
 * Profile Navigation Component
 *
 * Shared navigation for profile-related pages (Skills, Habits, History).
 * Provides consistent navigation and "you are here" indicator across the profile section.
 */

'use client';

import { FlameIcon, HistoryIcon, MortarBoardIcon } from '@primer/octicons-react';
import { NavList } from '@primer/react';
import { usePathname } from 'next/navigation';
import styles from './ProfileNav.module.css';

interface ProfileNavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}

const PROFILE_NAV_ITEMS: ProfileNavItem[] = [
  { href: '/skills', label: 'Skills', icon: MortarBoardIcon },
  { href: '/habits', label: 'Habits', icon: FlameIcon },
  { href: '/history', label: 'History', icon: HistoryIcon },
];

export function ProfileNav() {
  const pathname = usePathname();

  return (
    <div className={styles.container}>
      <NavList aria-label="Profile navigation">
        {PROFILE_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isCurrent = pathname === item.href;
          
          return (
            <NavList.Item
              key={item.href}
              href={item.href}
              aria-current={isCurrent ? 'page' : undefined}
            >
              <NavList.LeadingVisual>
                <Icon size={16} />
              </NavList.LeadingVisual>
              {item.label}
            </NavList.Item>
          );
        })}
      </NavList>
    </div>
  );
}
