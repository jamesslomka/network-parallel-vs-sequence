"use client";

import { useState, useCallback } from "react";
import type {
  FetchWinesResponse,
  FetchResult,
  TraceSpan,
} from "./api/fetch-wines/route";
import type { FetchWinesGotResponse } from "./api/fetch-wines-got/route";
import type { FetchWinesNoCacheResponse } from "./api/fetch-wines-nocache/route";
import type { NetworkTimings } from "./lib/cache";

type HttpClient = "fetch" | "got" | "fetch-nocache";

interface TestResult {
  id: string;
  response: FetchWinesResponse | FetchWinesGotResponse | FetchWinesNoCacheResponse;
  timestamp: Date;
  httpClient: HttpClient;
}

interface ComparisonResult {
  parallel: FetchWinesResponse | FetchWinesGotResponse | FetchWinesNoCacheResponse | null;
  sequential: FetchWinesResponse | FetchWinesGotResponse | FetchWinesNoCacheResponse | null;
}

// Type guard to check if response has network timings (got response)
function hasNetworkTimings(
  response: FetchWinesResponse | FetchWinesGotResponse | FetchWinesNoCacheResponse
): response is FetchWinesGotResponse {
  return "aggregatedTimings" in response;
}

// Type guard to check if result has network timings
function resultHasTimings(
  result: FetchResult
): result is FetchResult & { networkTimings: NetworkTimings } {
  return "networkTimings" in result && result.networkTimings !== undefined;
}

export default function Home() {
  const [fetchCount, setFetchCount] = useState(10);
  const [mode, setMode] = useState<"parallel" | "sequential" | "compare">(
    "compare"
  );
  const [httpClient, setHttpClient] = useState<HttpClient>("fetch");
  const [isLoading, setIsLoading] = useState(false);
  const [isWarmingCache, setIsWarmingCache] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [latestSingleResult, setLatestSingleResult] = useState<
    FetchWinesResponse | FetchWinesGotResponse | FetchWinesNoCacheResponse | null
  >(null);
  const [currentHttpClient, setCurrentHttpClient] =
    useState<HttpClient>("fetch");
  const [error, setError] = useState<string | null>(null);

  const warmCache = useCallback(async () => {
    setIsWarmingCache(true);
    setError(null);
    try {
      const response = await fetch("/api/warm-cache", { method: "POST" });
      if (!response.ok) {
        throw new Error("Failed to warm cache");
      }
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to warm cache");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to warm cache");
    } finally {
      setIsWarmingCache(false);
    }
  }, []);

  const runTest = useCallback(
    async (
      testMode: "parallel" | "sequential"
    ): Promise<FetchWinesResponse | FetchWinesGotResponse | FetchWinesNoCacheResponse> => {
      let endpoint: string;
      if (httpClient === "got") {
        endpoint = "/api/fetch-wines-got";
      } else if (httpClient === "fetch-nocache") {
        endpoint = "/api/fetch-wines-nocache";
      } else {
        endpoint = "/api/fetch-wines";
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fetchCount, mode: testMode }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Request failed");
      }

      return response.json();
    },
    [fetchCount, httpClient]
  );

  const handleRun = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setCurrentHttpClient(httpClient);

    try {
      if (mode === "compare") {
        const parallelResult = await runTest("parallel");
        const sequentialResult = await runTest("sequential");

        setComparison({
          parallel: parallelResult,
          sequential: sequentialResult,
        });
        setLatestSingleResult(null);

        setResults((prev) => [
          {
            id: `parallel-${Date.now()}`,
            response: parallelResult,
            timestamp: new Date(),
            httpClient,
          },
          {
            id: `sequential-${Date.now()}`,
            response: sequentialResult,
            timestamp: new Date(),
            httpClient,
          },
          ...prev,
        ]);
      } else {
        const result = await runTest(mode);
        setLatestSingleResult(result);
        setComparison(null);
        setResults((prev) => [
          {
            id: `${mode}-${Date.now()}`,
            response: result,
            timestamp: new Date(),
            httpClient,
          },
          ...prev,
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setIsLoading(false);
    }
  }, [mode, runTest, httpClient]);

  const clearResults = () => {
    setResults([]);
    setComparison(null);
    setLatestSingleResult(null);
  };

  const getCacheStatusColor = (status: string) => {
    switch (status) {
      case "hot":
        return "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30";
      case "cold":
        return "text-orange-600 bg-orange-100 dark:text-orange-400 dark:bg-orange-900/30";
      default:
        return "text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-800";
    }
  };

  const getStrategyLabel = (client: HttpClient) => {
    switch (client) {
      case "got":
        return "Got (timings)";
      case "fetch-nocache":
        return "No Cache";
      default:
        return "Unstable Cache";
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            Network Fetch: Parallel vs Sequential
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Compare the latency of fetching data in parallel vs sequential mode
          </p>
        </div>

        {/* Configuration Panel */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            Configuration
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Fetch Count */}
            <div className="space-y-2">
              <label
                htmlFor="fetchCount"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Number of Fetches
              </label>
              <input
                type="number"
                id="fetchCount"
                min={1}
                max={100}
                value={fetchCount}
                onChange={(e) =>
                  setFetchCount(
                    Math.min(100, Math.max(1, parseInt(e.target.value) || 1))
                  )
                }
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-zinc-500">Between 1 and 100</p>
            </div>

            {/* Mode Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Mode
              </label>
              <div className="flex flex-wrap gap-2">
                {(["parallel", "sequential", "compare"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      mode === m
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Strategy Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Strategy
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setHttpClient("fetch")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    httpClient === "fetch"
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  Unstable Cache
                </button>
                <button
                  onClick={() => setHttpClient("fetch-nocache")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    httpClient === "fetch-nocache"
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  No Cache
                </button>
                <button
                  onClick={() => setHttpClient("got")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    httpClient === "got"
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  Got w/ DNS-TCP
                </button>
              </div>
              <p className="text-xs text-zinc-500">
                {httpClient === "fetch-nocache"
                  ? "Direct fetch without cache"
                  : httpClient === "got"
                    ? "Node got client with detailed timings"
                    : "Next.js unstable_cache"}
              </p>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Actions
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleRun}
                  disabled={isLoading}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Spinner /> Running...
                    </>
                  ) : (
                    "Run Test"
                  )}
                </button>
                <button
                  onClick={warmCache}
                  disabled={isWarmingCache}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {isWarmingCache ? (
                    <>
                      <Spinner /> Warming...
                    </>
                  ) : (
                    "Warm Cache"
                  )}
                </button>
                {results.length > 0 && (
                  <button
                    onClick={clearResults}
                    className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Single Mode Results */}
        {latestSingleResult && (
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {latestSingleResult.mode === "parallel"
                    ? "Parallel"
                    : "Sequential"}{" "}
                  Results
                </h2>
                <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                  {getStrategyLabel(currentHttpClient)}
                </span>
              </div>
              {"cacheStatus" in latestSingleResult && (
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${getCacheStatusColor(latestSingleResult.cacheStatus)}`}
                >
                  Cache: {latestSingleResult.cacheStatus}
                </span>
              )}
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
                <div className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
                  {latestSingleResult.totalLatency.toFixed(2)}ms
                </div>
                <div className="text-xs text-zinc-500">Total Time</div>
              </div>
              <div className="text-center p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
                <div className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
                  {latestSingleResult.averageLatency.toFixed(2)}ms
                </div>
                <div className="text-xs text-zinc-500">Avg per Fetch</div>
              </div>
              <div className="text-center p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
                <div className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
                  {latestSingleResult.fetchCount}
                </div>
                <div className="text-xs text-zinc-500">Fetches</div>
              </div>
            </div>

            {/* Network Timings (if using got) */}
            {hasNetworkTimings(latestSingleResult) && (
              <div className="mb-6">
                <NetworkTimingsDisplay
                  timings={latestSingleResult.aggregatedTimings}
                  title="Average Network Timing Breakdown"
                />
              </div>
            )}

            {/* Trace Timeline */}
            <div className="mb-6">
              <TraceTimeline
                traces={latestSingleResult.traces}
                totalDuration={latestSingleResult.totalLatency}
                mode={latestSingleResult.mode}
                showNetworkBreakdown={hasNetworkTimings(latestSingleResult)}
                results={
                  hasNetworkTimings(latestSingleResult)
                    ? latestSingleResult.results
                    : undefined
                }
              />
            </div>

            {/* Individual Fetch Latencies Graph */}
            <IndividualFetchGraph
              results={latestSingleResult.results}
              mode={latestSingleResult.mode}
              showNetworkBreakdown={hasNetworkTimings(latestSingleResult)}
            />
          </div>
        )}

        {/* Comparison View */}
        {comparison && (
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Comparison Results
              </h2>
              <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                {getStrategyLabel(currentHttpClient)}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* Parallel Results */}
              {comparison.parallel && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-blue-900 dark:text-blue-100">
                      Parallel
                    </h3>
                    {"cacheStatus" in comparison.parallel && (
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${getCacheStatusColor(comparison.parallel.cacheStatus)}`}
                      >
                        Cache: {comparison.parallel.cacheStatus}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-zinc-600 dark:text-zinc-400">
                        Total Time:
                      </span>
                      <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                        {comparison.parallel.totalLatency.toFixed(2)}ms
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-600 dark:text-zinc-400">
                        Avg per Fetch:
                      </span>
                      <span className="font-mono text-zinc-900 dark:text-zinc-100">
                        {comparison.parallel.averageLatency.toFixed(2)}ms
                      </span>
                    </div>
                  </div>
                  {hasNetworkTimings(comparison.parallel) && (
                    <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-700">
                      <NetworkTimingsCompact
                        timings={comparison.parallel.aggregatedTimings}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Sequential Results */}
              {comparison.sequential && (
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-purple-900 dark:text-purple-100">
                      Sequential
                    </h3>
                    {"cacheStatus" in comparison.sequential && (
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${getCacheStatusColor(comparison.sequential.cacheStatus)}`}
                      >
                        Cache: {comparison.sequential.cacheStatus}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-zinc-600 dark:text-zinc-400">
                        Total Time:
                      </span>
                      <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                        {comparison.sequential.totalLatency.toFixed(2)}ms
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-600 dark:text-zinc-400">
                        Avg per Fetch:
                      </span>
                      <span className="font-mono text-zinc-900 dark:text-zinc-100">
                        {comparison.sequential.averageLatency.toFixed(2)}ms
                      </span>
                    </div>
                  </div>
                  {hasNetworkTimings(comparison.sequential) && (
                    <div className="mt-3 pt-3 border-t border-purple-200 dark:border-purple-700">
                      <NetworkTimingsCompact
                        timings={comparison.sequential.aggregatedTimings}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Comparison Summary */}
            {comparison.parallel && comparison.sequential && (
              <div className="mb-6 p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                <div className="text-center">
                  {comparison.parallel.totalLatency <
                  comparison.sequential.totalLatency ? (
                    <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                      Parallel is{" "}
                      {(
                        (comparison.sequential.totalLatency /
                          comparison.parallel.totalLatency -
                          1) *
                        100
                      ).toFixed(1)}
                      % faster
                      <span className="block text-sm font-normal text-zinc-600 dark:text-zinc-400">
                        Saved{" "}
                        {(
                          comparison.sequential.totalLatency -
                          comparison.parallel.totalLatency
                        ).toFixed(2)}
                        ms
                      </span>
                    </p>
                  ) : comparison.sequential.totalLatency <
                    comparison.parallel.totalLatency ? (
                    <p className="text-lg font-semibold text-purple-600 dark:text-purple-400">
                      Sequential is{" "}
                      {(
                        (comparison.parallel.totalLatency /
                          comparison.sequential.totalLatency -
                          1) *
                        100
                      ).toFixed(1)}
                      % faster
                      <span className="block text-sm font-normal text-zinc-600 dark:text-zinc-400">
                        Saved{" "}
                        {(
                          comparison.parallel.totalLatency -
                          comparison.sequential.totalLatency
                        ).toFixed(2)}
                        ms
                      </span>
                    </p>
                  ) : (
                    <p className="text-lg font-semibold text-zinc-600 dark:text-zinc-400">
                      Both modes performed equally
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Side-by-side Trace Timelines */}
            {comparison.parallel && comparison.sequential && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-4">
                  Backend Trace Timeline Comparison
                </h3>
                <ComparisonTraceTimeline
                  parallelTraces={comparison.parallel.traces}
                  sequentialTraces={comparison.sequential.traces}
                  parallelTotal={comparison.parallel.totalLatency}
                  sequentialTotal={comparison.sequential.totalLatency}
                />
              </div>
            )}

            {/* Side-by-side Individual Fetch Latencies */}
            {comparison.parallel && comparison.sequential && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Individual Fetch Latencies Comparison
                </h3>
                <ComparisonFetchGraph
                  parallelResults={comparison.parallel.results}
                  sequentialResults={comparison.sequential.results}
                  showNetworkBreakdown={hasNetworkTimings(comparison.parallel) && hasNetworkTimings(comparison.sequential)}
                />
              </div>
            )}
          </div>
        )}

        {/* Results History Table */}
        {results.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
              Results History
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-700">
                    <th className="text-left py-3 px-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Time
                    </th>
                    <th className="text-left py-3 px-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Strategy
                    </th>
                    <th className="text-left py-3 px-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Mode
                    </th>
                    <th className="text-right py-3 px-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Fetches
                    </th>
                    <th className="text-right py-3 px-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Total (ms)
                    </th>
                    <th className="text-right py-3 px-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Avg (ms)
                    </th>
                    <th className="text-center py-3 px-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Cache
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => (
                    <tr
                      key={result.id}
                      className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <td className="py-3 px-2 text-zinc-600 dark:text-zinc-400">
                        {result.timestamp.toLocaleTimeString()}
                      </td>
                      <td className="py-3 px-2">
                        <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          {getStrategyLabel(result.httpClient)}
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            result.response.mode === "parallel"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                              : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                          }`}
                        >
                          {result.response.mode}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-zinc-900 dark:text-zinc-100">
                        {result.response.fetchCount}
                      </td>
                      <td className="py-3 px-2 text-right font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                        {result.response.totalLatency.toFixed(2)}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-zinc-900 dark:text-zinc-100">
                        {result.response.averageLatency.toFixed(2)}
                      </td>
                      <td className="py-3 px-2 text-center">
                        {"cacheStatus" in result.response ? (
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${getCacheStatusColor(result.response.cacheStatus)}`}
                          >
                            {result.response.cacheStatus}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function NetworkTimingsDisplay({
  timings,
  title,
}: {
  timings: {
    avgDns: number;
    avgTcp: number;
    avgTls: number;
    avgFirstByte: number;
    avgDownload: number;
    avgTotal: number;
  };
  title: string;
}) {
  const phases = [
    { name: "DNS", value: timings.avgDns, color: "bg-amber-500" },
    { name: "TCP", value: timings.avgTcp, color: "bg-orange-500" },
    { name: "TLS", value: timings.avgTls, color: "bg-red-500" },
    { name: "TTFB", value: timings.avgFirstByte, color: "bg-pink-500" },
    { name: "Download", value: timings.avgDownload, color: "bg-violet-500" },
  ];

  const total = phases.reduce((sum, p) => sum + p.value, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {title}
        </span>
        <span className="text-xs text-zinc-500">
          Total: {timings.avgTotal.toFixed(2)}ms
        </span>
      </div>

      {/* Stacked bar */}
      <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded-lg overflow-hidden flex">
        {phases.map((phase, i) => {
          const widthPercent = total > 0 ? (phase.value / total) * 100 : 0;
          if (widthPercent < 1) return null;
          return (
            <div
              key={i}
              className={`${phase.color} flex items-center justify-center transition-all`}
              style={{ width: `${widthPercent}%` }}
              title={`${phase.name}: ${phase.value.toFixed(2)}ms`}
            >
              {widthPercent > 10 && (
                <span className="text-[9px] font-mono text-white truncate px-1">
                  {phase.name}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {phases.map((phase, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-2.5 h-2.5 rounded ${phase.color}`} />
            <span className="text-zinc-600 dark:text-zinc-400">
              {phase.name}:
            </span>
            <span className="font-mono text-zinc-900 dark:text-zinc-100">
              {phase.value.toFixed(1)}ms
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NetworkTimingsCompact({
  timings,
}: {
  timings: {
    avgDns: number;
    avgTcp: number;
    avgTls: number;
    avgFirstByte: number;
    avgDownload: number;
    avgTotal: number;
  };
}) {
  const phases = [
    { name: "DNS", value: timings.avgDns, color: "bg-amber-500" },
    { name: "TCP", value: timings.avgTcp, color: "bg-orange-500" },
    { name: "TLS", value: timings.avgTls, color: "bg-red-500" },
    { name: "TTFB", value: timings.avgFirstByte, color: "bg-pink-500" },
    { name: "DL", value: timings.avgDownload, color: "bg-violet-500" },
  ];

  const total = phases.reduce((sum, p) => sum + p.value, 0);

  return (
    <div className="space-y-2">
      <div className="h-3 bg-zinc-200 dark:bg-zinc-600 rounded overflow-hidden flex">
        {phases.map((phase, i) => {
          const widthPercent = total > 0 ? (phase.value / total) * 100 : 0;
          if (widthPercent < 0.5) return null;
          return (
            <div
              key={i}
              className={`${phase.color} transition-all`}
              style={{ width: `${widthPercent}%` }}
              title={`${phase.name}: ${phase.value.toFixed(2)}ms`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 text-[10px]">
        {phases.map((phase, i) => (
          <div key={i} className="flex items-center gap-0.5">
            <div className={`w-1.5 h-1.5 rounded ${phase.color}`} />
            <span className="text-zinc-500 dark:text-zinc-400">
              {phase.name}:
            </span>
            <span className="font-mono">{phase.value.toFixed(0)}ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TraceTimeline({
  traces,
  totalDuration,
  mode,
  showNetworkBreakdown,
  results,
}: {
  traces: TraceSpan[];
  totalDuration: number;
  mode: "parallel" | "sequential";
  showNetworkBreakdown?: boolean;
  results?: FetchResult[];
}) {
  const [hoveredTrace, setHoveredTrace] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const color = mode === "parallel" ? "bg-blue-500" : "bg-purple-500";
  const maxEnd = Math.max(...traces.map((t) => t.endTime));

  const markerCount = 5;
  const markers = Array.from({ length: markerCount + 1 }, (_, i) =>
    ((maxEnd / markerCount) * i).toFixed(1)
  );

  const handleMouseEnter = (
    event: React.MouseEvent<HTMLDivElement>,
    traceIndex: number
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltipPosition({
      x: event.clientX,
      y: rect.top,
    });
    setHoveredTrace(traceIndex);
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    setTooltipPosition({
      x: event.clientX,
      y: tooltipPosition.y,
    });
  };

  const handleMouseLeave = () => {
    setHoveredTrace(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Backend Trace Timeline
        </span>
        <span className="text-xs text-zinc-500">
          Total: {totalDuration.toFixed(2)}ms
        </span>
      </div>

      {/* Time axis */}
      <div className="relative h-6 mb-1">
        <div className="absolute inset-x-0 top-3 h-px bg-zinc-300 dark:bg-zinc-600" />
        {markers.map((marker, i) => (
          <div
            key={i}
            className="absolute flex flex-col items-center"
            style={{ left: `${(i / markerCount) * 100}%` }}
          >
            <div className="w-px h-2 bg-zinc-400 dark:bg-zinc-500" />
            <span className="text-[9px] text-zinc-500 mt-0.5">{marker}ms</span>
          </div>
        ))}
      </div>

      {/* Trace spans */}
      <div className="space-y-1">
        {traces.map((trace) => {
          const leftPercent = (trace.startTime / maxEnd) * 100;
          const widthPercent = Math.max(
            1,
            ((trace.endTime - trace.startTime) / maxEnd) * 100
          );

          // Get network timings for this trace if available
          const fetchResult = results?.[trace.index];
          const networkTimings = fetchResult && resultHasTimings(fetchResult)
            ? fetchResult.networkTimings
            : null;

          return (
            <div key={trace.index} className="flex items-center gap-2">
              <span className="w-16 text-xs text-zinc-500 dark:text-zinc-400 text-right shrink-0">
                {trace.name}
              </span>
              <div className="flex-1 h-6 bg-zinc-100 dark:bg-zinc-800 rounded relative">
                {showNetworkBreakdown && networkTimings ? (
                  <div
                    onMouseEnter={(e) => handleMouseEnter(e, trace.index)}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    className="cursor-pointer"
                  >
                    <NetworkTimingBar
                      timings={networkTimings}
                      leftPercent={leftPercent}
                      widthPercent={widthPercent}
                    />
                  </div>
                ) : (
                  <div
                    className={`absolute top-0.5 bottom-0.5 ${color} rounded flex items-center justify-center transition-all duration-300`}
                    style={{
                      left: `${leftPercent}%`,
                      width: `${widthPercent}%`,
                    }}
                  >
                    {widthPercent > 8 && (
                      <span className="text-[9px] font-mono text-white px-1 truncate">
                        {trace.duration.toFixed(1)}ms
                      </span>
                    )}
                  </div>
                )}
              </div>
              <span className="w-16 text-[10px] font-mono text-zinc-600 dark:text-zinc-400 shrink-0">
                {trace.startTime.toFixed(1)}-{trace.endTime.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Tooltip */}
      {hoveredTrace !== null && (() => {
        const result = results?.[hoveredTrace];
        return result && resultHasTimings(result) && (
          <NetworkTimingsTooltip
            timings={result.networkTimings}
            position={tooltipPosition}
            traceName={traces[hoveredTrace].name}
          />
        );
      })()}
    </div>
  );
}

function NetworkTimingBar({
  timings,
  leftPercent,
  widthPercent,
}: {
  timings: NetworkTimings;
  leftPercent: number;
  widthPercent: number;
}) {
  const phases = [
    { value: timings.dns, color: "bg-amber-500" },
    { value: timings.tcp, color: "bg-orange-500" },
    { value: timings.tls, color: "bg-red-500" },
    { value: timings.firstByte, color: "bg-pink-500" },
    { value: timings.download, color: "bg-violet-500" },
  ];

  const total = phases.reduce((sum, p) => sum + p.value, 0);

  return (
    <div
      className="absolute top-0.5 bottom-0.5 flex rounded overflow-hidden transition-all duration-300"
      style={{
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
      }}
    >
      {phases.map((phase, i) => {
        const phaseWidth = total > 0 ? (phase.value / total) * 100 : 0;
        if (phaseWidth < 0.5) return null;
        return (
          <div
            key={i}
            className={`${phase.color} h-full`}
            style={{ width: `${phaseWidth}%` }}
          />
        );
      })}
    </div>
  );
}

function NetworkTimingsTooltip({
  timings,
  position,
  traceName,
}: {
  timings: NetworkTimings;
  position: { x: number; y: number };
  traceName: string;
}) {
  const phases = [
    { name: "DNS Lookup", value: timings.dns, color: "bg-amber-500" },
    { name: "TCP Connection", value: timings.tcp, color: "bg-orange-500" },
    { name: "TLS Handshake", value: timings.tls, color: "bg-red-500" },
    { name: "Time to First Byte", value: timings.firstByte, color: "bg-pink-500" },
    { name: "Download", value: timings.download, color: "bg-violet-500" },
  ];

  const total = timings.total;

  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        left: `${position.x + 15}px`,
        top: `${position.y}px`,
      }}
    >
      <div className="bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg shadow-lg p-3 min-w-[220px]">
        <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 mb-2 border-b border-zinc-200 dark:border-zinc-700 pb-2">
          {traceName}
        </div>
        <div className="space-y-1.5">
          {phases.map((phase, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-2.5 h-2.5 rounded-sm ${phase.color} shrink-0`} />
                <span className="text-xs text-zinc-600 dark:text-zinc-400 truncate">
                  {phase.name}
                </span>
              </div>
              <span className="text-xs font-mono font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                {phase.value.toFixed(2)}ms
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 pt-1.5 mt-1.5 border-t border-zinc-200 dark:border-zinc-700">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Total
            </span>
            <span className="text-xs font-mono font-bold text-zinc-900 dark:text-zinc-100">
              {total.toFixed(2)}ms
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComparisonTraceTimeline({
  parallelTraces,
  sequentialTraces,
  parallelTotal,
  sequentialTotal,
}: {
  parallelTraces: TraceSpan[];
  sequentialTraces: TraceSpan[];
  parallelTotal: number;
  sequentialTotal: number;
}) {
  const maxEnd = Math.max(
    ...parallelTraces.map((t) => t.endTime),
    ...sequentialTraces.map((t) => t.endTime)
  );

  const markerCount = 5;
  const markers = Array.from({ length: markerCount + 1 }, (_, i) =>
    ((maxEnd / markerCount) * i).toFixed(1)
  );

  return (
    <div className="space-y-6">
      {/* Time axis (shared) */}
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-3 h-px bg-zinc-300 dark:bg-zinc-600" />
        {markers.map((marker, i) => (
          <div
            key={i}
            className="absolute flex flex-col items-center"
            style={{ left: `${(i / markerCount) * 100}%` }}
          >
            <div className="w-px h-2 bg-zinc-400 dark:bg-zinc-500" />
            <span className="text-[9px] text-zinc-500 mt-0.5">{marker}ms</span>
          </div>
        ))}
      </div>

      {/* Parallel Timeline */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3 h-3 bg-blue-500 rounded" />
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Parallel
          </span>
          <span className="text-xs text-zinc-500">
            ({parallelTotal.toFixed(2)}ms)
          </span>
        </div>
        {parallelTraces.map((trace) => {
          const leftPercent = (trace.startTime / maxEnd) * 100;
          const widthPercent = Math.max(
            0.5,
            ((trace.endTime - trace.startTime) / maxEnd) * 100
          );

          return (
            <div key={trace.index} className="flex items-center gap-2">
              <span className="w-12 text-[10px] text-zinc-500 dark:text-zinc-400 text-right shrink-0">
                #{trace.index + 1}
              </span>
              <div className="flex-1 h-4 bg-zinc-100 dark:bg-zinc-800 rounded relative">
                <div
                  className="absolute top-0.5 bottom-0.5 bg-blue-500 rounded transition-all duration-300"
                  style={{
                    left: `${leftPercent}%`,
                    width: `${widthPercent}%`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Sequential Timeline */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-3 h-3 bg-purple-500 rounded" />
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Sequential
          </span>
          <span className="text-xs text-zinc-500">
            ({sequentialTotal.toFixed(2)}ms)
          </span>
        </div>
        {sequentialTraces.map((trace) => {
          const leftPercent = (trace.startTime / maxEnd) * 100;
          const widthPercent = Math.max(
            0.5,
            ((trace.endTime - trace.startTime) / maxEnd) * 100
          );

          return (
            <div key={trace.index} className="flex items-center gap-2">
              <span className="w-12 text-[10px] text-zinc-500 dark:text-zinc-400 text-right shrink-0">
                #{trace.index + 1}
              </span>
              <div className="flex-1 h-4 bg-zinc-100 dark:bg-zinc-800 rounded relative">
                <div
                  className="absolute top-0.5 bottom-0.5 bg-purple-500 rounded transition-all duration-300"
                  style={{
                    left: `${leftPercent}%`,
                    width: `${widthPercent}%`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IndividualFetchGraph({
  results,
  mode,
  showNetworkBreakdown,
}: {
  results: FetchResult[];
  mode: "parallel" | "sequential";
  showNetworkBreakdown?: boolean;
}) {
  const [hoveredFetch, setHoveredFetch] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const maxLatency = Math.max(...results.map((r) => r.latency));
  const color = mode === "parallel" ? "bg-blue-500" : "bg-purple-500";

  const handleMouseEnter = (
    event: React.MouseEvent<HTMLDivElement>,
    index: number
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltipPosition({
      x: event.clientX,
      y: rect.top + rect.height / 2,
    });
    setHoveredFetch(index);
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    setTooltipPosition((prev) => ({
      x: event.clientX,
      y: prev.y,
    }));
  };

  const handleMouseLeave = () => {
    setHoveredFetch(null);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Individual Fetch Latencies
        </span>
        <span className="text-xs text-zinc-500">
          Max: {maxLatency.toFixed(2)}ms
        </span>
      </div>
      {results.map((fetchResult, index) => {
        const networkTimings = resultHasTimings(fetchResult) ? fetchResult.networkTimings : null;
        const showBreakdown = showNetworkBreakdown && networkTimings;

        return (
          <div key={index} className="flex items-center gap-2">
            <span className="w-8 text-xs text-zinc-500 dark:text-zinc-400 text-right">
              #{index + 1}
            </span>
            <div className="flex-1 h-5 bg-zinc-200 dark:bg-zinc-700 rounded overflow-hidden relative">
              {showBreakdown ? (
                <div
                  className="absolute inset-0 cursor-pointer hover:opacity-80"
                  onMouseEnter={(e) => handleMouseEnter(e, index)}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                  style={{
                    width: `${Math.max(5, (fetchResult.latency / maxLatency) * 100)}%`,
                  }}
                >
                  <IndividualNetworkTimingBar timings={networkTimings!} />
                </div>
              ) : (
                <div
                  className={`h-full ${color} transition-all duration-300 flex items-center justify-end pr-1`}
                  style={{
                    width: `${Math.max(5, (fetchResult.latency / maxLatency) * 100)}%`,
                  }}
                >
                  {fetchResult.latency / maxLatency > 0.25 && (
                    <span className="text-[10px] font-mono text-white">
                      {fetchResult.latency.toFixed(1)}ms
                    </span>
                  )}
                </div>
              )}
            </div>
            {fetchResult.latency / maxLatency <= 0.25 && (
              <span className="w-16 text-xs font-mono text-zinc-600 dark:text-zinc-400">
                {fetchResult.latency.toFixed(2)}ms
              </span>
            )}
            {!fetchResult.success && (
              <span className="text-xs text-red-500">Failed</span>
            )}
          </div>
        );
      })}

      {/* Tooltip */}
      {hoveredFetch !== null && showNetworkBreakdown && (() => {
        const result = results[hoveredFetch];
        return result && resultHasTimings(result) && (
          <NetworkTimingsTooltip
            timings={result.networkTimings}
            position={tooltipPosition}
            traceName={`Fetch #${hoveredFetch + 1}`}
          />
        );
      })()}
    </div>
  );
}

function IndividualNetworkTimingBar({ timings }: { timings: NetworkTimings }) {
  const phases = [
    { value: timings.dns, color: "bg-amber-500" },
    { value: timings.tcp, color: "bg-orange-500" },
    { value: timings.tls, color: "bg-red-500" },
    { value: timings.firstByte, color: "bg-pink-500" },
    { value: timings.download, color: "bg-violet-500" },
  ];

  const total = phases.reduce((sum, p) => sum + p.value, 0);

  return (
    <div className="h-full flex">
      {phases.map((phase, i) => {
        const phaseWidth = total > 0 ? (phase.value / total) * 100 : 0;
        if (phaseWidth < 0.5) return null;
        return (
          <div
            key={i}
            className={`${phase.color} h-full`}
            style={{ width: `${phaseWidth}%` }}
          />
        );
      })}
    </div>
  );
}

function ComparisonFetchGraph({
  parallelResults,
  sequentialResults,
  showNetworkBreakdown,
}: {
  parallelResults: FetchResult[];
  sequentialResults: FetchResult[];
  showNetworkBreakdown?: boolean;
}) {
  const [hoveredFetch, setHoveredFetch] = useState<{ index: number; mode: "parallel" | "sequential" } | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const maxLatency = Math.max(
    ...parallelResults.map((r) => r.latency),
    ...sequentialResults.map((r) => r.latency)
  );

  const fetchCount = Math.max(parallelResults.length, sequentialResults.length);

  const handleMouseEnter = (
    event: React.MouseEvent<HTMLDivElement>,
    index: number,
    mode: "parallel" | "sequential"
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltipPosition({
      x: event.clientX,
      y: rect.top + rect.height / 2,
    });
    setHoveredFetch({ index, mode });
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    setTooltipPosition((prev) => ({
      x: event.clientX,
      y: prev.y,
    }));
  };

  const handleMouseLeave = () => {
    setHoveredFetch(null);
  };

  const hoveredParallelResult =
    hoveredFetch?.mode === "parallel"
      ? parallelResults[hoveredFetch.index]
      : null;

  const hoveredSequentialResult =
    hoveredFetch?.mode === "sequential"
      ? sequentialResults[hoveredFetch.index]
      : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-blue-500 rounded" />
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              Parallel
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-purple-500 rounded" />
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              Sequential
            </span>
          </div>
        </div>
        <span className="text-xs text-zinc-500">
          Max: {maxLatency.toFixed(2)}ms
        </span>
      </div>

      {Array.from({ length: fetchCount }).map((_, index) => {
        const parallelFetch = parallelResults[index];
        const sequentialFetch = sequentialResults[index];
        const parallelTimings = parallelFetch && resultHasTimings(parallelFetch) ? parallelFetch.networkTimings : null;
        const sequentialTimings = sequentialFetch && resultHasTimings(sequentialFetch) ? sequentialFetch.networkTimings : null;

        return (
          <div key={index} className="flex items-center gap-2">
            <span className="w-8 text-xs text-zinc-500 dark:text-zinc-400 text-right">
              #{index + 1}
            </span>
            <div className="flex-1 space-y-0.5">
              {/* Parallel bar */}
              <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded overflow-hidden relative">
                {parallelFetch && (
                  <div
                    className="absolute inset-0 cursor-pointer hover:opacity-80"
                    style={{
                      width: `${Math.max(2, (parallelFetch.latency / maxLatency) * 100)}%`,
                    }}
                    onMouseEnter={(e) => handleMouseEnter(e, index, "parallel")}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                  >
                    {showNetworkBreakdown && parallelTimings ? (
                      <ComparisonNetworkTimingBar timings={parallelTimings} />
                    ) : (
                      <div className="h-full bg-blue-500" />
                    )}
                  </div>
                )}
              </div>
              {/* Sequential bar */}
              <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded overflow-hidden relative">
                {sequentialFetch && (
                  <div
                    className="absolute inset-0 cursor-pointer hover:opacity-80"
                    style={{
                      width: `${Math.max(2, (sequentialFetch.latency / maxLatency) * 100)}%`,
                    }}
                    onMouseEnter={(e) => handleMouseEnter(e, index, "sequential")}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                  >
                    {showNetworkBreakdown && sequentialTimings ? (
                      <ComparisonNetworkTimingBar timings={sequentialTimings} />
                    ) : (
                      <div className="h-full bg-purple-500" />
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="w-24 text-right">
              <div className="text-[10px] font-mono text-blue-600 dark:text-blue-400">
                {parallelFetch ? `${parallelFetch.latency.toFixed(1)}ms` : "-"}
              </div>
              <div className="text-[10px] font-mono text-purple-600 dark:text-purple-400">
                {sequentialFetch
                  ? `${sequentialFetch.latency.toFixed(1)}ms`
                  : "-"}
              </div>
            </div>
          </div>
        );
      })}

      {/* Tooltip */}
      {hoveredFetch !== null && showNetworkBreakdown && (
        <>
          {hoveredParallelResult &&
            resultHasTimings(hoveredParallelResult) && (
            <NetworkTimingsTooltip
              timings={hoveredParallelResult.networkTimings}
              position={tooltipPosition}
              traceName={`Parallel Fetch #${hoveredFetch.index + 1}`}
            />
          )}
          {hoveredSequentialResult &&
            resultHasTimings(hoveredSequentialResult) && (
            <NetworkTimingsTooltip
              timings={hoveredSequentialResult.networkTimings}
              position={tooltipPosition}
              traceName={`Sequential Fetch #${hoveredFetch.index + 1}`}
            />
          )}
        </>
      )}
    </div>
  );
}

function ComparisonNetworkTimingBar({ timings }: { timings: NetworkTimings }) {
  const phases = [
    { value: timings.dns, color: "bg-amber-500" },
    { value: timings.tcp, color: "bg-orange-500" },
    { value: timings.tls, color: "bg-red-500" },
    { value: timings.firstByte, color: "bg-pink-500" },
    { value: timings.download, color: "bg-violet-500" },
  ];

  const total = phases.reduce((sum, p) => sum + p.value, 0);

  return (
    <div className="h-full flex">
      {phases.map((phase, i) => {
        const phaseWidth = total > 0 ? (phase.value / total) * 100 : 0;
        if (phaseWidth < 0.5) return null;
        return (
          <div
            key={i}
            className={`${phase.color} h-full`}
            style={{ width: `${phaseWidth}%` }}
          />
        );
      })}
    </div>
  );
}
