"use client";

import React, { useEffect, useState } from "react";

interface EdituLogoLoaderProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "full";
  onComplete?: () => void;
}

export default function EdituLogoLoader({
  className = "",
  size = "md",
  onComplete,
}: EdituLogoLoaderProps) {
  const [phase, setPhase] = useState<"drawing" | "loop">("drawing");

  useEffect(() => {
    const t = setTimeout(() => {
      setPhase("loop");
      if (onComplete) onComplete();
    }, 1800);

    return () => clearTimeout(t);
  }, [onComplete]);

  const sizeClasses = {
    sm: "w-44 h-auto",
    md: "w-80 h-auto",
    lg: "w-[480px] h-auto",
    full: "w-full max-w-[600px] h-auto",
  };

  return (
    <div className={`relative flex flex-col items-center justify-center ${className}`}>
      {/* Background Ambient Glow */}
      <div className="pointer-events-none absolute -inset-10 bg-emerald-500/20 blur-3xl rounded-full animate-pulse" />

      {/* SVG Logo with Pure Stroke Line Animation for EDITOR */}
      <svg
        viewBox="0 0 660 140"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${sizeClasses[size]} relative z-10 transition-all duration-700 ${
          phase === "loop"
            ? "drop-shadow-[0_0_30px_rgba(16,185,129,0.85)]"
            : "drop-shadow-[0_0_15px_rgba(16,185,129,0.4)]"
        }`}
      >
        <defs>
          <linearGradient id="editor-stroke-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#6ee7b7" />
          </linearGradient>
        </defs>

        <style jsx>{`
          .editor-path {
            stroke-dasharray: 800;
            stroke-dashoffset: 800;
            animation: drawStroke 1.8s cubic-bezier(0.65, 0, 0.35, 1) forwards;
          }

          .path-e { animation-delay: 0.05s; }
          .path-d { animation-delay: 0.2s; }
          .path-i { animation-delay: 0.35s; }
          .path-t { animation-delay: 0.5s; }
          .path-o { animation-delay: 0.65s; }
          .path-r { animation-delay: 0.8s; }

          .looping-stroke {
            animation: strokePulseLoop 2.4s ease-in-out infinite;
          }

          @keyframes drawStroke {
            to {
              stroke-dashoffset: 0;
            }
          }

          @keyframes strokePulseLoop {
            0%, 100% {
              stroke-dashoffset: 0;
              opacity: 0.85;
            }
            50% {
              stroke-dashoffset: -250;
              opacity: 1;
            }
          }
        `}</style>

        {/* Letter 'E' */}
        <path
          d="M 105,25 L 35,25 L 35,115 L 105,115 M 35,70 L 95,70"
          stroke="url(#editor-stroke-grad)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`editor-path path-e ${phase === "loop" ? "looping-stroke" : ""}`}
        />

        {/* Letter 'D' */}
        <path
          d="M 135,25 L 135,115 M 135,25 C 205,25 205,115 135,115"
          stroke="url(#editor-stroke-grad)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`editor-path path-d ${phase === "loop" ? "looping-stroke" : ""}`}
        />

        {/* Letter 'I' */}
        <path
          d="M 235,25 L 235,115"
          stroke="url(#editor-stroke-grad)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`editor-path path-i ${phase === "loop" ? "looping-stroke" : ""}`}
        />

        {/* Letter 'T' */}
        <path
          d="M 275,25 L 365,25 M 320,25 L 320,115"
          stroke="url(#editor-stroke-grad)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`editor-path path-t ${phase === "loop" ? "looping-stroke" : ""}`}
        />

        {/* Letter 'O' */}
        <path
          d="M 400,70 C 400,35 425,25 455,25 C 485,25 510,35 510,70 C 510,105 485,115 455,115 C 425,115 400,105 400,70 Z"
          stroke="url(#editor-stroke-grad)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`editor-path path-o ${phase === "loop" ? "looping-stroke" : ""}`}
        />

        {/* Letter 'R' */}
        <path
          d="M 545,25 L 545,115 M 545,25 C 605,25 605,70 545,70 M 575,70 L 615,115"
          stroke="url(#editor-stroke-grad)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`editor-path path-r ${phase === "loop" ? "looping-stroke" : ""}`}
        />
      </svg>

      {/* Looping Status Pulse Indicator */}
      <div className="mt-6 flex items-center gap-2 font-mono text-xs text-[#a8a8a8]">
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
        <span className="text-emerald-400 font-semibold tracking-wider uppercase">
          Carregando EDITOR...
        </span>
      </div>
    </div>
  );
}
