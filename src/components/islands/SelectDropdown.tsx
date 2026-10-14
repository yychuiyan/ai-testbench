import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: ReadonlyArray<SelectOption<T>>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** 触发器占满父宽 */
  className?: string;
}

function Chevron() {
  return (
    <svg className="w-4 h-4 text-stone-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function Check() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function SelectDropdown<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  className = '',
}: Props<T>) {
  const current = options.find((o) => o.value === value);

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      <div className={`relative mt-1 ${className}`}>
        <ListboxButton className="w-full h-9 flex items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 text-sm text-left text-stone-800 outline-none hover:border-stone-300 focus:ring-2 focus:ring-[#4176e6]/30 focus:border-[#4176e6] disabled:bg-stone-50 disabled:text-stone-400 disabled:cursor-not-allowed">
          <span className="truncate">{current?.label ?? value}</span>
          <Chevron />
        </ListboxButton>
        <ListboxOptions
          anchor={{ to: 'bottom start', gap: 4 }}
          className="tw-select-menu z-[80] max-h-56 w-[var(--button-width)] overflow-auto rounded-lg py-1 shadow-lg ring-1 ring-stone-200 focus:outline-none"
        >
          {options.map((o) => (
            <ListboxOption
              key={o.value}
              value={o.value}
              className="group cursor-pointer select-none flex items-center gap-2 px-3 py-2 text-sm text-stone-700 data-[focus]:bg-stone-50 data-[selected]:text-stone-900"
            >
              <span className="w-4 shrink-0 text-[#4176e6] opacity-0 group-data-[selected]:opacity-100">
                <Check />
              </span>
              <span className="truncate">{o.label}</span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
