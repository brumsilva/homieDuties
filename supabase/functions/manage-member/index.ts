import '@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders, createAdminClient, createPublicClient, deriveAuthPassword, json, syntheticEmail, validUsername } from '../_shared/security.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Authentication required.' }, 401);
  const auth = createPublicClient();
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return json({ error: 'Authentication required.' }, 401);

  const admin = createAdminClient();
  try {
    const { data: actor, error: actorError } = await admin.from('profiles').select('household_id, role').eq('id', authData.user.id).single();
    if (actorError || actor?.role !== 'admin') return json({ error: 'Only the home captain can manage profiles.' }, 403);
    const body = await req.json();
    const action = body.action;
    if (action === 'create') {
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      const pin = typeof body.pin === 'string' ? body.pin : '';
      const role = body.role === 'admin' ? 'admin' : 'member';
      if (!validUsername(username) || !displayName || displayName.length > 60 || !/^\d{4}$/.test(pin)) return json({ error: 'Provide a valid username, display name, and four-digit PIN.' }, 400);
      const { count, error: countError } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('household_id', actor.household_id);
      if (countError) throw countError;
      if ((count ?? 0) >= 5) return json({ error: 'This household already has five member profiles.' }, 409);
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email: syntheticEmail(username), password: await deriveAuthPassword(username, pin), email_confirm: true });
      if (createError || !created.user) throw createError ?? new Error('Could not create auth user');
      const { error: profileError } = await admin.from('profiles').insert({ id: created.user.id, household_id: actor.household_id, username, display_name: displayName, role });
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw profileError;
      }
      return json({ success: true, member_id: created.user.id });
    }

    if (action === 'reset-pin') {
      const memberId = typeof body.memberId === 'string' ? body.memberId : '';
      const pin = typeof body.pin === 'string' ? body.pin : '';
      if (!memberId || !/^\d{4}$/.test(pin)) return json({ error: 'Choose a profile and enter a four-digit PIN.' }, 400);
      const { data: target, error: targetError } = await admin.from('profiles').select('id, username').eq('id', memberId).eq('household_id', actor.household_id).single();
      if (targetError || !target) return json({ error: 'Profile not found in this household.' }, 404);
      const { error } = await admin.auth.admin.updateUserById(memberId, { password: await deriveAuthPassword(target.username, pin) });
      if (error) throw error;
      return json({ success: true });
    }
    return json({ error: 'Unsupported profile action.' }, 400);
  } catch (error) {
    console.error('Profile management failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Could not manage this profile. Check that the username is unique and try again.' }, 500);
  }
});
