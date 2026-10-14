import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  title?: string;
  label?: string;
  placeholder?: string;
  /** 打开时预填（重命名场景） */
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export default function NamePromptDialog({
  open,
  title = '新建文件夹',
  label = '文件夹名称',
  placeholder = '请输入名称',
  initialValue = '',
  confirmLabel = '创建',
  cancelLabel = '取消',
  onClose,
  onConfirm,
}: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      const t = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => window.clearTimeout(t);
    }
  }, [open, initialValue]);

  function submit() {
    const name = value.trim();
    if (!name) return;
    onConfirm(name);
  }

  return (
    <Dialog open={open} onClose={onClose} transition className="relative z-50">
      <DialogBackdrop
        transition
        className="tw-dialog-backdrop-anim fixed inset-0 bg-black/30"
        aria-hidden="true"
      />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          transition
          className="tw-confirm-dialog tw-dialog-panel-anim w-full max-w-sm rounded-xl shadow-xl border border-stone-200 p-5 bg-white"
        >
          <DialogTitle className="tw-confirm-title text-base font-semibold text-stone-900">
            {title}
          </DialogTitle>
          <label className="tw-confirm-msg mt-4 block text-xs font-medium text-stone-500">
            {label}
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={placeholder}
              className="mt-1.5 w-full h-9 px-3 text-sm rounded-lg border border-stone-200 text-stone-800 outline-none focus:ring-2 focus:ring-[#4176e6]/30 focus:border-[#4176e6] transition-colors"
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="tw-confirm-cancel h-8 px-3 text-sm rounded-lg text-stone-600 hover:bg-stone-100 transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              disabled={!value.trim()}
              onClick={submit}
              className="h-8 px-4 text-sm font-medium text-white bg-[#4176e6] rounded-lg hover:bg-[#3565c7] disabled:opacity-40 transition-colors"
            >
              {confirmLabel}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
