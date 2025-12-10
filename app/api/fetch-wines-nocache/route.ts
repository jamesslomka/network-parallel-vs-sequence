import { NextRequest, NextResponse } from "next/server";

const WINES_API_URL = "https://api.sampleapis.com/wines/reds";

export interface TraceSpan {
  name: string;
  index: number;
  startTime: number;
  endTime: number;
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

export interface FetchWinesNoCacheResponse {
  results: FetchResult[];
  traces: TraceSpan[];
  totalLatency: number;
  averageLatency: number;
  mode: "parallel" | "sequential";
  fetchCount: number;
}

async function performSingleFetch(
  index: number,
  requestStart: number
): Promise<{ result: FetchResult; trace: TraceSpan }> {
  const startTime = performance.now() - requestStart;
  try {
    const response = await fetch(WINES_API_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await response.json();
    const endTime = performance.now() - requestStart;
    const duration = endTime - startTime;

    return {
      result: {
        index,
        latency: duration,
        cachedAt: 0,
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
      const promises = Array.from({ length: fetchCount }, (_, i) =>
        performSingleFetch(i, requestStart)
      );
      const fetchResults = await Promise.all(promises);
      results = fetchResults.map((r) => r.result);
      traces = fetchResults.map((r) => r.trace);
    } else {
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

    const response: FetchWinesNoCacheResponse = {
      results,
      traces,
      totalLatency,
      averageLatency,
      mode,
      fetchCount,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
