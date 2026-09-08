import { ChevronDown, Power, X } from "lucide-react";

interface CloseDialogProps {
  onCancel: () => void;
  onHide: () => void;
  onQuit: () => void;
}

export function CloseDialog({ onCancel, onHide, onQuit }: CloseDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="modal close-dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-dialog-title">
        <header className="modal__header">
          <div>
            <span className="eyebrow">CLOSE BZ HUB</span>
            <h2 id="close-dialog-title">关闭窗口</h2>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="取消关闭">
            <X size={17} />
          </button>
        </header>

        <div className="close-dialog__content">
          <p>你希望让 BZ Hub 继续留在托盘，还是完全退出？</p>
          <div className="close-dialog__choices">
            <button type="button" onClick={onHide}>
              <span className="close-dialog__choice-icon"><ChevronDown size={19} /></span>
              <span>
                <strong>收起到托盘</strong>
                <small>保持快捷键和托盘入口可用</small>
              </span>
            </button>
            <button type="button" className="is-danger" onClick={onQuit}>
              <span className="close-dialog__choice-icon"><Power size={18} /></span>
              <span>
                <strong>完全退出</strong>
                <small>停止后台运行，关闭托盘与快捷键</small>
              </span>
            </button>
          </div>
          <button type="button" className="button button--ghost close-dialog__cancel" onClick={onCancel}>取消</button>
        </div>
      </section>
    </div>
  );
}
