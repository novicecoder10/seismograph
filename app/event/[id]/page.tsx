import Link from "next/link";
import { formatDepth, formatMagnitude, formatUtc } from "@/lib/events/format";
import { detailUrl, parseProducts, type EventProducts } from "@/lib/events/products";
import { createUsgsFdsnRepository } from "@/lib/repositories/usgs-fdsn";

const repo = createUsgsFdsnRepository();

/** Every section is omitted when its product is absent, and says why when a
 *  fetch fails. Degradation is always toward showing something, honestly
 *  labelled (spec §7). */
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);

  const event = await repo.byId(decoded).catch(() => null);
  if (event === null) {
    return (
      <Shell>
        <p style={{ color: "var(--text-dim)" }}>
          No event with the identifier <code>{decoded}</code> could be retrieved. It may not
          exist, or the catalogue service may be unavailable.
        </p>
      </Shell>
    );
  }

  let products: EventProducts | null = null;
  let productsError: string | null = null;
  try {
    const res = await fetch(detailUrl(event.sourceId), { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    products = parseProducts(await res.json());
  } catch (e) {
    productsError = String(e);
  }

  return (
    <Shell>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, margin: "0 0 4px" }}>
        {formatMagnitude(event.magnitude, event.magType)}
      </h2>
      <p style={{ color: "var(--text-dim)", margin: "0 0 2px" }}>{event.place}</p>
      <p style={{ color: "var(--text-faint)", margin: "0 0 20px", fontSize: 12 }}>
        {formatUtc(event.time)} · {formatDepth(event.depthKm)} · {event.lat.toFixed(4)}°,{" "}
        {event.lon.toFixed(4)}° · {event.source.toUpperCase()} · {event.status}
      </p>

      {products === null ? (
        <Panel title="Products">
          <p style={{ color: "var(--accent-warn)" }}>
            The product tree could not be retrieved ({productsError}). The origin above comes
            from the catalogue and is unaffected.
          </p>
        </Panel>
      ) : (
        <>
          <Panel title="Contributing solutions">
            <p style={{ color: "var(--text-faint)", fontSize: 11, marginTop: 0 }}>
              Each agency solves the same event independently. Watching them converge is the
              point; a single number would hide the disagreement.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["source", "magnitude", "depth", "horiz. error", "azim. gap", "status"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "6px 10px",
                          borderBottom: "1px solid var(--line)",
                          color: "var(--text-dim)",
                          fontWeight: 500,
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {products.origins.map((o, i) => (
                  <tr key={`${o.source}-${i}`} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={cell}>{o.source}</td>
                    <td style={cell}>
                      {o.magnitude === null ? "—" : o.magnitude.toFixed(2)}
                      {o.magnitudeError !== null && (
                        <span style={{ color: "var(--text-faint)" }}>
                          {" "}
                          ± {o.magnitudeError.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td style={cell}>{o.depthKm === null ? "—" : `${o.depthKm.toFixed(1)} km`}</td>
                    <td style={cell}>
                      {o.horizontalErrorKm === null ? "—" : `${o.horizontalErrorKm.toFixed(1)} km`}
                    </td>
                    <td style={cell}>
                      {o.azimuthalGapDeg === null ? "—" : `${o.azimuthalGapDeg.toFixed(0)}°`}
                    </td>
                    <td style={cell}>{o.status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {products.momentTensors.length > 0 && (
            <Panel title="Moment tensor">
              {products.momentTensors.map((mt, i) => (
                <div key={i} style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  <div>
                    {mt.source} · {mt.magType ?? "Mw"}{" "}
                    {mt.magnitude === null ? "—" : mt.magnitude.toFixed(1)} · depth{" "}
                    {mt.depthKm === null ? "—" : `${mt.depthKm.toFixed(1)} km`} ·{" "}
                    {mt.percentDoubleCouple === null
                      ? "double couple unknown"
                      : `${(mt.percentDoubleCouple * 100).toFixed(0)}% double couple`}
                  </div>
                  {mt.planes !== null && (
                    <div style={{ marginTop: 4 }}>
                      {mt.planes.map((p, j) => (
                        <div key={j}>
                          plane {j + 1}: strike {p.strike.toFixed(0)}° · dip {p.dip.toFixed(0)}° ·
                          rake {p.rake.toFixed(0)}°
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </Panel>
          )}

          {products.shakemap !== null && (
            <Panel title="ShakeMap">
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)" }}>
                Maximum instrumental intensity{" "}
                {products.shakemap.maxMmi === null
                  ? "unreported"
                  : `MMI ${products.shakemap.maxMmi.toFixed(1)}`}
                .
              </p>
              <Links
                items={[
                  ["intensity contours (cont_mmi.json)", products.shakemap.contourMmiUrl],
                  ["finite-fault rupture (rupture.json)", products.shakemap.ruptureUrl],
                  ["processing info (info.json)", products.shakemap.infoUrl],
                ]}
              />
            </Panel>
          )}

          {products.dyfi !== null && (
            <Panel title="Did You Feel It?">
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)" }}>
                {products.dyfi.responses === null
                  ? "Response count unreported"
                  : `${products.dyfi.responses.toLocaleString()} felt reports`}
                {products.dyfi.maxCdi !== null && `, maximum CDI ${products.dyfi.maxCdi.toFixed(1)}`}
                .
              </p>
              <Links
                items={[
                  ["felt bins, 1 km (dyfi_geo_1km.geojson)", products.dyfi.geo1kmUrl],
                  ["felt bins, 10 km", products.dyfi.geo10kmUrl],
                ]}
              />
            </Panel>
          )}

          {products.pager !== null && (
            <Panel title="PAGER exposure">
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)" }}>
                Alert level {products.pager.alertLevel ?? "unreported"}
                {products.pager.maxMmi !== null && `, maximum MMI ${products.pager.maxMmi}`}. This
                is USGS&apos;s published estimate of shaking exposure for an event that has
                already occurred, not a forecast.
              </p>
              <Links
                items={[
                  ["population exposure (exposures.json)", products.pager.exposuresUrl],
                  ["one-page summary (PDF)", products.pager.onePagerUrl],
                ]}
              />
            </Panel>
          )}

          {products.groundFailure !== null && (
            <Panel title="Ground failure">
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)" }}>
                Landslide alert: {products.groundFailure.landslideAlert ?? "unreported"}.
                Liquefaction alert: {products.groundFailure.liquefactionAlert ?? "unreported"}.
              </p>
            </Panel>
          )}
        </>
      )}

      {event.url !== null && (
        <p style={{ marginTop: 24, fontSize: 12 }}>
          <a href={event.url} style={{ color: "var(--accent-warn)" }}>
            View on the agency&apos;s own event page →
          </a>
        </p>
      )}
    </Shell>
  );
}

const cell = { padding: "6px 10px", color: "var(--text-primary)" } as const;

function Links({ items }: { items: [string, string | null][] }) {
  const present = items.filter(([, url]) => url !== null);
  if (present.length === 0) return null;
  return (
    <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>
      {present.map(([label, url]) => (
        <li key={label} style={{ marginBottom: 2 }}>
          <a href={url!} style={{ color: "var(--text-dim)" }}>
            {label}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid var(--line)",
        background: "var(--bg-panel)",
        padding: "14px 16px",
        marginBottom: 14,
      }}
    >
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 13,
          margin: "0 0 8px",
          color: "var(--text-primary)",
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "22px 22px 60px" }}>
      <Link href="/" style={{ color: "var(--text-dim)", fontSize: 12 }}>
        ← back to the globe
      </Link>
      <div style={{ marginTop: 18 }}>{children}</div>
    </main>
  );
}
