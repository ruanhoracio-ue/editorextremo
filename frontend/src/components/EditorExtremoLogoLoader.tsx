"use client";

import React, { useEffect, useState } from "react";

interface EditorExtremoLogoLoaderProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "full";
  onComplete?: () => void;
}

export default function EditorExtremoLogoLoader({
  className = "",
  size = "md",
  onComplete,
}: EditorExtremoLogoLoaderProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const t = setTimeout(() => {
      if (onComplete) onComplete();
    }, 1800);

    return () => clearTimeout(t);
  }, [onComplete]);

  const sizeClasses = {
    sm: "h-8 sm:h-10",
    md: "h-12 sm:h-16",
    lg: "h-20 sm:h-24",
    full: "h-24 sm:h-32",
  };

  return (
    <div className={`relative flex flex-col items-center justify-center ${className}`}>
      {/* Dynamic Ambient Radial Glow */}
      <div className="pointer-events-none absolute -inset-16 bg-emerald-500/25 blur-3xl rounded-full animate-pulse" />

      {/* Clean & Crisp Official Brand Logo Reveal */}
      <div
        className={`relative z-10 flex items-center justify-center transition-all duration-1000 ${
          mounted ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      >
        <img
          src="/logo.svg"
          alt="EditorExtremo Logo"
          className={`${sizeClasses[size]} w-auto object-contain drop-shadow-[0_0_35px_rgba(16,185,129,0.85)]`}
        />
      </div>

      {/* Looping Status Pulse Indicator */}
      <div className="relative z-10 mt-6 flex items-center gap-2 font-mono text-xs text-[#a8a8a8]">
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
        <span className="text-emerald-400 font-semibold tracking-wider uppercase">
          Carregando plataforma...
        </span>
      </div>
    </div>
  );
}
