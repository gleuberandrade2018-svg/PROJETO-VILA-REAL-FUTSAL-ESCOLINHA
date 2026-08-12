# Vila Real Futsal — autenticação segura

Esta versão separa autenticação e recuperação de senha do `localStorage`.

## O que mudou
- Senhas não são mais armazenadas em texto puro no backend; são protegidas com `scrypt`.
- Login passa pelo backend e recebe um token de sessão.
- Recuperação usa código de uso único, com validade de 15 minutos e limite de tentativas.
- O sistema não envia a senha por e-mail. Envia código de recuperação e, depois, confirmação da alteração.
- Aprovação/rejeição de usuário exige sessão de administrador.
- Resposta manual de e-mail exige sessão de administrador.
- E-mails são enviados pelo backend via API do EmailJS.

## Instalação
1. Instale Node.js 18 ou superior.
2. Copie `.env.example` para `.env` e preencha os valores.
3. Inicie com `node server.js`.
4. Abra `http://localhost:3000/`.

O projeto não depende de pacotes npm externos.

## Migração dos usuários existentes
Os usuários antigos do `localStorage` ainda podem existir no navegador. Para migrá-los, habilite temporariamente `MIGRATION_KEY` e use a função de migração fornecida na versão HTML, enviando os usuários ao endpoint `/api/auth/migrate`. O backend converte cada senha para `scrypt` e não grava a senha original.

Depois da migração:
- altere/remova `MIGRATION_KEY`;
- troque a senha do administrador;
- mantenha o sistema atrás de HTTPS em produção.

## EmailJS
O template deve aceitar pelo menos:
- `to_email`
- `to_name`
- `from_name`
- `subject`
- `mensagem`
- `tipo_email`
- `usuario`
- `codigo_recuperacao`
- `sistema`

## Produção
Use HTTPS, firewall/reverse proxy e backup do diretório `server-data`. Não publique `.env`.
