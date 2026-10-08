import { corsHeaders, createAdminClient, createPublicClient, deriveAuthPassword, json, sha256, syntheticEmail } from '../_shared/security.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json();
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const pin = typeof body.pin === 'string' ? body.pin : '';
    if (!/^[a-z0-9._-]{2,32}$/.test(username) || !/^\d{4}$/.test(pin)) return json({ error: 'Username or PIN is incorrect.' }, 400);

    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const userKey = await sha256(`user:${username}`);
    const ipKey = await sha256(`ip:${ip}`);
    const admin = createAdminClient();
    const { data: allowed, error: limitError } = await admin.rpc('consume_pin_attempt', { p_username_key: userKey, p_ip_key: ipKey });
    if (limitError) throw limitError;
    if (!allowed) return json({ error: 'Too many attempts. Please wait 15 minutes and try again.' }, 429);

    const { data: profile, error: profileError } = await admin.from('profiles').select('id, username').eq('username', username).maybeSingle();
    if (profileError || !profile) return json({ error: 'Username or PIN is incorrect.' }, 401);

    const auth = createPublicClient();
    const { data, error } = await auth.auth.signInWithPassword({ email: syntheticEmail(username), password: await deriveAuthPassword(username, pin) });
    if (error || !data.session) return json({ error: 'Username or PIN is incorrect.' }, 401);
    return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, user_id: profile.id });
  } catch (error) {
    console.error('PIN sign-in failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Sign-in is temporarily unavailable. Please try again.' }, 500);
  }
});
