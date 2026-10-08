import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bootstrap-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function createAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  if (!key) throw new Error('Missing Supabase secret key');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function createPublicClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!key) throw new Error('Missing Supabase publishable key');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function deriveAuthPassword(username: string, pin: string) {
  const pepper = Deno.env.get('HOMIE_PIN_PEPPER');
  if (!pepper || pepper.length < 32) throw new Error('HOMIE_PIN_PEPPER must contain at least 32 characters');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${username}:${pin}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validUsername(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9._-]{2,32}$/.test(value);
}

export function syntheticEmail(username: string) {
  return `${username}@members.homie.invalid`;
}
