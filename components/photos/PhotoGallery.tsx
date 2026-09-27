"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EventPhotos } from "@/lib/photos/wikimedia";

/** Justified rows: each item's basis is its aspect ratio times the target row
 *  height (--photo-row), and rows grow to fill the width, so every photograph
 *  keeps its own proportions and none is cropped. */
export function PhotoGallery({ data }: { data: EventPhotos }) {
  const { subject, photos } = data;
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const show = useCallback((i: number) => {
    setOpen(i);
    dialog.current?.showModal();
  }, []);
  const step = useCallback(
    (d: number) => setOpen((i) => (i === null ? i : (i + d + photos.length) % photos.length)),
    [photos.length],
  );

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    const onClose = () => setOpen(null);
    el.addEventListener("keydown", onKey);
    el.addEventListener("close", onClose);
    return () => {
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("close", onClose);
    };
  }, [step]);

  const current = open === null ? null : (photos[open] ?? null);

  return (
    <section data-testid="event-photos" className="photos" aria-labelledby="photos-title">
      <div className="photos-head">
        <h3 id="photos-title">Photographs</h3>
        <p>
          Filed on Wikimedia Commons under{" "}
          <a href={subject.categoryUrl ?? subject.wikidataUrl}>{subject.label}</a>. Each is shown under its
          photographer&apos;s licence, credited beneath it.
          {subject.articleUrl !== null && (
            <>
              {" "}
              <a href={subject.articleUrl}>Read about it on Wikipedia</a>.
            </>
          )}
        </p>
      </div>

      <ul className="photos-rows">
        {photos.map((p, i) => (
          <li key={p.file} style={{ flexGrow: p.aspect, flexBasis: `calc(var(--photo-row) * ${p.aspect.toFixed(3)})` }}>
            <button type="button" onClick={() => show(i)} aria-label={`Open photograph: ${p.description || p.file}`}>
              <span style={{ paddingBottom: `${100 / p.aspect}%` }} />
              {/* eslint-disable-next-line @next/next/no-img-element -- Commons serves its own sized thumbnails. */}
              <img src={p.thumbUrl} alt={p.description || p.file.replace(/\.jpe?g$/i, "")} loading="lazy" decoding="async" />
            </button>
            <p className="photos-credit">
              {p.artist}, {p.license}
            </p>
          </li>
        ))}
        {/* Keeps a short last row at its natural height instead of stretching it. */}
        <li aria-hidden="true" className="photos-filler" />
      </ul>

      <dialog ref={dialog} className="photos-viewer" aria-label="Photograph" onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}>
        {current !== null && (
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={current.file} src={current.fullUrl} alt={current.description || current.file} />
            <figcaption>
              {current.description !== "" && <p className="photos-desc">{current.description}</p>}
              <p>
                {current.artist}
                {current.taken !== null && `, ${current.taken}`}.{" "}
                {current.licenseUrl !== null ? <a href={current.licenseUrl}>{current.license}</a> : current.license}.{" "}
                <a href={current.pageUrl}>Full size and details on Commons</a>
              </p>
            </figcaption>
          </figure>
        )}
        <div className="photos-nav">
          <button type="button" onClick={() => step(-1)} aria-label="Previous photograph">
            ‹
          </button>
          <span>
            {open === null ? "" : `${open + 1} of ${photos.length}`}
          </span>
          <button type="button" onClick={() => step(1)} aria-label="Next photograph">
            ›
          </button>
          <button type="button" onClick={() => dialog.current?.close()} className="photos-close">
            Close
          </button>
        </div>
      </dialog>
    </section>
  );
}
