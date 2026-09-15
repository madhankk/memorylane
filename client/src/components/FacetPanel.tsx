import type { FacetBucketDto } from "@memorylane/shared";

interface FacetPanelProps {
  title: string;
  buckets: FacetBucketDto[];
  selected: string | undefined;
  onSelect: (value: string | undefined) => void;
}

// One report facet: rows of label + count with a proportional bar. Clicking
// a row filters by it; clicking the selected row clears it. Rendering is
// shared by every facet so lens/camera/aperture/... read identically.
export default function FacetPanel({ title, buckets, selected, onSelect }: FacetPanelProps) {
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
      <h3 className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {buckets.length === 0 ? (
        <p className="px-3 py-3 text-xs text-faint">No data</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto py-1">
          {buckets.map((b) => {
            const isSelected = selected === b.value;
            return (
              <li key={b.value}>
                <button
                  type="button"
                  onClick={() => onSelect(isSelected ? undefined : b.value)}
                  aria-pressed={isSelected}
                  title={b.label}
                  className={`relative flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm transition ${
                    isSelected ? "bg-accent text-page" : "text-ink hover:bg-hover"
                  }`}
                >
                  {!isSelected && (
                    <span
                      aria-hidden
                      className="absolute inset-y-1 left-0 z-0 rounded-r bg-chip"
                      style={{ width: `${max ? (b.count / max) * 100 : 0}%` }}
                    />
                  )}
                  <span className="relative z-10 truncate">{b.label}</span>
                  <span className="relative z-10 shrink-0 text-xs tabular-nums opacity-80">{b.count.toLocaleString()}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
