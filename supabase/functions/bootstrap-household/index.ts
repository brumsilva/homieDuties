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
    if (!name || name.length > 80 || !Array.isArray(members) || members.length < 1 || members.length > 5) {
      return json({ error: 'Provide a household name and between one and five initial members.' }, 400);
    }
    const normalized = members.map((member) => ({
      username: typeof member.username === 'string' ? member.username.trim().toLowerCase() : '',
      displayName: typeof member.displayName === 'string' ? member.displayName.trim() : '',
      pin: typeof member.pin === 'string' ? member.pin : '',
    }));
    if (normalized.some((member) => !validUsername(member.username) || !member.displayName || member.displayName.length > 60 || !/^\d{4}$/.test(member.pin))) {
      return json({ error: 'Every member needs a valid username, display name, and four-digit PIN.' }, 400);
    }
    if (new Set(normalized.map((member) => member.username)).size !== normalized.length) return json({ error: 'Usernames must be unique.' }, 400);

    const { data: household, error: householdError } = await admin.from('households').insert({ name }).select('id').single();
    if (householdError) throw householdError;
    householdId = household.id;

    const roomTemplates = [
      { name: 'Kitchen', emoji: '🍳' },
      { name: 'Bathroom', emoji: '🛁' },
      { name: 'Hallway', emoji: '🧹' },
    ];
    const { data: rooms, error: roomsError } = await admin.from('rooms').insert(roomTemplates.map((room) => ({ ...room, household_id: householdId }))).select('id, name');
    if (roomsError) throw roomsError;

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
      { title: 'Organizar a cozinha', area: 'Kitchen', room: 'Kitchen', description: 'Limpar bancadas e mesa, limpar o fogão e deixar a pia vazia.', frequency: 'Daily', points: 10 },
      { title: 'Guardar os talheres', area: 'Kitchen', room: 'Kitchen', description: 'Guardar os talheres limpos na gaveta compartilhada.', frequency: 'Ongoing', points: 3 },
      { title: 'Levar o lixo para fora', area: 'Kitchen', room: 'Kitchen', description: 'Separar reciclagem e lixo comum, depois colocar sacos novos.', frequency: 'Ongoing', points: 5 },
      { title: 'Limpar o banheiro', area: 'Bathroom', room: 'Bathroom', description: 'Limpar vaso, pia, espelho e chuveiro; trocar a toalha de mãos.', frequency: 'Weekly', points: 15 },
      { title: 'Aspirar o corredor com carpete', area: 'Hallway', room: 'Hallway', description: 'Aspirar o carpete do corredor da entrada até o andar de cima, inclusive as bordas.', frequency: 'Weekly', points: 15 },
      { title: 'Repor itens compartilhados', area: 'Bathroom', room: 'Bathroom', description: 'Conferir papel higiênico, sabonete e produtos de limpeza compartilhados.', frequency: 'Weekly', points: 5 },
    ];
    const { error: tasksError } = await admin.from('tasks').insert(templates.map(({ room, ...task }) => ({ ...task, room_id: rooms?.find((item) => item.name === room)?.id, household_id: householdId, created_by: firstProfile?.id })));
    if (tasksError) throw tasksError;
    return json({ success: true, household_id: householdId, profiles_created: createdUsers.length });
  } catch (error) {
    if (createdUsers.length) await Promise.all(createdUsers.map((id) => admin.auth.admin.deleteUser(id)));
    if (householdId) await admin.from('households').delete().eq('id', householdId);
    console.error('Household bootstrap failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Could not initialize the household. Check the supplied data and retry.' }, 500);
  }
});
