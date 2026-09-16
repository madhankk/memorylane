import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { AppleBrowseDto, AppleBrowseItemDto, MediaDto } from "@memorylane/shared";
import { api } from "../api/client";
import { AppleBrowseCard } from "../components/AppleBrowseCard";
import { ApplePhotoTile } from "../components/ApplePhotoTile";
import Viewer from "../components/Viewer";

const PAGE_SIZE = 100;
const monthName = (month: string) => new Date(2000, Number(month) - 1, 1).toLocaleString(undefined, { month: "long" });

export default function ApplePhotosPage() {
  const { id } = useParams<{ id: string }>();
  const rootId = Number(id);
  const [params] = useSearchParams();
  const year = params.get("year") ?? undefined;
  const month = params.get("month") ?? undefined;
  const [result, setResult] = useState<AppleBrowseDto | null>(null);
  const [items, setItems] = useState<AppleBrowseItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerItem, setViewerItem] = useState<MediaDto | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setResult(null);
    setItems([]);
    setError(null);
    void api.plugins.browseApplePhotos(rootId, year, month, 0, PAGE_SIZE)
      .then((value) => { if (current) { setResult(value); setItems(value.items); } })
      .catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : "Could not load Apple Photos"); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [rootId, year, month]);

  const media = useMemo(() => items.flatMap((item) => item.media ? [item.media] : []), [items]);
  const rootUrl = `/apple-photos/${rootId}`;
  const openCatalogItem = async (item: AppleBrowseItemDto) => {
    setBusy(item.uuid); setError(null);
    try { await api.plugins.openCatalogItemInPhotos(rootId, item.uuid); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open Photos"); }
    finally { setBusy(null); }
  };
  const checkLocal = async (item: AppleBrowseItemDto) => {
    setBusy(item.uuid); setError(null);
    try {
      const status = await api.plugins.checkApplePhotoLocal(rootId, item.uuid);
      if (status.available) {
        const updated = await api.plugins.browseApplePhotos(rootId, year, month, 0, Math.max(items.length, PAGE_SIZE));
        setResult(updated); setItems(updated.items);
      } else setError("No usable local image yet. View the photo in Photos, then try again.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not check local copy"); }
    finally { setBusy(null); }
  };
  const loadMore = async () => {
    if (!result || loading) return;
    setLoading(true);
    try {
      const next = await api.plugins.browseApplePhotos(rootId, year, month, items.length, PAGE_SIZE);
      setItems((prior) => [...prior, ...next.items]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load more photos"); }
    finally { setLoading(false); }
  };

  return <div className="flex flex-col gap-6">
    <nav className="flex flex-wrap gap-2 text-sm text-muted" aria-label="Apple Photos breadcrumbs">
      <Link to="/" className="hover:text-ink">Library</Link><span>›</span>
      <Link to={rootUrl} className="hover:text-ink">Apple Device Photos</Link>
      {year && <><span>›</span><Link to={`${rootUrl}?year=${year}`} className="hover:text-ink">{year === "all" ? "All Photos" : year === "unknown" ? "Unknown Date" : year}</Link></>}
      {month && <><span>›</span><span>{monthName(month)}</span></>}
    </nav>
    <div>
      <h1 className="font-serif text-3xl font-semibold text-ink">{month ? `${monthName(month)} ${year}` : year === "all" ? "All Photos" : year === "unknown" ? "Unknown Date" : year ?? "Apple Device Photos"}</h1>
      {result && result.total > 0 && <p className="mt-1 text-sm text-muted">{result.total.toLocaleString()} items</p>}
    </div>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {!year && <Link to={`${rootUrl}?year=all`} className="w-fit rounded-md border border-border px-4 py-2 text-sm text-ink hover:bg-hover">All Photos</Link>}
    {result && result.groups.length > 0 && <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">
      {result.groups.map((group) => <AppleBrowseCard key={group.key}
        to={year ? `${rootUrl}?year=${year}&month=${group.key}` : `${rootUrl}?year=${group.key}`}
        title={group.key === "unknown" ? "Unknown Date" : year ? monthName(group.key) : group.key}
        count={group.count} coverMediaId={group.coverMediaId} thumbnailVersion={group.thumbnailVersion} />)}
    </div>}
    {items.length > 0 && <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
      {items.map((item) => <ApplePhotoTile key={item.uuid} item={item} busy={busy === item.uuid}
        onOpen={() => setViewerItem(item.media ?? null)} onOpenInPhotos={() => void openCatalogItem(item)}
        onCheckLocal={() => void checkLocal(item)} />)}
    </div>}
    {result && items.length < result.total && <button type="button" disabled={loading} onClick={() => void loadMore()} className="self-center rounded-md border border-border px-4 py-2 text-sm text-ink">{loading ? "Loading…" : "Load more"}</button>}
    {loading && !result && <p className="text-sm text-muted">Loading Apple Photos…</p>}
    {viewerItem && <Viewer items={media} startIndex={Math.max(0, media.findIndex((candidate) => candidate.id === viewerItem.id))} onClose={() => setViewerItem(null)} total={media.length} />}
  </div>;
}
