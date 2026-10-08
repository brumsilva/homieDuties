# Prompt para o Codex — Homie Duties

Copie o texto a seguir para uma tarefa do Codex que tenha acesso a este repositório.

---

Implemente e mantenha neste repositório uma aplicação Angular mobile first chamada **Homie Duties**, para organizar tarefas de uma casa compartilhada por cinco pessoas. Antes de alterar arquivos, leia o `README.md`, os arquivos Angular e tudo em `supabase/`; preserve o trabalho existente e complete os pontos que estiverem faltando.

## Objetivo e experiência

O app deve responder rapidamente a três perguntas: o que precisa ser feito, quem fez cada tarefa e quando. Cada conclusão deve guardar uma foto do resultado. Todos os cinco moradores consultam a mesma lista e o mesmo histórico em seus celulares.

- Criar uma interface em português brasileiro, responsiva e acessível, com navegação inferior no celular e navegação lateral em telas maiores.
- A tela inicial exibe tarefas abertas, filtro por cômodo, frequência, estado vazio, resumo do dia e moradores da casa.
- Incluir tarefas iniciais claras para cozinha, banheiro e corredor com carpete. O texto de cada tarefa explica o que significa concluí-la.
- Qualquer morador pode concluir uma tarefa aberta. Exigir foto do resultado, permitir observação opcional e registrar pessoa e timestamp no servidor.
- Incluir histórico por data, com nome do morador, tarefa, cômodo, horário e visualização da foto privada. Incluir tela de moradores com ação administrativa para criar perfis e redefinir PINs.
- Aplicar recorrência após uma conclusão: diariamente = 1 dia; várias vezes por semana = 3 dias; semanalmente = 1 semana; mensalmente = 1 mês; “quando necessário” não cria outra ocorrência.
- Mostrar estados de carregamento, sucesso, falha, lista vazia, filtro sem resultado e tarefa que ainda não venceu. Não apresentar ações administrativas a perfis comuns.
- Implementar modo de demonstração local quando Supabase não estiver configurado, claramente identificado e sem alegar que os dados estão sincronizados.

## Direção visual e pesquisa

Use [Duels.ink](https://duels.ink/) como referência de energia visual e cartões de conteúdo, reinterpretada como uma ferramenta acolhedora para uma casa compartilhada. Não copie marca, ilustrações ou elementos proprietários.

A comparação de produtos sugere combinar tarefas por cômodo e frequência, presentes em apps como [Tody](https://todyapp.com/) e [Sweepy](https://play.google.com/store/apps/details?id=app.sweepy.sweepy), com um histórico que mostre quem fez cada tarefa. O fluxo de [ChorePoints](https://chorepoints.com/photo-proof-chore-app) reforça o valor de fotos quando a conclusão precisa de evidência visual e a importância de manter essas imagens privadas. [FairlyDo](https://fairlydo.com/) também usa notas ou fotos para fechar o ciclo em tarefas compartilhadas. Para esta casa, a foto é obrigatória em cada conclusão e não há etapa de aprovação.

A skill shadcn/ui e seus padrões de composição devem orientar hierarquia, tokens semânticos e acessibilidade. O shadcn/ui oficial é voltado a React; não execute o CLI React nem finja compatibilidade com Angular. Use componentes Angular e Tailwind CSS v4, documentado para Angular em [angular.dev](https://v20.angular.dev/guide/tailwind), com a mesma clareza de composição.

## Stack e dados

- Frontend Angular standalone, TypeScript estrito, Tailwind CSS v4 e `@supabase/supabase-js`. Use `public/homie-config.js` apenas para URL do projeto e chave publicável/anônima.
- Supabase Postgres como fonte principal de dados; criar migração versionada e manter RLS habilitado em cada tabela exposta.
- Modelar casa, perfis, tarefas e logs de conclusão. Cada perfil tem username único, nome de exibição e papel `admin` ou `member`. Cada tarefa tem título, cômodo (`Kitchen`, `Bathroom`, `Hallway`), descrição, frequência, estado e próxima data disponível. Cada log referencia tarefa, morador, instante, nota e caminho da foto.
- Criar RPC transacional de conclusão: conferir usuário autenticado, pertencimento à casa, tarefa aberta e vencida, e objeto de foto enviado na pasta do usuário; gravar log e fechar a tarefa; criar próxima ocorrência se a frequência for recorrente. Impedir criação/edição direta de logs pelo cliente.
- Guardar fotos em bucket Supabase Storage privado, com limite de 8 MB, MIME types de imagem aceitos, upload em pasta do usuário e leitura por moradores da mesma casa usando URLs assinadas de curta duração.
- Usar Supabase Realtime para atualizar lista e histórico entre dispositivos. Persistir timestamps em UTC e apresentar datas no fuso `Europe/Dublin`.

## Acesso por username e PIN

- Os cinco perfis iniciais são criados pelo endpoint de bootstrap, que só funciona uma vez e exige `HOMIE_BOOTSTRAP_SECRET`. O primeiro perfil se torna administrador; ele pode criar e redefinir os PINs dos perfis seguintes.
- Exigir PIN individual de exatamente quatro dígitos. Nunca enviar chave privilegiada ao navegador nem armazenar PIN em texto claro.
- Implementar verificação em Edge Function com Supabase Auth: mapear o username a um endereço interno `.invalid`, derivar uma senha longa com HMAC usando `HOMIE_PIN_PEPPER` guardado somente nos segredos da função e devolver a sessão Supabase ao cliente.
- Aplicar limite de tentativas persistente por hash de username e IP. Usar respostas de erro genéricas para evitar enumeração de usuários. O PIN de quatro dígitos é curto; documentar que os limites reduzem tentativas automatizadas, mas não o tornam equivalente a uma senha longa.
- Desativar cadastro público de Auth. Validar no servidor que apenas o perfil administrador pode criar usuários ou redefinir PINs. Não usar `user_metadata` para autorização.

## Design de implementação

- Usar componentes pequenos e nomes claros para navegação, cartões de tarefa, filtros, seletor de foto, histórico, perfis, feedbacks e modais.
- Manter a UI em português; enums e colunas do banco podem usar valores estáveis em inglês.
- Não adicionar dependências ou complexidade que não apoiem o fluxo de casa compartilhada. Não adicionar gamificação de pontos, compras, calendário, rodízio de responsáveis ou aprovação de fotos.
- Documentar instalação, modo de demonstração, configuração local e hospedada do Supabase, bootstrap inicial, variáveis/secrets e comandos em `README.md`.
- Nunca incluir secrets em arquivos versionados. Não executar deploy, vincular um projeto remoto ou publicar dados sem uma solicitação explícita.

## Critérios de aceitação

1. A casa inicia com cinco perfis individuais e tarefas para cozinha, banheiro e corredor com carpete; a pessoa administradora pode criar perfis até o limite de cinco e redefinir PINs.
2. Um morador vê as tarefas compartilhadas, filtra por cômodo, conclui tarefa vencida com foto, e o app guarda usuário e horário corretos. A conclusão sem foto deve ser bloqueada.
3. Tarefas recorrentes agendam a ocorrência seguinte de acordo com a frequência; tarefas “quando necessário” não se repetem automaticamente.
4. Todos os moradores autenticados conseguem consultar o mesmo histórico e fotos; usuários sem sessão ou de outra casa não conseguem ler os dados privados.
5. PIN inválido não cria sessão; tentativas repetidas são limitadas; chaves administrativas não aparecem no bundle do cliente.
6. O layout funciona em viewport mobile e desktop, os controles são acessíveis por teclado/leitor de tela, e erros de rede/permissão não aparecem como falso sucesso.
7. Atualizar os testes para cobrir login de demonstração, filtro, exigência de foto, gravação de conclusão e agendamento recorrente. Executar build e testes; validar SQL/Edge Functions no Supabase local se Docker estiver disponível e relatar qualquer bloqueio externo.

Ao concluir, informe as principais alterações, comandos executados e resultados de validação, incluindo limitações causadas por configuração ausente ou serviços externos indisponíveis.

---
