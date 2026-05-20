"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import forms from "@/styles/forms.module.css";

type SearchComboboxProps<T> = {
  id?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  options: T[];
  isOpen: boolean;
  menuAbove?: boolean;
  menuLabel: string;
  loadingLabel?: string;
  noMatchesLabel?: string;
  wrapStyle?: CSSProperties;
  onChange: (value: string) => void;
  onSelect: (option: T) => void;
  onEscape?: () => void;
  getOptionKey: (option: T, index: number) => string | number;
  getOptionLabel: (option: T) => string;
};

export function SearchCombobox<T>({
  id,
  value,
  placeholder,
  disabled,
  options,
  isOpen,
  menuAbove = false,
  menuLabel,
  loadingLabel,
  noMatchesLabel,
  wrapStyle,
  onChange,
  onSelect,
  onEscape,
  getOptionKey,
  getOptionLabel,
}: SearchComboboxProps<T>) {
  const generatedId = useId();
  const inputId = id ?? `search-combobox-${generatedId}`;
  const listboxId = `${inputId}-options`;
  const optionIdPrefix = `${inputId}-option`;
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  const activeOptionIndex =
    isOpen && !loadingLabel && options.length > 0
      ? activeIndex < 0
        ? 0
        : Math.min(activeIndex, options.length - 1)
      : -1;

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeOptionIndex]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (!isOpen || options.length === 0) return;
      event.preventDefault();
      setActiveIndex((activeOptionIndex + 1) % options.length);
      return;
    }

    if (event.key === "ArrowUp") {
      if (!isOpen || options.length === 0) return;
      event.preventDefault();
      setActiveIndex(activeOptionIndex <= 0 ? options.length - 1 : activeOptionIndex - 1);
      return;
    }

    if (event.key === "Enter") {
      if (!isOpen || activeOptionIndex < 0 || !options[activeOptionIndex]) return;
      event.preventDefault();
      onSelect(options[activeOptionIndex]);
      return;
    }

    if (event.key === "Escape") {
      if (!isOpen) return;
      event.preventDefault();
      setActiveIndex(-1);
      onEscape?.();
    }
  }

  const menuClassName = [
    forms.autocompleteMenu,
    menuAbove ? forms.autocompleteMenuAbove : "",
  ]
    .filter(Boolean)
    .join(" ");
  const activeOptionId =
    activeOptionIndex >= 0 ? `${optionIdPrefix}-${activeOptionIndex}` : undefined;

  return (
    <div className={forms.autocompleteWrap} style={wrapStyle}>
      <input
        id={inputId}
        type="search"
        autoComplete="off"
        className={forms.field}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        onKeyDown={handleKeyDown}
        onChange={(event) => onChange(event.target.value)}
      />
      {isOpen ? (
        <div id={listboxId} className={menuClassName} role="listbox" aria-label={menuLabel}>
          {loadingLabel ? (
            <div className={forms.autocompleteOption}>{loadingLabel}</div>
          ) : options.length > 0 ? (
            options.map((option, optionIndex) => (
              <button
                key={getOptionKey(option, optionIndex)}
                id={`${optionIdPrefix}-${optionIndex}`}
                ref={optionIndex === activeOptionIndex ? activeOptionRef : null}
                type="button"
                role="option"
                aria-selected={optionIndex === activeOptionIndex}
                className={[
                  forms.autocompleteOption,
                  optionIndex === activeOptionIndex ? forms.autocompleteOptionActive : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => setActiveIndex(optionIndex)}
                onClick={() => onSelect(option)}
              >
                {getOptionLabel(option)}
              </button>
            ))
          ) : noMatchesLabel ? (
            <div className={forms.autocompleteOption}>{noMatchesLabel}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
