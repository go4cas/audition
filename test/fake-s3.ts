// A small in-memory S3-compatible server for tests (Cloudflare R2 stand-in):
// path-style PUT, GET, HEAD, DELETE and ListObjectsV2, which is what Bun's
// S3Client (used by Vaultbase's backup copy and scripts/offsite.ts) sends.
// Signatures aren't checked; a request whose access key isn't `accessKeyId`
// gets 403, so wrong credentials can be tested.

export interface FakeS3 {
  endpoint: string;
  objects: Map<string, Uint8Array>; // "<bucket>/<key>" -> bytes
  keys(bucket: string, prefix?: string): string[];
  stop(): void;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function startFakeS3(opts: { accessKeyId: string; buckets: string[] }): FakeS3 {
  const objects = new Map<string, Uint8Array>();
  const keys = (bucket: string, prefix = "") =>
    [...objects.keys()].filter((k) => k.startsWith(`${bucket}/${prefix}`)).map((k) => k.slice(bucket.length + 1)).sort();
  const err = (status: number, code: string) =>
    new Response(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`, {
      status, headers: { "content-type": "application/xml" },
    });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const auth = req.headers.get("authorization") ?? "";
      if (!auth.includes(`Credential=${opts.accessKeyId}/`)) return err(403, "InvalidAccessKeyId");
      const url = new URL(req.url);
      const parts = url.pathname.slice(1).split("/");
      const bucket = decodeURIComponent(parts.shift() ?? "");
      const key = parts.map(decodeURIComponent).join("/");
      if (!opts.buckets.includes(bucket)) return err(404, "NoSuchBucket");
      const id = `${bucket}/${key}`;

      if (req.method === "GET" && !key) {
        const prefix = url.searchParams.get("prefix") ?? "";
        const max = 1000;
        const all = keys(bucket, prefix);
        const after = url.searchParams.get("continuation-token");
        const startAt = after ? all.indexOf(after) + 1 : 0;
        const page = all.slice(startAt, startAt + max);
        const more = startAt + max < all.length;
        const body = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${esc(bucket)}</Name><Prefix>${esc(prefix)}</Prefix>` +
          `<KeyCount>${page.length}</KeyCount><MaxKeys>${max}</MaxKeys><IsTruncated>${more}</IsTruncated>` +
          (more ? `<NextContinuationToken>${esc(page[page.length - 1]!)}</NextContinuationToken>` : "") +
          page.map((k) => `<Contents><Key>${esc(k)}</Key><Size>${objects.get(`${bucket}/${k}`)!.length}</Size>` +
            `<LastModified>2026-11-18T00:00:00.000Z</LastModified><ETag>"x"</ETag><StorageClass>STANDARD</StorageClass></Contents>`).join("") +
          `</ListBucketResult>`;
        return new Response(body, { headers: { "content-type": "application/xml" } });
      }
      if (req.method === "PUT") {
        objects.set(id, new Uint8Array(await req.arrayBuffer()));
        return new Response(null, { status: 200, headers: { etag: '"x"' } });
      }
      if (req.method === "GET" || req.method === "HEAD") {
        const o = objects.get(id);
        if (!o) return err(404, "NoSuchKey");
        return new Response(req.method === "HEAD" ? null : o, { headers: { "content-length": String(o.length), etag: '"x"' } });
      }
      if (req.method === "DELETE") {
        objects.delete(id);
        return new Response(null, { status: 204 });
      }
      return err(405, "MethodNotAllowed");
    },
  });
  return { endpoint: `http://127.0.0.1:${server.port}`, objects, keys, stop: () => server.stop(true) };
}
