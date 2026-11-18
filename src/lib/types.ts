export type SiteType = "school" | "community";

export interface Site {
  id: string;
  type: SiteType;
  name: string;
  lat: number;
  lng: number;
  status: string | null;
  treesTracked: number;
}

export interface Tree {
  id: number;
  lat: number;
  lng: number;
  capturedAt: string | null;
  species: string | null;
  siteId: string | null;
}

export interface MapData {
  sites: Site[];
  trees: Tree[];
  demo: boolean;
  updatedAt: string | null;
}
