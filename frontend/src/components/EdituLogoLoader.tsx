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
    sm: "w-36 h-auto",
    md: "w-64 h-auto",
    lg: "w-96 h-auto",
    full: "w-full max-w-[480px] h-auto",
  };

  return (
    <div className={`relative flex flex-col items-center justify-center ${className}`}>
      {/* Background Ambient Glow */}
      <div className="pointer-events-none absolute -inset-10 bg-emerald-500/20 blur-3xl rounded-full animate-pulse" />

      {/* SVG Logo with Pure Stroke Animation */}
      <svg
        viewBox="0 0 500 175"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${sizeClasses[size]} relative z-10 transition-all duration-700 ${
          phase === "loop"
            ? "drop-shadow-[0_0_25px_rgba(16,185,129,0.8)]"
            : "drop-shadow-[0_0_12px_rgba(16,185,129,0.4)]"
        }`}
      >
        <defs>
          <linearGradient id="editu-stroke-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#6ee7b7" />
          </linearGradient>
        </defs>

        <style jsx>{`
          .logo-path {
            stroke-dasharray: 1200;
            stroke-dashoffset: 1200;
            animation: drawStroke 1.8s cubic-bezier(0.65, 0, 0.35, 1) forwards;
          }

          .logo-path-delayed-1 {
            animation-delay: 0.15s;
          }
          .logo-path-delayed-2 {
            animation-delay: 0.3s;
          }
          .logo-path-delayed-3 {
            animation-delay: 0.45s;
          }
          .logo-path-delayed-4 {
            animation-delay: 0.6s;
          }

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
              opacity: 0.8;
            }
            50% {
              stroke-dashoffset: -400;
              opacity: 1;
            }
          }
        `}</style>

        {/* Letter 'd' */}
        <path
          d="M208.236 2.59978L230.687 2.59229L230.688 148.294L208.528 148.276C208.366 142.732 208.338 135.713 208.654 130.248C193.281 152.281 168.158 155.813 144.552 144.743C123.129 133.516 115.813 109.747 118.389 86.9828C121.828 56.5828 147.025 37.3283 177.237 41.3188C191.856 43.2498 199.265 48.7108 208.119 59.9848C208.632 41.5098 208.243 21.2118 208.236 2.59978Z"
          fill="none"
          stroke="url(#editu-stroke-grad)"
          strokeWidth="4"
          className={`logo-path logo-path-delayed-1 ${phase === "loop" ? "looping-stroke" : ""}`}
        />
        <path
          d="M168.475 59.2782C175.88 58.7127 183.727 59.0042 190.132 63.0097C216.569 79.5432 213.345 123.09 181.727 131.505C135.915 140.565 124.81 69.3047 168.475 59.2782Z"
          fill="none"
          stroke="url(#editu-stroke-grad)"
          strokeWidth="3"
          className={`logo-path logo-path-delayed-1 ${phase === "loop" ? "looping-stroke" : ""}`}
        />

        {/* Letter 'e' */}
        <path
          d="M54.1756 40.9401C81.3011 40.3576 103.059 54.5316 108.743 81.8726C110.169 88.7321 109.999 94.6491 109.803 101.549C81.1846 101.993 51.9607 101.497 23.2557 101.636C23.6217 103.71 24.0347 105.775 24.4947 107.83C28.8697 126.663 46.7007 136.549 65.3687 132.227C75.4612 129.89 80.5072 124.278 85.6882 115.738L92.0491 115.73C97.3011 115.746 102.828 115.971 108.1 116.104C106.033 122.607 102.66 128.619 98.1891 133.773C78.9416 155.81 38.0807 155.556 16.8772 136.711C-4.46185 117.745 -5.53185 79.1131 13.4756 58.2006C24.5856 45.9771 38.2011 41.6736 54.1756 40.9401Z"
          fill="none"
          stroke="url(#editu-stroke-grad)"
          strokeWidth="4"
          className={`logo-path ${phase === "loop" ? "looping-stroke" : ""}`}
        />
        <path
          d="M50.279 58.849C69.6905 57.3925 84.531 64.9325 86.581 85.766C78.021 85.892 69.183 85.792 60.601 85.8015L23.824 85.767C26.4785 70.678 35.214 61.672 50.279 58.849Z"
          fill="none"
          stroke="url(#editu-stroke-grad)"
          strokeWidth="3"
          className={`logo-path ${phase === "loop" ? "looping-stroke" : ""}`}
        />

        {/* Letter 'i' stem & dot */}
        <path
          d="M248.189 42.7783L271.162 42.7978L271.083 147.223L270.896 147.715C269.147 148.752 251.515 148.285 248.212 148.269L248.189 42.7783Z"
          fill="none"
          stroke="url(#editu-stroke-grad)"
          strokeWidth="4"
          className={`logo-path logo-path-delayed-2 ${phase === "loop" ? "looping-stroke" : ""}`}
        />
        <path
          d="M257.064 0.206598C264.948 -1.1284 272.434 4.1451 273.831 12.0191C275.228 19.8931 270.014 27.4201 262.151 28.8791C254.2 30.3546 246.571 25.0686 245.158 17.1066C243.745 9.1446 249.091 1.5566 257.064 0.206598Z"
          fill="none"
          stroke="url(#editu-stroke-grad)"
          strokeWidth="3.5"
          className={`logo-path logo-path-delayed-2 ${phase === "loop" ? "looping-stroke" : ""}`}
        />

        {/* Letter 't' */}
        <path
          d="M297.332 15.2456L320.293 15.2616L320.319 42.7701C330.555 42.8806 340.985 42.7776 351.237 42.7801L351.288 60.2821L320.335 60.2716C320.304 72.9866 318.83 113.283 321.662 122.724C325.869 136.748 345.103 127.547 351.481 130.963L351.574 132.583C351.454 137.673 351.537 143.082 351.529 148.199C346.645 148.517 341.753 148.702 336.86 148.754C325.813 148.839 313.893 148.45 305.558 140.153C295.117 129.759 297.291 112.157 297.294 98.5261L297.309 60.2861L281.634 60.2601C281.495 54.6251 281.629 48.5461 281.654 42.8766C286.81 42.7896 292.131 42.8441 297.303 42.8301L297.332 15.2456Z"
          fill="none"
          stroke="url(#editu-stroke-grad)"
          strokeWidth="4"
          className={`logo-path logo-path-delayed-3 ${phase === "loop" ? "looping-stroke" : ""}`}
        />

        {/* Letter 'u' */}
        <path
          d="M444.196 42.7725L466.826 42.798V77.4575L466.846 148.273L444.991 148.256C445.001 142.938 445.116 137.107 444.791 131.846C436.516 145.343 423.916 150.263 408.691 150.446C387.654 150.698 369.55 140.199 364.72 118.787C362.253 107.852 363.007 94.5845 363.014 83.175L363.033 42.8025L385.84 42.7765L385.809 81.6725C385.805 103.72 383.384 132.238 413.781 132.161C446.071 132.08 444.206 101.877 444.211 79.347L444.196 42.7725Z"
          fill="none"
          stroke="url(#editu-stroke-grad)"
          strokeWidth="4"
          className={`logo-path logo-path-delayed-4 ${phase === "loop" ? "looping-stroke" : ""}`}
        />
      </svg>

      {/* Looping Status Pulse Indicator */}
      <div className="mt-6 flex items-center gap-2 font-mono text-xs text-[#a8a8a8]">
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
        <span className="text-emerald-400 font-semibold tracking-wider uppercase">
          Carregando plataforma...
        </span>
      </div>
    </div>
  );
}
