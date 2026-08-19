#!/usr/bin/env bash
# Mostra o que ENTROU (webhooks recebidos) e o que SAIU (mensagens espelhadas no
# Chatwoot) numa janela de tempo. Serve para separar dois cenários que parecem
# iguais de fora:
#
#   - webhook não chega        -> nada em "webhooks recebidos" com source=provider
#     (a uazapi não está mandando o evento; tipicamente o webhook da instância não
#      está configurado para entregar mensagens fromMe)
#   - webhook chega e é espelhado -> aparece em ambos, e o problema é de ROTEAMENTO
#     (a mensagem foi para a conversa de outro contato)
#
#   bash diag-flow.sh        # última 1 hora
#   bash diag-flow.sh 6      # últimas 6 horas
set -euo pipefail

STACK="${WOOTRICO_STACK:-wootrico}"
HOURS="${1:-1}"

C="$(docker ps -q -f "name=${STACK}_app" -f "name=${STACK}_worker" | head -n1)"
[ -n "$C" ] || { echo "nenhum container ${STACK}_app/${STACK}_worker rodando"; exit 1; }
echo "usando container: $(docker inspect --format '{{.Name}}' "$C" | sed 's#^/##')"
echo "janela: últimas ${HOURS}h"
echo

docker exec -i -e DIAG_HOURS="$HOURS" "$C" node <<'JS'
const { PrismaClient } = require('/app/packages/db/node_modules/@prisma/client');
const prisma = new PrismaClient();
const H = Number(process.env.DIAG_HOURS || 1);

const table = (rows, cols) => {
  if (!rows.length) return console.log('  (nenhum registro)');
  for (const r of rows) console.log('  ' + cols.map((c) => String(r[c] ?? '-')).join(' | '));
};

(async () => {
  console.log('== webhooks recebidos (source | evento | aceito | motivo | qtd) ==');
  table(
    await prisma.$queryRawUnsafe(`
      SELECT source::text, coalesce(event_type,'-') AS event_type, accepted,
             coalesce(reason,'-') AS reason, count(*)::int AS qtd
      FROM webhook_events
      WHERE received_at > now() - interval '${H} hours'
      GROUP BY 1,2,3,4 ORDER BY qtd DESC`),
    ['source', 'event_type', 'accepted', 'reason', 'qtd'],
  );

  console.log('\n== mensagens espelhadas (direção | tipo | kind | grupo | qtd) ==');
  table(
    await prisma.$queryRawUnsafe(`
      SELECT direction::text, message_type::text, kind, is_group, count(*)::int AS qtd
      FROM message_logs
      WHERE created_at > now() - interval '${H} hours'
      GROUP BY 1,2,3,4 ORDER BY qtd DESC`),
    ['direction', 'message_type', 'kind', 'is_group', 'qtd'],
  );

  // Quantos contatos/conversas distintos o wootrico está enxergando agora. Se as
  // conversas estavam misturadas, o esperado depois do reset é este número voltar
  // a crescer na proporção dos contatos reais.
  const [ident] = await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM contact_identities');
  const [peers] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM conversation_logs WHERE updated_at > now() - interval '${H} hours'`,
  ).catch(() => [{ n: null }]);
  console.log(`\nidentidades no diretório: ${ident.n}`);
  if (peers.n !== null) console.log(`conversas tocadas na janela: ${peers.n}`);

  await prisma.$disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
JS
