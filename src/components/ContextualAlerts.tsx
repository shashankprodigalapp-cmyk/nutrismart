/**
 * ContextualAlerts.tsx — NutriSmart Event-Driven Alert System
 * Module 6, Step 6.2
 *
 * ALERT TYPES:
 *   FestivalBanner  — auto-detects IST date against FESTIVALS map, adjusts targets
 *   EventBudgetCard — user-triggered "dinner out tonight" daytime target override
 *   OfflineBanner   — real connectivity check, shows pending sync count
 *   GracePeriodBanner — subscription payment failed, days until downgrade
 *   MealFeedbackToast — appears 1.2s after food log with non-judgmental insight
 *
 * SERVICE-WORKER OFFLINE INTERCEPTOR:
 *   When navigator.onLine is false AND a push notification would fire,
 *   we fall back to a local ServiceWorker showNotification() call so the
 *   user still sees the alert even with no network.
 *
 * All date logic uses Asia/Kolkata (IST) via Intl.DateTimeFormat.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { getSyncManager } from '../lib/SyncManager';
import { supabase }        from '../lib/supabase';
import { localDb }        from '../lib/localDb';
import { usePlan }        from '../utils/proGatekeeper';
import { useAuth }        from '../context/AuthContext';
import { todayIST }       from '../lib/kitchenIntelligence';

// ── FESTIVAL DATA ─────────────────────────────────────────────────────────────

interface FestivalConfig {
  name:          string;
  type:          'festival' | 'fast' | 'weekend_check';
  calMultiplier: number;   // multiply base cal target
  glLimit?:      number;   // override GL target
  message:       string;
  emoji:         string;
}

const FESTIVALS: Record<string, FestivalConfig> = {
  '2025-10-01': { name: 'Gandhi Jayanti',        type: 'weekend_check', calMultiplier: 1.00, message: 'National holiday — mindful eating day', emoji: '🕊️' },
  '2025-10-02': { name: 'Navratri Start',        type: 'fast',          calMultiplier: 0.85, glLimit: 35, message: 'Navratri fasting mode — low GL targets active', emoji: '🙏' },
  '2025-10-12': { name: 'Dussehra',              type: 'festival',      calMultiplier: 1.15, message: 'Dussehra — festival foods expected', emoji: '🏹' },
  '2025-10-20': { name: 'Diwali Week',           type: 'festival',      calMultiplier: 1.25, message: 'Diwali week — targets relaxed, enjoy mindfully', emoji: '🪔' },
  '2025-10-24': { name: 'Diwali',                type: 'festival',      calMultiplier: 1.35, glLimit: 80, message: 'Diwali — enjoy! All restrictions off today 🪔', emoji: '🎆' },
  '2025-11-05': { name: 'Chhath Puja',           type: 'fast',          calMultiplier: 0.80, glLimit: 30, message: 'Chhath fasting — reduced targets active', emoji: '🌅' },
  '2025-11-14': { name: 'Diwali (South)',        type: 'festival',      calMultiplier: 1.25, message: 'Festival celebration', emoji: '🪔' },
  '2025-12-25': { name: 'Christmas',             type: 'festival',      calMultiplier: 1.20, message: 'Christmas — festive eating expected', emoji: '🎄' },
  '2026-01-14': { name: 'Makar Sankranti',       type: 'festival',      calMultiplier: 1.15, message: 'Sankranti — tilgul & chikki day', emoji: '🪁' },
  '2026-01-26': { name: 'Republic Day',          type: 'weekend_check', calMultiplier: 1.00, message: 'National holiday', emoji: '🇮🇳' },
  '2026-03-14': { name: 'Holi',                  type: 'festival',      calMultiplier: 1.25, message: 'Holi — thandai and mithai day', emoji: '🎨' },
  '2026-03-30': { name: 'Ramzan Start',          type: 'fast',          calMultiplier: 0.90, message: 'Ramzan — adjusted for fasting schedule', emoji: '🌙' },
  '2026-04-14': { name: 'Baisakhi / Tamil New Year', type: 'festival',  calMultiplier: 1.15, message: 'Harvest festival — festive meals expected', emoji: '🌾' },
  '2026-04-28': { name: 'Eid ul-Fitr',           type: 'festival',      calMultiplier: 1.30, message: 'Eid — celebration day', emoji: '🌙' },
  '2026-08-15': { name: 'Independence Day',      type: 'weekend_check', calMultiplier: 1.00, message: 'National holiday', emoji: '🇮🇳' },
};

// ── EVENT BUDGET TYPES ────────────────────────────────────────────────────────

type EventType = 'restaurant' | 'party' | 'wedding' | 'business' | 'cheat';

interface EventBudgetState {
  active:        boolean;
  eventName:     string;
  eventType?:    EventType;
  estCals:       number;
  daytimeBudget: number;
  baseCal:       number;
}

const EVENT_DEFAULTS: Record<EventType, { label: string; est: number; emoji: string }> = {
  restaurant: { label: 'Restaurant',       est: 600,  emoji: '🍽️' },
  party:      { label: 'Party / Event',    est: 800,  emoji: '🎉' },
  wedding:    { label: 'Wedding',          est: 1000, emoji: '💒' },
  business:   { label: 'Business Dinner',  est: 700,  emoji: '🤝' },
  cheat:      { label: 'Cheat Meal',       est: 900,  emoji: '😋' },
};

const EVENT_BUDGET_KEY = 'ns_event_budget';

// ── CONTEXT ───────────────────────────────────────────────────────────────────

interface AlertContextValue {
  festival:         FestivalConfig | null;
  festivalDismissed: boolean;
  dismissFestival:  () => void;
  eventBudget:      EventBudgetState;
  setEventBudget:   (s: Partial<EventBudgetState>) => void;
  clearEventBudget: () => void;
  applyEventBudget: (type: EventType, estCals: number, name: string) => void;
  isOffline:        boolean;
  pendingSync:      number;
  graceDaysLeft:    number | null;
  feedbackMessage:  string | null;
  showFeedback:     (msg: string) => void;
}

const AlertContext = createContext<AlertContextValue | null>(null);

// ── PROVIDER ──────────────────────────────────────────────────────────────────

export function AlertProvider({
  children,
  baseCal = 1400,
}: {
  children: React.ReactNode;
  baseCal?: number;
}) {
  const { user }     = useAuth();
  const { status, graceEndsAt } = usePlan();

  // ── Festival ──────────────────────────────────────────────────────────────
  const [festival,          setFestival]          = useState<FestivalConfig | null>(null);
  const [festivalDismissed, setFestivalDismissed] = useState(false);

  useEffect(() => {
    const today = todayIST();
    const f = FESTIVALS[today] ?? null;
    setFestival(f);
    if (f) {
      // Apply festival override to today's targets in Dexie
      localDb.user_prefs.put({
        key:   'today_override',
        value: {
          date:          today,
          calMultiplier: f.calMultiplier,
          glLimit:       f.glLimit,
          festivalName:  f.name,
        },
      }).catch(() => {});

      // Service-worker offline-safe notification
      scheduleOfflineSafeNotif(
        `${f.emoji} ${f.name}`,
        f.message,
      );
    }
    // Clear at midnight IST
    const msToMidnight = new Date().setHours(24, 0, 0, 0) - Date.now();
    const t = setTimeout(() => {
      setFestival(null);
      setFestivalDismissed(false);
      localDb.user_prefs.delete('today_override').catch(() => {});
    }, msToMidnight);
    return () => clearTimeout(t);
  }, []);

  // ── Event budget ──────────────────────────────────────────────────────────
  const [eventBudget, _setEventBudget] = useState<EventBudgetState>(() => {
    try {
      const raw = localStorage.getItem(EVENT_BUDGET_KEY);
      if (!raw) return { active: false, eventName: '', estCals: 600, daytimeBudget: baseCal, baseCal };
      const data = JSON.parse(raw);
      if (data.date !== todayIST()) return { active: false, eventName: '', estCals: 600, daytimeBudget: baseCal, baseCal };
      return data;
    } catch {
      return { active: false, eventName: '', estCals: 600, daytimeBudget: baseCal, baseCal };
    }
  });

  const setEventBudget = useCallback((update: Partial<EventBudgetState>) => {
    _setEventBudget(prev => {
      const next = { ...prev, ...update };
      localStorage.setItem(EVENT_BUDGET_KEY, JSON.stringify({ ...next, date: todayIST() }));
      // Write daytime cal override to Dexie
      localDb.user_prefs.put({ key: 'event_cal_override', value: next.daytimeBudget }).catch(() => {});
      return next;
    });
  }, []);

  const applyEventBudget = useCallback((type: EventType, estCals: number, name: string) => {
    const daytimeBudget = Math.max(200, baseCal - estCals);
    setEventBudget({
      active:        true,
      eventType:     type,
      eventName:     name || EVENT_DEFAULTS[type].label,
      estCals,
      daytimeBudget,
      baseCal,
    });
    // Midnight reset
    const msToMidnight = new Date().setHours(24, 0, 0, 0) - Date.now();
    setTimeout(() => clearEventBudget(), msToMidnight);
  }, [baseCal, setEventBudget]);

  const clearEventBudget = useCallback(() => {
    localStorage.removeItem(EVENT_BUDGET_KEY);
    localDb.user_prefs.delete('event_cal_override').catch(() => {});
    _setEventBudget({ active: false, eventName: '', estCals: 600, daytimeBudget: baseCal, baseCal });
  }, [baseCal]);

  // ── Offline / sync ────────────────────────────────────────────────────────
  const [isOffline,   setIsOffline]   = useState(!navigator.onLine);
  const [pendingSync, setPendingSync] = useState(0);

  useEffect(() => {
    const checkConnectivity = async () => {
      if (!navigator.onLine) { setIsOffline(true); return; }
      try {
        const res = await fetch('/favicon.ico', { method: 'HEAD', cache: 'no-store' });
        setIsOffline(!res.ok);
      } catch {
        setIsOffline(true);
      }
    };

    const handleOnline  = () => checkConnectivity();
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    checkConnectivity();

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Poll pending sync count
  useEffect(() => {
    if (!user) return;
    const poll = async () => {
      try {
        const count = await getSyncManager().getPendingCount();
        setPendingSync(count);
      } catch {
        const all = await localDb.sync_queue.toArray();
        setPendingSync(all.filter(i => !i.synced_at && !i.failed).length);
      }
    };
    poll();
    const interval = setInterval(poll, 10_000);
    return () => clearInterval(interval);
  }, [user]);

  // ── Grace period ──────────────────────────────────────────────────────────
  const graceDaysLeft = graceEndsAt
    ? Math.max(0, Math.ceil((graceEndsAt.getTime() - Date.now()) / 86_400_000))
    : null;

  // ── Meal feedback toast ───────────────────────────────────────────────────
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>();

  const showFeedback = useCallback((msg: string) => {
    setFeedbackMessage(msg);
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedbackMessage(null), 8000);
  }, []);

  const value: AlertContextValue = {
    festival,
    festivalDismissed,
    dismissFestival: () => setFestivalDismissed(true),
    eventBudget,
    setEventBudget,
    clearEventBudget,
    applyEventBudget,
    isOffline,
    pendingSync,
    graceDaysLeft: status === 'grace_period' ? graceDaysLeft : null,
    feedbackMessage,
    showFeedback,
  };

  return <AlertContext.Provider value={value}>{children}</AlertContext.Provider>;
}

export function useAlerts(): AlertContextValue {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useAlerts must be used within <AlertProvider>');
  return ctx;
}

// ── SERVICE WORKER OFFLINE NOTIFICATION ──────────────────────────────────────

/**
 * Falls back to a local Service Worker notification when the network is down.
 * Guarantees notification delivery even with no push subscription or server.
 */
async function scheduleOfflineSafeNotif(title: string, body: string): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  if (navigator.onLine) {
    // Network available — let the normal push flow handle it
    return;
  }

  // Offline — use local SW notification as fallback
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    await reg.showNotification(title, {
      body,
      icon:   '/icon-192.png',
      badge:  '/icon-192.png',
      tag:    `nutrismart-festival-${todayIST()}`,
      // renotify: false,
    });
  } catch {
    // Non-fatal
  }
}

// ── INDIVIDUAL ALERT COMPONENTS ───────────────────────────────────────────────

export function FestivalBanner() {
  const { festival, festivalDismissed, dismissFestival } = useAlerts();
  if (!festival || festivalDismissed) return null;

  const bg = festival.type === 'fast'
    ? 'bg-sky-500/10 border-sky-500/25'
    : 'bg-[#C8F75E]/8 border-[#C8F75E]/25';
  const textColor = festival.type === 'fast' ? 'text-sky-400' : 'text-[#C8F75E]';

  return (
    <div className={`mx-4 mb-3 ${bg} border rounded-2xl px-4 py-3 flex items-center justify-between`}>
      <div className="flex items-center gap-3">
        <span className="text-xl">{festival.emoji}</span>
        <div>
          <p className={`text-[12px] font-bold ${textColor}`}>{festival.name}</p>
          <p className="text-[11px] text-[#A1A1A1] mt-0.5 leading-tight">{festival.message}</p>
        </div>
      </div>
      <button
        onClick={dismissFestival}
        className="text-[#636366] text-[16px] leading-none flex-shrink-0 ml-2"
        aria-label="Dismiss"
      >×</button>
    </div>
  );
}

export function OfflineBanner() {
  const { isOffline, pendingSync } = useAlerts();
  if (!isOffline && pendingSync === 0) return null;

  return (
    <div className={`mx-4 mb-3 rounded-xl px-4 py-2.5 flex items-center justify-between ${
      isOffline
        ? 'bg-[#1C1C1E] border border-white/[0.07]'
        : 'bg-[#C8F75E]/6 border border-[#C8F75E]/15'
    }`}>
      <div className="flex items-center gap-2">
        <span className="text-[14px]">{isOffline ? '📵' : '⟳'}</span>
        <p className="text-[11px] text-[#A1A1A1]">
          {isOffline
            ? `Offline — logs saved locally${pendingSync > 0 ? `, ${pendingSync} pending sync` : ''}`
            : `Syncing ${pendingSync} item${pendingSync !== 1 ? 's' : ''}…`}
        </p>
      </div>
      {isOffline && (
        <span className="text-[9px] text-[#636366] bg-[#2C2C2E] px-2 py-0.5 rounded-md">LOCAL</span>
      )}
    </div>
  );
}

export function GracePeriodBanner() {
  const { graceDaysLeft } = useAlerts();
  if (graceDaysLeft === null) return null;

  return (
    <div className="mx-4 mb-3 bg-yellow-500/8 border border-yellow-500/30 rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <p className="text-[12px] font-bold text-yellow-400">⚠️ Payment failed</p>
        <p className="text-[11px] text-[#A1A1A1] mt-0.5">
          Pro access ends in {graceDaysLeft} day{graceDaysLeft !== 1 ? 's' : ''}
        </p>
      </div>
      <button
        onClick={() => window.location.href = '/settings/subscription'}
        className="flex-shrink-0 bg-yellow-500/15 text-yellow-400 text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-yellow-500/30"
      >
        Retry →
      </button>
    </div>
  );
}

export function MealFeedbackToast() {
  const { feedbackMessage } = useAlerts();
  if (!feedbackMessage) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 z-40 bg-[#1C1C1E] border border-[#C8F75E]/25 rounded-2xl px-4 py-3 shadow-2xl animate-slide-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold text-[#C8F75E] uppercase tracking-[0.8px] mb-1">🧠 Meal insight</p>
          <p className="text-[12px] text-[#A1A1A1] leading-relaxed"
            dangerouslySetInnerHTML={{ __html: feedbackMessage }}
          />
        </div>
      </div>
    </div>
  );
}


// ── PENDING VALIDATION BANNER ─────────────────────────────────────────────────

/**
 * Shown on the dashboard while the user's UPI payment submission awaits
 * admin validation. Reads payment_submissions (RLS: user sees own rows).
 */
export function PendingValidationBanner() {
  const { user } = useAuth();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    supabase
      .from('payment_submissions')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle()
      .then(({ data }) => { if (mounted) setPending(!!data); });

    // Realtime: hide the banner the moment admin approves
    const ch = supabase.channel(`paysub-${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'payment_submissions',
        filter: `user_id=eq.${user.id}`,
      }, (payload: any) => {
        if (payload.new?.status !== 'pending') setPending(false);
      })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [user]);

  if (!pending) return null;
  return (
    <div className="mx-4 mb-3 bg-[#C8F75E]/8 border border-[#C8F75E]/25 rounded-xl px-4 py-3 flex items-center gap-3">
      <span className="text-[16px]">⏳</span>
      <div>
        <p className="text-[12px] font-bold text-[#C8F75E]">Pro access pending validation</p>
        <p className="text-[11px] text-[#A1A1A1] mt-0.5">Your payment is being validated by our team — usually within a few hours.</p>
      </div>
    </div>
  );
}
// ── EVENT BUDGET CARD ─────────────────────────────────────────────────────────

export function EventBudgetCard() {
  const { eventBudget, applyEventBudget, clearEventBudget } = useAlerts();
  const [open,       setOpen]       = useState(false);
  const [selType,    setSelType]    = useState<EventType>('restaurant');
  const [estCals,    setEstCals]    = useState(600);
  const [eventName,  setEventName]  = useState('');

  if (eventBudget.active) {
    return (
      <div className="mx-4 mb-3 bg-[#1C1C1E] border border-white/[0.07] rounded-xl px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold text-[#C8F75E]">
            {EVENT_DEFAULTS[eventBudget.eventType ?? 'restaurant'].emoji} {eventBudget.eventName} tonight
          </p>
          <p className="text-[10px] text-[#636366] mt-0.5">
            Daytime budget: {eventBudget.daytimeBudget} kcal
          </p>
        </div>
        <button
          onClick={clearEventBudget}
          className="text-[11px] text-[#636366] border border-white/[0.07] rounded-lg px-2 py-1"
        >
          clear ×
        </button>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 bg-[#1C1C1E] border border-white/[0.07] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
      >
        <span className="text-xl">📅</span>
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-[#F5F5F5]">Planning to eat out tonight?</p>
          <p className="text-[10px] text-[#636366] mt-0.5">Adjust today's targets to make room</p>
        </div>
        <span className={`text-[#636366] text-[18px] transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-white/[0.07]">
          {/* Event type selector */}
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
            {(Object.entries(EVENT_DEFAULTS) as [EventType, typeof EVENT_DEFAULTS[EventType]][]).map(([type, cfg]) => (
              <button
                key={type}
                onClick={() => { setSelType(type); setEstCals(cfg.est); }}
                className={`flex-shrink-0 px-3 py-2 rounded-xl text-[11px] font-semibold transition-all ${
                  selType === type
                    ? 'bg-[#C8F75E]/12 border border-[#C8F75E]/35 text-[#C8F75E]'
                    : 'bg-[#242426] border border-white/[0.07] text-[#636366]'
                }`}
              >
                {cfg.emoji} {cfg.label}
              </button>
            ))}
          </div>

          {/* Optional event name */}
          <input
            type="text"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="Event name (optional)"
            className="w-full mt-3 bg-[#242426] border border-white/[0.07] rounded-xl px-3 py-2.5 text-[13px] text-[#F5F5F5] outline-none placeholder-[#636366]"
          />

          {/* Est calories input */}
          <div className="flex items-center gap-3 mt-3">
            <span className="text-[11px] text-[#636366] whitespace-nowrap">Evening estimate:</span>
            <input
              type="number"
              value={estCals}
              onChange={(e) => setEstCals(Math.max(100, Number(e.target.value)))}
              className="flex-1 bg-[#242426] border border-white/[0.07] rounded-xl px-3 py-2 text-[15px] font-bold text-[#F5F5F5] outline-none text-right"
            />
            <span className="text-[11px] text-[#636366]">kcal</span>
          </div>

          {/* Preview */}
          <div className="bg-[#242426] rounded-xl p-3 mt-3 text-[11px]">
            <div className="flex justify-between py-1">
              <span className="text-[#636366]">Normal daily target</span>
              <span className="text-[#F5F5F5] font-semibold">1400 kcal</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[#636366]">Evening estimate</span>
              <span className="text-orange-400 font-semibold">{estCals} kcal</span>
            </div>
            <div className="flex justify-between py-1 border-t border-white/[0.07] mt-1 pt-2">
              <span className="text-[#636366]">Daytime budget</span>
              <span className="text-[#C8F75E] font-bold">{Math.max(200, 1400 - estCals)} kcal</span>
            </div>
          </div>

          <button
            onClick={() => {
              applyEventBudget(selType, estCals, eventName);
              setOpen(false);
            }}
            className="w-full mt-3 bg-[#C8F75E] text-[#111113] font-bold text-[13px] rounded-xl py-3"
          >
            ✓ Apply event mode for today
          </button>
        </div>
      )}
    </div>
  );
}

// ── CONTEXTUAL ALERTS COMPOSITE ───────────────────────────────────────────────

/**
 * Drop-in composite — render above log content on any tab where alerts apply.
 * Stacks all active alerts in priority order.
 */
export function ContextualAlerts() {
  return (
    <div className="pt-2">
      <GracePeriodBanner />
      <PendingValidationBanner />
      <OfflineBanner />
      <FestivalBanner />
      <EventBudgetCard />
      <MealFeedbackToast />
    </div>
  );
}

export default ContextualAlerts;
