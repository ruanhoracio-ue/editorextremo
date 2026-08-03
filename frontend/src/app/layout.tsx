import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-screen overflow-x-hidden antialiased" suppressHydrationWarning>
        {/* Fixed Background Gradient */}
        <div className="pointer-events-none fixed inset-0 -z-50 bg-radial-gradient" />
        {/* Noise Texture */}
        <div className="pointer-events-none fixed inset-0 -z-40 bg-noise" />

        <div className="mx-auto min-h-screen w-full max-w-[1440px] border-x border-white/[0.06]">
          {/* Header */}
          <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#080c14]/70 backdrop-blur-2xl animate-in">
            <nav className="mx-auto flex h-16 w-full max-w-[1360px] items-center justify-between px-5 sm:px-8 lg:px-10">
              <a href="/" className="group flex items-center gap-3 transition hover:opacity-90">
                <img
                  src="/logo.svg"
                  alt="Editu"
                  className="h-8 w-auto object-contain"
                />
              </a>

              <div className="hidden items-center gap-8 md:flex">
                <a
                  href="#features"
                  className="text-sm text-slate-400 transition hover:text-white font-geist"
                >
                  Funcionalidades
                </a>
                <a
                  href="#how"
                  className="text-sm text-slate-400 transition hover:text-white font-geist"
                >
                  Como funciona
                </a>
              </div>

              <a
                href="#upload"
                className="hidden rounded-full border border-cyan-200/20 bg-cyan-100 px-5 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:scale-[1.03] hover:bg-cyan-50 sm:inline-flex font-geist"
              >
                Começar agora
              </a>
            </nav>
          </header>

          {children}

          {/* Footer */}
          <footer className="border-t border-white/[0.06] p-10 text-center text-sm text-slate-500 font-geist">
            © 2026 Editu. Edição automática de vídeo com inteligência.
          </footer>
        </div>
      </body>
    </html>
  );
}
