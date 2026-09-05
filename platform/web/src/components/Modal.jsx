import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Hộp thoại dùng chung. Đóng bằng nút ✕ / phím ESC / bấm nền (tắt được bằng closeOnBackdrop=false
 * cho các form đang nhập dở — mất dữ liệu đang gõ là bức xúc lớn nhất của người dùng).
 */
export function Modal({
  open,
  title,
  children,
  footer,
  onClose,
  width = 'normal', // 'normal' | 'wide' | 'xwide'
  closeOnBackdrop = true,
}) {
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // khoá cuộn nền khi hộp thoại mở
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const cls = `modal${width === 'wide' ? ' wide' : width === 'xwide' ? ' xwide' : ''}`;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div className={cls} role="dialog" aria-modal="true" aria-label={title} ref={boxRef}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button type="button" className="x" onClick={onClose} aria-label="Đóng">
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ── Xác nhận: thay cho window.confirm (bắt buộc ở khu admin) ───────────── */

const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((options) => {
    const opts = typeof options === 'string' ? { message: options } : options || {};
    setState({
      title: opts.title || 'Xác nhận',
      message: opts.message || '',
      detail: opts.detail || null,
      confirmText: opts.confirmText || 'Đồng ý',
      cancelText: opts.cancelText || 'Huỷ',
      danger: !!opts.danger,
    });
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const finish = useCallback((value) => {
    setState(null);
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
  }, []);

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        title={state ? state.title : ''}
        onClose={() => finish(false)}
        footer={
          state && (
            <>
              <button type="button" onClick={() => finish(false)}>
                {state.cancelText}
              </button>
              <button
                type="button"
                className={state.danger ? 'solid-danger' : 'primary'}
                onClick={() => finish(true)}
                autoFocus
              >
                {state.confirmText}
              </button>
            </>
          )
        }
      >
        {state && (
          <div className="col">
            <p style={{ fontSize: '16px' }}>{state.message}</p>
            {state.detail && <div className="warnbox">{state.detail}</div>}
          </div>
        )}
      </Modal>
    </ConfirmCtx.Provider>
  );
}

/** const confirm = useConfirm(); if (await confirm({ message, danger: true })) { … } */
export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm phải nằm trong <ConfirmProvider>');
  return ctx;
}
