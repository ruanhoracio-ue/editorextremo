"use client";

import React, { useEffect, useState } from "react";
import EdituLogoLoader from "./EdituLogoLoader";

export default function InitialSplashScreen({
  children,
}: {
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Hide splash screen smoothly after animation finishes
    const timer = setTimeout(() => {
      setLoading(false);
      setTimeout(() => {
        setVisible(false);
      }, 700);
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {visible && (
        <div
          className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0a0a0a] transition-opacity duration-700 ${
            loading ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          {/* Conversão Extrema Background Grid & Glow */}
          <div
            className="fixed inset-0 -z-10 pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(circle, rgba(250, 250, 250, 0.05) 1px, transparent 1.6px)",
              backgroundSize: "24px 24px",
            }}
          />

          <EdituLogoLoader size="lg" />
        </div>
      )}
      {children}
    </>
  );
}
