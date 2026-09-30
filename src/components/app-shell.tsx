import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import type { Locale } from "@/i18n";
import type { Dictionary } from "@/i18n/dictionaries";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NavLinks } from "@/components/nav-links";
import { SignOutButton } from "@/components/sign-out-button";

export function AppShell({
  children,
  dictionary,
  locale,
  userName,
  studioName,
}: {
  children: ReactNode;
  dictionary: Dictionary;
  locale: Locale;
  userName: string;
  studioName?: string | null;
}) {
  const es = locale === "es";
  const studio = studioName?.trim() || (es ? "Tu estudio" : "Your studio");
  const initials = userName.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  const date = new Intl.DateTimeFormat(es ? "es-ES" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Madrid" }).format(new Date());
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{es ? "Saltar al contenido" : "Skip to content"}</a>
      <aside className="desktop-sidebar">
        <Link href="/calendar" className="desktop-brand" aria-label="Tinta">
          <span className="desktop-brand-mark"><BrandMark /></span>
          <span className="desktop-brand-copy">
            <strong>Tinta</strong><small>{es ? "ESPACIO DEL ARTISTA" : "ARTIST WORKSPACE"}</small>
          </span>
        </Link>
        <div className="sidebar-workspace"><span className="studio-dot" /><span title={studio}>{studio}</span></div>
        <p className="sidebar-section-label">{es ? "TU ESPACIO" : "YOUR WORKSPACE"}</p>
        <NavLinks copy={dictionary.nav} variant="desktop" />
        <div className="sidebar-note"><BrandMark /><p>{es ? "El arte es tuyo.\nEl orden, también." : "Your art.\nYour rhythm."}</p></div>
        <div className="desktop-sidebar-footer">
          <Link href="/settings" className="artist-profile"><span className="artist-avatar">{initials}</span><span><strong title={userName}>{userName}</strong><small>{es ? "Artista del estudio" : "Studio artist"}</small></span></Link>
          <SignOutButton label={dictionary.auth.signOut} />
        </div>
      </aside>

      <div className="app-main-wrap">
        <header className="app-topbar">
          <Link href="/calendar" className="topbar-identity">
            <span className="topbar-brand-mark"><BrandMark /></span>
            <span className="topbar-identity-copy">
              <span className="topbar-app-name">{studio}</span>
              <span className="topbar-user">{es ? "Espacio del artista" : "Artist workspace"}</span>
            </span>
          </Link>
          <div className="topbar-actions">
            <span className="workspace-date">{date}</span>
            <LanguageSwitcher locale={locale} label={dictionary.language} />
            <span className="mobile-signout"><SignOutButton label={dictionary.auth.signOut} /></span>
          </div>
        </header>

        <main className="app-content" id="main-content" tabIndex={-1}>{children}</main>
        <NavLinks copy={dictionary.nav} variant="mobile" />
      </div>
    </div>
  );
}
