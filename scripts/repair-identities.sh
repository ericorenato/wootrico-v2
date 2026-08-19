#!/usr/bin/env bash
# Diagnostica (e opcionalmente zera) o diretório GLOBAL de identidades.
#
# Um bug do parser da uazapi entregava ao resolveIdentity o LID do DONO DA CONTA
# pareado com o telefone do CONTATO em toda mensagem enviada pelo celular. O
# resolveIdentity lê isso como "mesma pessoa vista duas vezes" e funde as linhas
# — então cada contato respondido pelo celular foi absorvido numa única
# identidade. No Chatwoot isso aparece como conversas misturadas, nomes trocados
# e a sua foto em vários contatos.
#
# A fusão é destrutiva: as linhas absorvidas não existem mais, não há como
# desfundir. O diretório é um CACHE reconstruído pelo tráfego, então o reparo é
# zerá-lo e deixar encher de novo com dados corretos.
#
# RODE NA VPS, como root, DEPOIS de já ter atualizado a imagem (wootrico update).
#   bash repair-identities.sh            # só o relatório
#   bash repair-identities.sh --reset    # apaga o diretório + caches do Redis
set -euo pipefail

STACK="${WOOTRICO_STACK:-wootrico}"
RESET=0
[ "${1:-}" = "--reset" ] && RESET=1

cid() { docker ps -q -f "name=${STACK}_$1" | head -n1; }
PG="$(cid postgres)"; RD="$(cid redis)"
[ -n "$PG" ] || { echo "container ${STACK}_postgres não encontrado"; exit 1; }
[ -n "$RD" ] || { echo "container ${STACK}_redis não encontrado"; exit 1; }

# Usuário/base vêm do próprio container (o compose os injeta a partir do .env).
PGU="$(docker exec "$PG" printenv POSTGRES_USER)"
PGD="$(docker exec "$PG" printenv POSTGRES_DB)"
psql() { docker exec -i "$PG" psql -U "$PGU" -d "$PGD" -At -c "$1"; }

echo "== diagnóstico =="
echo "identidades................... $(psql 'SELECT count(*) FROM contact_identities')"
echo "  pareadas (pn + lid)......... $(psql 'SELECT count(*) FROM contact_identities WHERE pn IS NOT NULL AND lid IS NOT NULL')"
# Um LID é um id de roteamento de 15+ dígitos, não um número discável. Um LID na
# coluna pn significa que um JID @lid foi lido como telefone.
echo "  LID gravado como telefone... $(psql "SELECT count(*) FROM contact_identities WHERE length(regexp_replace(pn,'\D','','g')) > 15")"
# A mesma foto de perfil em várias identidades é a assinatura da fusão: a sua
# foto copiada para todo mundo que você respondeu pelo celular.
echo "  fotos repetidas entre pessoas $(psql "SELECT coalesce(count(*),0) FROM (SELECT 1 FROM contact_identities WHERE avatar_url IS NOT NULL GROUP BY split_part(avatar_url,'?',1) HAVING count(*) > 1) x")"

if [ "$RESET" != 1 ]; then
  echo; echo "somente relatório — rode com --reset para limpar."
  exit 0
fi

echo; echo "== reparo =="
# contact_avatars cai junto (ON DELETE CASCADE).
psql 'DELETE FROM contact_identities' | sed 's/^/identidades apagadas: /'
# O id do contato no Chatwoot, o nome e o avatar são memoizados por chave
# canônica; essas chaves ficaram obsoletas, então derruba e deixa a próxima
# mensagem resolver de novo.
docker exec "$RD" sh -c 'redis-cli --scan --pattern "cw:*" | xargs -r redis-cli DEL' \
  | tail -n1 | sed 's/^/chaves de cache removidas: /'
echo "pronto."
