import { NextResponse } from "next/server";
import { getCachedWines, markCacheWarmed } from "@/app/lib/cache";

export async function POST() {
  try {
    const start = performance.now();
    const result = await getCachedWines();
    const latency = performance.now() - start;

    // Note: the warmed timestamp mirrors the cached fetch time so other routes
    // can infer the cache is likely hot without timing heuristics alone.
    markCacheWarmed(result.fetchedAt);

    return NextResponse.json({
      success: true,
      latency,
      cachedAt: result.fetchedAt,
      wineCount: result.data.length,
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
