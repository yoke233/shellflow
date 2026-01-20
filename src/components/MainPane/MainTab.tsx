import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { listen } from '@tauri-apps/api/event';
import { Loader2 } from 'lucide-react';
import { Workspace } from '../../types';
import { usePty } from '../../hooks/usePty';
import { TerminalConfig } from '../../hooks/useConfig';
import '@xterm/xterm/css/xterm.css';

// Debounce helper
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timeout: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  }) as T;
}

interface MainTabProps {
  workspace: Workspace;
  isActive: boolean;
  terminalConfig: TerminalConfig;
}

export function MainTab({ workspace, isActive, terminalConfig }: MainTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const spawnedAtRef = useRef<number>(0); // Track when we spawned to avoid early resizes
  const [isReady, setIsReady] = useState(false);

  // Handle PTY output by writing directly to terminal
  const handleOutput = useCallback((data: string) => {
    if (terminalRef.current) {
      terminalRef.current.write(data);
    }
  }, []);

  const { ptyId, spawn, write, resize, kill } = usePty(handleOutput);

  // Listen for pty-ready event
  useEffect(() => {
    if (!ptyId) return;

    const unlisten = listen<{ ptyId: string; workspaceId: string }>('pty-ready', (event) => {
      if (event.payload.ptyId === ptyId) {
        setIsReady(true);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [ptyId]);

  // Store spawn/kill in refs so they're stable for the effect
  const spawnRef = useRef(spawn);
  const killRef = useRef(kill);
  useEffect(() => {
    spawnRef.current = spawn;
    killRef.current = kill;
  }, [spawn, kill]);

  // Initialize terminal and spawn PTY - only runs once per workspace
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    // Track if this effect instance is still active (for StrictMode cleanup)
    let isMounted = true;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: terminalConfig.fontSize,
      fontFamily: terminalConfig.fontFamily,
      allowProposedApi: true,
      theme: {
        background: '#09090b',
        foreground: '#fafafa',
        cursor: '#fafafa',
        cursorAccent: '#09090b',
        selectionBackground: '#3f3f46',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#f4f4f5',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(containerRef.current);

    // Load WebGL addon for GPU-accelerated rendering
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch (e) {
      console.warn('WebGL addon failed to load, using canvas renderer:', e);
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Fit terminal and spawn main process with correct size
    const initPty = async () => {
      // Wait for layout to fully settle
      await new Promise(resolve => setTimeout(resolve, 300));

      // Bail out if cleanup happened during the wait (StrictMode)
      if (!isMounted) return;

      fitAddon.fit();

      // Wait a bit more and fit again to ensure stable size
      await new Promise(resolve => setTimeout(resolve, 100));

      // Bail out if cleanup happened during the wait (StrictMode)
      if (!isMounted) return;

      fitAddon.fit();

      const cols = terminal.cols;
      const rows = terminal.rows;

      // Spawn main terminal with stable size
      spawnedAtRef.current = Date.now();
      await spawnRef.current(workspace.id, 'main', cols, rows);
    };

    initPty().catch(console.error);

    return () => {
      isMounted = false;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      initializedRef.current = false;
      // Kill the PTY process on cleanup
      killRef.current();
    };
  }, [workspace.id]); // Only re-run when workspace changes

  // Handle user input - set up immediately when we have ptyId
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !ptyId) return;

    const disposable = terminal.onData((data) => {
      write(data);
    });

    return () => disposable.dispose();
  }, [ptyId, write]);

  // Store resize function in ref to avoid dependency issues
  const resizeRef = useRef(resize);
  const ptyIdRef = useRef(ptyId);

  useEffect(() => {
    resizeRef.current = resize;
    ptyIdRef.current = ptyId;
  }, [resize, ptyId]);

  // Debounced resize handler - stable reference
  const debouncedResize = useMemo(
    () =>
      debounce(() => {
        const terminal = terminalRef.current;
        const fitAddon = fitAddonRef.current;
        if (!terminal || !fitAddon || !ptyIdRef.current) return;

        // Skip resizes within 1 second of spawn to let the UI settle
        if (Date.now() - spawnedAtRef.current < 1000) return;

        fitAddon.fit();
        resizeRef.current(terminal.cols, terminal.rows);
      }, 150),
    []
  );

  // Fit on active change
  useEffect(() => {
    if (isActive && ptyId) {
      // Small delay to let layout settle, then resize
      const timeout = setTimeout(debouncedResize, 50);
      return () => clearTimeout(timeout);
    }
  }, [isActive, ptyId, debouncedResize]);

  // Window resize handler
  useEffect(() => {
    if (!ptyId) return;

    window.addEventListener('resize', debouncedResize);
    return () => window.removeEventListener('resize', debouncedResize);
  }, [ptyId, debouncedResize]);

  // Focus terminal when active
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [isActive]);

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: '#09090b' }}>
      {/* Loading overlay */}
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-zinc-950">
          <div className="flex flex-col items-center gap-3 text-zinc-400">
            <Loader2 size={32} className="animate-spin" />
            <span className="text-sm">Starting Claude...</span>
          </div>
        </div>
      )}
      {/* Terminal container */}
      <div
        ref={containerRef}
        className={`w-full h-full transition-opacity duration-200 ${isReady ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}
