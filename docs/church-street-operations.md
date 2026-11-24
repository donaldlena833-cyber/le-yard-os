# Church Street Operations

Church Street is a counter-service organization in Le Yard OS. Its organization, location, memberships, jobs, employee records, and operational data have their own IDs. Provisioning starts the organization suspended and the location inactive. It assigns only the approved existing Auth accounts and never sends invitations or copies restaurant records. The initial All Staff and Management channels are empty.

## Provision and activate

1. Apply the Church Street migration and deploy the compatible application to an isolated environment first.
2. Prepare a private configuration file. Use the exact project origin and approved Auth user IDs. The only supported job codes are `COUNTER`, `BARISTA`, `PREP`, and `SHIFT_LEAD`. A job code is optional. At least one member must have the owner role.

   ```json
   {
     "supabaseUrl": "https://approved-project.supabase.co",
     "members": [
       {
         "user_id": "00000000-0000-4000-8000-000000000001",
         "role": "owner"
       }
     ]
   }
   ```

3. Run `npm run church-street -- provision --config <private-file>` to review the target and roster offline. Set `SUPABASE_URL` to the same origin and load its `SUPABASE_SERVICE_ROLE_KEY` from the approved secret source. Run the same command with `--execute` to provision. A retry with the same roster returns the original IDs. Change the roster through normal tenant administration after provisioning.
4. For activation, use a private file containing `supabaseUrl` and the returned `organizationId`. Run `npm run church-street -- activate --config <private-file>` for the dry run, then add `--execute` after pilot approval. Confirm that single-tenant accounts see only their own workspace and dual members can switch on the Operations site.
5. Use the `suspend` action with the activation config if the pilot must stop. Suspension hides the workspace and blocks scoped database access while retaining its records and memberships. Repeating either lifecycle command is safe.

Restaurant booking, communications, and provider credentials continue to use the 858 9th Ave configuration. Start Church Street with manual closeout. Validate any new Church Street integration independently before enabling it.

For the hosted rollout, prepare compatible builds of Operations, Host, and Phone together. They share a database and each health endpoint checks the migration head. Verify the current schema and backup before applying the migration, promote the three builds together, and check all three health endpoints and the Ninth Avenue Reserve flow before activating the Church Street pilot. If the pilot needs to stop, suspend the tenant first so the current builds and migration can stay in place while preserving the pilot records.

## Marketplace order evidence

In **Today → Check an exact Square order**, use the full Square ID. Once Operations has the same Square revision, a manager with Church Street financial and Manager Log access can record a marketplace link from the merchant order details or a payout statement. Compare the full Square order to the correct marketplace storefront and order before saving. Start with the DoorDash marketplace order UUID and store ID. Use the Uber Eats Workflow ID from Payment Details and the full Grubhub order UUID.

Paste the exact store and order IDs. If only a short display code is available, keep the link pending. On a later statement, enter the same two IDs again to record that the team matched the order on the statement. Operations keeps the original entry and shows only ID suffixes on the order check. If either order already belongs to another link, leave the conflict for a manager to resolve. Compare payout totals with the provider and the bank separately.
