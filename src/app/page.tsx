import TreeMap from "@/components/TreeMap";

export default function Home() {
  return (
    <main className="h-dvh w-full">
      <TreeMap
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? ""}
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ?? ""}
      />
    </main>
  );
}
