"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import forms from "@/styles/forms.module.css";

type SearchComboboxProps<T> = {
  id?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  options: T[];
  isOpen: boolean;
  menuLabel: string;
  loadingLabel?: string;
  noMatchesLabel?: string;
  wrapStyle?: CSSProperties;
  onChange: (value: string) => void;
  onOpenRequest?: () => void;
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
  menuLabel,
  loadingLabel,
  noMatchesLabel,
  wrapStyle,
  onChange,
  onOpenRequest,
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
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const activeOptionIndex =
    isOpen && !loadingLabel && options.length > 0
      ? activeIndex < 0
        ? 0
        : Math.min(activeIndex, options.length - 1)
      : -1;

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeOptionIndex]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateMenuPosition = () => {
      const inputRect = wrapRef.current?.getBoundingClientRect();
      if (!inputRect) return;

      setMenuStyle({
        position: "fixed",
        top: inputRect.bottom + 6,
        bottom: "auto",
        left: inputRect.left,
        right: "auto",
        width: inputRect.width,
        maxHeight: Math.max(120, window.innerHeight - inputRect.bottom - 18),
        zIndex: 1000,
      });
    };

    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, []);

  function updateMenuPosition() {
    if (typeof window === "undefined") return;
    const inputRect = wrapRef.current?.getBoundingClientRect();
    if (!inputRect) return;

    setMenuStyle({
      position: "fixed",
      top: inputRect.bottom + 6,
      bottom: "auto",
      left: inputRect.left,
      right: "auto",
      width: inputRect.width,
      maxHeight: Math.max(120, window.innerHeight - inputRect.bottom - 18),
      zIndex: 1000,
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    updateMenuPosition();

    if (event.key === "ArrowDown") {
      if (options.length === 0) return;
      event.preventDefault();
      if (!isOpen) {
        setActiveIndex(0);
        onOpenRequest?.();
        return;
      }
      setActiveIndex((activeOptionIndex + 1) % options.length);
      return;
    }

    if (event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      if (!isOpen) {
        setActiveIndex(options.length - 1);
        onOpenRequest?.();
        return;
      }
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

  const menuClassName = forms.autocompleteMenu;
  const activeOptionId =
    activeOptionIndex >= 0 ? `${optionIdPrefix}-${activeOptionIndex}` : undefined;
  const menu = isOpen ? (
    <div
      id={listboxId}
      className={menuClassName}
      role="listbox"
      aria-label={menuLabel}
      style={menuStyle}
    >
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
  ) : null;

  return (
    <div ref={wrapRef} className={forms.autocompleteWrap} style={wrapStyle}>
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
        onChange={(event) => {
          updateMenuPosition();
          onChange(event.target.value);
        }}
      />
      {menu && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </div>
  );
}
