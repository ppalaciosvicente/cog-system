"use client";

import { ReactNode } from "react";
import { useRouter } from "next/navigation";

type BackLinkProps = {
  fallbackHref: string;
  className?: string;
  children: ReactNode;
};

export function BackLink({ fallbackHref, className, children }: BackLinkProps) {
  const router = useRouter();

  return (
    <a
      href={fallbackHref}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        if (window.history.length > 1) {
          router.back();
          return;
        }
        router.push(fallbackHref);
      }}
    >
      {children}
    </a>
  );
}
