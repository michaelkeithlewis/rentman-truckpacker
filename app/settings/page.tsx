"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getActiveProvider, setActiveProvider } from "@/lib/api";
import type { ProviderId } from "@/lib/api";

interface TestResult {
  ok: boolean;
  message?: string;
  error?: string;
}

const PROVIDERS: { id: ProviderId; name: string; tokenHelp: string; placeholder: string }[] = [
  {
    id: "rentman",
    name: "Rentman",
    tokenHelp: "Find your token in Rentman → Configuration → Extensions → Webshop → \"show token\"",
    placeholder: "eyJhbGciOiJIUz...",
  },
  {
    id: "currentrms",
    name: "Current RMS",
    tokenHelp: "Get your API token from Current RMS → System Preferences → API",
    placeholder: "your-currentrms-api-token",
  },
];

export default function SettingsPage() {
  const [provider, setProvider] = useState<ProviderId>("rentman");
  const [rentmanToken, setRentmanToken] = useState("");
  const [currentrmsToken, setCurrentrmsToken] = useState("");
  const [tpKey, setTpKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [srcTest, setSrcTest] = useState<TestResult | null>(null);
  const [tpTest, setTpTest] = useState<TestResult | null>(null);
  const [srcTesting, setSrcTesting] = useState(false);
  const [tpTesting, setTpTesting] = useState(false);

  useEffect(() => {
    setProvider(getActiveProvider());
    setRentmanToken(localStorage.getItem("rentman_token") ?? "");
    setCurrentrmsToken(localStorage.getItem("currentrms_token") ?? "");
    setTpKey(localStorage.getItem("truckpacker_key") ?? "");
  }, []);

  function save() {
    setActiveProvider(provider);
    if (rentmanToken) localStorage.setItem("rentman_token", rentmanToken);
    else localStorage.removeItem("rentman_token");
    if (currentrmsToken) localStorage.setItem("currentrms_token", currentrmsToken);
    else localStorage.removeItem("currentrms_token");
    if (tpKey) localStorage.setItem("truckpacker_key", tpKey);
    else localStorage.removeItem("truckpacker_key");
    setSaved(true);
    setSrcTest(null);
    setTpTest(null);
    setTimeout(() => setSaved(false), 2000);
  }

  const activeToken = provider === "currentrms" ? currentrmsToken : rentmanToken;
  const activeCfg = PROVIDERS.find((p) => p.id === provider)!;

  async function testSource() {
    setSrcTesting(true);
    setSrcTest(null);
    try {
      const res = await api<TestResult>("/api/test-connection/rentman");
      setSrcTest(res);
    } catch (e: unknown) {
      setSrcTest({ ok: false, error: e instanceof Error ? e.message : "Failed" });
    } finally {
      setSrcTesting(false);
    }
  }

  async function testTruckPacker() {
    setTpTesting(true);
    setTpTest(null);
    try {
      const res = await api<TestResult>("/api/test-connection/truckpacker");
      setTpTest(res);
    } catch (e: unknown) {
      setTpTest({ ok: false, error: e instanceof Error ? e.message : "Failed" });
    } finally {
      setTpTesting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/"
        className="text-sm text-gray-500 hover:text-gray-900 transition mb-4 inline-block"
      >
        ← Back to Projects
      </Link>
      <h1 className="text-2xl font-bold mb-2">Settings</h1>
      <p className="text-gray-500 mb-8">
        Connect your rental management system and Truck Packer. Keys are stored
        in your browser only.
      </p>

      {/* Provider selector */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="font-semibold text-lg mb-1">Rental Management System</h2>
        <p className="text-sm text-gray-500 mb-4">
          Choose your source system. Equipment, projects, and inventory data
          will be pulled from here.
        </p>
        <div className="flex gap-2 mb-4">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => { setProvider(p.id); setSrcTest(null); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                provider === p.id
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-500 mb-3">{activeCfg.tokenHelp}</p>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {activeCfg.name} API Token
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={activeToken}
            onChange={(e) => {
              if (provider === "currentrms") setCurrentrmsToken(e.target.value);
              else setRentmanToken(e.target.value);
            }}
            placeholder={activeCfg.placeholder}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <button
            onClick={testSource}
            disabled={srcTesting || !activeToken}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition flex-shrink-0"
          >
            {srcTesting ? "Testing…" : "Test"}
          </button>
        </div>
        {srcTest && (
          <p className={`text-sm mt-2 ${srcTest.ok ? "text-green-600" : "text-red-600"}`}>
            {srcTest.ok ? `✓ ${srcTest.message}` : `✗ ${srcTest.error}`}
          </p>
        )}
        {provider === "currentrms" && (
          <p className="text-xs text-amber-600 mt-2">
            Current RMS supports bidirectional sync — changes in Truck Packer can
            be pushed back.
          </p>
        )}
        {provider === "rentman" && (
          <p className="text-xs text-gray-400 mt-2">
            Rentman API is read-only — dimensions can be pulled but not pushed back.
          </p>
        )}
      </div>

      {/* Truck Packer */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="font-semibold text-lg mb-1">Truck Packer</h2>
        <p className="text-sm text-gray-500 mb-4">
          Generate a key in Truck Packer → Settings → API Keys (starts with{" "}
          <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">tp_</code>)
        </p>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          API Key
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={tpKey}
            onChange={(e) => setTpKey(e.target.value)}
            placeholder="tp_..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <button
            onClick={testTruckPacker}
            disabled={tpTesting || !tpKey}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition flex-shrink-0"
          >
            {tpTesting ? "Testing…" : "Test"}
          </button>
        </div>
        {tpTest && (
          <p className={`text-sm mt-2 ${tpTest.ok ? "text-green-600" : "text-red-600"}`}>
            {tpTest.ok ? `✓ ${tpTest.message}` : `✗ ${tpTest.error}`}
          </p>
        )}
      </div>

      {/* Save */}
      <button
        onClick={save}
        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium text-sm transition"
      >
        {saved ? "✓ Saved" : "Save Settings"}
      </button>

      <div className="mt-6 bg-gray-50 rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
        <p className="font-medium text-gray-700 mb-1">Where are my keys stored?</p>
        <p>
          Your API keys and provider choice are saved in this browser&apos;s
          local storage. They are only sent to the respective APIs — never to
          any other server. Clearing your browser data will remove them, but
          synced items in Truck Packer carry unique stamps that survive
          independently.
        </p>
      </div>
    </div>
  );
}
