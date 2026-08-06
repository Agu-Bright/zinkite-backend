# VTpass deployment setup

Set these secrets on the backend deployment (never in the mobile or admin apps):

```text
VTPASS_API_KEY=...
VTPASS_PUBLIC_KEY=PK_...
VTPASS_SECRET_KEY=SK_...
VTPASS_BASE_URL=https://sandbox.vtpass.com/api
VTPASS_TIMEOUT_MS=30000
```

Use `https://vtpass.com/api` only after sandbox airtime, data, electricity, TV,
pending/requery and refund scenarios have passed. In the VTpass dashboard set
the callback URL to:

```text
https://<backend-host>/vtu/webhook
```

The callback does not directly alter a wallet or transaction. It triggers a
server-authenticated `/requery`, preventing a forged callback from marking a
payment successful or causing a refund.

Operational checks before production:

1. Confirm the VTpass wallet is funded and live API keys are active.
2. Confirm MongoDB supports transactions (replica set / Atlas deployment).
3. Run successful, explicit-failure, timeout and delayed-success tests.
4. Confirm the five-minute reconciliation job resolves pending payments.
5. Confirm the admin role has `vtu.view`, `vtu.retry`, and only trusted finance
   roles have `vtu.refund`.
