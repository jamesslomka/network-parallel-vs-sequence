import { NextResponse } from "next/server";
import { getCachedWines } from "@/app/lib/cache";

const CACHE_COUNT = 100;

export async function POST() {
  try {
    const start = performance.now();

    // Warm all 100 cache entries in parallel
    const promises = Array.from({ length: CACHE_COUNT }, (_, i) =>
      getCachedWines(i + 1)
    );
    const results = await Promise.all(promises);

    const latency = performance.now() - start;
    const firstResult = results[0];

    return NextResponse.json({
      success: true,
      latency,
      cachedAt: firstResult.fetchedAt,
      wineCount: firstResult.data.length,
      cacheEntriesWarmed: CACHE_COUNT,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
