import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const OVERRIDES_PATH = path.join(process.cwd(), "src/data/visual-overrides.json");

export async function GET() {
  try {
    const content = await fs.readFile(OVERRIDES_PATH, "utf-8");
    return NextResponse.json(JSON.parse(content));
  } catch {
    return NextResponse.json({ elements: {} });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await fs.mkdir(path.dirname(OVERRIDES_PATH), { recursive: true });
    await fs.writeFile(OVERRIDES_PATH, JSON.stringify(body, null, 2), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}
