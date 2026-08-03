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
        // Simulated progress steps
        const progressTimer = setInterval(() => {
          setUploadProgress((prev) => Math.min(prev + 5, 85));
        }, 300);

        const result = await uploadVideo(file);

        clearInterval(progressTimer);
        setUploadProgress(100);

        // Navigate to editor
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
        {/* Glow */}
        <div className="pointer-events-none absolute left-1/2 top-24 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-200/10 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-[1280px]">
          {/* Badge */}
          <div className="animate-in mb-8 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 py-1.5 text-xs text-slate-300 shadow-2xl backdrop-blur-xl font-geist">
              <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300 shadow-lg shadow-cyan-300/50" />
              Edição automática com IA — Upload e pronto
            </div>
          </div>

          {/* Heading */}
          <div className="animate-in text-center">
            <h1 className="mx-auto max-w-4xl text-4xl font-semibold leading-[1.1] tracking-tighter text-white sm:text-5xl lg:text-7xl font-jakarta">
              Edição de vídeo sem a dor de cabeça.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg font-geist">
              O Editu transcreve, remove silêncios, aplica color grade e gera
              legendas automaticamente. Faça upload do seu vídeo cru e receba o
              resultado editado em minutos.
            </p>
          </div>

          {/* Upload Zone */}
          <div className="animate-slide-up mx-auto mt-12 max-w-2xl" id="upload">
            <div
              className={`upload-zone ${isDragOver ? "dragover" : ""}`}
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
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-cyan-400/10">
                    <svg
                      className="h-8 w-8 animate-spin text-cyan-300"
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
                  <p className="text-sm text-slate-300 font-geist">
                    Enviando{" "}
                    <span className="font-medium text-cyan-200">{fileName}</span>
                    ...
                  </p>
                  <div className="progress-track mx-auto max-w-xs">
                    <div
                      className="progress-fill"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04] border border-white/[0.08]">
                    <svg
                      className="h-7 w-7 text-slate-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                      />
                    </svg>
                  </div>
                  <p className="text-sm text-slate-300 font-geist">
                    <span className="font-semibold text-cyan-200">
                      Clique para selecionar
                    </span>{" "}
                    ou arraste seu vídeo aqui
                  </p>
                  <p className="mt-2 text-xs text-slate-500 font-geist">
                    MP4, MOV, WebM, MKV — até 500MB
                  </p>
                </>
              )}
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300 font-geist">
                ⚠️ {error}
              </div>
            )}
          </div>

          {/* Features Grid */}
          <div
            className="mx-auto mt-20 grid max-w-[1100px] gap-5 sm:grid-cols-2 lg:grid-cols-3"
            id="features"
          >
            {[
              {
                icon: "🎤",
                title: "Transcrição com IA",
                desc: "Transcrição automática com timestamps por palavra usando faster-whisper.",
              },
              {
                icon: "✂️",
                title: "Corte Inteligente",
                desc: "Remove silêncios, pausas e hesitações sem cortar no meio de palavras.",
              },
              {
                icon: "🎨",
                title: "Color Grade Automático",
                desc: "Preset cinematográfico profissional aplicado via FFmpeg automaticamente.",
              },
              {
                icon: "📝",
                title: "Legendas",
                desc: "Legendas básicas ou animadas palavra por palavra, geradas da transcrição.",
              },
              {
                icon: "🔍",
                title: "Zoom Dinâmico",
                desc: "Zoom in/out automático em pontos-chave para dar dinamismo ao vídeo.",
              },
              {
                icon: "🎵",
                title: "Trilha Sonora IA",
                desc: "Geração de trilha sonora com IA integrada. Em breve.",
                badge: "Em breve",
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="glass-card p-6 transition-all duration-300"
                style={{
                  animationDelay: `${0.1 + i * 0.08}s`,
                }}
              >
                <div className="mb-4 text-2xl">{feature.icon}</div>
                <h3 className="text-base font-semibold text-white font-jakarta">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm text-slate-400 font-geist">
                  {feature.desc}
                </p>
                {feature.badge && (
                  <span className="mt-3 inline-block rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
                    {feature.badge}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* How it Works */}
          <div className="mx-auto mt-24 max-w-[1100px] text-center" id="how">
            <span className="text-xs font-semibold tracking-wider text-cyan-300 uppercase bg-cyan-400/10 border border-cyan-400/20 px-3 py-1 rounded-full">
              Como funciona
            </span>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl font-jakarta">
              Do vídeo cru ao conteúdo profissional
            </h2>

            <div className="mt-12 grid gap-6 sm:grid-cols-3">
              {[
                {
                  step: "1",
                  title: "Faça upload",
                  desc: "Envie seu vídeo cru — depoimento, apresentação, conteúdo para redes.",
                },
                {
                  step: "2",
                  title: "Limpeza automática",
                  desc: "A IA transcreve, corta silêncios e aplica color grade. Tudo automático.",
                },
                {
                  step: "3",
                  title: "Escolha o estilo",
                  desc: "Adicione legendas, zoom e trilha. Renderize e baixe o resultado final.",
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className="glass-card p-6 text-left"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-400/10 font-bold text-cyan-300">
                    {item.step}
                  </div>
                  <h3 className="text-lg font-semibold text-white font-jakarta">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm text-slate-400 font-geist">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
