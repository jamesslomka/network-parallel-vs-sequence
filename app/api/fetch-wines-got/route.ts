import { NextRequest, NextResponse } from "next/server";
import {
  getWinesWithTimings,
  type NetworkTimings,
} from "@/app/lib/cache";

export interface TraceSpan {
  name: string;
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string;
  networkTimings?: NetworkTimings;
}

export interface FetchResult {
  index: number;
  latency: number;
  cachedAt: number;
  success: boolean;
  error?: string;
  networkTimings?: NetworkTimings;
}

export interface FetchWinesGotResponse {
  results: FetchResult[];
  traces: TraceSpan[];
  totalLatency: number;
  averageLatency: number;
  mode: "parallel" | "sequential";
  fetchCount: number;
  // Aggregated network timings
  aggregatedTimings: {
    avgDns: number;
    avgTcp: number;
    avgTls: number;
    avgFirstByte: number;
    avgDownload: number;
    avgTotal: number;
  };
}

async function performSingleFetch(
  index: number,
  requestStart: number
): Promise<{ result: FetchResult; trace: TraceSpan }> {
  const startTime = performance.now() - requestStart;
  try {
    const fetchResult = await getWinesWithTimings();
    const endTime = performance.now() - requestStart;
    const duration = endTime - startTime;

    return {
      result: {
        index,
        latency: duration,
        cachedAt: fetchResult.fetchedAt,
        success: true,
        networkTimings: fetchResult.timings,
      },
      trace: {
        name: `fetch-${index + 1}`,
        index,
        startTime,
        endTime,
        duration,
        success: true,
        networkTimings: fetchResult.timings,
      },
    };
  } catch (error) {
    const endTime = performance.now() - requestStart;
    const duration = endTime - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

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

    // Calculate aggregated network timings
    const resultsWithTimings = successfulResults.filter(
      (r) => r.networkTimings
    );
    const count = resultsWithTimings.length || 1;

    const aggregatedTimings = {
      avgDns:
        resultsWithTimings.reduce(
          (sum, r) => sum + (r.networkTimings?.dns ?? 0),
          0
        ) / count,
      avgTcp:
        resultsWithTimings.reduce(
          (sum, r) => sum + (r.networkTimings?.tcp ?? 0),
          0
        ) / count,
      avgTls:
        resultsWithTimings.reduce(
          (sum, r) => sum + (r.networkTimings?.tls ?? 0),
          0
        ) / count,
      avgFirstByte:
        resultsWithTimings.reduce(
          (sum, r) => sum + (r.networkTimings?.firstByte ?? 0),
          0
        ) / count,
      avgDownload:
        resultsWithTimings.reduce(
          (sum, r) => sum + (r.networkTimings?.download ?? 0),
          0
        ) / count,
      avgTotal:
        resultsWithTimings.reduce(
          (sum, r) => sum + (r.networkTimings?.total ?? 0),
          0
        ) / count,
    };

    const response: FetchWinesGotResponse = {
      results,
      traces,
      totalLatency,
      averageLatency,
      mode,
      fetchCount,
      aggregatedTimings,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
