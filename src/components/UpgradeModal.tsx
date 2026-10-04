/**
 * UpgradeModal.tsx — UPI Payment with Automatic Pro Activation
 *
 * Flow:
 *   1. User sees QR + UPI ID → pays ₹99
 *   2. User enters UTR number (transaction ID from their UPI app)
 *   3. App calls /verify-upi-payment → Pro activates immediately
 *   4. No manual admin action needed
 *
 * UTR = Unique Transaction Reference — appears in every UPI app after payment.
 * Example: "GPay: UTR 426812345678" or PhonePe shows it as "Transaction ID"
 *
 * EDIT THESE 2 LINES:
 */

import React, { useState } from 'react';
import { supabase }         from '../lib/supabase';
import type { ProFeature }  from '../utils/proGatekeeper';
import { UpiPaymentFlow }   from './UpiPaymentFlow';

// ─────────────────────────────────────────────
const YOUR_UPI_ID          = 'yourname@ybl';       // ← your UPI ID
const YOUR_WHATSAPP_NUMBER = '919876543210';        // ← 91 + your 10-digit number
// ─────────────────────────────────────────────

const FEATURE_LABELS: Record<ProFeature, string> = {
  ai_food_search:    'AI Food Search',
  photo_recognition: 'Photo Food Recognition',
  nl_description:    'Natural Language Logging',
  meal_feedback:     'Smart Meal Feedback',
  dinner_suggester:  'AI Dinner Suggester',
  voice_logging:     'Voice Logging',
  fitness_insights:  'Fitness Insights',
};

type Step = 'info' | 'qr' | 'utr' | 'activating' | 'success' | 'error';

interface UpgradeModalProps {
  feature: ProFeature;
  onClose: () => void;
}

export function UpgradeModal({ feature, onClose }: UpgradeModalProps) {
  const [step,            setStep]            = useState<Step>('info');
  const [copied,          setCopied]          = useState(false);
  const [utrInput,        setUtrInput]        = useState('');
  const [amountConfirmed, setAmountConfirmed] = useState(false);
  const [errorMsg,        setErrorMsg]        = useState('');
  const [activating,      setActivating]      = useState(false);

  const copyUpiId = async () => {
    try { await navigator.clipboard.writeText(YOUR_UPI_ID); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // ── Step: submit UTR and activate Pro automatically ─────────────────────
  const handleActivate = async () => {
    const utr = utrInput.trim();
    if (!utr) { setErrorMsg('Please enter your transaction ID.'); return; }
    if (!amountConfirmed) { setErrorMsg('Please confirm you paid ₹99.'); return; }

    setActivating(true);
    setStep('activating');
    setErrorMsg('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setErrorMsg('Session expired. Please log in again.'); setStep('error'); return; }

      const res = await fetch('/.netlify/functions/verify-upi-payment', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          utr_number:        utr,
          amount_confirmed:  true,
          upi_id_used:       YOUR_UPI_ID,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setStep('success');
      } else {
        setErrorMsg(data.message ?? 'Activation failed. Please contact support.');
        setStep('error');
      }
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.');
      setStep('error');
    } finally {
      setActivating(false);
    }
  };

  const openWhatsApp = () => {
    const msg = encodeURIComponent(
      `Hi! I just paid ₹99 for NutriSmart Pro.\n\nUPI ID: ${YOUR_UPI_ID}\nTransaction ID (UTR): ${utrInput || '(enter UTR)'}\n\nPlease help me activate Pro.`
    );
    window.open(`https://wa.me/${YOUR_WHATSAPP_NUMBER}?text=${msg}`, '_blank');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      onClick={step === 'success' ? onClose : undefined}
    >
      <div
        className="w-full max-w-md bg-[#1C1C1E] rounded-t-3xl px-5 pt-3 pb-10 max-h-[92dvh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-9 h-1 bg-[#2C2C2E] rounded-full mx-auto mb-5" />

        {/* ── STEP: info ──────────────────────────────────────────── */}
        {step === 'info' && (
          <>
            <div className="text-center mb-5">
              <div className="text-4xl mb-2">⭐</div>
              <h2 className="font-['Playfair_Display'] text-2xl font-black text-[#F5F5F5]">
                Upgrade to Pro
              </h2>
              <p className="text-[13px] text-[#A1A1A1] mt-1">
                Unlock <strong className="text-[#C8F75E]">{FEATURE_LABELS[feature]}</strong>
              </p>
            </div>

            {/* Price badge */}
            <div className="bg-[#C8F75E]/10 border border-[#C8F75E]/30 rounded-2xl p-4 text-center mb-5">
              <span className="font-['Playfair_Display'] text-4xl font-black text-[#C8F75E]">₹99</span>
              <span className="text-[#A1A1A1] text-sm ml-1">/ month</span>
              <p className="text-[11px] text-[#636366] mt-1">Pay via UPI · Activates instantly</p>
            </div>

            {/* Features */}
            <div className="bg-[#242426] rounded-xl p-4 mb-5">
              {[
                ['🤖', 'AI Food Search (200/day)', '5 searches/day on free'],
                ['📸', 'Photo Recognition', 'Log meals by clicking a photo'],
                ['🧠', 'Smart Meal Feedback', 'Insight after every meal'],
                ['🌙', 'AI Dinner Suggester', 'Best dinner for remaining macros'],
                ['💪', 'Fitness Insights', 'Deep deficit & trend analysis'],
              ].map(([icon, title, sub]) => (
                <div key={title} className="flex gap-3 py-2 border-b border-white/[0.05] last:border-0">
                  <span className="text-lg w-6 text-center flex-shrink-0">{icon}</span>
                  <div>
                    <p className="text-[12px] font-semibold text-[#F5F5F5]">{title}</p>
                    <p className="text-[10px] text-[#636366] mt-0.5">{sub}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* How it works */}
            <div className="bg-[#242426] rounded-xl p-4 mb-5">
              <p className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px] mb-3">
                How it works — activates automatically
              </p>
              {[
                ['1', 'Tap Pay via UPI'],
                ['2', 'Scan QR or copy UPI ID and pay ₹99'],
                ['3', 'Enter the UTR / Transaction ID from your UPI app'],
                ['4', 'Pro unlocks immediately — no waiting'],
              ].map(([n, t]) => (
                <div key={n} className="flex items-center gap-3 py-1.5">
                  <span className="w-5 h-5 rounded-full bg-[#C8F75E] text-[#111113] text-[10px] font-black flex items-center justify-center flex-shrink-0">{n}</span>
                  <span className="text-[12px] text-[#A1A1A1]">{t}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setStep('qr')}
              className="w-full bg-[#C8F75E] text-[#111113] font-bold text-[15px] rounded-xl py-4 active:scale-[0.98] transition-transform"
            >
              💳 Pay via UPI — ₹99
            </button>
            <button onClick={onClose} className="w-full mt-2 py-3 text-[13px] text-[#636366]">
              Maybe later
            </button>
            <p className="text-[10px] text-[#636366] text-center mt-1">
              By paying you agree to our{' '}
              <a href="/legal/terms.html" target="_blank" className="underline hover:text-[#C8F75E]">Terms</a>
              {' '}and{' '}
              <a href="/legal/privacy.html" target="_blank" className="underline hover:text-[#C8F75E]">Privacy Policy</a>
            </p>
          </>
        )}

        {/* ── STEP: qr ────────────────────────────────────────────── */}
        {step !== 'info' && (
          <UpiPaymentFlow onDone={onClose} />
        )}
        {false && (
          <>
            <div className="text-center mb-4">
              <h2 className="font-['Playfair_Display'] text-xl font-black text-[#F5F5F5]">
                Pay ₹99 via UPI
              </h2>
              <p className="text-[12px] text-[#A1A1A1] mt-1">
                Scan with any UPI app, then enter the UTR
              </p>
            </div>

            {/* QR code */}
            <div className="flex justify-center mb-4">
              <div className="bg-white rounded-2xl p-4 w-52 h-52 flex items-center justify-center">
                <img
                  src="/upi-qr.png"
                  alt="UPI QR Code"
                  className="w-full h-full object-contain"
                  onError={e => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    ((e.target as HTMLImageElement).nextSibling as HTMLElement)?.classList.remove('hidden');
                  }}
                />
                <div className="hidden text-center text-gray-400 text-xs p-2">
                  <p className="text-3xl mb-2">📱</p>
                  <p>Add QR image at</p>
                  <p className="font-mono font-bold mt-1">public/upi-qr.png</p>
                </div>
              </div>
            </div>

            <p className="text-center text-[10px] text-[#636366] mb-4">
              GPay · PhonePe · Paytm · BHIM · Any UPI app
            </p>

            {/* UPI ID copy */}
            <div className="bg-[#242426] border border-white/[0.07] rounded-xl p-4 mb-4">
              <p className="text-[10px] text-[#636366] mb-2">Or pay to UPI ID</p>
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-bold text-[#F5F5F5] font-mono">{YOUR_UPI_ID}</span>
                <button
                  onClick={copyUpiId}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                    copied
                      ? 'bg-[#6BCB77]/20 text-[#6BCB77] border border-[#6BCB77]/30'
                      : 'bg-[#C8F75E]/15 text-[#C8F75E] border border-[#C8F75E]/30'
                  }`}
                >
                  {copied ? '✓ Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-[10px] text-[#636366] mt-2">
                Amount: <strong className="text-[#F5F5F5]">₹99</strong>
                {' · '}Note: <strong className="text-[#F5F5F5]">NutriSmart Pro</strong>
              </p>
            </div>

            <button
              onClick={() => setStep('utr')}
              className="w-full bg-[#C8F75E] text-[#111113] font-bold text-[14px] rounded-xl py-4 active:scale-[0.98]"
            >
              ✓ I've paid — Enter Transaction ID →
            </button>
            <button onClick={() => setStep('info')} className="w-full mt-2 py-2 text-[12px] text-[#636366]">
              ← Back
            </button>
          </>
        )}

        {/* ── STEP: utr ───────────────────────────────────────────── */}
        {step === 'utr' && (
          <>
            <div className="text-center mb-5">
              <div className="text-3xl mb-2">🔢</div>
              <h2 className="font-['Playfair_Display'] text-xl font-black text-[#F5F5F5]">
                Enter Transaction ID
              </h2>
              <p className="text-[12px] text-[#A1A1A1] mt-1">
                Found in your UPI app after paying
              </p>
            </div>

            {/* How to find UTR */}
            <div className="bg-[#242426] rounded-xl p-4 mb-4">
              <p className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px] mb-2">
                Where to find it
              </p>
              {[
                ['📱 GPay', 'Open app → tap payment → "UPI transaction ID"'],
                ['📱 PhonePe', 'History → tap payment → "Transaction ID"'],
                ['📱 Paytm', 'Passbook → tap payment → "Transaction Ref No"'],
                ['📱 BHIM', 'Transactions → tap payment → "Reference No"'],
              ].map(([app, help]) => (
                <div key={app} className="py-1.5 border-b border-white/[0.05] last:border-0">
                  <p className="text-[11px] font-semibold text-[#F5F5F5]">{app}</p>
                  <p className="text-[10px] text-[#636366]">{help}</p>
                </div>
              ))}
            </div>

            {/* UTR input */}
            <input
              type="text"
              value={utrInput}
              onChange={e => setUtrInput(e.target.value.toUpperCase())}
              placeholder="e.g. 426812345678 or GPAYxxxxxxxx"
              maxLength={22}
              className="w-full bg-[#242426] border border-white/[0.12] rounded-xl px-4 py-3.5 text-[15px] font-mono font-bold text-[#F5F5F5] outline-none placeholder-[#636366] mb-3 tracking-wider"
              autoCapitalize="characters"
              autoCorrect="off"
            />

            {/* Amount confirmation */}
            <label className="flex items-center gap-3 bg-[#242426] rounded-xl px-4 py-3.5 mb-4 cursor-pointer">
              <div
                onClick={() => setAmountConfirmed(v => !v)}
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                  amountConfirmed
                    ? 'bg-[#C8F75E] border-[#C8F75E]'
                    : 'border-[#636366]'
                }`}
              >
                {amountConfirmed && <span className="text-[#111113] text-[11px] font-black">✓</span>}
              </div>
              <span className="text-[13px] text-[#F5F5F5]">
                I confirm I paid exactly <strong className="text-[#C8F75E]">₹99</strong> to{' '}
                <strong className="text-[#C8F75E]">{YOUR_UPI_ID}</strong>
              </span>
            </label>

            {/* Error */}
            {errorMsg && (
              <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 mb-4 text-[12px] text-red-400">
                {errorMsg}
              </div>
            )}

            <button
              onClick={handleActivate}
              disabled={!utrInput.trim() || !amountConfirmed || activating}
              className="w-full bg-[#C8F75E] text-[#111113] font-bold text-[15px] rounded-xl py-4 disabled:opacity-40 active:scale-[0.98] transition-all"
            >
              🚀 Activate Pro Now
            </button>

            <p className="text-center text-[11px] text-[#636366] mt-3">
              Problem?{' '}
              <button onClick={openWhatsApp} className="text-[#C8F75E] underline">
                WhatsApp us
              </button>
            </p>
            <button onClick={() => setStep('qr')} className="w-full mt-2 py-2 text-[12px] text-[#636366]">
              ← Back
            </button>
          </>
        )}

        {/* ── STEP: activating ────────────────────────────────────── */}
        {step === 'activating' && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-[#C8F75E] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="font-['Playfair_Display'] text-xl font-black text-[#F5F5F5] mb-2">
              Verifying payment…
            </h2>
            <p className="text-[13px] text-[#636366]">This takes just a second</p>
          </div>
        )}

        {/* ── STEP: success (pending verification) ──────────────── */}
        {step === 'success' && (
          <div className="text-center py-6">
            <div className="text-5xl mb-4">⏳</div>
            <h2 className="font-['Playfair_Display'] text-2xl font-black text-[#F5F5F5] mb-2">
              Payment submitted!
            </h2>
            <p className="text-[13px] text-[#A1A1A1] mb-4 leading-relaxed">
              We received your transaction ID. We will verify the payment in your UPI app
              and activate Pro within <strong className="text-[#C8F75E]">a few hours</strong>.
            </p>
            <div className="bg-[#242426] rounded-xl p-4 mb-5 text-left">
              <p className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px] mb-3">What happens next</p>
              {[
                ['⏱', 'We check your UTR in our UPI app (usually within 2 hours)'],
                ['✓', 'We match ₹99 to your account'],
                ['🚀', "Pro activates automatically — you'll see it on refresh"],
                ['💬', "We'll WhatsApp you when it's done"],
              ].map(([icon, text]) => (
                <div key={text} className="flex items-start gap-2 py-1.5">
                  <span className="text-[14px] flex-shrink-0">{icon}</span>
                  <span className="text-[12px] text-[#A1A1A1]">{text}</span>
                </div>
              ))}
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 mb-5">
              <p className="text-[11px] text-yellow-400">
                If you don't hear back in 4 hours, message us on WhatsApp with your UTR number.
              </p>
            </div>
            <button onClick={openWhatsApp}
              className="w-full bg-[#25D366] text-white font-bold text-[13px] rounded-xl py-3 flex items-center justify-center gap-2 mb-3">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Send UTR on WhatsApp (faster activation)
            </button>
            <button onClick={onClose} className="w-full py-3 text-[12px] text-[#636366]">
              Close — I'll wait for activation
            </button>
          </div>
        )}

        {/* ── STEP: error ─────────────────────────────────────────── */}
        {step === 'error' && (
          <div className="text-center py-6">
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="font-['Playfair_Display'] text-xl font-black text-[#F5F5F5] mb-3">
              Activation issue
            </h2>
            <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-4 mb-5 text-left">
              <p className="text-[13px] text-red-400">{errorMsg}</p>
            </div>
            <button
              onClick={openWhatsApp}
              className="w-full bg-[#25D366] text-white font-bold text-[14px] rounded-xl py-4 flex items-center justify-center gap-2 mb-3"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Contact Support on WhatsApp
            </button>
            <button
              onClick={() => { setStep('utr'); setErrorMsg(''); }}
              className="w-full py-3 text-[12px] text-[#636366]"
            >
              ← Try again with a different UTR
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
