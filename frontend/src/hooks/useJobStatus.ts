"use client";

import { useState, useEffect, useCallback } from "react";
import type { Job } from "@/lib/types";
import { getJobStatus } from "@/lib/api";

/**
 * Custom hook that polls a job's status every `intervalMs` milliseconds.
 * Stops polling once the job reaches a terminal state (done, error).
 * Continues polling during clean_ready and rendering to catch transitions.
 */
export function useJobStatus(jobId: string | null, intervalMs = 2000) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!jobId) return;
    try {
      const data = await getJobStatus(jobId);
      setJob(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;

    fetchStatus();

    const interval = setInterval(() => {
      // Only stop polling on terminal states
      if (job?.status === "done" || job?.status === "error") {
        return;
      }
      fetchStatus();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [jobId, job?.status, intervalMs, fetchStatus]);

  return { job, error, refetch: fetchStatus };
}
