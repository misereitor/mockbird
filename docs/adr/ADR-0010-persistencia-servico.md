# ADR-0010 — Persistência do serviço

O modo serviço usa stores JSON versionados, gravados por rename atômico, com backup diário em `.backups` e retenção de sete conjuntos. O restore valida JSON antes de substituir os stores. Acima de aproximadamente 50 usuários, migrar para SQLite; essa migração está fora do escopo atual.
