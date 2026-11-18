/**
 * Nächtlicher Sync für die Inception Tree Map.
 *
 * 1. Schulen und Communities aus Notion lesen, Koordinaten aus GPS-Feld oder Google-Maps-Kurzlink ermitteln
 * 2. Alle Bäume der Organisation von der öffentlichen Greenstand-Karte holen
 * 3. Jeden Baum der nächsten Schule oder Community zuordnen
 * 4. Alles in Supabase schreiben, optional Koordinaten zurück nach Notion
 *
 * Aufruf:  npm run sync              (braucht .env)
 *          npm run sync -- --dry-run (schreibt nichts, zeigt nur Zahlen)
 *          npm run sync -- --only=trees|sites
 */
import { Client as NotionClient } from "@notionhq/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const ONLY = [...args].find((a) => a.startsWith("--only="))?.split("=")[1];

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`Umgebungsvariable ${k} fehlt`);
  return v;
};

const GREENSTAND = "https://prod-k8s.treetracker.org/webmap/trees";
const MAX_ASSIGN_DISTANCE_M = 3000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- Typen

interface SiteRow {
  notion_id: string;
  type: "school" | "community";
  name: string;
  lat: number | null;
  lng: number | null;
  status: string | null;
  maps_url: string | null;
  coordsFromLink: boolean; // Koordinaten neu aus dem Link ermittelt -> ggf. nach Notion zurückschreiben
}

interface TreePoint {
  greenstand_id: number;
  lat: number;
  lng: number;
}

// ---------------------------------------------------------------- Koordinaten

/** "0.540322,33.401703" -> {lat, lng} */
export function parseLatLng(text: string | null | undefined): { lat: number; lng: number } | null {
  if (!text) return null;
  const m = text.match(/(-?\d{1,2}\.\d+)\s*,\s*\+?(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Koordinaten aus einer langen Google-Maps-URL lesen. Der genaue Ortspunkt (!3d!4d) hat Vorrang vor dem Kartenausschnitt (@). */
export function coordsFromMapsUrl(url: string): { lat: number; lng: number } | null {
  const u = decodeURIComponent(url);
  const pin = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (pin) return { lat: Number(pin[1]), lng: Number(pin[2]) };
  const q = u.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*\+?(-?\d+\.\d+)/);
  if (q) return { lat: Number(q[1]), lng: Number(q[2]) };
  const search = u.match(/\/(?:search|place|dir)\/(-?\d+\.\d+),\s*\+?(-?\d+\.\d+)/);
  if (search) return { lat: Number(search[1]), lng: Number(search[2]) };
  const at = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
  return null;
}

/** maps.app.goo.gl-Kurzlink auflösen, indem wir den Weiterleitungen folgen. */
async function resolveShortLink(url: string): Promise<{ lat: number; lng: number } | null> {
  let current = url;
  for (let i = 0; i < 6; i++) {
    const direct = coordsFromMapsUrl(current);
    if (direct) return direct;
    const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const next = res.headers.get("location");
    if (!next) {
      // Letzte Seite: manchmal stehen die Koordinaten nur im HTML
      const html = await res.text().catch(() => "");
      return coordsFromMapsUrl(html.slice(0, 200000));
    }
    current = new URL(next, current).toString();
  }
  return null;
}

// ---------------------------------------------------------------- Notion

type NotionProps = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const plain = (p: any): string | null => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!p) return null;
  switch (p.type) {
    case "title": return p.title.map((t: any) => t.plain_text).join("").trim() || null; // eslint-disable-line @typescript-eslint/no-explicit-any
    case "rich_text": return p.rich_text.map((t: any) => t.plain_text).join("").trim() || null; // eslint-disable-line @typescript-eslint/no-explicit-any
    case "url": return p.url ?? null;
    case "status": return p.status?.name ?? null;
    case "select": return p.select?.name ?? null;
    default: return null;
  }
};

async function queryAll(notion: NotionClient, dataSourceId: string): Promise<{ id: string; properties: NotionProps }[]> {
  const out: { id: string; properties: NotionProps }[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.dataSources.query({ data_source_id: dataSourceId, start_cursor: cursor, page_size: 100 });
    for (const r of res.results) if ("properties" in r) out.push({ id: r.id, properties: r.properties as NotionProps });
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

async function loadSites(notion: NotionClient): Promise<SiteRow[]> {
  const sources = [
    { type: "school" as const, id: env("NOTION_SCHOOLS_DATA_SOURCE"), name: "School Name", link: "School Google Maps Link", gps: "GPS Coordinates", status: null },
    { type: "community" as const, id: env("NOTION_COMMUNITIES_DATA_SOURCE"), name: "Community Name", link: "Community Google Maps Link", gps: "GPS Coordinates", status: "Community Status" },
  ];
  const sites: SiteRow[] = [];
  for (const src of sources) {
    const pages = await queryAll(notion, src.id);
    log(`Notion ${src.type}: ${pages.length} Einträge`);
    for (const p of pages) {
      const name = plain(p.properties[src.name]);
      if (!name) continue; // Einträge ohne Namen ignorieren (siehe Cleanup Woche 44)
      const mapsUrl = plain(p.properties[src.link]);
      const gpsText = plain(p.properties[src.gps]);
      const gps = parseLatLng(gpsText);
      sites.push({
        notion_id: p.id,
        type: src.type,
        name,
        lat: gps?.lat ?? null,
        lng: gps?.lng ?? null,
        status: src.status ? plain(p.properties[src.status]) : null,
        maps_url: mapsUrl,
        coordsFromLink: false,
      });
    }
  }
  return sites;
}

async function fillCoordinates(sites: SiteRow[], known: Map<string, { lat: number; lng: number; maps_url: string | null }>) {
  let fromCache = 0, resolved = 0, failed = 0;
  for (const s of sites) {
    if (s.lat !== null) continue;
    const prev = known.get(s.notion_id);
    // Schon einmal aufgelöst und Link unverändert -> nicht erneut abfragen
    if (prev && prev.maps_url === s.maps_url) {
      s.lat = prev.lat; s.lng = prev.lng; fromCache++;
      continue;
    }
    if (!s.maps_url) { failed++; continue; }
    try {
      const c = await resolveShortLink(s.maps_url);
      if (c) { s.lat = c.lat; s.lng = c.lng; s.coordsFromLink = true; resolved++; }
      else failed++;
    } catch { failed++; }
    await sleep(300); // Google nicht überlasten
  }
  log(`Koordinaten: ${resolved} neu aus Links, ${fromCache} aus Supabase, ${failed} ohne Ergebnis`);
}

async function writeCoordinatesToNotion(notion: NotionClient, sites: SiteRow[]) {
  const todo = sites.filter((s) => s.coordsFromLink && s.lat !== null);
  log(`Notion: schreibe ${todo.length} Koordinaten zurück`);
  for (const s of todo) {
    try {
      await notion.pages.update({
        page_id: s.notion_id,
        properties: { "GPS Coordinates": { rich_text: [{ type: "text", text: { content: `${s.lat!.toFixed(6)},${s.lng!.toFixed(6)}` } }] } },
      });
    } catch (e) {
      log(`Notion-Update fehlgeschlagen für ${s.name}:`, (e as Error).message);
    }
    await sleep(350); // Notion erlaubt ca. 3 Anfragen pro Sekunde
  }
}

// ---------------------------------------------------------------- Greenstand

type Bounds = [number, number, number, number]; // West, Süd, Ost, Nord

// Achtung: Der Parameter organization_id wird von diesem Endpunkt ignoriert (Test 18.11.2026),
// gefiltert wird über map_name. Ob map_name=inception genau unsere Bäume liefert, muss Greenstand bestätigen.
async function greenstand(zoom: number, b: Bounds, timeoutMs: number) {
  const url = `${GREENSTAND}?zoom_level=${zoom}&clusterRadius=${zoom >= 15 ? 0 : 0.05}&map_name=${encodeURIComponent(env("GREENSTAND_MAP_NAME", "inception"))}&bounds=${b.join(",")}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Greenstand ${res.status}`);
  const json = (await res.json()) as { data: Record<string, unknown>[] };
  return json.data;
}

/** Einzelne Bäume in einem Ausschnitt holen. Bricht die Abfrage ab, wird der Ausschnitt geviertelt. */
async function pointsIn(b: Bounds, depth = 0): Promise<TreePoint[]> {
  try {
    const rows = await greenstand(16, b, 90000);
    return rows
      .filter((r) => r.type === "point")
      .map((r) => ({ greenstand_id: Number(r.id), lat: Number(r.lat), lng: Number(r.lon) }));
  } catch (e) {
    if (depth >= 3) { log(`Ausschnitt ${b.join(",")} übersprungen:`, (e as Error).message); return []; }
    const [w, s, east, n] = b;
    const mx = (w + east) / 2, my = (s + n) / 2;
    const parts: Bounds[] = [[w, s, mx, my], [mx, s, east, my], [w, my, mx, n], [mx, my, east, n]];
    const out: TreePoint[] = [];
    for (const p of parts) out.push(...(await pointsIn(p, depth + 1)));
    return out;
  }
}

async function loadTrees(): Promise<{ trees: TreePoint[]; expected: number }> {
  const bounds = env("GREENSTAND_BOUNDS", "32.5,-0.6,35.1,2.0").split(",").map(Number) as Bounds;
  // Schritt 1: grobe Cluster zeigen, wo überhaupt Bäume stehen
  const clusters = await greenstand(10, bounds, 120000);
  const expected = clusters.reduce((n, c) => n + Number(c.count ?? 1), 0);
  log(`Greenstand: ${clusters.length} Cluster, zusammen ${expected} Bäume erwartet`);

  // Schritt 2: um jeden Cluster herum die einzelnen Bäume holen
  const byId = new Map<number, TreePoint>();
  let i = 0;
  for (const c of clusters) {
    i++;
    let lat: number, lng: number;
    if (c.type === "point") { lat = Number(c.lat); lng = Number(c.lon); }
    else { [lng, lat] = (JSON.parse(String(c.centroid)) as { coordinates: [number, number] }).coordinates; }
    const pad = 0.06; // Clusterraster bei Zoom 10 ist ca. 0,09 Grad
    const pts = await pointsIn([lng - pad, lat - pad, lng + pad, lat + pad]);
    for (const p of pts) byId.set(p.greenstand_id, p);
    if (i % 10 === 0) log(`  ${i}/${clusters.length} Cluster, ${byId.size} Bäume`);
  }
  return { trees: [...byId.values()], expected };
}

// ---------------------------------------------------------------- Zuordnung

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------- Supabase

async function upsertChunks(db: SupabaseClient, table: string, rows: object[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

// ---------------------------------------------------------------- Ablauf

async function main() {
  const summary: Record<string, unknown> = { dryRun: DRY_RUN };
  const db = DRY_RUN ? null : createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const run = db ? (await db.from("sync_runs").insert({}).select("id").single()).data : null;

  try {
    // Standorte
    let sites: (SiteRow & { id?: string })[] = [];
    if (ONLY !== "trees") {
      const notion = new NotionClient({ auth: env("NOTION_TOKEN") });
      sites = await loadSites(notion);
      const known = new Map<string, { lat: number; lng: number; maps_url: string | null }>();
      if (db) {
        const { data } = await db.from("sites").select("notion_id,lat,lng,maps_url").not("lat", "is", null);
        for (const r of data ?? []) known.set(r.notion_id, r);
      }
      await fillCoordinates(sites, known);
      summary.sites = sites.length;
      summary.sitesWithCoords = sites.filter((s) => s.lat !== null).length;
      if (db) {
        await upsertChunks(db, "sites", sites.map(({ coordsFromLink: _c, ...s }) => ({ ...s, updated_at: new Date().toISOString() })), "notion_id"); // eslint-disable-line @typescript-eslint/no-unused-vars
        if (env("NOTION_WRITE_COORDINATES", "false") === "true") await writeCoordinatesToNotion(notion, sites);
      }
    }

    // Bäume
    if (ONLY !== "sites") {
      const { trees, expected } = await loadTrees();
      summary.treesExpected = expected;
      summary.treesFetched = trees.length;
      log(`Greenstand: ${trees.length} von ${expected} Bäumen geholt`);

      if (db) {
        const { data: siteRows } = await db.from("sites").select("id,lat,lng").not("lat", "is", null);
        const located = (siteRows ?? []) as { id: string; lat: number; lng: number }[];
        const now = new Date().toISOString();
        const counts = new Map<string, number>();
        const rows = trees.map((t) => {
          let best: { id: string; d: number } | null = null;
          for (const s of located) {
            const d = distanceM(t, s);
            if (!best || d < best.d) best = { id: s.id, d };
          }
          const site = best && best.d <= MAX_ASSIGN_DISTANCE_M ? best : null;
          if (site) counts.set(site.id, (counts.get(site.id) ?? 0) + 1);
          return { ...t, site_id: site?.id ?? null, distance_m: site ? Math.round(site.d) : null, last_seen: now };
        });
        await upsertChunks(db, "trees", rows, "greenstand_id");
        for (const s of located) {
          await db.from("sites").update({ trees_tracked: counts.get(s.id) ?? 0 }).eq("id", s.id);
        }
        summary.treesAssigned = rows.filter((r) => r.site_id).length;
      }
    }

    if (db && run) await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: true, summary }).eq("id", run.id);
    log("Fertig", summary);
  } catch (e) {
    summary.error = (e as Error).message;
    if (db && run) await db.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: false, summary }).eq("id", run.id);
    console.error(e);
    process.exit(1);
  }
}

main();
