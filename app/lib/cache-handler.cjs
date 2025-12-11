// @ts-check
const Redis = require("ioredis").default;
const { SpanStatusCode, trace } = require("@opentelemetry/api");

// @see https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers#external-storage-pattern

const CACHE_PREFIX = "nextjs:cache:";
const TAGS_PREFIX = "nextjs:tags:";

const tracer = trace.getTracer("cache-handler");

/**
 * Helper to run an async function within an active span.
 * Ensures the span closes and records any thrown error.
 * @template T
 * @param {string} name
 * @param {import("@opentelemetry/api").SpanAttributes} attributes
 * @param {(span: import("@opentelemetry/api").Span) => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withSpan(name, attributes, fn) {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}


/**
 * Create Redis client from URL
 * @param {string} url
 * @returns {Redis}
 */
function createRedisClient(url) {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    lazyConnect: true,
    enableAutoPipelining: true,
    tls: {
      rejectUnauthorized: true,
    },
  });
}

const redisUrl = "rediss://default:ARjTAAImcDFhNTZjZjI4MDI5NGI0ZmQ3OTMwZWRlY2QwOTVlYzBkZXAxNjM1NQ@saving-oriole-6355.upstash.io:6379";

const writeClient = createRedisClient(redisUrl);
const readClient = createRedisClient(redisUrl);

writeClient.on("error", (err) => {
  console.error("[CacheHandler] Redis write client error:", err.message);
});

readClient.on("error", (err) => {
  console.error("[CacheHandler] Redis read client error:", err.message);
});

let connected = false;
/** @type {Map<string, number>} */
const tagTimestamps = new Map();
/** @type {Map<string, Promise<void>>} */
const pendingSets = new Map();

async function ensureConnected() {
  if (connected) return;

  try {
    await Promise.all([writeClient.connect(), readClient.connect()]);
    connected = true;
  } catch {
    connected = true;
  }
}

/**
 * Retrieve a cache entry for the given cache key.
 * @param {string} cacheKey
 * @param {string[]} softTags
 * @returns {Promise<object | undefined>}
 */
async function get(cacheKey, softTags) {
  try {
    return await withSpan(
      "cache.get",
      { "cache.key": cacheKey, "cache.tags": softTags },
      async (span) => {
        await ensureConnected();
        console.log("get", cacheKey, softTags);

        // Wait for any pending set operation to complete
        const pendingPromise = pendingSets.get(cacheKey);
        if (pendingPromise) {
          await pendingPromise;
        }

        const key = `${CACHE_PREFIX}${cacheKey}`;
        const stored = await readClient.get(key);

        if (!stored) {
          return undefined;
        }

        const data = JSON.parse(stored);
        span.setAttributes({
          "cache.expire": data.expire,
          "cache.revalidate": data.revalidate,
          "cache.stale": Boolean(data.stale),
        });

        // Check if entry has expired
        const now = Date.now();
        if (now > data.timestamp + data.revalidate * 1000) {
          return undefined;
        }

        // Reconstruct the ReadableStream from stored data
        return {
          value: new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.from(data.value, "base64"));
              controller.close();
            },
          }),
          tags: data.tags,
          stale: data.stale,
          timestamp: data.timestamp,
          expire: data.expire,
          revalidate: data.revalidate,
        };
      },
    );
  } catch (error) {
    console.error("[CacheHandler] Error getting cache key:", cacheKey, error);
    return undefined;
  }
}

/**
 * Store a cache entry for the given cache key.
 * @param {string} cacheKey
 * @param {Promise<object>} pendingEntry
 * @returns {Promise<void>}
 */
async function set(cacheKey, pendingEntry) {
  // Create a promise to track this set operation
  let resolvePending;
  const pendingPromise = new Promise((resolve) => {
    resolvePending = resolve;
  });
  pendingSets.set(cacheKey, pendingPromise);

  try {
    await withSpan(
      "cache.set",
      { "cache.key": cacheKey },
      async (span) => {
        await ensureConnected();
        console.log("set", cacheKey);

        // Wait for the entry to be ready
        const entry = await pendingEntry;
        span.setAttributes({
          "cache.tags": entry.tags,
          "cache.expire": entry.expire,
          "cache.revalidate": entry.revalidate,
          "cache.stale": Boolean(entry.stale),
        });

        // Read the stream to get the data
        const reader = entry.value.getReader();
        /** @type {Uint8Array[]} */
        const chunks = [];

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }

        // Combine chunks and serialize for Redis storage
        const data = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));

        const key = `${CACHE_PREFIX}${cacheKey}`;
        const serialized = JSON.stringify({
          value: data.toString("base64"),
          tags: entry.tags,
          stale: entry.stale,
          timestamp: entry.timestamp,
          expire: entry.expire,
          revalidate: entry.revalidate,
        });

        const pipeline = writeClient.pipeline();
        pipeline.setex(key, entry.expire, serialized);

        // Store tag associations
        for (const tag of entry.tags) {
          const tagKey = `${TAGS_PREFIX}${tag}`;
          pipeline.sadd(tagKey, key);
          pipeline.expire(tagKey, entry.expire + 60);
        }

        await pipeline.exec();
      },
    );
  } catch (error) {
    console.error("[CacheHandler] Error setting cache key:", cacheKey, error);
  } finally {
    resolvePending();
    pendingSets.delete(cacheKey);
  }
}

/**
 * Called periodically before starting a new request to sync with external tag services.
 * @returns {Promise<void>}
 */
async function refreshTags() {
  try {
    await withSpan("cache.refreshTags", {}, async () => {
      await ensureConnected();

      const tagKeys = await readClient.keys(`${TAGS_PREFIX}*:timestamp`);

      for (const tagKey of tagKeys) {
        const tag = tagKey.replace(TAGS_PREFIX, "").replace(":timestamp", "");
        const timestamp = await readClient.get(tagKey);
        if (timestamp) {
          tagTimestamps.set(tag, Number.parseInt(timestamp, 10));
        }
      }
    });
  } catch (error) {
    console.error("[CacheHandler] Error refreshing tags:", error);
  }
}

/**
 * Get the maximum revalidation timestamp for a set of tags.
 * @param {string[]} tags
 * @returns {Promise<number>}
 */
async function getExpiration(tags) {
  if (tags.length === 0) return 0;

  return withSpan(
    "cache.getExpiration",
    { "cache.tags": tags },
    async (span) => {
      let maxTimestamp = 0;
      for (const tag of tags) {
        const timestamp = tagTimestamps.get(tag) ?? 0;
        if (timestamp > maxTimestamp) {
          maxTimestamp = timestamp;
        }
      }

      span.setAttribute("cache.tag.maxTimestamp", maxTimestamp);
      return maxTimestamp;
    },
  );
}

/**
 * Called when tags are revalidated or expired.
 * @param {string[]} tags
 * @param {{ expire?: number }} [durations]
 * @returns {Promise<void>}
 */
async function updateTags(tags, durations) {
  try {
    const spanAttributes = { "cache.tags": tags };
    if (durations?.expire !== undefined) {
      spanAttributes["cache.tag.expireOverride"] = durations.expire;
    }

    await withSpan(
      "cache.updateTags",
      spanAttributes,
      async (span) => {
        await ensureConnected();

        const now = Date.now();
        const pipeline = writeClient.pipeline();

        for (const tag of tags) {
          const tagKey = `${TAGS_PREFIX}${tag}`;

          // Get all cache keys associated with this tag
          const cacheKeys = await readClient.smembers(tagKey);

          // Delete all cache entries with this tag
          for (const cacheKey of cacheKeys) {
            pipeline.del(cacheKey);
          }

          // Delete the tag set and store the revalidation timestamp
          pipeline.del(tagKey);
          pipeline.set(`${tagKey}:timestamp`, now.toString());

          tagTimestamps.set(tag, now);
        }

        await pipeline.exec();

        span.setAttribute("cache.tag.count", tags.length);
      },
    );
  } catch (error) {
    console.error("[CacheHandler] Error updating tags:", tags, error);
  }
}

module.exports = {
  get,
  set,
  refreshTags,
  getExpiration,
  updateTags,
};