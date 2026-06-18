<h1 align="center">Wootrico v2</h1>

<p align="center">
  <b>Middleware self-hosted que conecta o Chatwoot a APIs não-oficiais de WhatsApp</b><br>
  (Evolution&nbsp;Go · UAZAPI · Z-API) — configurado por um painel, não por env-vars.
</p>

<p align="center">
  <code>Node.js + TypeScript</code> ·
  <code>Fastify</code> ·
  <code>React + Vite</code> ·
  <code>Postgres</code> ·
  <code>RabbitMQ</code> ·
  <code>Redis</code> ·
  <code>Docker Swarm</code>
</p>

---

## ✨ O que é

Conecta o **[Chatwoot](https://github.com/chatwoot/chatwoot)** a APIs não-oficiais de
WhatsApp e centraliza o atendimento. Cada cliente instala na **própria VPS**, ativa
uma **licença** e gerencia tudo por um **painel** com tema escuro.

- **Várias empresas / inboxes** numa só instância, misturando provedores.
- **3 provedores**: Evolution&nbsp;Go, UAZAPI, Z-API (extensível).
- **Mensagens em ordem e sem duplicar** — lock por conversa (Redis) + dedup durável.
- **Licença controlada pelo fornecedor** — ativação online + token assinado (Ed25519) + heartbeat; vínculo por instância (sem compartilhamento).
- **Privacy-by-design** — **nenhum conteúdo de mensagem** fica em repouso no banco.

## 🚀 Instalação (VPS · Docker Swarm)

Em uma VPS Linux limpa (Ubuntu/Debian/RHEL), rode:

```bash
curl -fsSL https://raw.githubusercontent.com/ericorenato/wootrico-v2/main/install.sh | sudo bash
```

> Repositório **privado**: passe um token de acesso para o `curl` e para o `git`:
> ```bash
> curl -fsSL -H "Authorization: token SEU_PAT" \
>   https://raw.githubusercontent.com/ericorenato/wootrico-v2/main/install.sh | sudo bash
> ```
> Ou simplesmente: `git clone https://github.com/ericorenato/wootrico-v2 && cd wootrico-v2 && sudo bash install.sh`

O instalador **detecta o SO**, instala o que faltar (git/Docker/Swarm), pergunta o
domínio/e-mail/licença, **gera ou preserva** as chaves, builda a imagem, sobe a
stack e mostra um **resumo com as chaves**. É **idempotente** (re-rodar não
sobrescreve o `.env`).

Depois acesse `https://SEU_DOMINIO` → o **setup wizard** cria o admin, ativa a
licença e guia a 1ª integração (com teste de conexão e as URLs de webhook).

### Manutenção
```bash
sudo bash install.sh update      # git pull + rebuild + redeploy (preserva .env e dados)
sudo bash install.sh uninstall   # remove a stack (pergunta se apaga os volumes)
```

## 🖥️ Rodar localmente (Docker Desktop)

Sem Swarm, com porta publicada — ótimo para testar:

```bash
cp .env.example .env
# ajuste: hosts internos (postgres/rabbitmq/redis), LICENSE_REQUIRED=false,
# e gere JWT_SECRET / APP_ENCRYPTION_KEY
docker compose -f docker-compose.local.yml up -d   # puxa a imagem do Docker Hub
# painel em http://localhost:3000
```

> A imagem pública é `ericoautomacao/wootrico-v2:latest`. Para buildar a sua
> própria, descomente o `build:` no `docker-compose.local.yml`.

## 🧩 Arquitetura

```
WhatsApp API ─▶ /webhook/:token/provider ┐
Chatwoot     ─▶ /webhook/:token/chatwoot ─┤ panel-api (ingress)
                                          ▼
                                      RabbitMQ  (quorum + DLX + retry)
                                          ▼
                                       worker  ──▶ Chatwoot / Provider
                                          │  (lock por conversa + cache + throttle no Redis)
                                          ▼
                                      Postgres  (config + IDs/metadados — SEM conteúdo)
```

- **RabbitMQ** transporta as mensagens (payload só trafega aqui — efêmero).
- **Redis**: lock por conversa (ordem, elimina "delay"), cache de lookups do Chatwoot e throttle de mídia.
- **Postgres**: configuração + estado operacional mínimo (IDs, tickets pseudonimizados, metadados). Telefones em dedup são **HMAC**; `recipient` de mapping é **criptografado**.
- Topologia do RabbitMQ e migrações do banco: **criadas automaticamente** no boot.

## 🔐 Servidor de licença (fornecedor)

Hospedado **separadamente** dos clientes:

```bash
node scripts/gen-license-keys.mjs                              # par Ed25519
cp apps/license-server/.env.example apps/license-server/.env   # cole as chaves + ADMIN_TOKEN
docker compose -f docker-compose.license-server.yml up -d
# criar/vender uma chave:
curl -XPOST https://license.seudominio/admin/keys \
  -H "authorization: Bearer SEU_ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"plan":"pro","email":"cliente@x.com"}'
```

A chave (`WTR-…`) é entregue ao cliente; ela ativa **uma** instância.

## 🛠️ Desenvolvimento

Pré-requisitos: Node 20+, pnpm 10+, Docker.

```bash
pnpm install
cp .env.example .env   # gere APP_ENCRYPTION_KEY e JWT_SECRET
pnpm dev:db            # Postgres + RabbitMQ + Redis (docker-compose.dev.yml)
pnpm db:generate && pnpm --filter @wootrico/db migrate:dev
pnpm dev               # api + web + worker
# painel (dev): http://127.0.0.1:5173   ·   API: http://127.0.0.1:3000
```

> Windows: use `127.0.0.1` (o Fastify escuta em IPv4).

Testes ponta-a-ponta (mock de Chatwoot + provedores):
```bash
node --env-file-if-exists=.env scripts/m2-e2e.mjs   # uazapi: round trip + dedup
node --env-file-if-exists=.env scripts/m3-e2e.mjs   # zapi + evolution + roteamento
node --env-file-if-exists=.env scripts/m4-e2e.mjs   # licença: ativar/revogar/binding
```

## 📁 Monorepo

```
apps/      panel-api · panel-web · worker · license-server
packages/  config · db · types · providers · chatwoot-client · queue · cache · license-client
```

## 📄 Licença de uso

Software proprietário. Uso mediante chave de licença válida fornecida por Erico Renato.
