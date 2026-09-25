/**
 * Browser-side downloads. Nothing goes through a server: the file is built from
 * what is already on screen and handed to the browser as a Blob.
 */
export function downloadBlob(data: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A chart as a standalone SVG document: the dark surface painted in, the app's
 * font named explicitly (it was inherited from CSS), and interactive overlays
 * (the crosshair) stripped.
 */
export function svgDocument(svg: SVGSVGElement, background = "#12161a"): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll("[data-export='skip']").forEach((n) => n.remove());
  const [, , w, h] = (clone.getAttribute("viewBox") ?? "0 0 640 300").split(/\s+/).map(Number);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.removeAttribute("style");
  clone.removeAttribute("tabindex");
  clone.setAttribute("font-family", "IBM Plex Mono, ui-monospace, monospace");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", background);
  clone.insertBefore(bg, clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/** Rasterises the SVG document at `scale`× its viewBox size. */
export async function svgToPng(doc: string, width: number, height: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([doc], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG did not load"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("No 2D context");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b === null ? reject(new Error("PNG encoding failed")) : resolve(b)), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A filesystem-safe stem from a chart's test id or title. */
export function fileStem(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chart";
}
