import { AlertCircle, CheckCircle2, X } from "lucide-react";

export interface ToastMessage {
  id: number;
  type: "success" | "error";
  text: string;
}

interface ToastProps {
  toast: ToastMessage;
  onClose: () => void;
}

export function Toast({ toast, onClose }: ToastProps) {
  return (
    <div className={`toast toast--${toast.type}`} role="status">
      {toast.type === "success" ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
      <span>{toast.text}</span>
      <button type="button" onClick={onClose} aria-label="关闭通知"><X size={14} /></button>
    </div>
  );
}

