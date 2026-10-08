import { corsHeaders, createAdminClient, deriveAuthPassword, json, syntheticEmail, validUsername } from '../_shared/security.ts';

type InitialMember = { username: string; displayName: string; pin: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const configuredSecret = Deno.env.get('HOMIE_BOOTSTRAP_SECRET');
  const providedSecret = req.headers.get('x-bootstrap-secret') || '';
  if (!configuredSecret || configuredSecret.length < 32 || providedSecret !== configuredSecret) return json({ error: 'Invalid setup credentials.' }, 401);

  const admin = createAdminClient();
  let householdId: string | undefined;
  const createdUsers: string[] = [];
  try {
    const { data: existing, error: existingError } = await admin.from('households').select('id').limit(1);
    if (existingError) throw existingError;
    if (existing?.length) return json({ error: 'This project is already initialized.' }, 409);

    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const members = body.members as InitialMember[];
    if (!name || name.length > 80 || !Array.isArray(members) || members.length !== 5) {
      return json({ error: 'Provide a household name and exactly five initial members.' }, 400);
    }
    const normalized = members.map((member) => ({
      username: typeof member.username === 'string' ? member.username.trim().toLowerCase() : '',
      displayName: typeof member.displayName === 'string' ? member.displayName.trim() : '',
      pin: typeof member.pin === 'string' ? member.pin : '',
    }));
    if (normalized.some((member) => !validUsername(member.username) || !member.displayName || member.displayName.length > 60 || !/^\d{4}$/.test(member.pin))) {
      return json({ error: 'Every member needs a valid username, display name, and four-digit PIN.' }, 400);
    }
    if (new Set(normalized.map((member) => member.username)).size !== 5) return json({ error: 'Usernames must be unique.' }, 400);

    const { data: household, error: householdError } = await admin.from('households').insert({ name }).select('id').single();
    if (householdError) throw householdError;
    householdId = household.id;

    for (const [index, member] of normalized.entries()) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: syntheticEmail(member.username), password: await deriveAuthPassword(member.username, member.pin), email_confirm: true,
      });
      if (createError || !created.user) throw createError ?? new Error('Could not create initial profile');
      createdUsers.push(created.user.id);
      const { error: profileError } = await admin.from('profiles').insert({
        id: created.user.id, household_id: householdId, username: member.username,
        display_name: member.displayName, role: index === 0 ? 'admin' : 'member',
      });
      if (profileError) throw profileError;
    }

    const firstProfile = (await admin.from('profiles').select('id').eq('household_id', householdId).order('created_at').limit(1).single()).data;
    const templates = [
      { title: 'Reset the kitchen', area: 'Kitchen', description: 'Wipe counters and table, clean the hob, and leave the sink empty.', frequency: 'Daily' },
      { title: 'Take out the bins', area: 'Kitchen', description: 'Separate recycling and general waste, then replace the liners.', frequency: 'As needed' },
      { title: 'Clean the bathroom', area: 'Bathroom', description: 'Clean the toilet, basin, mirror, and shower; replace the hand towel.', frequency: 'Weekly' },
      { title: 'Vacuum the hallway carpet', area: 'Hallway', description: 'Vacuum the hallway carpet from the front door to the landing, including the edges.', frequency: 'Weekly' },
      { title: 'Restock shared supplies', area: 'Bathroom', description: 'Check toilet paper, hand soap, and shared cleaning supplies.', frequency: 'Weekly' },
    ];
    const { error: tasksError } = await admin.from('tasks').insert(templates.map((task) => ({ ...task, household_id: householdId, created_by: firstProfile?.id })));
    if (tasksError) throw tasksError;
    return json({ success: true, household_id: householdId, profiles_created: createdUsers.length });
  } catch (error) {
    if (createdUsers.length) await Promise.all(createdUsers.map((id) => admin.auth.admin.deleteUser(id)));
    if (householdId) await admin.from('households').delete().eq('id', householdId);
    console.error('Household bootstrap failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Could not initialize the household. Check the supplied data and retry.' }, 500);
  }
});
