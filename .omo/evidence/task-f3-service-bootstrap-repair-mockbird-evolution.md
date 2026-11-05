# F3 service bootstrap repair
- `node --test skills/design/assets/auth.test.mjs`: pass, including missing-password rejection and scrypt-hash storage.
- `MOCKBIRD_ADMIN_PASSWORD=... node serve.mjs --service --data <tmp> --create-admin admin@example.com`: exit 0; users.json inspected and contains `scrypt$...`, never plaintext.
- Real HTTP probe `/api/login`: 200 authenticated with admin role and CSRF token.
- `npm run ci`: exit 0.
