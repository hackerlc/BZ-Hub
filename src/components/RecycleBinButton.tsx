import { useRef, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { setNativeDialogOpen } from "../lib/nativeDialog";

export function RecycleBinButton({ onError }: { onError: (message: string) => void }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (empty: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    if (empty) setNativeDialogOpen(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke(empty ? "empty_recycle_bin" : "open_recycle_bin");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      if (empty) setNativeDialogOpen(false);
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <button type="button" className="titlebar-button" aria-label="回收站"
      title="回收站：点击打开，右键清空" disabled={busy} aria-busy={busy}
      onClick={() => void run(false)}
      onContextMenu={(event) => { event.preventDefault(); void run(true); }}>
      {busy ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
    </button>
  );
}
