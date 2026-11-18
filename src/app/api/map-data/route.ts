import { connection } from "next/server";
import { loadMapData } from "@/lib/map-data";

// Liefert alle Standorte und Bäume für die Karte.
// Die Daten ändern sich nur einmal pro Nacht, deshalb darf ein Proxy sie eine Stunde zwischenspeichern.
export async function GET() {
  // Immer zur Laufzeit ausführen, nie beim Build einfrieren
  await connection();
  try {
    const data = await loadMapData();
    return Response.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error("map-data failed", err);
    return Response.json({ error: "Daten konnten nicht geladen werden" }, { status: 500 });
  }
}
