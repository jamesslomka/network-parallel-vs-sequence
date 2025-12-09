import { NextRequest, NextResponse } from "next/server";
import { getCachedWines } from "@/app/lib/cache";

export interface TraceSpan {
  name: string;
  index: number;
  startTime: number; // relative to request start (ms)
  endTime: number; // relative to request start (ms)
  duration: number;
  success: boolean;
  error?: string;
}

export interface FetchResult {
  index: number;
  latency: number;
  cachedAt: number;
  success: boolean;
  error?: string;
}

export interface FetchWinesResponse {
  results: FetchResult[];
  traces: TraceSpan[];
  totalLatency: number;
  averageLatency: number;
  mode: "parallel" | "sequential";
  fetchCount: number;
  cacheStatus: "hot" | "cold" | "unknown";
  firstFetchLatency: number;
}

async function performSingleFetch(
  index: number,
  requestStart: number
): Promise<{ result: FetchResult; trace: TraceSpan }> {
  const startTime = performance.now() - requestStart;
  try {
    const fetchResult = await getCachedWines();
    const endTime = performance.now() - requestStart;
    const duration = endTime - startTime;

    return {
      result: {
        index,
        latency: duration,
        cachedAt: fetchResult.fetchedAt,
        success: true,
      },
      trace: {
        name: `fetch-${index + 1}`,
        index,
        startTime,
        endTime,
        duration,
        success: true,
      },
    };
  } catch (error) {
    const endTime = performance.now() - requestStart;
    const duration = endTime - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return {
      result: {
        index,
        latency: duration,
        cachedAt: 0,
        success: false,
        error: errorMessage,
      },
      trace: {
        name: `fetch-${index + 1}`,
        index,
        startTime,
        endTime,
        duration,
        success: false,
        error: errorMessage,
      },
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fetchCount, mode } = body as {
      fetchCount: number;
      mode: "parallel" | "sequential";
    };

    if (!fetchCount || fetchCount < 1 || fetchCount > 100) {
      return NextResponse.json(
        { error: "fetchCount must be between 1 and 100" },
        { status: 400 }
      );
    }

    if (mode !== "parallel" && mode !== "sequential") {
      return NextResponse.json(
        { error: "mode must be 'parallel' or 'sequential'" },
        { status: 400 }
      );
    }

    const requestStart = performance.now();
    let results: FetchResult[];
    let traces: TraceSpan[];

    if (mode === "parallel") {
      // Execute all fetches in parallel
      const promises = Array.from({ length: fetchCount }, (_, i) =>
        performSingleFetch(i, requestStart)
      );
      const fetchResults = await Promise.all(promises);
      results = fetchResults.map((r) => r.result);
      traces = fetchResults.map((r) => r.trace);
    } else {
      // Execute fetches sequentially
      results = [];
      traces = [];
      for (let i = 0; i < fetchCount; i++) {
        const { result, trace } = await performSingleFetch(i, requestStart);
        results.push(result);
        traces.push(trace);
      }
    }

    const totalLatency = performance.now() - requestStart;
    const successfulResults = results.filter((r) => r.success);
    const averageLatency =
      successfulResults.length > 0
        ? successfulResults.reduce((sum, r) => sum + r.latency, 0) /
          successfulResults.length
        : 0;

    // Determine cache status based on first fetch latency
    const firstFetchLatency = results[0]?.latency || 0;
    const subsequentAvg =
      results.length > 1
        ? results.slice(1).reduce((sum, r) => sum + r.latency, 0) /
          (results.length - 1)
        : firstFetchLatency;

    let cacheStatus: "hot" | "cold" | "unknown" = "unknown";
    if (results.length > 1) {
      if (firstFetchLatency > subsequentAvg * 3 || firstFetchLatency > 100) {
        cacheStatus = "cold";
      } else {
        cacheStatus = "hot";
      }
    } else if (firstFetchLatency > 100) {
      cacheStatus = "cold";
    } else {
      cacheStatus = "hot";
    }

    const response: FetchWinesResponse = {
      results,
      traces,
      totalLatency,
      averageLatency,
      mode,
      fetchCount,
      cacheStatus,
      firstFetchLatency,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
