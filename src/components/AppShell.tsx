"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadCurrentAppAccess } from "@/lib/app-access";
import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import styles from "./AppShell.module.css";

type AppShellProps = {
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  label: string;
};

type AppShellIdentityCache = {
  canAccessEmc: boolean;
  canAccessContributions: boolean;
  roleSummary: string | null;
  contributionScopeLabel: string | null;
  isContributionAdmin: boolean;
  emcAreasLabel: string | null;
};

const APP_SHELL_IDENTITY_STORAGE_KEY = "emc.app_shell_identity";

const SYSTEM_NAV_ITEMS: NavItem[] = [
  { href: "/emc", label: "EMC" },
  { href: "/contributions", label: "Contributions" },
];

const EMC_NAV_ITEMS: NavItem[] = [
  { href: "/emc", label: "Dashboard" },
  { href: "/members", label: "Members" },
  { href: "/elders", label: "Elders" },
  { href: "/fot-reg", label: "FoT Registration" },
];

const CONTRIBUTION_NAV_ITEMS: NavItem[] = [
  { href: "/contributions", label: "Dashboard" },
  { href: "/contributions/enter", label: "Enter Contributions" },
  { href: "/contributions/donors", label: "View Donors" },
  { href: "/contributions/view", label: "View Contributions & Download Reports" },
  { href: "/contributions/access", label: "Access Configuration" },
];

const AUTH_PATH_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/fot-reg/register",
  "/api",
];

let appShellIdentityCache: AppShellIdentityCache = {
  canAccessEmc: false,
  canAccessContributions: false,
  roleSummary: null,
  contributionScopeLabel: null,
  isContributionAdmin: false,
  emcAreasLabel: null,
};

function persistAppShellIdentityCache() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    APP_SHELL_IDENTITY_STORAGE_KEY,
    JSON.stringify(appShellIdentityCache),
  );
}

function clearPersistedAppShellIdentityCache() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(APP_SHELL_IDENTITY_STORAGE_KEY);
}

function loadPersistedAppShellIdentityCache() {
  if (typeof window === "undefined") return appShellIdentityCache;

  const raw = window.sessionStorage.getItem(APP_SHELL_IDENTITY_STORAGE_KEY);
  if (!raw) return appShellIdentityCache;

  try {
    const parsed = JSON.parse(raw) as Partial<AppShellIdentityCache>;
    return {
      canAccessEmc: Boolean(parsed.canAccessEmc),
      canAccessContributions: Boolean(parsed.canAccessContributions),
      roleSummary: typeof parsed.roleSummary === "string" ? parsed.roleSummary : null,
      contributionScopeLabel:
        typeof parsed.contributionScopeLabel === "string"
          ? parsed.contributionScopeLabel
          : null,
      isContributionAdmin: Boolean(parsed.isContributionAdmin),
      emcAreasLabel: typeof parsed.emcAreasLabel === "string" ? parsed.emcAreasLabel : null,
    } satisfies AppShellIdentityCache;
  } catch {
    clearPersistedAppShellIdentityCache();
    return appShellIdentityCache;
  }
}

export function AppShell({ children }: AppShellProps) {
  const supabase = useMemo(() => createClient(), []);
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [initialIdentity] = useState(() => {
    return appShellIdentityCache;
  });
  const [canAccessEmc, setCanAccessEmc] = useState(initialIdentity.canAccessEmc);
  const [canAccessContributions, setCanAccessContributions] = useState(
    initialIdentity.canAccessContributions,
  );
  const [roleSummary, setRoleSummary] = useState<string | null>(initialIdentity.roleSummary);
  const [contributionScopeLabel, setContributionScopeLabel] = useState<string | null>(
    initialIdentity.contributionScopeLabel,
  );
  const [isContributionAdmin, setIsContributionAdmin] = useState(
    initialIdentity.isContributionAdmin,
  );
  const [emcAreasLabel, setEmcAreasLabel] = useState<string | null>(initialIdentity.emcAreasLabel);
  const lastAuthUserIdRef = useRef<string | null>(null);

  const showShell = useMemo(() => {
    if (!pathname) return true;
    return !AUTH_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  }, [pathname]);

  useEffect(() => {
    clearPersistedAppShellIdentityCache();
    appShellIdentityCache = {
      canAccessEmc: false,
      canAccessContributions: false,
      roleSummary: null,
      contributionScopeLabel: null,
      isContributionAdmin: false,
      emcAreasLabel: null,
    };
    setCanAccessEmc(false);
    setCanAccessContributions(false);
    setRoleSummary(null);
    setContributionScopeLabel(null);
    setIsContributionAdmin(false);
    setEmcAreasLabel(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      const { data, error } = await supabase.auth.getUser();
      if (cancelled) return;
      const unauthenticated = Boolean(error) || !data.user;
      if (unauthenticated && !AUTH_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix))) {
        router.replace("/login");
        return;
      }
      setAuthReady(true);
    }
    void checkSession();
    return () => {
      cancelled = true;
    };
  }, [pathname, router, supabase]);

  const rehydrateShellIdentity = useCallback(() => {
    const nextCache = loadPersistedAppShellIdentityCache();
    appShellIdentityCache = nextCache;
    setCanAccessEmc(nextCache.canAccessEmc);
    setCanAccessContributions(nextCache.canAccessContributions);
    setRoleSummary(nextCache.roleSummary);
    setContributionScopeLabel(nextCache.contributionScopeLabel);
    setIsContributionAdmin(nextCache.isContributionAdmin);
    setEmcAreasLabel(nextCache.emcAreasLabel);
  }, []);

  useEffect(() => {
    const nextCache = loadPersistedAppShellIdentityCache();
    const changed =
      nextCache.canAccessEmc !== appShellIdentityCache.canAccessEmc ||
      nextCache.canAccessContributions !== appShellIdentityCache.canAccessContributions ||
      nextCache.roleSummary !== appShellIdentityCache.roleSummary ||
      nextCache.contributionScopeLabel !== appShellIdentityCache.contributionScopeLabel ||
      nextCache.isContributionAdmin !== appShellIdentityCache.isContributionAdmin ||
      nextCache.emcAreasLabel !== appShellIdentityCache.emcAreasLabel;

    if (!changed) return;

    appShellIdentityCache = nextCache;
    queueMicrotask(() => {
      setCanAccessEmc(nextCache.canAccessEmc);
      setCanAccessContributions(nextCache.canAccessContributions);
      setRoleSummary(nextCache.roleSummary);
      setContributionScopeLabel(nextCache.contributionScopeLabel);
      setIsContributionAdmin(nextCache.isContributionAdmin);
      setEmcAreasLabel(nextCache.emcAreasLabel);
    });
  }, []);

  useEffect(() => {
    if (!showShell) return;

    let cancelled = false;

    async function load() {
      const access = await loadCurrentAppAccess(supabase);
      if (!cancelled && access.ok) {
        setCanAccessEmc(access.appAccess.canAccessEmc);
        setCanAccessContributions(access.appAccess.canAccessContributions);
        setRoleSummary(access.roleSummary);
        appShellIdentityCache = {
          ...appShellIdentityCache,
          canAccessEmc: access.appAccess.canAccessEmc,
          canAccessContributions: access.appAccess.canAccessContributions,
          roleSummary: access.roleSummary,
        };
        persistAppShellIdentityCache();
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    async function primeAuthUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled) {
        lastAuthUserIdRef.current = user?.id ?? null;
      }
    }

    void primeAuthUser();

  }, [showShell, supabase]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user?.id ?? null;
      const prevUserId = lastAuthUserIdRef.current;

      if (event === "INITIAL_SESSION") {
        lastAuthUserIdRef.current = nextUserId;
        return;
      }

      if (event === "SIGNED_OUT") {
        lastAuthUserIdRef.current = null;
        setCanAccessEmc(false);
        setCanAccessContributions(false);
        setRoleSummary(null);
        setContributionScopeLabel(null);
        setIsContributionAdmin(false);
        setEmcAreasLabel(null);
        appShellIdentityCache = {
          canAccessEmc: false,
          canAccessContributions: false,
          roleSummary: null,
          contributionScopeLabel: null,
          isContributionAdmin: false,
          emcAreasLabel: null,
        };
        clearPersistedAppShellIdentityCache();
        router.refresh();
        return;
      }

      if (event === "SIGNED_IN") {
        const userChanged = prevUserId !== null && nextUserId !== prevUserId;
        lastAuthUserIdRef.current = nextUserId;
        if (!userChanged) {
          return;
        }

        setCanAccessEmc(false);
        setCanAccessContributions(false);
        setRoleSummary(null);
        setContributionScopeLabel(null);
        setIsContributionAdmin(false);
        setEmcAreasLabel(null);
        appShellIdentityCache = {
          canAccessEmc: false,
          canAccessContributions: false,
          roleSummary: null,
          contributionScopeLabel: null,
          isContributionAdmin: false,
          emcAreasLabel: null,
        };
        clearPersistedAppShellIdentityCache();
        router.refresh();
        return;
      }

      if (event === "USER_UPDATED") {
        lastAuthUserIdRef.current = nextUserId;
        router.refresh();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  useEffect(() => {
    function handleFocus() {
      rehydrateShellIdentity();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        rehydrateShellIdentity();
      }
    }

    function handlePageShow() {
      rehydrateShellIdentity();
    }

    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [rehydrateShellIdentity]);

  useEffect(() => {
    if (!showShell || !pathname?.startsWith("/contributions")) {
      return;
    }

    let cancelled = false;

    async function loadContributionScope() {
      try {
        const headers = await getAuthHeaders();
        const response = await fetch("/api/contributions/access", {
          credentials: "include",
          headers,
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { scopeLabel?: string };
        if (!cancelled) {
          setContributionScopeLabel(payload.scopeLabel ?? null);
          const roleNames = Array.isArray((payload as { roleNames?: unknown }).roleNames)
            ? ((payload as { roleNames: unknown[] }).roleNames
                .map((value) => String(value).trim().toLowerCase())
                .filter(Boolean))
            : [];
          setIsContributionAdmin(roleNames.includes("contrib_admin"));
          appShellIdentityCache = {
            ...appShellIdentityCache,
            contributionScopeLabel: payload.scopeLabel ?? null,
            isContributionAdmin: roleNames.includes("contrib_admin"),
          };
          persistAppShellIdentityCache();
        }
      } catch {
        return;
      }
    }

    void loadContributionScope();
    return () => {
      cancelled = true;
    };
  }, [showShell, pathname]);

  useEffect(() => {
    if (
      !showShell ||
      pathname === "/" ||
      pathname?.startsWith("/contributions")
    ) {
      return;
    }

    let cancelled = false;

    async function loadEmcAreasSummary() {
      try {
        const headers = await getAuthHeaders();
        const response = await fetch("/api/elders/areas/summary", {
          credentials: "include",
          headers,
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { label?: string };
        if (!cancelled) {
          setEmcAreasLabel(payload.label ?? null);
          appShellIdentityCache = {
            ...appShellIdentityCache,
            emcAreasLabel: payload.label ?? null,
          };
          persistAppShellIdentityCache();
        }
      } catch {
        return;
      }
    }

    void loadEmcAreasSummary();
    return () => {
      cancelled = true;
    };
  }, [showShell, pathname]);

  const visibleContributionScopeLabel = pathname?.startsWith("/contributions")
    ? contributionScopeLabel
    : null;

  if (!showShell) return <>{children}</>;
  if (!authReady) return null;

  const isContributionPath = Boolean(pathname?.startsWith("/contributions"));
  const isSystemChooser = pathname === "/";

  const navItems = isSystemChooser
    ? SYSTEM_NAV_ITEMS.filter(
        (item) =>
          (item.href === "/emc" && canAccessEmc) ||
          (item.href === "/contributions" && canAccessContributions),
      )
    : isContributionPath
      ? CONTRIBUTION_NAV_ITEMS.filter((item) =>
          item.href === "/contributions/access" ? isContributionAdmin : true,
        )
      : EMC_NAV_ITEMS;

  const topTitle = "Menu";

  const brand = isSystemChooser
    ? "COG PKG Management System"
    : isContributionPath
      ? "Contributions"
      : "EMC";

  async function handleLogout() {
    await supabase.auth.signOut();
    setContributionScopeLabel(null);
    setIsContributionAdmin(false);
    setRoleSummary(null);
    setEmcAreasLabel(null);
    appShellIdentityCache = {
      canAccessEmc: false,
      canAccessContributions: false,
      roleSummary: null,
      contributionScopeLabel: null,
      isContributionAdmin: false,
      emcAreasLabel: null,
    };
    clearPersistedAppShellIdentityCache();
    setMobileOpen(false);
    router.replace("/login");
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <button
          type="button"
          className={styles.menuButton}
          aria-label="Open navigation menu"
          onClick={() => setMobileOpen(true)}
        >
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <path
              d="M6 8h20M6 16h20M6 24h20"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <h2 className={styles.topTitle}>{topTitle}</h2>
      </header>

      {mobileOpen && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close navigation menu"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ""}`}
      >
        <div className={styles.brand}>{brand}</div>
        {isContributionPath && pathname !== "/" ? (
          <>
            {roleSummary ? (
              <div className={styles.scopeLabel}>Logged in as: {roleSummary}</div>
            ) : null}
            {visibleContributionScopeLabel ? (
              <div className={styles.scopeLabel}>Scope: {visibleContributionScopeLabel}</div>
            ) : null}
          </>
        ) : null}
        {!isContributionPath && pathname !== "/" ? (
          <>
            {roleSummary ? (
              <div className={styles.scopeLabel}>Logged in as: {roleSummary}</div>
            ) : null}
            {emcAreasLabel ? (
              <div className={styles.scopeLabel}>Areas of responsibility: {emcAreasLabel}</div>
            ) : null}
          </>
        ) : null}
        <nav className={styles.nav} aria-label="Main navigation">
          {navItems.map((item) => {
            const active = item.href === "/contributions" || item.href === "/emc"
              ? pathname === item.href
              : pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {!isSystemChooser && canAccessEmc && canAccessContributions ? (
          <div className={styles.switcher}>
            <div className={styles.switcherLabel}>Switch App</div>
            <Link
              href={isContributionPath ? "/emc" : "/contributions"}
              onClick={() => setMobileOpen(false)}
              className={styles.navLink}
            >
              {isContributionPath ? "EMC" : "Contributions"}
            </Link>
          </div>
        ) : null}
        <button
          type="button"
          className={`${styles.navLink} ${styles.navLogout}`}
          onClick={handleLogout}
        >
          Log out
        </button>
      </aside>

      <div className={styles.content}>{children}</div>
    </div>
  );
}
