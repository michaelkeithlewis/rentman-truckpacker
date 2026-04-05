import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rentman → Truck Packer",
  description: "Visualize Rentman data and sync to Truck Packer load plans",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
            <a href="/" className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">R</span>
              </div>
              <span className="font-semibold text-lg">
                Rentman<span className="text-gray-400 font-normal mx-1">→</span>Truck Packer
              </span>
            </a>
            <nav className="flex items-center gap-5 text-sm text-gray-500">
              <a href="/" className="hover:text-gray-900 transition">
                Projects
              </a>
              <a href="/inventory" className="hover:text-gray-900 transition">
                Inventory
              </a>
              <a href="/logs" className="hover:text-gray-900 transition">
                Logs
              </a>
              <span className="w-px h-4 bg-gray-200" />
              <a
                href="https://app.truckpacker.com/packs"
                target="_blank"
                rel="noopener"
                className="hover:text-gray-900 transition"
              >
                Truck Packer ↗
              </a>
              <a href="/settings" className="hover:text-gray-900 transition">
                Settings
              </a>
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
