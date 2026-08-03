import type { Metadata } from "next";
import "./globals.css";
import InitialSplashScreen from "@/components/InitialSplashScreen";

export const metadata: Metadata = {
  title: "Editu — Edição Automática de Vídeo",
  description:
    "Automatize a edição dos seus vídeos curtos. Upload, limpeza automática, color grade, legendas e zoom — tudo em uma plataforma.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-[#0a0a0a] text-[#fafafa] font-sans antialiased ds-app" suppressHydrationWarning>
        <InitialSplashScreen>
          {/* SVG Global Brand Gradient Defs */}
          <svg width="0" height="0" className="absolute pointer-events-none">
            <defs>
              <linearGradient id="brand-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop stopColor="#10b981" offset="0%" />
                <stop stopColor="#34d399" offset="100%" />
              </linearGradient>
            </defs>
          </svg>

          {/* Page Dot Grid Layer (Conversão Extrema) */}
          <div
            className="fixed inset-0 -z-50 pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(circle, rgba(250, 250, 250, 0.05) 1px, transparent 1.6px)",
              backgroundSize: "24px 24px",
            }}
          />

          <div className="mx-auto min-h-screen w-full max-w-[1440px] border-x border-[#262626]">
            {/* Conversão Extrema Header */}
            <header className="sticky top-0 z-50 border-b border-[#262626] bg-[#0a0a0a]/80 backdrop-blur-md">
              <nav className="mx-auto flex h-16 w-full max-w-[1360px] items-center justify-between px-5 sm:px-8">
                <a href="/" className="group flex items-center gap-3 transition hover:opacity-90">
                  <img
                    src="/logo.svg"
                    alt="Editu"
                    className="h-7 w-auto object-contain"
                  />
                </a>

                <div className="hidden items-center gap-8 md:flex text-sm text-[#a8a8a8]">
                  <a href="#features" className="transition hover:text-white">
                    Funcionalidades
                  </a>
                  <a href="#how" className="transition hover:text-white">
                    Como funciona
                  </a>
                </div>

                <a
                  href="#upload"
                  className="shiny-cta px-5 py-2 text-xs font-semibold sm:inline-flex"
                >
                  <span className="shiny-dots" aria-hidden="true" />
                  <span className="shiny-cta-content text-white">Começar agora →</span>
                </a>
              </nav>
            </header>

            {children}

            {/* Footer */}
            <footer className="border-t border-[#262626] p-8 text-center text-xs text-[#737373]">
              © 2026 Editu. Edição automática de vídeo com alta conversão.
            </footer>
          </div>
        </InitialSplashScreen>
      </body>
    </html>
  );
}
