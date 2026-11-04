---
description: Regenerate the whole design mapping (agent-map + per-screen packs + search index) in one call and report the diff
---

# /design-map

O comando `design-map` regenera TODO o mapeamento do projeto alvo numa
chamada só e reporta o diff. Todo artefato é derivado dos arquivos do alvo —
nunca edite à mão um arquivo gerado (é exatamente esse drift que o mapa
existe para pegar). Alvo: $ARGUMENTS (padrão `design/`).

1. Mapa: rode `node skills/design/scripts/agent-map.mjs --target <alvo>` →
   grava `<alvo>/agent-map.json` + `<alvo>/agent-map.md` (inventário por
   tela, verbos do runtime derivados de mock.js, índice de contratos,
   contratos mortos).
2. Verificação de sincronia: rode `node skills/design/scripts/agent-map.mjs
   --check-verbs --target <alvo>` — precisa dar exit 0 (tabela de verbos ×
   código-fonte de mock.js).
3. Pacotes por tela (todo 7): para cada tela do alvo, rode
   `node skills/design/scripts/agent-map.mjs --target <alvo> --screen <tela> --pack`
   → grava `<alvo>/.map/<tela>.md` com TUDO sobre a tela em um arquivo
   (elementos, ações × módulos, componentes, ícones, tokens, DEC,
   comentários 🎯, baselines/smoke e contratos mortos da tela).
4. Índice de busca (quando o índice do find existir — plan todo 8): atualize
   `<alvo>/.map/index.json`.
5. Relatório de diff: liste o que mudou por tela (contentHash antes/depois),
   cite todo contrato morto novo ou removido com arquivo:linha e mostre
   `git diff --stat` dos arquivos de mapeamento. Nada fora do mapeamento
   pode mudar nesta chamada.

Contrato de determinismo: bytes do alvo inalterados → bytes do mapa
inalterados. O carimbo ({schemaVersion, gitSHA, contentHash, timestamp}) é
derivado do estado do alvo, então duas execuções consecutivas produzem
arquivos byte a byte idênticos.
