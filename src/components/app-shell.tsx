import type { ReactNode } from "react";
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
}: {
  children: ReactNode;
  dictionary: Dictionary;
  locale: Locale;
  userName: string;
}) {
  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <div className="desktop-brand">
          <span className="desktop-brand-mark" aria-hidden="true">T</span>
          <span className="desktop-brand-copy">
            <strong>{dictionary.appName}</strong>
          </span>
        </div>
        <NavLinks copy={dictionary.nav} variant="desktop" />
        <div className="desktop-sidebar-footer">
          <div className="desktop-user" title={userName}>
            {userName}
          </div>
          <LanguageSwitcher locale={locale} label={dictionary.language} />
          <SignOutButton label={dictionary.auth.signOut} />
        </div>
      </aside>

      <div className="app-main-wrap">
        <header className="app-topbar">
          <div className="topbar-identity">
            <span className="topbar-brand-mark" aria-hidden="true">T</span>
            <span className="topbar-identity-copy">
              <p className="topbar-app-name">{dictionary.appName}</p>
              <p className="topbar-user">{userName}</p>
            </span>
          </div>
          <div className="topbar-actions">
            <LanguageSwitcher locale={locale} label={dictionary.language} />
            <SignOutButton label={dictionary.auth.signOut} />
          </div>
        </header>

        <main className="app-content">{children}</main>
        <NavLinks copy={dictionary.nav} variant="mobile" />
      </div>
    </div>
  );
}
