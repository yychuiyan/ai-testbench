import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from '@headlessui/react';
import { useMemo, useState } from 'react';

export interface SearchableOption {
  value: string;
  label: string;
}

interface Props {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '搜索并选择…',
  disabled = false,
  allowEmpty = true,
  emptyLabel = '不选择',
}: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <Combobox
      value={selected}
      onChange={(opt: SearchableOption | null) => {
        onChange(opt?.value ?? '');
        setQuery('');
      }}
      disabled={disabled}
      immediate
    >
      <div className="relative mt-1">
        <ComboboxInput
          className="w-full h-9 rounded-lg border border-stone-200 bg-white px-3 pr-8 text-sm outline-none focus:ring-2 focus:ring-[#4176e6]/30 focus:border-[#4176e6] disabled:bg-stone-50 disabled:text-stone-400"
          displayValue={(opt: SearchableOption | null) => opt?.label ?? ''}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
        />
        <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-2 text-stone-400">
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </ComboboxButton>
        <ComboboxOptions
          transition
          className="tw-select-menu tw-menu-anim absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-stone-200 py-1 shadow-lg focus:outline-none"
        >
          {allowEmpty ? (
            <ComboboxOption
              value={null}
              className="cursor-pointer px-3 py-2 text-sm text-stone-400 data-focus:bg-stone-50"
            >
              {emptyLabel}
            </ComboboxOption>
          ) : null}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-stone-400">无匹配项</div>
          ) : (
            filtered.map((o) => (
              <ComboboxOption
                key={o.value}
                value={o}
                className="cursor-pointer px-3 py-2 text-sm text-stone-700 data-focus:bg-[#e8f0fe] data-focus:text-[#4176e6] data-selected:font-medium"
              >
                {o.label}
              </ComboboxOption>
            ))
          )}
        </ComboboxOptions>
      </div>
    </Combobox>
  );
}
