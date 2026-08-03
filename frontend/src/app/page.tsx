"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { uploadVideo } from "@/lib/api";

export default function HomePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setFileName(file.name);
      setIsUploading(true);
      setUploadProgress(10);

      try {
        const progressTimer = setInterval(() => {
          setUploadProgress((prev) => Math.min(prev + 5, 85));
        }, 300);

        const result = await uploadVideo(file);

        clearInterval(progressTimer);
        setUploadProgress(100);

        setTimeout(() => {
          router.push(`/editor/${result.job_id}`);
        }, 500);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Erro ao fazer upload do vídeo"
        );
        setIsUploading(false);
        setUploadProgress(0);
      }
    },
    [router]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <main>
      {/* Hero Section */}
      <section className="relative overflow-hidden px-5 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24 lg:px-10 lg:pb-24 lg:pt-20">
        {/* Conversão Extrema Emerald Radial Glow */}
        <div className="pointer-events-none absolute left-1/2 top-24 h-96 w-96 -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-[1280px]">
          {/* Eyebrow Badge */}
          <div className="animate-in mb-8 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#262626] bg-[#171717] px-4 py-1.5 text-xs text-[#a8a8a8] shadow-2xl backdrop-blur-xl">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50" />
              Edição Automática com Inteligência de Alta Conversão
            </div>
          </div>

          {/* Headline */}
          <div className="animate-in text-center">
            <h1 className="mx-auto max-w-5xl text-4xl font-semibold leading-[1.2] tracking-tighter text-[#fafafa] sm:text-5xl lg:text-7xl font-sans">
              Edição de vídeo com{" "}
              <span className="relative inline-block hover-text-shine cursor-default font-extrabold pb-2 mx-1">
                alta conversão automática
                <span className="animate-sweep-underline" aria-hidden="true" />
              </span>
              .
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-[#a8a8a8] sm:text-lg">
              O <strong className="text-white font-semibold">Editor</strong> transcreve, remove silêncios, aplica color grade, zoom dinâmico e gera
              legendas perfeitamente sincronizadas. Envie seu vídeo cru e receba o resultado final pronto em minutos.
            </p>
          </div>

          {/* Upload Zone */}
          <div className="animate-slide-up mx-auto mt-12 max-w-2xl" id="upload">
            <div
              className={`relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center transition-all ${
                isDragOver
                  ? "border-emerald-400 bg-emerald-500/10 scale-[1.01]"
                  : "border-[#262626] bg-[#171717]/80 hover:border-emerald-500/50 hover:bg-[#171717]"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={onFileSelect}
              />

              {isUploading ? (
                <div className="space-y-4">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                    <svg
                      className="h-8 w-8 animate-spin text-emerald-400"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  </div>
                  <p className="text-sm text-[#fafafa]">
                    Enviando <span className="font-medium text-emerald-400">{fileName}</span>...
                  </p>
                  <div className="h-2 w-full max-w-xs mx-auto overflow-hidden rounded-full bg-black/40 border border-[#262626]">
                    <div
                      className="h-full bg-brand-gradient transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#262626] bg-[#0a0a0a] text-2xl shadow-xl">
                    🎬
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-[#fafafa]">
                      Arraste seu vídeo aqui ou <span className="text-emerald-400 underline">clique para selecionar</span>
                    </p>
                    <p className="mt-1 text-xs text-[#737373]">
                      Suporta MP4, MOV, WEBM (até 500MB)
                    </p>
                  </div>

                  <div className="pt-2">
                    <button className="shiny-cta px-6 py-3 text-sm font-semibold inline-flex">
                      <span className="shiny-dots" aria-hidden="true" />
                      <span className="shiny-cta-content text-white">Selecionar Vídeo para Editar →</span>
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <p className="mt-4 text-xs font-semibold text-rose-400">
                  ⚠️ {error}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Features Showcase */}
      <section className="border-t border-[#262626] bg-[#0a0a0a] py-20 px-5 sm:px-8 lg:px-10" id="features">
        <div className="mx-auto max-w-[1200px] space-y-12">
          <div className="text-center space-y-3">
            <span className="text-xs uppercase tracking-[0.14em] text-emerald-400 font-semibold">RECURSOS PREMIUM</span>
            <h2 className="text-3xl font-bold tracking-tight text-[#fafafa] sm:text-4xl">Tudo o que seu vídeo precisa para viralizar</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: "✂️", title: "Corte Inteligente de Silêncio", desc: "Identifica e remove pausas mortas automaticamente preservando o ritmo natural do apresentador." },
              { icon: "🌟", title: "Legendas Dinâmicas Karaoke", desc: "Animação palavra por palavra sincronizada com a voz com quebra estrita de 1 ou 2 linhas." },
              { icon: "📐", title: "Adaptação de Formatos", desc: "Exporte instantaneamente para 9:16 (Reels/TikTok), 4:5 (Feed), 1:1 ou 16:9 (YouTube)." },
            ].map((item, idx) => (
              <div key={idx} className="premium-card p-6 space-y-3">
                <div className="h-11 w-11 rounded-full bg-emerald-500/10 flex items-center justify-center text-xl text-emerald-400">
                  {item.icon}
                </div>
                <h3 className="text-lg font-bold text-[#fafafa]">{item.title}</h3>
                <p className="text-sm text-[#a8a8a8] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
