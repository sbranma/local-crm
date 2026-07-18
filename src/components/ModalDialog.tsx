import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

type ModalDialogProps = {
  children: ReactNode;
  labelledBy: string;
  className?: string;
  onRequestClose: () => void;
};

export function ModalDialog({
  children,
  labelledBy,
  className = "",
  onRequestClose,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();

    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`modal-dialog ${className}`.trim()}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onRequestClose();
      }}
    >
      {children}
    </dialog>
  );
}
