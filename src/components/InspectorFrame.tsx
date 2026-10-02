import type { ReactNode } from "react";
import { X } from "lucide-react";

/** Right-hand panel: fixed header, scrolling body, pinned action footer. */
export function InspectorFrame({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside className="inspector" aria-label={title}>
      <header className="inspector__header">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close panel"
          title="Close (Esc)"
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      <div className="inspector__body">{children}</div>
      {footer && <footer className="inspector__footer">{footer}</footer>}
    </aside>
  );
}
