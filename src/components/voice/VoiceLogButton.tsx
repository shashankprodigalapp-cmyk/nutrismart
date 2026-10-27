import React, { useEffect, useRef, useState } from 'react';

type Lang = 'en-IN' | 'hi-IN';
interface Props { onTranscript: (text: string, lang: Lang) => void; onStatus?: (s: { listening: boolean; message: string | null }) => void; disabled?: boolean }

function getRecognition(): any | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
const readLang = (): Lang => { try { return localStorage.getItem('ns_voice_lang') === 'hi-IN' ? 'hi-IN' : 'en-IN'; } catch { return 'en-IN'; } };

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser settings, then try again.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in your browser settings, then try again.',
  'no-speech': 'Did not hear anything. Tap the mic and speak a little closer.',
  'audio-capture': 'No microphone found on this device.',
  network: 'Voice needs an internet connection. You can still type your food.',
};

/** Mic button. The browser's own speech service turns speech into text; NutriSmart never receives or stores audio. */
export function VoiceLogButton({ onTranscript, onStatus, disabled }: Props) {
  const Rec = typeof window !== 'undefined' ? getRecognition() : null;
  const [lang, setLang] = useState<Lang>(readLang);
  const [listening, setListening] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const recRef = useRef<any>(null);
  const gotRef = useRef(false);

  useEffect(() => { onStatus?.({ listening, message: msg }); }, [listening, msg]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* already stopped */ } }, []);
  if (!Rec) return null;   // browsers without speech support simply don't show the button

  function start() {
    setMsg(null); gotRef.current = false;
    const r = new Rec();
    r.lang = lang; r.interimResults = false; r.maxAlternatives = 1; r.continuous = false;
    r.onresult = (e: any) => {
      const text = String(e.results?.[0]?.[0]?.transcript ?? '').trim();
      if (text) { gotRef.current = true; onTranscript(text, lang); }
    };
    r.onerror = (e: any) => setMsg(ERRORS[e.error] ?? 'Voice did not work this time. You can type instead.');
    r.onend = () => { setListening(false); if (!gotRef.current) setMsg(m => m ?? 'Did not catch that. Tap the mic and try again.'); };
    recRef.current = r;
    try { r.start(); setListening(true); } catch { setMsg('Could not start the microphone.'); }
  }
  function stop() { try { recRef.current?.stop(); } catch { /* ignore */ } }
  function toggleLang() {
    const n: Lang = lang === 'en-IN' ? 'hi-IN' : 'en-IN';
    setLang(n); try { localStorage.setItem('ns_voice_lang', n); } catch { /* optional */ }
  }

  return (
    <>
      <button onClick={listening ? stop : start} disabled={disabled} aria-pressed={listening}
        aria-label={listening ? 'Stop listening' : 'Say what you ate'} title="Say what you ate"
        className={`text-[20px] min-w-[40px] min-h-[40px] flex items-center justify-center active:scale-90 transition-all ${listening ? 'text-[#FF6B6B] animate-pulse' : 'opacity-60 hover:opacity-100'} disabled:opacity-30`}>
        {listening ? '⏺' : '🎤'}
      </button>
      <button onClick={toggleLang} aria-label={`Voice language: ${lang === 'en-IN' ? 'English' : 'Hindi'}. Tap to switch`}
        className="text-[11px] min-w-[40px] min-h-[40px] text-[#8E8E93]">{lang === 'en-IN' ? 'EN' : 'हि'}</button>
    </>
  );
}
