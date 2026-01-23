import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react';
import { ReactNode } from 'react';

type BannerVariant = 'error' | 'warning' | 'info' | 'success';

interface BannerProps {
  variant: BannerVariant;
  children: ReactNode;
}

const variantStyles: Record<BannerVariant, { bg: string; border: string; text: string; icon: string }> = {
  error: {
    bg: 'bg-red-950/80',
    border: 'border-red-800',
    text: 'text-red-200',
    icon: 'text-red-400',
  },
  warning: {
    bg: 'bg-yellow-950/80',
    border: 'border-yellow-800',
    text: 'text-yellow-200',
    icon: 'text-yellow-400',
  },
  info: {
    bg: 'bg-blue-950/80',
    border: 'border-blue-800',
    text: 'text-blue-200',
    icon: 'text-blue-400',
  },
  success: {
    bg: 'bg-green-950/80',
    border: 'border-green-800',
    text: 'text-green-200',
    icon: 'text-green-400',
  },
};

const variantIcons: Record<BannerVariant, typeof AlertTriangle> = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle,
};

export function Banner({ variant, children }: BannerProps) {
  const styles = variantStyles[variant];
  const Icon = variantIcons[variant];

  return (
    <div className={`${styles.bg} border-b ${styles.border} px-3 py-2`}>
      <div className={`flex items-start gap-2 ${styles.text} text-sm`}>
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${styles.icon}`} />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
