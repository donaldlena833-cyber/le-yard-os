# Square stock counts at Church Street

Operations → Inventory shows Square stock counts to assigned Church Street managers and staff with the inventory count capability. An owner or admin selects eligible Square variations to show on the count screen. Use this for sellable, physically countable units such as a short run of prepared sandwiches or packaged items. Ingredient counts belong in Operations inventory.

## Connect the café

1. Create the café application in the Square Developer Console and verify its production merchant and active location. The adapter verifies the exact merchant, Square location, address at 140 Church Street, New York 10007, USD, and the New York time zone. Use the café's own credential. A scoped OAuth token needs `MERCHANT_PROFILE_READ`, `ITEMS_READ`, `INVENTORY_READ`, and `INVENTORY_WRITE`. Plan for credential rotation. Store it in the Operations production project as `SQUARE_CHURCH_ACCESS_TOKEN`, with server-only `SQUARE_CHURCH_MERCHANT_ID` and `SQUARE_CHURCH_LOCATION_ID`.
2. Follow the shared schema release process for Operations, Host, and Phone. Enable `LE_YARD_CHURCH_SQUARE_COUNTS_ENABLED=true` only on Operations Production when the stock pilot starts.
3. Start with one item. The manager or chef physically counts the units. In Square’s item editor at Le Yard Cafe, switch the item to **Track by stock count** and initialize it using that observation. Square can mark an item sold out when tracking starts without stock. In Operations → Church Street → Inventory → Square stock counts, the owner selects **Find tracked items in Square** and adds that variation.
4. Have a manager and an appropriately authorized chef each take a fresh count and verify the saved count in Square inventory history. Compare POS availability, and separately check any connected customer storefront. For an actual zero, verify sold-out behavior, then repeat with an actual restock. Use Sandbox or a controlled test item to exercise zero and restore before doing so with a live item.

## Turn on Square events and live stock alerts

In the Square production developer application, create a webhook subscription with the exact URL `https://operations.leyardny.com/api/integrations/square/webhook` and API version `2026-09-16`. The receiver verifies the signature using the registered URL and original request bytes. Save the subscription signature key as `SQUARE_CHURCH_WEBHOOK_SIGNATURE_KEY` in Operations Production and enable `LE_YARD_CHURCH_SQUARE_WEBHOOK_ENABLED=true` after the database migration is applied. The configured Church merchant and location IDs must match the Square account in the subscription.

- For stock alerts, subscribe to `inventory.count.updated`. Add an eligible Church Street tracked item to Operations so an incoming count maps to a known item. Operations raises an alert when the latest count reaches five units or fewer, keeps the alert active while it is low, and clears it when stock goes above five. A repeat drop opens a fresh alert.
- For the Square event health feed, subscribe to `order.created`, `order.updated`, `payment.created`, `payment.updated`, `refund.created`, `refund.updated`, `invoice.published`, `invoice.updated`, `invoice.payment_made`, `invoice.refunded`, and `invoice.canceled`. The feed shows receipt types and times. Order detail, channel attribution, and money totals need an authenticated Square API read and periodic reconciliation. Square's `order.created` event covers API-created orders only.

Verify using the dedicated `LY-OPS-STOCK-TEST` fixture. Change its count from above five to five and confirm the receipt, alert, and quantity in Operations. Repeat with four, restock above five, then lower it again to confirm rearming. Restore the agreed test quantity at the end. Check the webhook delivery log for 2xx acknowledgments and confirm there are no repeat alert popups while a single alert stays active. Square retries unsuccessful deliveries for up to 24 hours.

[Square webhook signatures](https://developer.squareup.com/docs/webhooks/step3validate) · [Square webhook retries](https://developer.squareup.com/docs/webhooks/overview) · [Square POS order event coverage](https://developer.squareup.com/reference/square/orders-api/webhooks/order.created)

For a production rehearsal, Operations can optionally display the stock-only Square item whose exact variation ID is configured in `SQUARE_CHURCH_TEST_VARIATION_ID`. The item must have SKU `LY-OPS-STOCK-TEST`, be tracked at the café, and be explicitly non-sellable. The café's dedicated test item is excluded from customer menus. Leave this setting empty on deployments that don't need a rehearsal.

## During service

Enter the whole number of units currently on hand and a short reason. Square applies a physical count in order of observation and may report a different current quantity if sales have occurred since the count. Operations shows a confirmed result after it finds the matching Square history entry and reads current in-stock quantity.

If an import stalls, select **Check pending count**. Operations keeps the same request ID and observed time, serializes attempts to send it, and uses the same Square idempotency key. After 24 hours it only checks Square history. If it still cannot confirm, use Square inventory history and the Square POS as the operational fallback, and ask an owner to review the unresolved record. Temporarily unavailable dishes and modifiers use Square’s native availability controls. A zero physical count means zero sellable units were actually counted.

[Square batch inventory changes](https://developer.squareup.com/reference/square/inventory-api/batch-change-inventory) · [Physical counts](https://developer.squareup.com/reference/square/objects/InventoryPhysicalCount) · [Square availability controls](https://squareup.com/help/us/en/article/8495-beta-item-availability)
