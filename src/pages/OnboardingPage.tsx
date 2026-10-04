/**
 * OnboardingPage.tsx — Kitchen Profile Setup (3 questions)
 * Writes profile to Supabase + Dexie then redirects to /app/log.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase }    from '../lib/supabase';
import { localDb }     from '../lib/localDb';
import { buildKitchenProfile, formatMultiplierForDisplay } from '../lib/kitchenIntelligence';
import type { KitchenAnswers } from '../lib/kitchenIntelligence';
import { useAuth } from '../context/AuthContext';

const QUESTIONS = [
  {
    id: 'oil' as const,
    q: 'How much oil / ghee per dish?',
    hint: 'This calibrates your home-cooked calorie counts for YOUR kitchen',
    opts: [
      { v: 'very_light', label: 'Very light', desc: '< 1 tsp — health conscious' },
      { v: 'moderate',   label: 'Moderate',   desc: '1–2 tsp — standard home' },
      { v: 'regular',    label: 'Regular',     desc: '2–3 tsp — typical Indian' },
      { v: 'heavy',      label: 'Heavy',       desc: 'Ghee + oil — rich cooking' },
    ],
  },
  {
    id: 'cook' as const,
    q: 'Who usually cooks at home?',
    hint: 'Helps us understand cooking style and typical oil usage',
    opts: [
      { v: 'me',   label: 'I cook',      desc: 'Self-cooked, controlled' },
      { v: 'maid', label: 'Maid / Cook', desc: 'Professional cook at home' },
      { v: 'mix',  label: 'Mix',         desc: 'Varies day to day' },
    ],
  },
  {
    id: 'style' as const,
    q: 'Describe your cooking style',
    hint: 'Traditional cooking or health-conscious cooking changes calorie estimates significantly',
    opts: [
      { v: 'health',      label: 'Health conscious', desc: 'Less oil, more veggies, light spices' },
      { v: 'mixed',       label: 'Mixed',            desc: 'Balance of healthy and traditional' },
      { v: 'traditional', label: 'Traditional',      desc: 'Lots of ghee, rich gravies, full flavour' },
    ],
  },
];

export default function OnboardingPage() {
  const navigate   = useNavigate();
  const { user }   = useAuth();
  const [step,     setStep]     = useState(0);
  const [answers,  setAnswers]  = useState<Partial<KitchenAnswers>>({});
  const [saving,   setSaving]   = useState(false);

  const q = QUESTIONS[step];

  const handleSelect = (val: string) => {
    setAnswers(a => ({ ...a, [q.id]: val as any }));
  };

  const handleNext = async () => {
    if (step < QUESTIONS.length - 1) {
      setStep(s => s + 1);
      return;
    }
    // Final step — build and save profile
    if (!user) return;
    setSaving(true);
    try {
      const profile = buildKitchenProfile(answers as KitchenAnswers);
      // Save to Dexie
      await localDb.user_prefs.put({ key: 'kitchen_profile', value: profile });
      // Save to Supabase
      await supabase.from('kitchen_profiles').upsert({
        user_id:           user.id,
        oil_usage:         answers.oil,
        who_cooks:         answers.cook,
        cook_style:        answers.style,
        home_mult:         profile.home_mult,
        rest_mult:         profile.rest_mult,
        logs_used:         0,
      }, { onConflict: 'user_id' });
      // Update users table plan default
      await supabase.from('users').upsert({ id: user.id, plan: 'free' }, { onConflict: 'id' });
      navigate('/app/today', { replace: true });
    } catch (e) {
      // Silently log via analytics — console.error removed for production
      supabase.from('events').insert({ user_id: user?.id, event_name: 'onboarding_save_error', properties: { msg: String(e) } }).then(() => {});
      // Navigate anyway — SyncManager will retry
      navigate('/app/today', { replace: true });
    } finally {
      setSaving(false);
    }
  };

  const selected = answers[q.id as keyof KitchenAnswers];
  const preview  = Object.keys(answers).length === 3
    ? buildKitchenProfile(answers as KitchenAnswers) : null;

  return (
    <div className="min-h-dvh bg-[#111113] px-5 py-10">
      {/* Progress */}
      <div className="text-[11px] font-bold text-[#C8F75E] uppercase tracking-[1px] mb-2">
        Kitchen Intelligence · {step + 1} of {QUESTIONS.length}
      </div>
      <div className="flex gap-2 mb-6">
        {QUESTIONS.map((_, i) => (
          <div key={i} className={`flex-1 h-1 rounded-full ${i <= step ? 'bg-[#C8F75E]' : 'bg-[#2C2C2E]'}`} />
        ))}
      </div>

      <h1 className="font-['Playfair_Display'] text-[26px] font-black text-white mb-2 leading-tight">{q.q}</h1>
      <p className="text-[12px] text-[#636366] mb-6 leading-relaxed">{q.hint}</p>

      <div className="flex flex-col gap-3 mb-8">
        {q.opts.map(opt => (
          <button key={opt.v} onClick={() => handleSelect(opt.v)}
            className={`flex items-center gap-4 bg-[#1C1C1E] border rounded-2xl px-4 py-4 text-left transition-all ${
              selected === opt.v
                ? 'border-[#C8F75E]/50 bg-[#C8F75E]/8'
                : 'border-white/10'
            }`}>
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
              selected === opt.v ? 'border-[#C8F75E]' : 'border-[#636366]'
            }`}>
              {selected === opt.v && <div className="w-2.5 h-2.5 rounded-full bg-[#C8F75E]" />}
            </div>
            <div>
              <div className="text-[14px] font-semibold text-white">{opt.label}</div>
              <div className="text-[11px] text-[#636366] mt-0.5">{opt.desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Preview multiplier on final step */}
      {preview && (
        <div className="bg-[#1C1C1E] border border-[#C8F75E]/20 rounded-2xl p-4 mb-6">
          <p className="text-[11px] text-[#636366] mb-1">Your Kitchen Multiplier</p>
          <p className="text-[24px] font-black text-[#C8F75E]">{formatMultiplierForDisplay(preview.home_mult)}</p>
          <p className="text-[11px] text-[#A1A1A1] mt-1">
            Home cooking · Restaurant stays at 1.30× · Updates as you log more meals
          </p>
        </div>
      )}

      <button onClick={handleNext} disabled={!selected || saving}
        className="w-full bg-[#C8F75E] text-[#111113] font-bold text-[15px] rounded-2xl py-4 disabled:opacity-40">
        {saving ? 'Building your profile…' : step < QUESTIONS.length - 1 ? 'Next →' : 'Build my Kitchen Profile'}
      </button>
    </div>
  );
}
