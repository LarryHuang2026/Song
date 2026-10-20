import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { redact } from "./domain";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function guard(request: NextRequest) {
  const host = request.headers.get("host") || "";
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
    throw new HttpError(403, "仅允许本机访问");
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== `http://${host}` && origin !== `https://${host}`) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new HttpError(403, "不允许跨站访问");
}
export async function jsonBody(request: NextRequest) {
  const body = await request.text();
  if (body.length > 30000) throw new HttpError(413, "请求内容过长");
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "请求必须为有效 JSON");
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof HttpError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof z.ZodError)
    return NextResponse.json(
      { error: error.issues.map((i) => i.message).join("；") },
      { status: 400 },
    );
  if (error instanceof Error && "code" in error && error.code === "P2025")
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  console.error(
    "本地请求失败：",
    redact(error instanceof Error ? error.message : error),
  );
  return NextResponse.json(
    { error: "操作未完成，请检查本地服务与磁盘空间" },
    { status: 500 },
  );
}
