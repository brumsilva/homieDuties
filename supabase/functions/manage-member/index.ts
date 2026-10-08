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
    const { data: actor, error: actorError } = await admin.from('profiles').select('household_id, role, is_active').eq('id', authData.user.id).single();
    if (actorError || actor?.role !== 'admin' || !actor.is_active) return json({ error: 'Only an active home captain can manage profiles.' }, 403);
    const body = await req.json();
    const action = body.action;
    if (action === 'create') {
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      const pin = typeof body.pin === 'string' ? body.pin : '';
      const role = body.role === 'admin' ? 'admin' : 'member';
      if (!validUsername(username) || !displayName || displayName.length > 60 || !/^\d{4}$/.test(pin)) return json({ error: 'Provide a valid username, display name, and four-digit PIN.' }, 400);
      const { count, error: countError } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('household_id', actor.household_id).eq('is_active', true);
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

    if (action === 'update') {
      const memberId = typeof body.memberId === 'string' ? body.memberId : '';
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      const role = body.role === 'admin' ? 'admin' : 'member';
      const pin = typeof body.pin === 'string' ? body.pin : '';
      if (!memberId || !validUsername(username) || !displayName || displayName.length > 60 || (pin && !/^\d{4}$/.test(pin))) {
        return json({ error: 'Provide a valid username, display name, role, and optional four-digit PIN.' }, 400);
      }
      const { data: target, error: targetError } = await admin.from('profiles').select('id, username, display_name, role, is_active').eq('id', memberId).eq('household_id', actor.household_id).single();
      if (targetError || !target || !target.is_active) return json({ error: 'Active profile not found in this household.' }, 404);
      const usernameChanged = username !== target.username;
      if (usernameChanged && !/^\d{4}$/.test(pin)) return json({ error: 'A new four-digit PIN is required when changing a username.' }, 400);
      const { count: adminCount, error: adminCountError } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('household_id', actor.household_id).eq('role', 'admin').eq('is_active', true);
      if (adminCountError) throw adminCountError;
      if (target.role === 'admin' && role !== 'admin' && (adminCount ?? 0) <= 1) return json({ error: 'The household must keep at least one active administrator.' }, 409);

      const { error: profileError } = await admin.from('profiles').update({ username, display_name: displayName, role }).eq('id', memberId).eq('household_id', actor.household_id);
      if (profileError) throw profileError;
      if (usernameChanged || pin) {
        const authUpdate = await admin.auth.admin.updateUserById(memberId, {
          ...(usernameChanged ? { email: syntheticEmail(username), email_confirm: true } : {}),
          password: await deriveAuthPassword(username, pin || '0000'),
        });
        if (authUpdate.error) {
          await admin.from('profiles').update({ username: target.username, display_name: target.display_name, role: target.role }).eq('id', memberId);
          throw authUpdate.error;
        }
      }
      return json({ success: true });
    }

    if (action === 'delete') {
      const memberId = typeof body.memberId === 'string' ? body.memberId : '';
      if (!memberId || memberId === authData.user.id) return json({ error: 'You cannot delete your own administrator profile.' }, 400);
      const { data: target, error: targetError } = await admin.from('profiles').select('id, role, is_active').eq('id', memberId).eq('household_id', actor.household_id).single();
      if (targetError || !target || !target.is_active) return json({ error: 'Active profile not found in this household.' }, 404);
      if (target.role === 'admin') {
        const { count, error } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('household_id', actor.household_id).eq('role', 'admin').eq('is_active', true);
        if (error) throw error;
        if ((count ?? 0) <= 1) return json({ error: 'The household must keep at least one active administrator.' }, 409);
      }
      const { error: profileError } = await admin.from('profiles').update({ is_active: false }).eq('id', memberId).eq('household_id', actor.household_id);
      if (profileError) throw profileError;
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(memberId, { ban_duration: '876000h' });
      if (authUpdateError) {
        await admin.from('profiles').update({ is_active: true }).eq('id', memberId);
        throw authUpdateError;
      }
      return json({ success: true });
    }
    return json({ error: 'Unsupported profile action.' }, 400);
  } catch (error) {
    console.error('Profile management failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Could not manage this profile. Check that the username is unique and try again.' }, 500);
  }
});
