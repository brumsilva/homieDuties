# Homie Duties

Aplicação Angular mobile first para organizar as atividades de uma casa compartilhada por até cinco pessoas. Os moradores podem adicionar cômodos, criar atividades com pontos e marcar a frequência como diária, semanal, mensal, sob demanda ou sempre disponível. Atividades contínuas, como guardar talheres e levar o lixo para fora, voltam à lista imediatamente após cada conclusão e podem ser repetidas várias vezes no mesmo dia. Cada registro inclui quem fez, data, hora, observação opcional e foto obrigatória.

O histórico conserva os registros e permite que outro morador envie uma contestação para revisão do administrador. A aba Pontos mostra a classificação geral por pontos, com filtro por cômodo e insights sobre os espaços e tarefas que mais pontuam. Cômodos podem ser editados ou excluídos, transferindo atividades abertas para outro espaço. O administrador pode editar e remover moradores; o acesso é desativado enquanto os registros históricos permanecem preservados. Quando uma contestação é aceita, os pontos deixam de contar no ranking. As fotos privadas são exibidas por links temporários do Supabase Storage. Atualizações são compartilhadas entre dispositivos por Supabase Realtime.

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
4. Crie `supabase/.env.local` com dois segredos fortes e diferentes, cada um com ao menos 32 caracteres aleatórios:

   ```dotenv
   HOMIE_PIN_PEPPER=um-segredo-aleatorio-com-pelo-menos-32-caracteres
   HOMIE_BOOTSTRAP_SECRET=outro-segredo-aleatorio-com-pelo-menos-32-caracteres
   ```

   Esse arquivo está excluído do Git. Para desenvolvimento local, inicie as Edge Functions em outro terminal:

   ```sh
   npx supabase functions serve --env-file supabase/.env.local
   ```

5. Defina `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `HOMIE_BOOTSTRAP_SECRET` no terminal e execute `npm run bootstrap:household`. O script pede o nome da casa e permite criar de um a cinco perfis; o primeiro será administrador. Se criar só o admin agora, ele poderá adicionar os demais moradores depois pelo app. A função de inicialização só pode ser usada uma vez e exige o segredo de configuração.
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
5. Execute `npm run bootstrap:household` uma vez usando URL, chave publicável e segredo de configuração. Crie um ou mais perfis; o primeiro será admin. Depois, remova `HOMIE_BOOTSTRAP_SECRET` do projeto. Desative o cadastro público de usuários nas configurações do Supabase Auth; os perfis devem ser criados pelo administrador da casa.

## Dados e segurança

- `households`, `profiles`, `tasks` e `completion_logs` ficam no Postgres, com RLS habilitado. Todos os moradores podem consultar a lista e o histórico da mesma casa; só a Edge Function autenticada permite que a pessoa administradora crie perfis ou redefina PINs.
- A conclusão usa uma única RPC transacional. Ela confirma o usuário autenticado, a tarefa aberta, a casa e a foto enviada antes de gravar o log, fechar a tarefa e agendar a próxima ocorrência.
- A frequência é aplicada após a conclusão: diariamente, a cada três dias para “várias vezes por semana”, semanalmente ou mensalmente. “Sempre disponível” reabre imediatamente a atividade; “quando necessário” não gera outra ocorrência automática.
- Cômodos, pontos e contestações usam tabelas com RLS por casa. A relação entre cômodo e tarefa também valida o mesmo `household_id`. Só o administrador pode resolver contestações, e os registros originais não são apagados.
- O bucket `completion-photos` é privado, aceita imagens de até 8 MB e só permite uploads na pasta do usuário autenticado. As fotos são acessíveis aos moradores da mesma casa por URLs assinadas que expiram após uma hora.
- Um PIN de quatro dígitos tem somente 10 mil combinações. O segredo HMAC do servidor e o limite persistente de tentativas reduzem tentativas automatizadas, mas um PIN curto continua menos seguro que uma senha longa. Use PINs aleatórios e não compartilhe o PIN de administrador.
- Não há rodízio automático de responsáveis. Qualquer morador pode concluir uma atividade disponível; o app registra imediatamente quem fez e os pontos definidos para ela.

## Comandos

```sh
npm start
npm run build
npm run bootstrap:household
```
