/**
 * UpiPaymentFlow.tsx — Module 5 UI: UPI Payment Submission
 *
 * Steps: pay (QR + copy UPI ID) → proof (UTR + optional screenshot URL) → pending
 * POSTs to /.netlify/functions/submit-payment.
 * Used inside UpgradeModal, replacing the Razorpay checkout.
 */

import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

// ── EDIT THESE TWO LINES ──────────────────────
const YOUR_UPI_ID          = 'yourname@ybl';
const YOUR_WHATSAPP_NUMBER = '919876543210';
// ──────────────────────────────────────────────

type Step = 'pay' | 'proof' | 'submitting' | 'pending' | 'error';

export function UpiPaymentFlow({ onDone }: { onDone: () => void }) {
  const [step,     setStep]     = useState<Step>('pay');
  const [copied,   setCopied]   = useState(false);
  const [utr,        setUtr]        = useState('');
  const [proofUrl,   setProofUrl]   = useState('');
  const [errorMsg,   setErrorMsg]   = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState('');

  const copyUpi = async () => {
    try { await navigator.clipboard.writeText(YOUR_UPI_ID); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };


  // AUDIT FIX R3 — "kill the typing": screenshot → Gemini Vision → UTR auto-fill.
  // Upload via signed URL (R2 infra), then /extract-utr reads it server-side.
  const handleScreenshot = async (file: File) => {
    setExtracting(true);
    setExtractMsg('');
    setErrorMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Session expired');
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      };

      // 1. Get signed upload URL (payment-proof purpose = not Pro-gated)
      const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
      const urlRes = await fetch('/.netlify/functions/get-upload-url', {
        method: 'POST', headers,
        body: JSON.stringify({ ext, purpose: 'payment-proof' }),
      });
      const urlData = await urlRes.json();
      if (!urlData.success) throw new Error(urlData.message ?? 'Upload prep failed');

      // 2. PUT file directly to storage
      const putRes = await fetch(urlData.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'image/jpeg' },
        body: file,
      });
      if (!putRes.ok) throw new Error('Upload failed — try again');

      // 3. Extract UTR server-side
      const exRes = await fetch('/.netlify/functions/extract-utr', {
        method: 'POST', headers,
        body: JSON.stringify({ image_path: urlData.path }),
      });
      const exData = await exRes.json();

      if (exData.utr) {
        setUtr(exData.utr);
        setExtractMsg(exData.amount_matches
          ? '✓ Found it! Transaction ID filled and ₹99 confirmed.'
          : `✓ Transaction ID filled. Amount read as ₹${exData.amount ?? '?'} — please verify.`);
      } else {
        setExtractMsg('Could not read the ID from this screenshot — please type it below.');
      }
    } catch (e: any) {
      setExtractMsg(e.message ?? 'Screenshot reading failed — please type the UTR manually.');
    } finally {
      setExtracting(false);
    }
  };

  const submit = async () => {
    if (!utr.trim()) { setErrorMsg('Please enter your transaction ID.'); return; }
    setStep('submitting');
    setErrorMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setErrorMsg('Session expired — please log in again.'); setStep('error'); return; }

      const res = await fetch('/.netlify/functions/submit-payment', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          transaction_id: utr.trim(),
          proof_url:      proofUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) setStep('pending');
      else { setErrorMsg(data.message ?? 'Submission failed.'); setStep('error'); }
    } catch {
      setErrorMsg('Network error — check your connection and retry.');
      setStep('error');
    }
  };

  const openWhatsApp = () => {
    const msg = encodeURIComponent(
      `Hi! I paid ₹99 for NutriSmart Pro.\nUTR: ${utr || '(my UTR)'}\nPlease validate my payment.`
    );
    window.open(`https://wa.me/${YOUR_WHATSAPP_NUMBER}?text=${msg}`, '_blank');
  };

  // ── STEP: pay ─────────────────────────────────────────────────────────────
  if (step === 'pay') return (
    <>
      <div className="text-center mb-4">
        <h2 className="font-['Playfair_Display'] text-xl font-black text-[#F5F5F5]">Pay ₹99 via UPI</h2>
        <p className="text-[12px] text-[#A1A1A1] mt-1">Scan or copy the UPI ID, then submit proof</p>
      </div>

      <div className="flex justify-center mb-4">
        <div className="bg-white rounded-2xl p-4 w-52 h-52 flex items-center justify-center">
          <img src="/upi-qr.png" alt="UPI QR"
            className="w-full h-full object-contain"
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none';
              ((e.target as HTMLImageElement).nextSibling as HTMLElement)?.classList.remove('hidden');
            }} />
          <div className="hidden text-center text-gray-400 text-xs p-2">
            <p className="text-3xl mb-2">📱</p><p>Add QR at</p>
            <p className="font-mono font-bold">public/upi-qr.png</p>
          </div>
        </div>
      </div>

      <div className="bg-[#242426] border border-white/[0.07] rounded-xl p-4 mb-4">
        <p className="text-[10px] text-[#636366] mb-2">Or pay to UPI ID</p>
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-bold font-mono text-[#F5F5F5]">{YOUR_UPI_ID}</span>
          <button onClick={copyUpi}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold ${
              copied ? 'bg-[#6BCB77]/20 text-[#6BCB77] border border-[#6BCB77]/30'
                     : 'bg-[#C8F75E]/15 text-[#C8F75E] border border-[#C8F75E]/30'}`}>
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
        </div>
        <p className="text-[10px] text-[#636366] mt-2">
          Amount: <strong className="text-[#F5F5F5]">₹99</strong> · Note: <strong className="text-[#F5F5F5]">NutriSmart Pro</strong>
        </p>
      </div>

      <p className="text-[10px] text-[#636366] text-center mb-2">
        By paying you agree to our{' '}
        <a href="/legal/terms.html" target="_blank" className="underline text-[#636366] hover:text-[#C8F75E]">Terms</a>
        {' '}&amp;{' '}
        <a href="/legal/privacy.html" target="_blank" className="underline text-[#636366] hover:text-[#C8F75E]">Privacy Policy</a>
      </p>
      <button onClick={() => setStep('proof')}
        className="w-full bg-[#C8F75E] text-[#111113] font-bold text-[14px] rounded-xl py-4 active:scale-[0.98]">
        ✓ I've paid — Upload Proof →
      </button>
    </>
  );

  // ── STEP: proof ───────────────────────────────────────────────────────────
  if (step === 'proof') return (
    <>
      <div className="text-center mb-5">
        <div className="text-3xl mb-2">🧾</div>
        <h2 className="font-['Playfair_Display'] text-xl font-black text-[#F5F5F5]">Submit Payment Proof</h2>
        <p className="text-[12px] text-[#A1A1A1] mt-1">Enter the UTR from your UPI app</p>
      </div>

      {/* Screenshot-first: 3 taps beat a scavenger hunt */}
      <label className={`block w-full border-2 border-dashed rounded-xl p-4 mb-3 text-center cursor-pointer transition-colors ${
        extracting ? 'border-[#C8F75E]/40 bg-[#C8F75E]/5' : 'border-white/[0.15] bg-[#242426]'}`}>
        <input type="file" accept="image/*" className="hidden" disabled={extracting}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleScreenshot(f); }} />
        {extracting ? (
          <span className="flex items-center justify-center gap-2 text-[13px] text-[#C8F75E]">
            <span className="w-4 h-4 border-2 border-[#C8F75E] border-t-transparent rounded-full animate-spin" />
            Reading your screenshot…
          </span>
        ) : (
          <>
            <span className="text-[22px] block mb-1">📸</span>
            <span className="text-[13px] font-semibold text-[#C8F75E]">Upload payment screenshot</span>
            <span className="block text-[10px] text-[#636366] mt-1">We'll read the transaction ID automatically</span>
          </>
        )}
      </label>
      {extractMsg && (
        <p className={`text-[11px] mb-3 px-1 ${extractMsg.startsWith('✓') ? 'text-[#6BCB77]' : 'text-yellow-400'}`}>
          {extractMsg}
        </p>
      )}
      <p className="text-[10px] text-[#636366] text-center mb-2">— or type it manually —</p>

      <input type="text" value={utr}
        onChange={e => setUtr(e.target.value.toUpperCase())}
        placeholder="Transaction ID / UTR (e.g. 426812345678)"
        maxLength={22} autoCapitalize="characters" autoCorrect="off"
        className="w-full bg-[#242426] border border-white/[0.12] rounded-xl px-4 py-3.5 text-[15px] font-mono font-bold text-[#F5F5F5] outline-none placeholder-[#636366] mb-3 tracking-wider" />

      <input type="url" value={proofUrl}
        onChange={e => setProofUrl(e.target.value)}
        placeholder="Screenshot link (optional — Drive/Imgur URL)"
        className="w-full bg-[#242426] border border-white/[0.07] rounded-xl px-4 py-3 text-[13px] text-[#F5F5F5] outline-none placeholder-[#636366] mb-4" />

      <div className="bg-[#242426] rounded-xl p-3 mb-4">
        <p className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px] mb-1">Where's my UTR?</p>
        <p className="text-[11px] text-[#A1A1A1]">
          GPay: tap the payment → "UPI transaction ID" · PhonePe: History → "Transaction ID" · Paytm: Passbook → "Ref No"
        </p>
      </div>

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 mb-3 text-[12px] text-red-400">{errorMsg}</div>
      )}

      <button onClick={submit} disabled={!utr.trim()}
        className="w-full bg-[#C8F75E] text-[#111113] font-bold text-[14px] rounded-xl py-4 disabled:opacity-40">
        📤 Submit for Validation
      </button>
      <button onClick={() => setStep('pay')} className="w-full mt-2 py-2 text-[12px] text-[#636366]">← Back</button>
    </>
  );

  // ── STEP: submitting ──────────────────────────────────────────────────────
  if (step === 'submitting') return (
    <div className="text-center py-12">
      <div className="w-10 h-10 border-4 border-[#C8F75E] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
      <p className="text-[14px] text-[#F5F5F5] font-semibold">Submitting…</p>
    </div>
  );

  // ── STEP: pending ─────────────────────────────────────────────────────────
  if (step === 'pending') return (
    <div className="text-center py-4">
      <div className="text-5xl mb-4">🎉</div>
      <h2 className="font-['Playfair_Display'] text-2xl font-black text-[#F5F5F5] mb-2">Pro unlocked! 🎉</h2>
      <p className="text-[13px] text-[#A1A1A1] mb-5 leading-relaxed">
        All Pro features are <strong className="text-[#C8F75E]">active right now</strong> while
        we verify your payment (within 24 hours). No waiting.
      </p>
      <button onClick={openWhatsApp}
        className="w-full bg-[#25D366] text-white font-bold text-[13px] rounded-xl py-3 mb-3">
        💬 WhatsApp us for faster validation
      </button>
      <button onClick={onDone}
        className="w-full bg-[#C8F75E] text-[#111113] font-bold text-[14px] rounded-xl py-3.5">
        Done
      </button>
    </div>
  );

  // ── STEP: error ───────────────────────────────────────────────────────────
  return (
    <div className="text-center py-4">
      <div className="text-4xl mb-4">⚠️</div>
      <h2 className="font-['Playfair_Display'] text-xl font-black text-[#F5F5F5] mb-3">Something went wrong</h2>
      <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-4 mb-5 text-left">
        <p className="text-[13px] text-red-400">{errorMsg}</p>
      </div>
      <button onClick={() => { setStep('proof'); setErrorMsg(''); }}
        className="w-full bg-[#C8F75E] text-[#111113] font-bold text-[14px] rounded-xl py-3.5 mb-2">
        Try again
      </button>
      <button onClick={openWhatsApp} className="w-full py-2 text-[12px] text-[#C8F75E] underline">
        Contact support on WhatsApp
      </button>
    </div>
  );
}

export default UpiPaymentFlow;
