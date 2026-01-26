import { Loader2, BellDot, Check } from 'lucide-react';

export interface StatusIndicatorsProps {
  /** Show notification badge */
  isNotified?: boolean;
  /** Show thinking spinner */
  isThinking?: boolean;
  /** Show idle checkmark */
  isIdle?: boolean;
  /** Whether to show the idle checkmark (config option) */
  showIdleCheck?: boolean;
  /** Whether this item is currently selected/active (hides some indicators) */
  isSelected?: boolean;
  /** Size of the icons */
  size?: number;
  /** Additional className for the container */
  className?: string;
}

/**
 * Renders status indicators for sessions/tabs.
 * Priority: notification > thinking > idle
 *
 * Note: `isThinking` indicator shows regardless of `isSelected` state
 * (for OSC-based progress which persists when viewing the terminal).
 * Other indicators hide when selected.
 */
export function StatusIndicators({
  isNotified = false,
  isThinking = false,
  isIdle = false,
  showIdleCheck = true,
  isSelected = false,
  size = 12,
  className = '',
}: StatusIndicatorsProps) {
  // Priority: notification > thinking > idle
  if (isNotified && !isSelected) {
    return (
      <span className={className} title="New notification">
        <BellDot size={size} className="text-blue-400" />
      </span>
    );
  }

  if (isThinking) {
    return (
      <span className={className} title="Thinking...">
        <Loader2 size={size} className="animate-spin text-violet-400" />
      </span>
    );
  }

  if (showIdleCheck && isIdle && !isSelected) {
    return (
      <span className={className} title="Ready">
        <Check size={size} className="text-emerald-400" />
      </span>
    );
  }

  return null;
}
