import { useEffect, useRef } from "react";
import { Plus, X } from "@phosphor-icons/react";

export function Modal({ title, children, onClose, size = "medium", busy = false }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return (
    <dialog ref={dialogRef} className="modal-backdrop" aria-labelledby="modal-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <section className={`modal soft-panel modal-${size}`}>
        <div className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button soft-button" type="button" onClick={onClose} disabled={busy} aria-label="Close"><X size={20} weight="bold" /></button></div>
        {children}
      </section>
    </dialog>
  );
}

export function PrimaryButton({ children, icon: Icon = Plus, className = "", ...props }) {
  return <button className={`primary-button ${className}`} type="button" {...props}><span>{children}</span><Icon size={23} weight="bold" /></button>;
}
