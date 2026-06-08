# Reconciliation And LINE Presets

## Internal Reconciliation

Use this after a notification rule has already run. The command reads persisted
notification runs and report snapshots only. It must not query SML or send LINE.

```bash
corepack pnpm --filter @ai-bcc/api reconcile:notification-run -- \
  --rule-id notification_rule_tenant_demo_remote_morning_brief_digest
```

For one scheduled round:

```bash
corepack pnpm --filter @ai-bcc/api reconcile:notification-run -- \
  --tenant-id tenant_demo_remote \
  --scheduled-date 2026-06-08 \
  --scheduled-time 18:30
```

Optional expected metrics from reviewed SML exports:

```json
{
  "reports": {
    "sales_goods_services": {
      "bill_count": 245,
      "line_count": 704,
      "total_sales": 5596407.59
    }
  }
}
```

Money tolerance is the larger of `1` baht or `0.01%`. Margin tolerance is
`0.01` percentage point. Missing expected metrics are warnings, not automatic
failures.

## LINE Presets

Presets are UI helpers over the existing `report_keys` field. They do not add a
new DB column.

- `executive_full`: all 8 reports
- `executive_focus`: sales, product gross profit, stock balance, AR receipt
- `sales_profit`: sales and both gross-profit reports
- `inventory`: stock balance, stock reorder, purchase
- `finance_ar`: purchase, AR movement, AR receipt

To apply the rollout preset to the two pilot rules:

```bash
corepack pnpm --filter @ai-bcc/api notification-preset:apply -- --dry-run
corepack pnpm --filter @ai-bcc/api notification-preset:apply -- --preset executive_full
```

The update command appends an audit log with old and new report keys.
