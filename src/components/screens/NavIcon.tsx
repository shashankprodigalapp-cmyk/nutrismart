/**
 * NavIcon.tsx — simple line icons for the four tabs (replaces emoji when 'ui_screens_a' is on).
 * Drawn with currentColor so they follow the theme and the active colour.
 */
import React from 'react';

const P: Record<string, React.ReactNode> = {
  Today: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>,
  Log: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  Insights: <><path d="M4 19V9M10 19V5M16 19v-7M21 19H3" /></>,
  Profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
};

export function NavIcon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-nav-icon={name}>
      {P[name] ?? P.Today}
    </svg>
  );
}
