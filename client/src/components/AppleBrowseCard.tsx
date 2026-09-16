import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api } from "../api/client";

export function AppleBrowseCard({ to, title, subtitle, count, coverMediaId, thumbnailVersion }: {
  to: string;
  title: string;
  subtitle?: string;
  count: number;
  coverMediaId: number | null;
  thumbnailVersion: number;
}) {
  return <Link to={to} className="group block overflow-hidden rounded-xl bg-surface ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-xl">
    <div className="relative aspect-[4/3] overflow-hidden bg-media">
      {coverMediaId !== null
        ? <img src={api.media.thumbnailUrl(coverMediaId, thumbnailVersion)} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        : <div className="flex h-full items-center justify-center text-3xl opacity-40">📷</div>}
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="truncate font-serif text-2xl font-semibold text-white">{title}</div>
        {subtitle && <div className="truncate text-sm text-white/80">{subtitle}</div>}
      </div>
    </div>
    <div className="flex items-center justify-between p-4 text-sm">
      <span className="text-muted">{count.toLocaleString()} items</span>
      <span className="inline-flex items-center gap-2 font-medium text-ink">Open <ArrowRight size={15} aria-hidden /></span>
    </div>
  </Link>;
}
