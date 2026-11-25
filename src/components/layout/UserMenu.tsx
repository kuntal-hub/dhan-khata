"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentType } from "react";
import {
  Building2,
  Languages,
  LogOut,
  RefreshCw,
  Settings,
  Smartphone,
  Landmark,
  UserRound,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogoutBlockedError, logout } from "@/client/auth/session";
import { errorKey } from "@/client/errors";
import { useI18n } from "@/i18n/I18nProvider";
import type { TKey } from "@/i18n/translate";
import { actions, useAppDispatch, useAppSelector } from "@/store";
import type { LazyMenuProps } from "./lazyMenu";
import { UserMenuButton } from "./UserMenuButton";

const LINKS: Array<{
  href: string;
  label: TKey;
  icon: ComponentType<{ className?: string }>;
  owner?: boolean;
}> = [
  { href: "/profile", label: "menu.profile", icon: UserRound },
  { href: "/business", label: "menu.business", icon: Building2, owner: true },
  { href: "/golas", label: "menu.golas", icon: Warehouse, owner: true },
  { href: "/banks", label: "menu.banks", icon: Landmark, owner: true },
  { href: "/settings", label: "menu.settings", icon: Settings },
  { href: "/sessions", label: "menu.sessions", icon: Smartphone },
  { href: "/sync", label: "menu.sync", icon: RefreshCw },
];

/**
 * The header avatar menu (requirement_v2 §11): profile, business profile, Gola management,
 * logged-in phones, sync, language, logout. Loaded on the first tap.
 */
export function UserMenu({ open, onOpenChange }: LazyMenuProps) {
  const { t, lang, setLang, setDigits } = useI18n();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const userName = useAppSelector((s) => s.session.userName);
  const isOwner = useAppSelector((s) => s.session.isOwner);

  const doLogout = async () => {
    try {
      await logout();
      dispatch(actions.session.signedOut());
      dispatch(actions.activeGodown.godownCleared());
      router.replace("/login");
    } catch (e) {
      if (e instanceof LogoutBlockedError) {
        toast.error(t("auth.logoutBlocked", { count: e.pending }), {
          action: { label: t("sync.title"), onClick: () => router.push("/sync") },
        });
      } else toast.error(t(errorKey(e)));
    }
  };

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <UserMenuButton />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        {userName ? <DropdownMenuLabel className="text-base">{userName}</DropdownMenuLabel> : null}
        {LINKS.filter((l) => !l.owner || isOwner).map((l) => (
          <DropdownMenuItem key={l.href} asChild className="min-h-12 text-base">
            <Link href={l.href} data-testid={`menu-${l.href.slice(1)}`}>
              <l.icon className="size-5" aria-hidden />
              {t(l.label)}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-12 text-base"
          data-testid="toggle-language"
          onSelect={() => {
            // Digits follow the language by default (Profile can set them separately).
            const next = lang === "bn" ? "en" : "bn";
            setLang(next);
            setDigits(next);
          }}
        >
          <Languages className="size-5" aria-hidden />
          {lang === "bn" ? t("lang.en") : t("lang.bn")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-12 text-base"
          onSelect={() => void doLogout()}
          data-testid="menu-logout"
        >
          <LogOut className="size-5" aria-hidden />
          {t("menu.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
