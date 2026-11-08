/**
 * BrandMark.tsx — the NutriSmart IQ logo (a katori bowl with a gold spark) and wordmark, as in the design canvas.
 * The word follows the theme colour; the "IQ" pill is gold on Evergreen in both themes.
 */
import React from 'react';

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="NutriSmart IQ logo: a katori bowl topped with a spark">
      <path d="M32 3 L35.2 11.8 L44 15 L35.2 18.2 L32 27 L28.8 18.2 L20 15 L28.8 11.8 Z" fill="#D6A96B" />
      <path d="M9 31 H55 C55 45 45 56 32 56 C19 56 9 45 9 31 Z" fill="#F5F3ED" />
    </svg>
  );
}

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <span data-testid="brand-mark" className="inline-flex items-center gap-2">
      <span className="rounded-xl overflow-hidden inline-flex" style={{ background: '#183C32', padding: 3 }}><LogoMark size={size} /></span>
      <span className="font-serif font-bold text-xl leading-none tracking-tight" style={{ color: 'var(--n-t1, #F5F5F5)' }}>NutriSmart</span>
      <span className="font-bold text-xs leading-none rounded-lg px-2 py-1" style={{ background: '#D6A96B', color: '#183C32' }}>IQ</span>
    </span>
  );
}
