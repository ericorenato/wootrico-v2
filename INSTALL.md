# Instalação na VPS

Instaladores automáticos (Docker Swarm + Traefik/TLS). Detectam SO/Docker/Swarm,
perguntam a rede, o domínio e a infra, geram os segredos e sobem a stack a partir das
imagens publicadas no Docker Hub — **não** clonam o repositório.

Pré-requisitos: VPS **Linux** (Ubuntu/Debian recomendado), acesso **root** (ou `sudo`),
e um **domínio/subdomínio** com registro **A** apontando para o IP da VPS (para o TLS).

> Dica: rode cada instalador em uma pasta própria (ele grava o `.env` e o compose ali).

---

## 1. Servidor de licença (FORNECEDOR — você hospeda)

Hospede **separado** dos clientes, num subdomínio próprio (ex.: `license.suaempresa.com`).
Só precisa de um **Postgres** (reaproveita um existente ou sobe um dedicado).

```bash
mkdir -p /opt/wootrico-license && cd /opt/wootrico-license
curl -fsSL -O https://raw.githubusercontent.com/ericorenato/wootrico-v2/main/install-license.sh
sudo bash install-license.sh
```

Ou em uma linha:

```bash
curl -fsSL https://raw.githubusercontent.com/ericorenato/wootrico-v2/main/install-license.sh | sudo bash
```

O instalador pergunta: rede overlay, **subdomínio**, e-mail do TLS, reaproveitamento do
**Postgres**, login do **painel admin** e os **dias do teste gratuito**. Ao final mostra a
URL do painel (`https://SEU_SUBDOMINIO/`), a URL do **webhook de pagamento**
(`/webhook/payment`) e os segredos gerados.

Manutenção (rode da mesma pasta):

```bash
sudo bash install-license.sh update      # repull da imagem + redeploy (preserva o .env.license)
sudo bash install-license.sh uninstall   # remove a stack (pergunta se apaga o banco)
```

Depois de no ar, no painel admin abra **Webhooks** para criar a chave `WHK-…` usada pelo
seu provedor de pagamento, e veja o **payload** que o webhook espera.

---

## 2. Cliente Wootrico (quem usa o produto)

```bash
mkdir -p /opt/wootrico && cd /opt/wootrico
curl -fsSL -O https://raw.githubusercontent.com/ericorenato/wootrico-v2/main/install.sh
sudo bash install.sh
```

Ou em uma linha:

```bash
curl -fsSL https://raw.githubusercontent.com/ericorenato/wootrico-v2/main/install.sh | sudo bash
```

Pergunta a rede, o **domínio**, o TLS e a infra (Postgres/RabbitMQ/Redis — reaproveita ou
sobe embarcados). No 1º acesso (`https://SEU_DOMINIO`) o **setup wizard** cria o admin e
oferece o **teste gratuito de 7 dias**. Aponte o cliente ao seu servidor de licença com
`LICENSE_SERVER_URL` no `.env` (e, opcionalmente, `LICENSE_CHECKOUT_URL` para o botão de
compra).

Manutenção:

```bash
sudo bash install.sh update       # atualizar
sudo bash install.sh uninstall    # remover
bash install.sh local             # rodar local (Docker Desktop, sem Swarm)
```

---

## Imagens Docker

| Imagem | Alvo | Quem hospeda |
|---|---|---|
| `ericoautomacao/wootrico-v2:latest` | cliente (painel + worker) | seu cliente |
| `ericoautomacao/wootrico-license:latest` | servidor de licença + painel admin | você (fornecedor) |

Ambas são `linux/amd64`. Os instaladores sempre puxam a tag `:latest` mais recente.
