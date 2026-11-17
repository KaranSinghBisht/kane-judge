import { join } from "node:path";
import { readData } from "../lib/shop.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(await readData(join(process.cwd(), "data"), "products.json"));
}
