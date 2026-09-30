import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import type { Locale } from "@/i18n";

export function AuthShell({ children, locale, languageLabel }: { children: ReactNode; locale: Locale; languageLabel: string }) {
  const es = locale === "es";
  return (
    <main className="auth-shell">
      <aside className="auth-story">
        <div className="auth-brand"><BrandMark /><span>Tinta<small>{es ? "EL ESPACIO DEL ARTISTA" : "THE ARTIST’S WORKSPACE"}</small></span></div>
        <div className="auth-story-copy">
          <p className="eyebrow">{es ? "TU ESTUDIO, EN ORDEN" : "YOUR STUDIO, IN ORDER"}</p>
          <h2>{es ? <>Menos gestión.<br /><em>Más tinta.</em></> : <>Less admin.<br /><em>More ink.</em></>}</h2>
          <p>{es ? "Tus citas, clientes y diseños. Un espacio tranquilo para todo lo que rodea a tu arte." : "Your appointments, clients and designs. A considered space for everything around your art."}</p>
        </div>
        <div className="auth-art" aria-hidden="true">
          <svg viewBox="0 0 400 340" fill="none">
            <circle cx="200" cy="168" r="133" stroke="currentColor" strokeOpacity=".18" />
            <circle cx="200" cy="168" r="106" stroke="currentColor" strokeOpacity=".13" />
            <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M199 164c-27-2-54-14-63-37-7-16-1-33 12-37-5-22 17-40 36-33 10-23 40-25 52-7 26-2 41 18 33 36 19 10 18 33 5 48-18 21-45 33-75 30Z" />
              <path d="M147 92c21-13 42-8 54 7m-15-39c-8 17-3 32 15 40m35-48c5 21-8 43-28 47m60-12c-22-8-49 3-62 17m-68 10c26 6 40 20 55 45m81-36c-33-6-59 8-77 33" />
              <path d="M175 113c-5-16 13-34 29-31 18-1 29 15 22 28-7 15-24 21-38 20m16-39c-12 2-18 11-12 20 7 8 17 4 20-4m-19 27c14 2 25 10 27 22" />
              <path d="M203 165c-12 39-9 85 1 130m-4-72c-40-35-72-34-88-35 10 40 39 53 88 51m1 25c39-29 70-34 91-36-15 34-44 49-90 49m-3-65 14-14-14-3m2 59-12-9 14-4" />
              <path d="m121 194 78 39m85 1-82 36" strokeWidth=".7" />
            </g>
            <path d="M62 168h18m240 0h18M200 10v18m0 280v18" stroke="currentColor" />
            <circle cx="200" cy="10" r="2" fill="currentColor" /><circle cx="200" cy="326" r="2" fill="currentColor" />
          </svg>
          <span>{es ? "ORGANIZA · CREA · TATÚA" : "PLAN · CREATE · TATTOO"}</span>
        </div>
        <p className="auth-story-footer">{es ? "Hecho para el ritmo de tu estudio." : "Made for the rhythm of your studio."}</p>
      </aside>
      <div className="auth-form-side">
        <div className="auth-language"><LanguageSwitcher locale={locale} label={languageLabel} /></div>
        <div className="auth-mobile-brand"><BrandMark /><span>Tinta</span></div>
        <section className="auth-card">{children}</section>
        <p className="auth-footer">{es ? "Tu arte tiene su espacio. Tu gestión también." : "A place for your art. And everything around it."}</p>
      </div>
    </main>
  );
}
