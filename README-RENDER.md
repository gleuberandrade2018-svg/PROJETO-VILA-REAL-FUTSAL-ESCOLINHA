# Vila Real Futsal — migração para banco online no Render

## Correções aplicadas nesta revisão
1. **Sincronização automática parava após atualizar a página (F5).** A função que verifica atualizações no servidor a cada 10s só era ligada no momento do login. Agora também é ligada quando a sessão é restaurada automaticamente ao reabrir o app.
2. **O servidor expunha o código-fonte publicamente.** Antes, qualquer pessoa podia acessar `seusite.onrender.com/server.js` ou `/package.json` e baixar o backend inteiro. Agora o servidor só entrega o `index.html`; as rotas `/api/*` continuam funcionando normalmente.
3. Adicionados avisos no log do servidor caso `JWT_SECRET` ou `ADMIN_PASSWORD` não estejam configuradas no Render (nesse caso ele usa valores padrão inseguros, que **não devem** ser usados em produção).
4. Adicionado `.gitignore` para não subir `node_modules` para o GitHub.


## Arquivos
- `index.html` — aplicativo web responsivo.
- `server.js` — API Express + PostgreSQL + autenticação JWT.
- `package.json` — dependências e comando de inicialização.

## 1. Criar o banco
No Render: **New + Postgres**. Depois, no Web Service, conecte a variável `DATABASE_URL` do banco ao serviço.

## 2. Configurar o Web Service
O serviço precisa ser um **Web Service**, não Static Site.

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

## 3. Variáveis de ambiente
Configure no Render:

- `DATABASE_URL` — vem do Render Postgres.
- `JWT_SECRET` — uma string longa e aleatória.
- `ADMIN_USER` — usuário atual do administrador.
- `ADMIN_PASSWORD` — senha atual do administrador.
- `ADMIN_EMAIL` — e-mail do administrador.

Para a primeira migração, `ADMIN_USER` e `ADMIN_PASSWORD` precisam permitir o login do administrador que já usa o sistema.

## 4. Primeira migração
Depois do deploy:

1. Abra o sistema no navegador do computador que possui os dados antigos.
2. Faça login como administrador.
3. Se o banco estiver vazio, o sistema detectará os usuários/dados locais e enviará automaticamente o conteúdo para o PostgreSQL.
4. Depois disso, o PostgreSQL passa a ser a fonte central.
5. Teste em uma janela anônima ou em um celular.

## 5. Funcionamento após a migração
- Novo cadastro grava diretamente no PostgreSQL.
- Usuários aparecem automaticamente no painel do administrador.
- Permissões alteradas pelo administrador são gravadas no PostgreSQL.
- Login em qualquer computador/celular recebe as permissões atuais.
- Usuários já conectados são atualizados periodicamente.
- O Dashboard e os demais painéis são controlados pela permissão correspondente.
- O menu mobile continua disponível em telas pequenas.

## Observação de segurança
As senhas não são armazenadas em texto puro no PostgreSQL; o servidor usa bcrypt. O navegador pode manter dados locais legados apenas para a transição/migração.

**Importante:** o `server.js` traz uma senha de administrador e um segredo JWT padrão "de fábrica" (`Opala77@2056` / `CHANGE_THIS_JWT_SECRET_IN_RENDER`), usados **apenas** se as variáveis de ambiente não forem configuradas. Antes de publicar o repositório no GitHub, configure `JWT_SECRET` e `ADMIN_PASSWORD` no Render com valores próprios — o servidor agora avisa no log se algum deles estiver ausente. Se o repositório for público, qualquer pessoa pode ler esses valores padrão no código.

---

## Como administrar o processo: GitHub + Render passo a passo

### A) Subir os arquivos para o GitHub
1. Crie um repositório novo no GitHub (pode ser privado, recomendado dado o ponto acima).
2. No seu computador, dentro da pasta com os 4 arquivos (`index.html`, `server.js`, `package.json`, `README-RENDER.md`) e o `.gitignore`:
   ```bash
   git init
   git add .
   git commit -m "Vila Real Futsal - versão com banco online"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
   git push -u origin main
   ```
3. Sempre que corrigir algo no código depois, o fluxo é: editar o arquivo → `git add .` → `git commit -m "descrição da mudança"` → `git push`.

### B) Criar o banco de dados no Render
1. No painel do Render: **New +** → **PostgreSQL**.
2. Dê um nome (ex: `vila-real-futsal-db`) e crie. Aguarde o status ficar "Available".
3. Guarde a "Internal Database URL" — será usada no passo seguinte.

### C) Criar o Web Service a partir do GitHub
1. No painel do Render: **New +** → **Web Service**.
2. Conecte sua conta do GitHub e selecione o repositório criado no passo A.
3. Configure:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`
4. Em **Environment**, adicione as variáveis:
   - `DATABASE_URL` → cole a Internal Database URL do banco criado em B (ou conecte diretamente pelo botão de vincular banco, se disponível na sua conta).
   - `JWT_SECRET` → uma string longa e aleatória só sua (ex: gere com `openssl rand -hex 32`).
   - `ADMIN_USER` → o usuário do administrador atual.
   - `ADMIN_PASSWORD` → a senha do administrador atual.
   - `ADMIN_EMAIL` → e-mail do administrador.
5. Clique em **Create Web Service**. O Render vai instalar as dependências e iniciar o servidor automaticamente.

### D) Deploys seguintes (rotina do dia a dia)
- Todo `git push` para a branch `main` no GitHub dispara um novo deploy automático no Render (deploy automático fica ligado por padrão).
- Para acompanhar: aba **Logs** do Web Service no Render mostra em tempo real o que está acontecendo (inclusive os avisos de `JWT_SECRET`/`ADMIN_PASSWORD` ausentes, se for o caso).
- Para forçar um novo deploy sem alterar código: botão **Manual Deploy** → **Deploy latest commit**.

### E) Primeira migração dos dados
Depois do primeiro deploy funcionando (siga a seção "4. Primeira migração" acima): acesse pelo navegador do computador com os dados antigos, faça login como administrador, e o sistema migra automaticamente o conteúdo local para o PostgreSQL.
