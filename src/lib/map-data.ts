import { createClient } from "@supabase/supabase-js";
import type { MapData, Site, Tree } from "./types";

// Beispieldaten, solange Supabase noch nicht verbunden ist.
// Koordinaten stammen aus Notion (Communities mit GPS-Feld) und aus der Greenstand-Karte.
const DEMO: MapData = {
  demo: true,
  updatedAt: null,
  sites: [
    { id: "demo-1", type: "community", name: "Namazanza community", lat: 1.089981, lng: 34.234062, status: "Active", treesTracked: 0 },
    { id: "demo-2", type: "community", name: "Bugodi Community", lat: 0.540322, lng: 33.401703, status: "Active", treesTracked: 0 },
    { id: "demo-3", type: "community", name: "luubu", lat: 0.4082944, lng: 33.4426484, status: "Active", treesTracked: 0 },
  ],
  trees: [
    { id: 7363060, lat: 0.3824224852, lng: 33.1500854436, capturedAt: null, species: null, siteId: null },
    { id: 6612628, lat: 0.3746848446, lng: 33.1232964409, capturedAt: null, species: null, siteId: null },
  ],
};

const PAGE = 1000;

export async function loadMapData(): Promise<MapData> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return DEMO;

  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: siteRows, error: siteErr } = await db
    .from("sites")
    .select("id,type,name,lat,lng,status,trees_tracked")
    .not("lat", "is", null);
  if (siteErr) throw siteErr;

  // Supabase liefert maximal 1000 Zeilen pro Abfrage, daher seitenweise
  const treeRows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("trees")
      .select("greenstand_id,lat,lng,captured_at,species,site_id")
      .order("greenstand_id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    treeRows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const { data: lastRun } = await db
    .from("sync_runs")
    .select("finished_at")
    .eq("ok", true)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sites: Site[] = (siteRows ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    status: r.status,
    treesTracked: r.trees_tracked,
  }));

  const trees: Tree[] = treeRows.map((r) => ({
    id: Number(r.greenstand_id),
    lat: Number(r.lat),
    lng: Number(r.lng),
    capturedAt: (r.captured_at as string) ?? null,
    species: (r.species as string) ?? null,
    siteId: (r.site_id as string) ?? null,
  }));

  return { sites, trees, demo: false, updatedAt: lastRun?.finished_at ?? null };
}
