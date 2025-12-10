import got from 'got';

async function test() {
  const url = 'https://api.sampleapis.com/wines/reds';

  console.log('=== Test 1: got() with default HTTP/2 ===');
  const start1 = Date.now();
  const promises1 = Array.from({ length: 10 }, async (_, i) => {
    const startIndividual = Date.now();
    try {
      await got(url, {
        responseType: 'json',
        retry: { limit: 0 }
        // http2 is true by default in got v14
      });
      const duration = Date.now() - startIndividual;
      console.log(`  Request ${i + 1}: ${duration}ms`);
      return duration;
    } catch (err) {
      console.log(`  Request ${i + 1}: ERROR - ${err.message}`);
      return Date.now() - startIndividual;
    }
  });
  const results1 = await Promise.all(promises1);
  console.log(`Total time: ${Date.now() - start1}ms`);
  console.log(`Average: ${results1.reduce((a, b) => a + b, 0) / results1.length}ms\n`);

  console.log('=== Test 2: got() with HTTP/1.1 forced ===');
  const start2 = Date.now();
  const promises2 = Array.from({ length: 10 }, async (_, i) => {
    const startIndividual = Date.now();
    await got(url, {
      responseType: 'json',
      retry: { limit: 0 },
      http2: false
    });
    const duration = Date.now() - startIndividual;
    console.log(`  Request ${i + 1}: ${duration}ms`);
    return duration;
  });
  const results2 = await Promise.all(promises2);
  console.log(`Total time: ${Date.now() - start2}ms`);
  console.log(`Average: ${results2.reduce((a, b) => a + b, 0) / results2.length}ms`);
}

test().catch(console.error);
