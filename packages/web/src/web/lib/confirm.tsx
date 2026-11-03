import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Modal } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Hide the cancel button (for info/acknowledgement dialogs). */
  hideCancel?: boolean;
}

type ConfirmFn = (opts?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({});
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o = {}) => {
    setOpts(o);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (val: boolean) => {
    setOpen(false);
    resolver.current?.(val);
    resolver.current = null;
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={open}
        onClose={() => close(false)}
        title={opts.title ?? "Are you sure?"}
        footer={
          <>
            {!opts.hideCancel && (
              <Button variant="outline" onClick={() => close(false)}>{opts.cancelLabel ?? "Cancel"}</Button>
            )}
            <Button
              variant={opts.destructive === false ? "default" : "destructive"}
              onClick={() => close(true)}
            >
              {opts.confirmLabel ?? "Delete"}
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-3">
          {opts.destructive !== false && (
            <span className="mt-0.5 shrink-0 rounded-full bg-destructive/10 p-2 text-destructive">
              <AlertTriangle className="size-5" />
            </span>
          )}
          <p className="text-sm text-foreground whitespace-pre-line">
            {opts.message ?? "This action cannot be undone."}
          </p>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
