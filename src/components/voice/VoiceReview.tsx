import React from 'react';
import type { VoiceItem } from '../../lib/voiceParse';

export interface VoiceRow extends VoiceItem { matchName: string | null; matchId: string | null; food?: unknown }

interface Props {
  heard: string;
  rows: VoiceRow[];
  onPick: (row: VoiceRow) => void;
  onSearch: (name: string) => void;
  onQty: (index: number, qty: number) => void;
  onSkip: (index: number) => void;
  onClose: () => void;
}

/** Shows what was heard and what each part matched. Nothing is logged until the person taps an item and confirms. */
export function VoiceReview({ heard, rows, onPick, onSearch, onQty, onSkip, onClose }: Props) {
  return (
    <section aria-label="What I heard" className="mx-4 mt-3 bg-[#1C1C1E] border border-[#C8F75E]/20 rounded-xl p-3 space-y-2 md:mx-0">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-[#8E8E93]">I heard: <span className="text-[#F5F5F5]">“{heard}”</span></p>
        <button onClick={onClose} aria-label="Close voice review" className="text-[#636366] text-lg min-w-[36px] min-h-[36px]">×</button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[#C7C7CC]">I could not find any food in that. Try again, or type it in the search box.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="bg-[#242426] rounded-lg p-2.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{r.matchName ?? r.name}</p>
                  <p className="text-[11px] text-[#8E8E93]">{r.matchName ? (r.matchName.toLowerCase() === r.name.toLowerCase() ? 'Found in the food list' : `You said “${r.name}”`) : 'Not found in the food list'}</p>
                </div>
                <div className="flex items-center gap-1" role="group" aria-label={`Quantity for ${r.name}`}>
                  <button onClick={() => onQty(i, Math.max(0.5, r.qty - (r.qty > 1 ? 1 : 0.5)))} aria-label="Less" className="w-9 h-9 rounded-full bg-[#1C1C1E]">−</button>
                  <span className="w-8 text-center text-sm tabular-nums">{r.qty}</span>
                  <button onClick={() => onQty(i, Math.min(20, r.qty + (r.qty >= 1 ? 1 : 0.5)))} aria-label="More" className="w-9 h-9 rounded-full bg-[#1C1C1E]">+</button>
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                {r.matchId
                  ? <button onClick={() => onPick(r)} className="px-3 min-h-[36px] rounded-full bg-[#C8F75E] text-[#111113] text-xs font-semibold">Review and add</button>
                  : <button onClick={() => onSearch(r.name)} className="px-3 min-h-[36px] rounded-full bg-[#C8F75E]/15 text-[#C8F75E] text-xs font-semibold">Search “{r.name}”</button>}
                <button onClick={() => onSkip(i)} className="px-3 min-h-[36px] rounded-full bg-[#1C1C1E] text-xs text-[#C7C7CC]">Skip</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-[#636366]">Speech is turned into text by your browser's speech service. NutriSmart does not keep your voice.</p>
    </section>
  );
}
