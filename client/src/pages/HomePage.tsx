import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FolderDto, HomeSummaryDto, MediaDto, OnThisDayTier } from "@memorylane/shared";
import { api } from "../api/client";
import FolderCard from "../components/FolderCard";
import InlineSlideshow from "../components/InlineSlideshow";
import { formatBytes } from "../utils/format";
import { formatMemoryBlurb } from "../utils/blurb";

type MemoryTab = "random" | "onThisDay";

const TIER_CAPTION: Record<OnThisDayTier, string> = {
  day: "Photos taken on this day across the years.",
  week: "No photos from this exact day yet - here's the same week across the years.",
  month: "Nothing from this week yet - here's the same month across the years.",
  none: "",
};

export default function HomePage() {
  const [folders, setFolders] = useState<FolderDto[] | null>(null);
  const [summary, setSummary] = useState<HomeSummaryDto | null>(null);
  const [activeTab, setActiveTab] = useState<MemoryTab | null>(null);
  const [tabItems, setTabItems] = useState<MediaDto[] | null>(null);
  const [tabTier, setTabTier] = useState<OnThisDayTier | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    void api.folders.listTop().then(setFolders);
    // Re-fetched (and re-randomized server-side) on every Home page load.
    void api.home.summary().then(setSummary);
  }, []);

  const randomFolder = () => {
    if (folders && folders.length > 0) {
      const pick = folders[Math.floor(Math.random() * folders.length)];
      navigate(`/folder/${pick.id}`);
    }
  };

  const selectTab = async (tab: MemoryTab) => {
    setActiveTab(tab);
    setTabLoading(true);
    setTabItems(null);
    setTabTier(null);
    try {
      if (tab === "random") {
        const res = await api.memories.random(30);
        setTabItems(res.items);
      } else {
        const res = await api.memories.onThisDay(30);
        setTabItems(res.items);
        setTabTier(res.tier);
      }
    } finally {
      setTabLoading(false);
    }
  };

  const heroMetadata = summary
    ? [
        summary.mediaCount > 0 ? `${summary.mediaCount.toLocaleString()} media` : null,
        summary.folderCount > 0 ? `${summary.folderCount.toLocaleString()} folders` : null,
        summary.yearSpan > 0 ? `${summary.yearSpan.toLocaleString()} ${summary.yearSpan === 1 ? "year" : "years"}` : null,
        summary.totalSizeBytes > 0 ? formatBytes(summary.totalSizeBytes) : null,
      ].filter((v): v is string => v !== null)
    : [];

  const heroBlurb = summary?.heroMedia ? formatMemoryBlurb(summary.heroMedia) : null;

  const tabButtonClass = (tab: MemoryTab) =>
    `rounded-full px-4 py-2 text-sm font-medium transition ${
      activeTab === tab ? "bg-photo-shell text-white" : "border border-border bg-surface text-ink hover:bg-hover"
    }`;

  return (
    <div className="flex flex-col gap-10">
      {/* Hero card - mirrors life-archive-app's home hero, with a random
          library photo standing in for the archive's "hero.jpg". */}
      <section>
        <div className="relative min-h-[460px] overflow-hidden rounded-[8px] bg-hero-fallback shadow-hero ring-1 ring-border">
          {summary?.heroMedia && (
            <img
              src={api.media.thumbnailUrl(summary.heroMedia.id)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,18,34,0.72)_0%,rgba(8,18,34,0.43)_42%,rgba(8,18,34,0.08)_78%)]" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/42 to-transparent" />

          <div className="relative flex min-h-[460px] items-end p-6 text-white sm:p-8 lg:p-10">
            <div className="max-w-[760px] pb-2">
              <p className="text-[13px] font-medium text-white/70">Photo Archive</p>
              <h1 className="mt-2 font-serif text-[clamp(3.875rem,5.4vw,5.25rem)] font-semibold leading-[0.95] tracking-[-0.03em]">
                MemoryLane
              </h1>
              {heroBlurb && <p className="mt-3 text-sm font-medium text-white/60">{heroBlurb}</p>}
            </div>
          </div>
        </div>

        {heroMetadata.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-x-7 gap-y-2 px-1 text-[14px] leading-[1.7] text-muted">
            {heroMetadata.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        )}

        <div className="mt-6 px-1">
          <button
            className="rounded-full bg-accent px-10 py-4 text-lg font-bold text-page shadow-hero transition-opacity hover:opacity-90"
            onClick={() => {
              // Requested synchronously inside the click handler - browsers only grant
              // fullscreen in direct response to a user gesture, and that gesture context
              // is gone by the time the Surprise Me route finishes fetching photos.
              document.documentElement.requestFullscreen?.().catch(() => {});
              navigate("/surprise");
            }}
          >
            Surprise Me
          </button>
        </div>
      </section>

      {/* Small tabbed rediscovery widgets - surface photos from anywhere in
          the library with zero effort, right on the home page. */}
      <section>
        <div className="flex gap-2 px-1">
          <button onClick={() => selectTab("random")} className={tabButtonClass("random")}>
            Random Memory
          </button>
          <button onClick={() => selectTab("onThisDay")} className={tabButtonClass("onThisDay")}>
            This Day, Another Time
          </button>
        </div>

        {activeTab && (
          <div className="mt-4">
            {tabLoading && <p className="px-1 text-sm text-muted">Gathering photos...</p>}
            {!tabLoading && tabItems && tabItems.length > 0 && (
              <>
                {activeTab === "onThisDay" && tabTier && tabTier !== "none" && (
                  <p className="mb-2 px-1 text-xs text-muted">{TIER_CAPTION[tabTier]}</p>
                )}
                <InlineSlideshow items={tabItems} />
              </>
            )}
            {!tabLoading && tabItems && tabItems.length === 0 && (
              <p className="px-1 text-sm text-muted">
                {activeTab === "onThisDay"
                  ? "No dated photos yet to pull memories from - dates come from photo metadata."
                  : "No indexed photos yet - add a scan root and run a scan from Settings first."}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <button
          disabled
          title="Coming soon"
          className="rounded-xl border border-border bg-surface p-5 text-left text-sm text-ink shadow-card disabled:cursor-not-allowed disabled:opacity-40"
        >
          Years Ago
        </button>
        <button
          onClick={randomFolder}
          disabled={!folders?.length}
          className="rounded-xl border border-border bg-surface p-5 text-left text-sm text-ink shadow-card transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Random Folder
        </button>
        <button
          disabled
          title="Coming soon"
          className="rounded-xl border border-border bg-surface p-5 text-left text-sm text-ink shadow-card disabled:cursor-not-allowed disabled:opacity-40"
        >
          Forgotten Photos
        </button>
      </section>

      <section>
        <h2 className="mb-4 font-serif text-2xl font-semibold text-ink">Your Library</h2>
        {folders === null && <p className="text-sm text-muted">Loading...</p>}
        {folders && folders.length === 0 && (
          <p className="text-sm text-muted">No photo folders configured yet. Head to Settings to add a folder to scan.</p>
        )}
        {folders && folders.length > 0 && (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">
            {folders.map((f) => (
              <FolderCard key={f.id} folder={f} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
