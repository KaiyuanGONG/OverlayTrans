import { X } from "lucide-react";

interface WarningBannerProps {
  message: string;
  dismissLabel: string;
  onDismiss: () => void;
}

export function WarningBanner({ message, dismissLabel, onDismiss }: WarningBannerProps) {
  return (
    <div role="status" className="flex items-start gap-1 px-2 pb-1.5 shrink-0">
      <p className="text-amber-400 text-xs flex-1 leading-snug">{message}</p>
      <button
        aria-label={dismissLabel}
        className="text-amber-400/60 hover:text-amber-300 text-xs shrink-0 leading-none mt-0.5"
        onClick={onDismiss}
        onMouseDown={(event) => event.stopPropagation()}
        title={dismissLabel}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
