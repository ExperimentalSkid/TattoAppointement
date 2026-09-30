export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M20 5 32 18 20 35 8 18 20 5Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M20 5v17m0 13V22m-12-4h24" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="20" cy="18" r="3.5" fill="currentColor" />
    </svg>
  );
}
