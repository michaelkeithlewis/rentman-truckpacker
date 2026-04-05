"use client";

import { useEffect, useState } from "react";
import { hasTokens } from "@/lib/api";
import Link from "next/link";

export function SetupGuard({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    setReady(hasTokens());
  }, []);

  // Still checking (avoids flash)
  if (ready === null) return null;

  if (!ready) {
    return (
      <div className="max-w-md mx-auto py-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-6">
          <span className="text-2xl">⚡</span>
        </div>
        <h1 className="text-xl font-bold mb-2">Connect Your Accounts</h1>
        <p className="text-gray-500 mb-6">
          Add your Rentman and Truck Packer API keys to get started. Keys are
          stored locally in your browser — nothing is sent to any third party.
        </p>
        <Link
          href="/settings"
          className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium text-sm transition"
        >
          Go to Settings
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
