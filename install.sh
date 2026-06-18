#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Wootrico v2 — instalador para VPS (Docker Swarm).
#   sudo bash install.sh            # instalar em produção (Swarm; Traefik/TLS opcional)
#   sudo bash install.sh update     # pull da imagem + regenera compose + redeploy (preserva .env)
#   sudo bash install.sh uninstall  # remover a stack (e opcionalmente volumes)
#        bash install.sh local      # rodar LOCAL (Docker Desktop, Compose puro, sem Swarm)
#
# NÃO clona o repositório: a stack sobe via Compose GERADO pelo instalador usando
# a imagem publicada no Docker Hub. Detecta o SO/Docker/Swarm, pergunta a rede
# overlay e as chaves, gera/preserva segredos, sobe a stack e mostra um resumo.
# Idempotente: re-executar NÃO sobrescreve valores já existentes no .env.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

STACK_NAME="wootrico"
IMAGE="${WOOTRICO_IMAGE:-ericoautomacao/wootrico-v2:latest}"
ENV_FILE=".env"
REPO_URL_DEFAULT="https://github.com/ericorenato/wootrico-v2"

if [ -t 1 ]; then C_B="\033[1m"; C_G="\033[32m"; C_Y="\033[33m"; C_R="\033[31m"; C_C="\033[36m"; C_0="\033[0m"; else C_B=""; C_G=""; C_Y=""; C_R=""; C_C=""; C_0=""; fi
info()  { echo -e "${C_C}›${C_0} $*"; }
ok()    { echo -e "${C_G}✓${C_0} $*"; }
warn()  { echo -e "${C_Y}!${C_0} $*"; }
err()   { echo -e "${C_R}✗${C_0} $*" >&2; }
title() { echo -e "\n${C_B}== $* ==${C_0}"; }

SUMMARY=(); note() { SUMMARY+=("$1"); }
SUDO=""

ask() {
  local prompt="$1" def="${2:-}" ans
  if [ -n "$def" ]; then read -rp "$(echo -e "${C_C}?${C_0} ${prompt} [${def}]: ")" ans </dev/tty || true; echo "${ans:-$def}"
  else read -rp "$(echo -e "${C_C}?${C_0} ${prompt}: ")" ans </dev/tty || true; echo "$ans"; fi
}
confirm() {
  local ans; read -rp "$(echo -e "${C_C}?${C_0} $1 [Y/n]: ")" ans </dev/tty || true
  case "${ans:-Y}" in [Nn]*) return 1 ;; *) return 0 ;; esac
}
need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else err "Rode como root ou instale sudo."; exit 1; fi
  fi
}
# Leitura global de um valor do .env (helpers get_env/set_env locais ficam em configure_env).
genv() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }

# ───────────────────────────── INSTALL ─────────────────────────────
cmd_install() {
  title "Sistema operacional"
  [ "$(uname -s)" = "Linux" ] || { err "Este instalador é para Linux (VPS). Para testar localmente use docker-compose.local.yml."; exit 1; }
  need_root
  local OS_ID="desconhecido" PKG=""
  [ -f /etc/os-release ] && . /etc/os-release && OS_ID="${ID:-desconhecido}"
  case "$OS_ID" in
    ubuntu|debian|raspbian|linuxmint|pop) PKG="apt" ;;
    centos|rhel|rocky|almalinux|fedora|amzn) command -v dnf >/dev/null 2>&1 && PKG="dnf" || PKG="yum" ;;
    *) warn "Distro '$OS_ID' não reconhecida; tentarei seguir." ;;
  esac
  ok "Detectado: ${PRETTY_NAME:-$OS_ID} (gerenciador: ${PKG:-n/d})"; note "SO: ${PRETTY_NAME:-$OS_ID}"

  local pkg_update_done=0
  pkg_update() { [ "$pkg_update_done" = 1 ] && return 0
    case "$PKG" in apt) info "apt-get update…"; $SUDO apt-get update -y >/dev/null ;; dnf) $SUDO dnf -y check-update >/dev/null 2>&1 || true ;; yum) $SUDO yum -y check-update >/dev/null 2>&1 || true ;; esac
    pkg_update_done=1; }
  pkg_install() {
    local bin="$1" pkg="${2:-$1}"
    command -v "$bin" >/dev/null 2>&1 && { ok "$bin já instalado"; return 0; }
    confirm "Instalar '$pkg' (ausente)?" || { warn "Pulado: $pkg"; return 0; }
    pkg_update
    case "$PKG" in apt) $SUDO apt-get install -y "$pkg" >/dev/null ;; dnf) $SUDO dnf install -y "$pkg" >/dev/null ;; yum) $SUDO yum install -y "$pkg" >/dev/null ;; *) err "Sem gerenciador para instalar $pkg"; return 1 ;; esac
    ok "$pkg instalado"; note "Instalado: $pkg"
  }

  title "Dependências base"
  pkg_install curl; pkg_install git; pkg_install openssl

  title "Docker"
  if command -v docker >/dev/null 2>&1; then ok "Docker já instalado ($(docker --version | awk '{print $3}' | tr -d ,))"
  elif confirm "Docker não encontrado. Instalar via get.docker.com?"; then
    curl -fsSL https://get.docker.com | $SUDO sh; $SUDO systemctl enable --now docker 2>/dev/null || true
    ok "Docker instalado"; note "Instalado: Docker Engine"
  else err "Docker é obrigatório."; exit 1; fi

  title "Docker Swarm"
  if [ "$($SUDO docker info -f '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo inactive)" = "active" ]; then ok "Swarm já ativo"
  elif confirm "Inicializar o Docker Swarm neste nó?"; then
    local ip; ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    $SUDO docker swarm init --advertise-addr "${ip:-127.0.0.1}" >/dev/null 2>&1 || $SUDO docker swarm init >/dev/null 2>&1 || { err "Falha no swarm init (tente --advertise-addr <IP>)"; exit 1; }
    ok "Swarm inicializado"; note "Swarm: inicializado (${ip:-local})"
  else err "Swarm é obrigatório."; exit 1; fi

  # Sem clone do repositório: a stack sobe via Compose gerado aqui, usando a
  # imagem publicada no Docker Hub.
  decide_network
  decide_traefik
  configure_env
  write_compose
  pull_image
  deploy_stack
  print_summary
}

# ───────────────────────────── .env ─────────────────────────────
configure_env() {
  title "Configuração (.env)"
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
  set_env() { local k="$1" v="$2" tmp; if grep -qE "^$k=" "$ENV_FILE"; then tmp="$(mktemp)"; grep -vE "^$k=" "$ENV_FILE" > "$tmp"; mv "$tmp" "$ENV_FILE"; fi; printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"; }
  keep_or() { local cur; cur="$(get_env "$1")"; [ -n "$cur" ] && echo "$cur" || echo "$2"; }
  gen() { openssl rand -base64 "$1" | tr -d '\n='; }
  genhex() { openssl rand -hex "$1"; }

  local AUTO=0; confirm "Gerar senhas/segredos automaticamente (recomendado)?" && AUTO=1
  secret_for() {
    local key="$1"; shift; local cur; cur="$(get_env "$key")"; [ -n "$cur" ] && { echo "$cur"; return; }
    local val; val="$("$@")"
    if [ "$AUTO" = 0 ]; then local t; t="$(ask "Valor para $key (enter = gerar)" "")"; [ -n "$t" ] && val="$t"; note "$key: definido manualmente"; else note "$key: gerado automaticamente"; fi
    echo "$val"
  }

  DOMAIN="$(ask "Domínio do painel (a URL do webhook é derivada deste domínio)" "$(get_env DOMAIN)")"

  # DNS: o domínio precisa apontar para este servidor (o roteamento é por Host).
  local SRV_IP; SRV_IP="$(public_ip)"
  echo
  warn "DNS necessário: crie um registro A de '${DOMAIN}' apontando para ${SRV_IP:-<IP deste servidor>}."
  info "Faça isso no painel DNS do seu provedor (Cloudflare, Registro.br, etc.). O Wootrico NÃO cria DNS."
  if [ "${USE_TRAEFIK:-1}" = 1 ]; then
    info "O certificado TLS (Let's Encrypt) só é emitido após o DNS propagar e as portas 80/443 ficarem acessíveis neste servidor."
  fi
  confirm "O DNS de '${DOMAIN}' já aponta para ${SRV_IP:-este servidor}?" || \
    warn "Sem o DNS apontando, o painel não abrirá pelo domínio e o TLS falhará — ajuste o DNS e rode 'install.sh update' depois."
  echo

  # Só precisamos do e-mail do Let's Encrypt quando o Wootrico instala o Traefik.
  if [ "${USE_TRAEFIK:-1}" = 1 ]; then
    ACME_EMAIL="$(ask "E-mail para o certificado TLS (Let's Encrypt)" "$(get_env ACME_EMAIL)")"
  else
    ACME_EMAIL="$(get_env ACME_EMAIL)"
  fi
  LICENSE_SERVER_URL="$(ask "URL do servidor de licença" "$(keep_or LICENSE_SERVER_URL 'https://license.example.com')")"
  LICENSE_PUBLIC_KEY="$(ask "Chave pública da licença (base64 PEM)" "$(get_env LICENSE_PUBLIC_KEY)")"
  LICENSE_KEY="$(ask "Chave de licença (opcional, ativável no painel)" "$(get_env LICENSE_KEY)")"

  local PGU PGDB RBU
  PGU="$(keep_or POSTGRES_USER wootrico)"; PGDB="$(keep_or POSTGRES_DB wootrico)"; RBU="$(keep_or RABBITMQ_USER wootrico)"
  POSTGRES_PASSWORD="$(secret_for POSTGRES_PASSWORD genhex 16)"
  RABBITMQ_PASSWORD="$(secret_for RABBITMQ_PASSWORD genhex 16)"
  JWT_SECRET="$(secret_for JWT_SECRET gen 48)"
  APP_ENCRYPTION_KEY="$(get_env APP_ENCRYPTION_KEY)"; [ -z "$APP_ENCRYPTION_KEY" ] && { APP_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"; note "APP_ENCRYPTION_KEY: gerado automaticamente"; }

  set_env DOMAIN "$DOMAIN"; set_env ACME_EMAIL "$ACME_EMAIL"
  set_env WOOTRICO_TRAEFIK "${USE_TRAEFIK:-1}"
  set_env WOOTRICO_NETWORK "${NET_NAME:-${STACK_NAME}-net}"
  set_env POSTGRES_USER "$PGU"; set_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"; set_env POSTGRES_DB "$PGDB"
  set_env DATABASE_URL "$(keep_or DATABASE_URL "postgresql://${PGU}:${POSTGRES_PASSWORD}@postgres:5432/${PGDB}?schema=public")"
  set_env RABBITMQ_USER "$RBU"; set_env RABBITMQ_PASSWORD "$RABBITMQ_PASSWORD"
  set_env RABBITMQ_URL "$(keep_or RABBITMQ_URL "amqp://${RBU}:${RABBITMQ_PASSWORD}@rabbitmq:5672")"
  set_env REDIS_URL "$(keep_or REDIS_URL 'redis://redis:6379')"
  set_env PUBLIC_BASE_URL "$(keep_or PUBLIC_BASE_URL "https://${DOMAIN}")"
  set_env LICENSE_SERVER_URL "$LICENSE_SERVER_URL"
  [ -n "$LICENSE_PUBLIC_KEY" ] && set_env LICENSE_PUBLIC_KEY "$LICENSE_PUBLIC_KEY"
  [ -n "$LICENSE_KEY" ] && set_env LICENSE_KEY "$LICENSE_KEY"
  set_env LICENSE_REQUIRED "$(keep_or LICENSE_REQUIRED true)"
  set_env JWT_SECRET "$JWT_SECRET"; set_env APP_ENCRYPTION_KEY "$APP_ENCRYPTION_KEY"
  set_env NODE_ENV "$(keep_or NODE_ENV production)"; set_env PORT "$(keep_or PORT 3000)"
  set_env HOST "$(keep_or HOST 0.0.0.0)"; set_env LOG_LEVEL "$(keep_or LOG_LEVEL info)"
  chmod 600 "$ENV_FILE"; ok ".env atualizado (preservando valores existentes)"
}

# Descobre o IP público deste servidor (para a instrução de DNS).
public_ip() {
  local ip
  ip="$(curl -s --max-time 4 https://api.ipify.org 2>/dev/null)"
  [ -z "$ip" ] && ip="$(curl -s --max-time 4 https://ifconfig.me 2>/dev/null)"
  [ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "$ip"
}

# Detecta um Traefik já em execução (Swarm ou container) para não duplicar o
# proxy/portas 80/443. Se não detectar, pergunta se deve instalar. A escolha é
# persistida no .env (WOOTRICO_TRAEFIK) para o 'update' reutilizá-la.
decide_traefik() {
  title "Traefik (proxy reverso + TLS)"
  local found=""
  found="$($SUDO docker service ls --format '{{.Image}}' 2>/dev/null; $SUDO docker ps --format '{{.Image}}' 2>/dev/null)"
  if printf '%s\n' "$found" | grep -qi 'traefik'; then
    USE_TRAEFIK=0
    ok "Traefik já detectado neste host — não vou subir outro (evita conflito em 80/443)."
    warn "Use seu Traefik com provider Swarm na rede '${NET_NAME:-<rede informada>}' para rotear o painel/webhook (porta 3000 do serviço app)."
    note "Traefik: existente (não instalado pelo Wootrico)"
  elif confirm "Traefik não detectado. Instalar o Traefik (com TLS Let's Encrypt)?"; then
    USE_TRAEFIK=1
    note "Traefik: será instalado pelo Wootrico"
  else
    USE_TRAEFIK=0
    warn "Sem Traefik: configure seu próprio proxy publicando o serviço 'app' (porta 3000) no domínio informado."
    note "Traefik: não instalado (proxy externo do usuário)"
  fi
}

# Detecta redes overlay existentes e pergunta em qual a stack deve entrar.
# Se a rede não existir, oferece criá-la (overlay, attachable). Persistida no
# .env (WOOTRICO_NETWORK) para o 'update' reutilizar.
decide_network() {
  title "Rede Docker (overlay/Swarm)"
  local overlays
  overlays="$($SUDO docker network ls --filter driver=overlay --format '{{.Name}}' 2>/dev/null | grep -vE '^(ingress|docker_gwbridge)$' || true)"
  if [ -n "$overlays" ]; then
    info "Redes overlay existentes neste Swarm:"; printf '   • %s\n' $overlays
  else
    info "Nenhuma rede overlay personalizada encontrada."
  fi
  local net_def; net_def="$(genv WOOTRICO_NETWORK)"; [ -z "$net_def" ] && net_def="${STACK_NAME}-net"
  NET_NAME="$(ask "Nome da rede Docker (overlay) para a stack" "$net_def")"
  [ -z "$NET_NAME" ] && NET_NAME="$net_def"
  if $SUDO docker network inspect "$NET_NAME" >/dev/null 2>&1; then
    ok "Usando a rede existente '${NET_NAME}'."
    note "Rede: ${NET_NAME} (existente)"
  elif confirm "A rede '${NET_NAME}' não existe. Criar (overlay, attachable)?"; then
    $SUDO docker network create --driver overlay --attachable "$NET_NAME" >/dev/null \
      && ok "Rede '${NET_NAME}' criada." || { err "Falha ao criar a rede."; exit 1; }
    note "Rede: ${NET_NAME} (criada)"
  else
    err "Uma rede é obrigatória. Abortando."; exit 1
  fi
}

# Gera o docker-compose.yml da stack (app+infra, e Traefik se aplicável) usando
# a imagem do Docker Hub e a rede escolhida (externa). Sem clonar o repositório.
write_compose() {
  title "Gerando compose (rede: ${NET_NAME}, traefik: ${USE_TRAEFIK:-1})"
  local f="docker-compose.yml"
  cat > "$f" <<'YAML'
# GERADO pelo install.sh — não edite à mão (rode o instalador novamente).
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-wootrico}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-wootrico}
      POSTGRES_DB: ${POSTGRES_DB:-wootrico}
    volumes: [pgdata:/var/lib/postgresql/data]
    networks: [wtnet]
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER:-wootrico} -d ${POSTGRES_DB:-wootrico}']
      interval: 5s
      timeout: 5s
      retries: 12
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      placement: { constraints: [node.role == manager] }

  rabbitmq:
    image: rabbitmq:3-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-wootrico}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD:-wootrico}
    volumes: [rabbitmq_data:/var/lib/rabbitmq]
    networks: [wtnet]
    healthcheck:
      test: ['CMD', 'rabbitmq-diagnostics', '-q', 'ping']
      interval: 10s
      timeout: 10s
      retries: 12
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      placement: { constraints: [node.role == manager] }

  redis:
    image: redis:7-alpine
    command: ['redis-server', '--save', '60', '1', '--appendonly', 'no']
    volumes: [redis_data:/data]
    networks: [wtnet]
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 12
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      placement: { constraints: [node.role == manager] }

  app:
    image: __IMAGE__
    env_file: .env
    command: >-
      sh -c "pnpm --filter @wootrico/db exec prisma migrate deploy &&
             node apps/panel-api/dist/server.cjs"
    networks: [wtnet]
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      labels:
        - traefik.enable=true
        - traefik.http.routers.wootrico.rule=Host(`${DOMAIN}`)
        - traefik.http.routers.wootrico.entrypoints=websecure
        - traefik.http.routers.wootrico.tls.certresolver=le
        - traefik.http.services.wootrico.loadbalancer.server.port=3000

  worker:
    image: __IMAGE__
    env_file: .env
    command: node apps/worker/dist/main.cjs
    networks: [wtnet]
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
YAML

  if [ "${USE_TRAEFIK:-1}" = 1 ]; then
    cat >> "$f" <<'YAML'

  traefik:
    image: traefik:v3
    command:
      - --providers.swarm=true
      - --providers.swarm.exposedByDefault=false
      - --providers.swarm.network=__NET__
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --certificatesresolvers.le.acme.email=${ACME_EMAIL}
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.le.acme.httpchallenge=true
      - --certificatesresolvers.le.acme.httpchallenge.entrypoint=web
    ports:
      - { target: 80, published: 80, mode: host }
      - { target: 443, published: 443, mode: host }
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_letsencrypt:/letsencrypt
    networks: [wtnet]
    deploy:
      replicas: 1
      restart_policy: { condition: any, delay: 5s }
      placement: { constraints: [node.role == manager] }
YAML
  fi

  cat >> "$f" <<'YAML'

networks:
  wtnet:
    external: true
    name: __NET__

volumes:
  pgdata:
  rabbitmq_data:
  redis_data:
YAML
  [ "${USE_TRAEFIK:-1}" = 1 ] && printf '  traefik_letsencrypt:\n' >> "$f"

  # Substitui os placeholders estruturais (imagem do Hub + rede externa).
  sed -i "s|__IMAGE__|${IMAGE}|g; s|__NET__|${NET_NAME}|g" "$f"
  ok "Compose gerado em ${PWD}/${f} (imagem ${IMAGE}, rede externa ${NET_NAME})"
}

pull_image() { title "Imagem"; $SUDO docker pull "$IMAGE"; ok "Imagem $IMAGE baixada"; note "Imagem: $IMAGE"; }
deploy_stack() {
  title "Deploy (Swarm)"
  set -a; . "./$ENV_FILE"; set +a
  $SUDO docker stack deploy --resolve-image always -c docker-compose.yml "$STACK_NAME"
  ok "Stack '$STACK_NAME' implantada"
  note "Stack: $STACK_NAME (Swarm, rede ${NET_NAME:-$(genv WOOTRICO_NETWORK)})"
}
print_summary() {
  title "Resumo"
  for line in "${SUMMARY[@]:-}"; do [ -n "$line" ] && echo "  • $line"; done
  echo; echo -e "${C_B}Serviços:${C_0}"; $SUDO docker stack services "$STACK_NAME" 2>/dev/null || true
  local DOM; DOM="${DOMAIN:-$(grep -E '^DOMAIN=' "$ENV_FILE"|cut -d= -f2-)}"
  echo; echo -e "${C_B}Acesso:${C_0} https://${DOM}  (o setup wizard cria o admin no 1º acesso)"
  echo -e "${C_Y}DNS:${C_0} confirme um registro A de '${DOM}' apontando para $(public_ip) (sem isso o domínio não abre e o TLS falha)."
  echo -e "${C_C}Webhooks (gerados por integração no painel): https://${DOM}/webhook/<token>/provider e /chatwoot${C_0}"
  echo; echo -e "${C_B}${C_Y}Chaves/segredos (guarde em local seguro):${C_0}"
  grep -E '^(DOMAIN|POSTGRES_PASSWORD|RABBITMQ_PASSWORD|JWT_SECRET|APP_ENCRYPTION_KEY|LICENSE_SERVER_URL|LICENSE_PUBLIC_KEY|LICENSE_KEY)=' "$ENV_FILE" | sed 's/^/  /'
  echo; echo -e "${C_C}Salvo em ${PWD}/${ENV_FILE} (chmod 600). Logs: docker service logs -f ${STACK_NAME}_app${C_0}"
}

# ───────────────────────────── UPDATE ─────────────────────────────
cmd_update() {
  need_root
  [ -f "$ENV_FILE" ] || { err ".env não encontrado — rode a instalação primeiro." ; exit 1; }
  title "Atualizar"
  # Reaproveita as escolhas da instalação (rede/Traefik) e regenera o compose
  # apontando para a imagem mais recente do Docker Hub. Sem git.
  USE_TRAEFIK="$(genv WOOTRICO_TRAEFIK)"; USE_TRAEFIK="${USE_TRAEFIK:-1}"
  NET_NAME="$(genv WOOTRICO_NETWORK)"; NET_NAME="${NET_NAME:-${STACK_NAME}-net}"
  write_compose
  pull_image
  deploy_stack
  ok "Atualizado."; $SUDO docker stack services "$STACK_NAME"
}

# ───────────────────────────── UNINSTALL ─────────────────────────────
cmd_uninstall() {
  need_root
  title "Desinstalar"
  warn "Isto remove a stack '$STACK_NAME'."
  $SUDO docker stack rm "$STACK_NAME" 2>/dev/null || true
  if confirm "Remover TAMBÉM os volumes de dados (APAGA Postgres/RabbitMQ/Redis)?"; then
    info "aguardando a stack encerrar…"; sleep 8
    for v in pgdata rabbitmq_data redis_data traefik_letsencrypt; do
      $SUDO docker volume rm "${STACK_NAME}_$v" >/dev/null 2>&1 && ok "volume $v removido" || true
    done
  else info "Volumes preservados."; fi
  confirm "Remover a imagem $IMAGE?" && { $SUDO docker rmi "$IMAGE" >/dev/null 2>&1 || true; ok "imagem removida"; }
  ok "Concluído. (o arquivo .env foi preservado)"
}

# ───────────────────────────── LOCAL (Docker Desktop) ─────────────────────────────
configure_env_local() {
  title "Configuração (.env local)"
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE" 2>/dev/null || true
  get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
  set_env() { local k="$1" v="$2" tmp; if grep -qE "^$k=" "$ENV_FILE"; then tmp="$(mktemp)"; grep -vE "^$k=" "$ENV_FILE" > "$tmp"; mv "$tmp" "$ENV_FILE"; fi; printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"; }
  keep_or() { local c; c="$(get_env "$1")"; [ -n "$c" ] && echo "$c" || echo "$2"; }

  local PORT_HOST PGU PGDB RBU PGP RBP JWT ENC
  PORT_HOST="$(ask "Porta do painel no host (pouco comum p/ evitar conflito)" "$(keep_or PANEL_PORT 8789)")"
  PGU="$(keep_or POSTGRES_USER wootrico)"; PGDB="$(keep_or POSTGRES_DB wootrico)"; RBU="$(keep_or RABBITMQ_USER wootrico)"
  PGP="$(keep_or POSTGRES_PASSWORD "$(openssl rand -hex 16)")"
  RBP="$(keep_or RABBITMQ_PASSWORD "$(openssl rand -hex 16)")"
  JWT="$(keep_or JWT_SECRET "$(openssl rand -base64 48 | tr -d '\n=')")"
  ENC="$(keep_or APP_ENCRYPTION_KEY "$(openssl rand -base64 32 | tr -d '\n')")"

  set_env PANEL_PORT "$PORT_HOST"
  set_env RABBITMQ_UI_PORT "$(keep_or RABBITMQ_UI_PORT 15673)"
  set_env POSTGRES_USER "$PGU"; set_env POSTGRES_PASSWORD "$PGP"; set_env POSTGRES_DB "$PGDB"
  set_env DATABASE_URL "$(keep_or DATABASE_URL "postgresql://${PGU}:${PGP}@postgres:5432/${PGDB}?schema=public")"
  set_env RABBITMQ_USER "$RBU"; set_env RABBITMQ_PASSWORD "$RBP"
  set_env RABBITMQ_URL "$(keep_or RABBITMQ_URL "amqp://${RBU}:${RBP}@rabbitmq:5672")"
  set_env REDIS_URL "$(keep_or REDIS_URL 'redis://redis:6379')"
  set_env PUBLIC_BASE_URL "http://localhost:${PORT_HOST}"
  set_env LICENSE_REQUIRED "$(keep_or LICENSE_REQUIRED false)"
  set_env LICENSE_SERVER_URL "$(keep_or LICENSE_SERVER_URL 'https://license.example.com')"
  set_env JWT_SECRET "$JWT"; set_env APP_ENCRYPTION_KEY "$ENC"
  set_env NODE_ENV "$(keep_or NODE_ENV production)"; set_env PORT "$(keep_or PORT 3000)"
  set_env HOST "$(keep_or HOST 0.0.0.0)"; set_env LOG_LEVEL "$(keep_or LOG_LEVEL info)"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  ok ".env (local) pronto"; PANEL_PORT_OUT="$PORT_HOST"
}

cmd_local() {
  title "Modo LOCAL (Docker Desktop · Compose puro · sem Swarm)"
  command -v docker >/dev/null 2>&1 || { err "Docker não encontrado. Instale o Docker Desktop."; exit 1; }
  docker compose version >/dev/null 2>&1 || { err "Plugin 'docker compose' ausente (atualize o Docker)."; exit 1; }

  if [ ! -f docker-compose.local.yml ]; then
    local repo; repo="$(ask "URL do repositório git" "$REPO_URL_DEFAULT")"
    git clone "$repo" wootrico-v2 && cd wootrico-v2 && ok "clonado em $(pwd)"
  fi

  configure_env_local

  title "Subindo a stack local"
  set -a; . "./$ENV_FILE"; set +a
  docker compose -f docker-compose.local.yml up -d

  title "Resumo"
  echo -e "Painel:      ${C_B}http://localhost:${PANEL_PORT_OUT}${C_0}"
  echo -e "RabbitMQ UI: http://localhost:$(grep -E '^RABBITMQ_UI_PORT=' "$ENV_FILE" | cut -d= -f2-)"
  echo -e "\n${C_Y}Chaves (guarde em local seguro):${C_0}"
  grep -E '^(POSTGRES_PASSWORD|RABBITMQ_PASSWORD|JWT_SECRET|APP_ENCRYPTION_KEY|PANEL_PORT)=' "$ENV_FILE" | sed 's/^/  /'
  echo -e "\n${C_C}Parar:  docker compose -f docker-compose.local.yml down${C_0}"
  echo -e "${C_C}Logs:   docker compose -f docker-compose.local.yml logs -f app${C_0}"
}

case "${1:-install}" in
  install) cmd_install ;;
  update) cmd_update ;;
  uninstall) cmd_uninstall ;;
  local) cmd_local ;;
  *) echo "uso: install.sh [install|update|uninstall|local]"; exit 1 ;;
esac
