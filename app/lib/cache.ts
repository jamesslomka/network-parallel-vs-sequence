import { unstable_cache } from "next/cache";
import got from "got";

const WINES_API_URL = "https://api.sampleapis.com/wines/reds";

export interface Wine {
  winery: string;
  wine: string;
  rating: { average: string; reviews: string };
  location: string;
  image: string;
  id: number;
}

export interface NetworkTimings {
  wait: number; // Time waiting for socket
  dns: number; // DNS lookup time
  tcp: number; // TCP connection time
  tls: number; // TLS handshake time
  request: number; // Request send time
  firstByte: number; // Time to first byte (TTFB)
  download: number; // Content download time
  total: number; // Total request time
}

export interface FetchWithTimingsResult {
  data: Wine[];
  fetchedAt: number;
  timings: NetworkTimings;
}

// Cached version of the wines API fetch with a long TTL (1 hour)
export const getCachedWines = unstable_cache(
  async (): Promise<{ data: Wine[]; fetchedAt: number }> => {
    const response = await fetch(WINES_API_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch wines: ${response.status}`);
    }
    const data = await response.json();
    return {
      data,
      fetchedAt: Date.now(),
    };
  },
  ["wines-cache"],
  {
    revalidate: 3600, // 1 hour TTL
    tags: ["wines"],
  }
);

// Direct fetch without cache (for comparison)
export async function getUncachedWines(): Promise<{
  data: Wine[];
  fetchedAt: number;
}> {
  const response = await fetch(WINES_API_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch wines: ${response.status}`);
  }
  const data = await response.json();
  return {
    data,
    fetchedAt: Date.now(),
  };
}

// Fetch using 'got' with detailed network timings
export async function getWinesWithTimings(): Promise<FetchWithTimingsResult> {
  const response = await got(WINES_API_URL, {
    responseType: "json",
    // Disable retry to get accurate single-request timings
    retry: { limit: 0 },
  });

  const phases = response.timings.phases;

  return {
    data: response.body as Wine[],
    fetchedAt: Date.now(),
    timings: {
      wait: phases.wait ?? 0,
      dns: phases.dns ?? 0,
      tcp: phases.tcp ?? 0,
      tls: phases.tls ?? 0,
      request: phases.request ?? 0,
      firstByte: phases.firstByte ?? 0,
      download: phases.download ?? 0,
      total: phases.total ?? 0,
    },
  };
}
