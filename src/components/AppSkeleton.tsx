/**
 * AppSkeleton.tsx — Full-screen loading state
 * Shown while auth session resolves or kitchen profile is being checked.
 * Prevents flash-of-login-screen on valid returning sessions.
 */
import React from 'react';

export function AppSkeleton() {
  return (
    <div className="min-h-dvh bg-[#111113] flex flex-col items-center justify-center gap-4">
      <div className="text-4xl animate-pulse">🥗</div>
      <div className="flex gap-1">
        <span className="w-2 h-2 rounded-full bg-[#C8F75E] animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 rounded-full bg-[#C8F75E] animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 rounded-full bg-[#C8F75E] animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}
