# Paridade D8 — protótipo (mock) vs frontend real (chat_bot_ia)

Checklist de paridade do D8 (`spec/parity.md`, todo 23) conferido contra os
componentes reais inspecionados somente-leitura em
`/opt/chat_bot_ia/frontend/src/components/chat/` (§A6). Origem do lado mock:
registry `components/components.json` (realComponent/dataProps — saída do
export-spec, todo 18) + módulos do corpus do cliente (§A5/§A8 de
`.omo/05-melhorias-sistema.md`).

- ordem das linhas: alfabética pelo componente real (estável, sem timestamps).
- coluna "real" cita o arquivo REAL inspecionado + linha da definição
  (`export default function ...`).
- status:
  - `coberto` — contraparte mock declarada no registry cobre as regiões
    principais do componente real (D8 itens 1-2 mapeáveis).
  - `parcial` — contraparte mock existe, mas parte da superfície real
    (regiões/estados/props) não tem contraparte declarada.
  - `gap-cliente` — sem contraparte mock para a superfície principal do
    componente real: lacuna de escopo do corpus/protótipo do cliente,
    **nunca falha do repo** (toolchain/codegen/registry).

| componente mock | componente real (arquivo:linha) | status | cobertura inspecionada |
| --- | --- | --- | --- |
| `bubble` + `field` + `button` (registry; módulos `conversas`/`composer`/`mensagens`, §A5) | `/opt/chat_bot_ia/frontend/src/components/chat/ChatWindow.tsx:100` (`ChatWindow`) | parcial | primitivas declaradas cobrem lista de mensagens (`bubble`: tone in/out, slots content/meta) e composer (`field` + `button`); a janela composta (transferência, copilot, mídia, templates, quick replies, modais) não tem componente mock declarado |
| `card` + `field` + `chip` (registry; módulo `CONTATOS`, §A8) | `/opt/chat_bot_ia/frontend/src/components/chat/ContactPanel.tsx:81` (`ContactPanel`) | parcial | dados/notas/tags cobertos por primitivas declaradas (`card`: slots title/body; `chip`: state selected); galeria de mídia, campos custom, autosave e escopo admin sem contraparte declarada |
| nenhum (registry sem entrada de painel de tickets; `TICKETS` só como dado embutido, §A8) | `/opt/chat_bot_ia/frontend/src/components/chat/ConversationTicketPanel.tsx:111` (`ConversationTicketPanel`) | gap-cliente | detalhe de ticket + navegação entre tickets + histórico (`MsgBubble` em ConversationTicketPanel.tsx:65, `TicketDivider` em :93) sem contraparte mock no corpus — lacuna de escopo do cliente |
| `tabs` + `chip` (registry; entradas criadas como alvo de paridade para `InboxTabs`, §11.5) | `/opt/chat_bot_ia/frontend/src/components/chat/InboxTabs.tsx:15` (`InboxTabs`) | coberto | barra de abas (`tabs`: slots tabs/panel) + filtros por tag (`chip`): as duas regiões do componente têm contraparte declarada 1:1; badges de contadores/unread e polling de 15s são detalhe do real sem attr mock (nota D8 item 1) |

Observações D8:

- Linhas `gap-cliente` são lacunas do corpus do cliente — não abrem issue no
  repo e não contam como falha de aceitação (critério (c) do todo 23).
- D8 item 6 (interação/e2e contra o frontend real): fase posterior — fora do
  escopo deste checklist (MUST NOT do todo 23).
- D8 item 3 (breakpoints 900/640 do protótipo vs Tailwind do real): mapeamento
  ainda não existe (apontado como lacuna global; não é item por componente).
