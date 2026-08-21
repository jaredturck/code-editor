/**
 * Owns the state, persistence, and bridge interactions for the systemMonitor panel. The
 * hook leaves rendering to the panel component while keeping the feature workflow testable
 * and reusable.
 */

import { useEffect, useState } from 'react';
import { systemStats, systemProcesses } from '@/platform/desktopBridge';

export interface SystemStats {
  platform: string;
  arch: string;
  hostname: string;
  cpuModel: string;
  cpuCount: number;
  cpuPercent: number;
  loadavg: number[];
  memTotal: number;
  memFree: number;
  memUsed: number;
  memPercent: number;
  uptime: number;
  generatedAt: number;
  gpuDevices?: Array<{ name: string; memoryTotalMb: number }>;
  gpuMemoryTotalMb?: number;
}

export interface SystemProcess {
  pid: number;
  cpu: number;
  mem: number;
  command: string;
}

export interface SystemMonitorState {
  stats: SystemStats | null;
  procs: SystemProcess[];
  err: string;
}

/**
 * Polls local system and process statistics while the System Monitor panel is active. The
 * hook owns refresh timing and cleanup so hidden or unmounted views do not leave background
 * polling behind.
 */

export function useSystemMonitor(): SystemMonitorState {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [procs, setProcs] = useState<SystemProcess[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;

    // Refreshes local system and process statistics for the monitor panel.
    const poll = async () => {
      try {
        const [nextStats, nextProcesses] = await Promise.all([systemStats(), systemProcesses(15)]);
        if (cancelled) return;
        if (nextStats) {
          setStats(nextStats);
          setErr('');
        } else {
          setErr('System monitor needs the desktop app (local bridge).');
        }
        setProcs(Array.isArray(nextProcesses) ? nextProcesses : []);
      } catch {
        if (!cancelled) setErr('Could not read system stats.');
      }
    };

    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { stats, procs, err };
}
