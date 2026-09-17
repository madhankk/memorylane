# Cleanup and Tags Design

**Status:** Approved direction from conversation, 2026-09-16. Implementation is staged below.

## Goal

Let a user review very large photo libraries in visible batches, mark unwanted items without touching files, and later delete them through a source-appropriate, explicit action. Tags and conservative AI suggestions help find review candidates; they never delete or mark media automatically.

## Review and selection

Selection applies to thumbnails currently rendered in the view. Select all, select none, and invert selection operate on that rendered set, not unseen pages. The UI states the count and scope before marking. A collapsed burst tile selects only its cover; members require opening the stack. Marking is persistent, immediately removes the item from ordinary listings, and is reversible from Cleanup. A marked item can still be viewed in Cleanup. Companion files are never separate selectable tiles; their relationship is shown before moving files.

## Cleanup states

`suggested` is a derived AI recommendation, separate from `marked`. `marked` is an explicit user decision stored by media ID. Marked media are excluded from all normal browsing, search, random memories, reports, and AI work, but retained in the index. The Cleanup page lists marked items with source, folder, size, and reason. Unmark restores normal visibility. A user's Keep decision dismisses an AI suggestion for the current analyzer version; user intent survives rescans.

For ordinary folder roots, confirming removal moves the original and associated RAW, Live Photo, and sidecar files into a visible `_MemoryLane-Trash` sibling directory. The operation validates current root, path, fingerprint, companion relationships, and destination conflicts before touching any file. The scanner ignores that directory. A trash manifest records every move so Restore can put the files back and rescan. Empty Trash is a separate confirmation and the only permanent unlink operation. Failures are shown per item and do not silently discard a mark or manifest.

## Tags and suggestions

User tags, imported keywords, and AI suggestions have separate provenance. Imported values are updated by source sync without overwriting user tags. The tag browser shows counts, search, and filters; a tag opens its matching media. A versioned background analyzer can use existing CLIP embeddings for broad scene/object candidates, then store calibrated suggestions and reasons. Blur/exposure checks require a separate image analyzer. Age or absence of detected people can change review priority but never serve as standalone evidence of junk. No AI result creates a deletion mark. Existing indexed media are backfilled incrementally; no full filesystem rescan is required. Catalog-only Apple assets receive no image-based suggestion until an image becomes local.

The first tagging implementation uses a fixed vocabulary of broad photo labels, caches the vocabulary's text embeddings per worker, and compares them with stored image embeddings. The Generate AI tags action queues work and reports embedding and tag progress; startup and later scans also queue eligible media. Tags retain source provenance (`user`, `imported`, `ai`), and dismissing an AI tag suppresses it on later generation. The AI similarity cutoff is a heuristic and requires review against real libraries before treating it as calibrated confidence. Quality and junk suggestions remain a separate later analyzer.

## Apple Photos

The shared marking, hiding, review, tags, and suggestion flow applies to indexed Apple Photos media. Its current integration stays read-only toward `.photoslibrary`. Apple assets cannot enter filesystem trash. Cleanup offers Open in Photos as the initial deletion handoff. A later macOS PhotoKit helper may delete selected Photos UUIDs after a separate permission and explicit warning that iCloud Photos deletion affects synced devices. Its result must be reconciled by Photos sync; recovery is through Photos' Recently Deleted, not MemoryLane's filesystem trash. Catalog-only assets need a source UUID based mark path before they can join the same queue.

## Delivery slices

1. Persistent marks, central visibility, rendered-batch selection, Cleanup review and unmark for indexed folder and Apple media.
2. Safe filesystem trash, restore, empty, and scanner exclusion for ordinary folder media.
3. Provenance-aware tags, tag browsing, and incremental AI suggestions.
4. Optional native PhotoKit deletion capability for Apple Photos, designed and reviewed separately before enabling it.

Each slice must have focused tests for permissions, pagination, source visibility, rescans, and failure recovery. The first slice delivers a usable reversible cleanup workflow while later slices add file removal and discovery.
