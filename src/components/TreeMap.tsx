"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  APIProvider,
  AdvancedMarker,
  ControlPosition,
  InfoWindow,
  Map,
  MapControl,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import type { MapData, Site, Tree } from "@/lib/types";

const UGANDA_EAST = { lat: 0.75, lng: 33.6 };

type Layers = { trees: boolean; school: boolean; community: boolean };

export default function TreeMap({ apiKey, mapId }: { apiKey: string; mapId: string }) {
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>({ trees: true, school: true, community: true });
  const [selected, setSelected] = useState<Site | null>(null);

  useEffect(() => {
    fetch("/api/map-data")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setError("Die Kartendaten konnten nicht geladen werden."));
  }, []);

  const sites = useMemo(
    () => (data?.sites ?? []).filter((s) => layers[s.type]),
    [data, layers],
  );

  if (!apiKey) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        Google-Maps-Key fehlt. Bitte NEXT_PUBLIC_GOOGLE_MAPS_KEY in der .env setzen.
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey} language="en">
      <Map
        mapId={mapId || "DEMO_MAP_ID"}
        defaultCenter={UGANDA_EAST}
        defaultZoom={9}
        mapTypeId="hybrid"
        gestureHandling="greedy"
        className="h-full w-full"
      >
        {layers.trees && data && <TreeCluster trees={data.trees} />}

        {sites.map((s) => (
          <AdvancedMarker
            key={s.id}
            position={{ lat: s.lat, lng: s.lng }}
            title={s.name}
            onClick={() => setSelected(s)}
          >
            <SiteIcon type={s.type} />
          </AdvancedMarker>
        ))}

        {selected && (
          <InfoWindow position={{ lat: selected.lat, lng: selected.lng }} onCloseClick={() => setSelected(null)}>
            <div className="text-sm text-neutral-900">
              <div className="font-semibold">{selected.name}</div>
              <div>{selected.type === "school" ? "School" : "Community"}</div>
              <div>{selected.treesTracked} trees tracked</div>
            </div>
          </InfoWindow>
        )}

        <MapControl position={ControlPosition.TOP_LEFT}>
          <Legend data={data} layers={layers} setLayers={setLayers} error={error} />
        </MapControl>
      </Map>
    </APIProvider>
  );
}

function SiteIcon({ type }: { type: Site["type"] }) {
  const style =
    type === "school"
      ? "bg-amber-400 border-amber-700"
      : "bg-sky-400 border-sky-800";
  return (
    <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-base shadow ${style}`}>
      {type === "school" ? "🏫" : "🏠"}
    </div>
  );
}

// Bäume als Cluster: bei Tausenden Punkten bleibt die Karte so flüssig.
function TreeCluster({ trees }: { trees: Tree[] }) {
  const map = useMap();
  const markerLib = useMapsLibrary("marker");
  const clusterer = useRef<MarkerClusterer | null>(null);

  useEffect(() => {
    if (!map || !markerLib) return;
    const markers = trees.map((t) => {
      const el = document.createElement("div");
      el.className = "h-3 w-3 rounded-full border border-green-900 bg-green-500";
      return new markerLib.AdvancedMarkerElement({
        position: { lat: t.lat, lng: t.lng },
        content: el,
        title: t.species ?? "Tree",
      });
    });
    clusterer.current = new MarkerClusterer({ map, markers });
    return () => {
      clusterer.current?.clearMarkers();
      clusterer.current = null;
    };
  }, [map, markerLib, trees]);

  return null;
}

function Legend({
  data,
  layers,
  setLayers,
  error,
}: {
  data: MapData | null;
  layers: Layers;
  setLayers: (l: Layers) => void;
  error: string | null;
}) {
  const count = (t: Site["type"]) => data?.sites.filter((s) => s.type === t).length ?? 0;
  const rows: { key: keyof Layers; label: string; n: number }[] = [
    { key: "trees", label: "🌳 Trees", n: data?.trees.length ?? 0 },
    { key: "school", label: "🏫 Schools", n: count("school") },
    { key: "community", label: "🏠 Communities", n: count("community") },
  ];
  return (
    <div className="m-3 rounded-lg bg-white/95 p-3 text-sm text-neutral-900 shadow-lg">
      <div className="mb-2 font-semibold">Inception Tree Map</div>
      {rows.map((r) => (
        <label key={r.key} className="flex cursor-pointer items-center gap-2 py-0.5">
          <input
            type="checkbox"
            checked={layers[r.key]}
            onChange={(e) => setLayers({ ...layers, [r.key]: e.target.checked })}
          />
          <span>{r.label}</span>
          <span className="ml-auto pl-3 tabular-nums text-neutral-500">{r.n.toLocaleString("en")}</span>
        </label>
      ))}
      {data?.demo && <div className="mt-2 text-xs text-amber-700">Demo data</div>}
      {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
    </div>
  );
}
