/**
 * NavIcon.tsx — simple line icons for the four tabs (replaces emoji when 'ui_screens_a' is on).
 * Drawn with currentColor so they follow the theme and the active colour.
 */
import React from 'react';

const P: Record<string, React.ReactNode> = {
  Today: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6 10v9h12v-9" /></>,
  Log: <><rect x="5" y="4" width="14" height="16" rx="2.5" /><path d="M9 9h6M9 13h6M9 17h3" /></>,
  Insights: <><path d="M5 19V11M12 19V5M19 19v-6" /></>,
  Profile: <><circle cx="12" cy="9" r="3.5" /><path d="M5 20c1-3.5 4-5 7-5s6 1.5 7 5" /></>,
};

export function NavIcon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-nav-icon={name}>
      {P[name] ?? P.Today}
    </svg>
  );
}
