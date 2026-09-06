import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const push = useCallback((text, kind = 'ok', ms = 3200) => {
    seq.current += 1;
    const id = seq.current;
    setItems((list) => [...list, { id, text, kind }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), ms);
  }, []);

  const value = useMemo(
    () => ({
      toast: (text) => push(text, 'ok'),
      toastOk: (text) => push(text, 'ok'),
      toastError: (text) => push(text, 'bad', 4600),
    }),
    [push],
  );

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>
              {t.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast phải nằm trong <ToastProvider>');
  return ctx;
}
