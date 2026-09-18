// Utilitas bersama untuk semua Edge Function di fase ini.

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * Klien service role. Melewati RLS, jadi HANYA boleh dipakai di dalam
 * Edge Function — tidak pernah dikirim ke klien.
 */
export function klienAdmin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sinkron-rahasia",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jawab(isi: unknown, status = 200): Response {
  return new Response(JSON.stringify(isi), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/**
 * Gerbang untuk endpoint yang HANYA boleh dipanggil Apps Script
 * (sinkronisasi). Rahasianya dibandingkan dengan panjang tetap supaya
 * tidak bocor lewat selisih waktu.
 */
export function rahasiaSinkronSah(req: Request): boolean {
  const diharapkan = Deno.env.get("SINKRON_RAHASIA") || "";
  const diberikan = req.headers.get("x-sinkron-rahasia") || "";
  if (!diharapkan || diharapkan.length !== diberikan.length) return false;
  let beda = 0;
  for (let i = 0; i < diharapkan.length; i++) {
    beda |= diharapkan.charCodeAt(i) ^ diberikan.charCodeAt(i);
  }
  return beda === 0;
}
