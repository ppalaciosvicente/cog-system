"use client";

import { useMemo, useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getLocale = () => navigator.language;
const getServerLocale = () => "en-US";

export function useTableDateFormat() {
  const locale = useSyncExternalStore(subscribe, getLocale, getServerLocale);

  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC",
      calendar: "gregory",
    });
    const pattern = formatter.formatToParts(new Date(Date.UTC(2006, 10, 22)))
      .map((part) => {
        if (part.type === "year") return "YYYY";
        if (part.type === "month") return "MM";
        if (part.type === "day") return "DD";
        return part.value;
      }).join("");

    function formatTableDate(value: string | null | undefined) {
      if (!value) return "";
      // These are calendar dates, even when the API includes a timestamp.
      const date = value.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return value;
      const parsed = new Date(`${date}T00:00:00Z`);
      return Number.isNaN(parsed.getTime()) ? value : formatter.format(parsed);
    }

    const dateFormatHint = (
      <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 400, color: "#64748b" }}>
        {pattern}
      </span>
    );

    return { formatTableDate, dateFormatHint };
  }, [locale]);
}
