const startTime = Date.now();

export async function GET() {
  return Response.json({
    status: 'ok',
    version: process.env.npm_package_version ?? 'unknown',
    uptimeMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  });
}
