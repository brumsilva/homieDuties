# Homie Duties

Aplicação Angular mobile first para organizar as tarefas de uma casa compartilhada por cinco pessoas. A lista inicial cobre cozinha, banheiro e corredor com carpete. Qualquer morador pode assumir uma tarefa; ao concluir, registra o responsável, o horário, uma observação opcional e uma foto obrigatória. O histórico mostra as fotos privadas por links temporários do Supabase Storage. Atualizações de tarefas e atividade são compartilhadas entre dispositivos por Supabase Realtime.

O visual usa cartões e uma energia lúdica inspirados em Duels.ink, adaptados para uma ferramenta doméstica acolhedora. O projeto usa Tailwind CSS v4 e componentes Angular acessíveis. A biblioteca shadcn/ui é voltada a React; por isso, o app aplica padrões de composição semelhantes sem usar o CLI React.

## Executar a interface em modo de demonstração

```sh
npm install
npm start
```

Sem configuração do Supabase, o app abre com cinco perfis de exemplo. Entre com o usuário `ava` e PIN `1234`. As alterações da demonstração existem apenas no navegador atual e não são sincronizadas.

## Conectar um projeto Supabase

1. Para usar a stack local, instale e inicie o Docker Desktop. Depois execute `npx supabase start`; use `npx supabase status` para encontrar a URL local da API e a chave publicável/anônima.
2. Aplique a migração com `npx supabase db reset` em um banco local novo. Para um projeto hospedado, vincule-o e use `npx supabase db push`.
3. Edite `public/homie-config.js` com a URL do projeto e a chave publicável/anônima. Nunca coloque uma chave secreta ou `service_role` nesse arquivo.
4. Crie `supabase/.env.local` com dois segredos fortes e diferentes:

   ```dotenv
   HOMIE_PIN_PEPPER=um-segredo-aleatorio-com-pelo-menos-32-caracteres
   HOMIE_BOOTSTRAP_SECRET=outro-segredo-aleatorio-com-pelo-menos-32-caracteres
   ```

   Esse arquivo está excluído do Git. Para desenvolvimento local, inicie as Edge Functions em outro terminal:

   ```sh
   npx supabase functions serve --env-file supabase/.env.local
   ```

5. Defina `SUPABASE_URL` e `SUPABASE_ANON_KEY` no terminal e execute `npm run bootstrap:household`. O script pede o nome da casa e cinco nomes, usuários e PINs; a primeira pessoa será administradora. A função de inicialização só pode ser usada uma vez e exige o segredo de configuração.
6. Inicie o app com `npm start` e entre usando um dos cinco perfis.

A função de configuração cria usuários no Supabase Auth. Ela deriva uma senha longa a partir do usuário e do PIN usando o segredo disponível apenas no servidor; o PIN original não é armazenado. Tentativas de login são limitadas no banco por usuário e IP. Depois de criar a casa, remova `HOMIE_BOOTSTRAP_SECRET` dos segredos das Edge Functions. Mantenha `HOMIE_PIN_PEPPER` configurado para permitir login e redefinição de PIN.

## Publicar em um projeto Supabase hospedado

1. Vincule o projeto e aplique a migração:

   ```sh
   npx supabase login
   npx supabase link --project-ref REFERENCIA_DO_PROJETO
   npx supabase db push
   ```

2. Crie `supabase/.env.production` com `HOMIE_PIN_PEPPER` e `HOMIE_BOOTSTRAP_SECRET` e envie-os como segredos:

   ```sh
   npx supabase secrets set --env-file supabase/.env.production --project-ref REFERENCIA_DO_PROJETO
   ```

3. Publique as três funções:

   ```sh
   npx supabase functions deploy pin-login bootstrap-household manage-member --use-api --project-ref REFERENCIA_DO_PROJETO
   ```

4. Configure `public/homie-config.js` com a URL hospedada e a chave publicável/anônima. Gere o app com `npm run build`; o resultado fica em `dist/homie-duties/`.
5. Execute `npm run bootstrap:household` uma vez usando URL, chave e segredo da configuração. Depois, remova `HOMIE_BOOTSTRAP_SECRET` do projeto. Desative o cadastro público de usuários nas configurações do Supabase Auth; os perfis devem ser criados pelo administrador da casa.

## Dados e segurança

- `households`, `profiles`, `tasks` e `completion_logs` ficam no Postgres, com RLS habilitado. Todos os moradores podem consultar a lista e o histórico da mesma casa; só a Edge Function autenticada permite que a pessoa administradora crie perfis ou redefina PINs.
- A conclusão usa uma única RPC transacional. Ela confirma o usuário autenticado, a tarefa aberta, a casa e a foto enviada antes de gravar o log, fechar a tarefa e agendar a próxima ocorrência.
- A frequência é aplicada após a conclusão: diariamente, a cada três dias para “várias vezes por semana”, semanalmente ou mensalmente. “Quando necessário” não gera outra ocorrência automática.
- O bucket `completion-photos` é privado, aceita imagens de até 8 MB e só permite uploads na pasta do usuário autenticado. As fotos são acessíveis aos moradores da mesma casa por URLs assinadas que expiram após uma hora.
- Um PIN de quatro dígitos tem somente 10 mil combinações. O segredo HMAC do servidor e o limite persistente de tentativas reduzem tentativas automatizadas, mas um PIN curto continua menos seguro que uma senha longa. Use PINs aleatórios e não compartilhe o PIN de administrador.
- Esta versão não inclui rodízio de responsáveis nem aprovação por outra pessoa. Qualquer morador pode concluir uma tarefa; o app registra imediatamente quem fez.

## Comandos

```sh
npm start
npm run build
npm run bootstrap:household
```
