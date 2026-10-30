const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export async function fetchWeb(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 25000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: rest.signal ?? controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        ...rest.headers,
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBytes(
  url: string,
  timeoutMs = 25000,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const res = await fetchWeb(url, { timeoutMs });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, contentType };
  } catch {
    return null;
  }
}

export async function fetchText(url: string, timeoutMs = 25000): Promise<string | null> {
  const got = await fetchBytes(url, timeoutMs);
  if (!got) return null;
  return got.bytes.toString("utf8");
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}
