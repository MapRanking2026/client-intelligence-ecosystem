"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./presentation-edit-workspace.css";

export function PresentationEditWorkspace({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [open]);
  if (!open) return children;
  return createPortal(
    <dialog ref={dialog} className="presentation-edit-dialog" aria-label="Edit presentation slides" onCancel={event => { event.preventDefault(); onClose(); }}>
      <header><div><strong>Presentation studio</strong><p>Edit each slide with a live preview. Save when ready.</p></div><button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close editor</button></header>
      <div className="presentation-edit-body">{children}</div>
    </dialog>, document.body,
  );
}
