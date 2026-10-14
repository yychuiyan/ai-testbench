import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';

interface Props {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作：solid=红底白字；outline=描边红字（对齐 dsh 删工作区） */
  danger?: boolean | 'solid' | 'outline';
  onClose: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open,
  title = '确认',
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  onClose,
  onConfirm,
}: Props) {
  const dangerMode = danger === true || danger === 'solid' ? 'solid' : danger === 'outline' ? 'outline' : null;

  return (
    <Dialog open={open} onClose={onClose} className="relative z-[90]">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="tw-confirm-dialog relative w-full max-w-sm rounded-xl shadow-xl border border-stone-200 p-5">
          <button
            type="button"
            onClick={onClose}
            className="tw-confirm-cancel absolute top-3.5 right-3.5 w-7 h-7 flex items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            aria-label="关闭"
          >
            ✕
          </button>
          <DialogTitle className="tw-confirm-title pr-8 text-base font-semibold text-stone-900">
            {title}
          </DialogTitle>
          <p className="tw-confirm-msg mt-3 text-sm text-stone-600 leading-relaxed whitespace-pre-wrap">
            {message}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="tw-confirm-cancel h-8 px-3 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-100"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={
                dangerMode === 'outline'
                  ? 'h-8 px-3 text-sm rounded-lg border border-red-300 text-red-600 bg-transparent hover:bg-red-50'
                  : dangerMode === 'solid'
                    ? 'h-8 px-3 text-sm rounded-lg text-white bg-red-600 hover:bg-red-700'
                    : 'h-8 px-3 text-sm rounded-lg text-white bg-[#4176e6] hover:bg-[#3566d0]'
              }
            >
              {confirmLabel}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
