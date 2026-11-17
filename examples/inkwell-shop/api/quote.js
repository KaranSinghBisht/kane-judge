import { join } from "node:path";
import { quote } from "../lib/shop.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
  const { status, json } = await quote(join(process.cwd(), "data"), body);
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(json);
}
