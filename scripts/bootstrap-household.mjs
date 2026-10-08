import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const publicKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const bootstrapSecret = process.env.HOMIE_BOOTSTRAP_SECRET;

if (!baseUrl || !publicKey || !bootstrapSecret) {
  console.error('Defina SUPABASE_URL, SUPABASE_ANON_KEY (ou SUPABASE_PUBLISHABLE_KEY) e HOMIE_BOOTSTRAP_SECRET antes de continuar.');
  process.exit(1);
}

const prompts = createInterface({ input, output });
const ask = async (label) => (await prompts.question(label)).trim();
const askPin = (label) => {
  if (!input.isTTY || typeof input.setRawMode !== 'function') return ask(`${label} (four digits): `);
  return new Promise((resolve, reject) => {
    let value = '';
    output.write(label);
    input.setRawMode(true);
    input.resume();
    const onKey = (character, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        input.setRawMode(false); input.off('keypress', onKey); output.write('\n');
        reject(new Error('Cancelado.'));
      } else if (key.name === 'return' || key.name === 'enter') {
        input.setRawMode(false); input.off('keypress', onKey); output.write('\n'); resolve(value);
      } else if (key.name === 'backspace') {
        value = value.slice(0, -1); output.write('\b \b');
      } else if (/^\d$/.test(character) && value.length < 4) {
        value += character; output.write('•');
      }
    };
    input.on('keypress', onKey);
  });
};

try {
  const name = await ask('Nome da casa: ');
  const members = [];
  for (let index = 0; index < 5; index += 1) {
    output.write(`\n${index === 0 ? 'Administradora / responsável pela casa' : `Morador(a) ${index + 1}`}\n`);
    const displayName = await ask('  Nome: ');
    const username = await ask('  Usuário (2 a 32 letras, números, pontos, traços ou sublinhados): ');
    let pin = '';
    while (!/^\d{4}$/.test(pin)) pin = await askPin('  PIN de quatro dígitos: ');
    members.push({ displayName, username, pin });
  }

  const response = await fetch(`${baseUrl}/functions/v1/bootstrap-household`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publicKey, 'x-bootstrap-secret': bootstrapSecret },
    body: JSON.stringify({ name, members }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `A configuração inicial falhou (${response.status}).`);
  output.write('\nCasa criada. O primeiro perfil é o administrador. Entre no Homie Duties para continuar.\n');
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : 'A configuração inicial falhou.'}`);
  process.exitCode = 1;
} finally {
  prompts.close();
}
