/** InstallHelpModal — manual install steps for browsers with no native install prompt. */
import React from 'react';
import { isIOS } from '../lib/pwaInstall';

export function InstallHelpModal({ onClose }: { onClose: () => void }) {
  const ios = isIOS();
  const steps = ios
    ? ['Open NutriSmart in Safari', 'Tap the Share button (square with an up arrow)', 'Scroll down and tap “Add to Home Screen”', 'Tap Add — then open NutriSmart from your home screen']
    : ['Open NutriSmart in Chrome or Edge', 'Open the browser menu (⋮ or the install icon in the address bar)', 'Tap “Install app” or “Add to Home screen”', 'Open NutriSmart from your home screen or app list'];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose} role="dialog" aria-label="How to install NutriSmart">
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-md bg-[#1C1C1E] border border-white/[0.08] rounded-t-3xl px-5 pt-5 pb-8" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-between mb-4">
          <p className="text-base font-semibold text-white">Install NutriSmart</p>
          <button onClick={onClose} className="text-[#636366] text-sm px-2 py-1">Done</button>
        </div>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-[#EBEBF5]/80">
              <span className="w-6 h-6 rounded-full bg-[#C8F75E] text-black text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        {ios && <p className="text-xs text-[#636366] mt-4">On iPhone, meal reminders work only after the app is added to your home screen.</p>}
      </div>
    </div>
  );
}
