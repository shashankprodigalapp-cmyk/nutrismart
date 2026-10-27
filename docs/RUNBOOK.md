# Runbook: when something looks wrong

First look: Admin, Platform 2.0, Overview (health lines), then AI usage and Audit log.

| Symptom | Likely cause | What to do |
|---|---|---|
| Overview says AI calls are failing | Gemini quota or key problem | Admin, Free tier shows model limits. If a model is red, wait for reset (Pacific midnight) or enable paid Gemini with a spend cap. Reviews fall back to plain rule wording automatically; nothing breaks. |
| "Nudges waiting more than 24 hours" | Hourly job is not running | GitHub, Actions, "Cron". Check the `nudges` job ran; check the repository secret CRON_SECRET matches Cloudflare. Run it by hand with "Run workflow". |
| Notifications failing | People revoked permission, or push keys changed | Failed counts rise slowly with revoked devices: normal. A sudden jump: check the VAPID keys in Cloudflare. |
| "Reviews waiting for coaches" growing | Coaches not approving | Nothing is shown to clients until approved when a coach is linked. Ask coaches, or switch v2_ai_reviews off. |
| A page shows "not installed yet, run migration NNN" | A migration was not run | Run that file in the Supabase SQL Editor (they are safe to run twice). |
| Someone cannot accept a coach invite | Invite expired (14 days), already used, or coach is at a client cap | Coach sends a new invite. Check Admin, Plans for a cap. |
| Someone says a coach sees too much | Sharing scope | Client can change what the coach sees, or end the link, on the "My coach" page (Profile, My coach). Audit log shows every coach action. |
| A person asks to delete or download their data | Both are in Profile | Delete removes everything; download covers 35 tables. |
| Admin page says "not an admin" | Signed in with another account | Sign in with the admin account. |
| Pro user lost Pro | Expired or payment rejected | Admin, Users: gift or activate. |
| Something wrong after a deploy | Bad build | Cloudflare Pages, Deployments, Rollback. See RELEASE_2_0.md. |

## Weekly check (10 minutes)
Overview health; AI usage errors; Coaches waiting for approval; Feature use (are people using what you switched on); Free tier screen for database size.

## Secrets (Cloudflare Pages settings and GitHub secrets)
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET, RAZORPAY_WEBHOOK_SECRET. Never paste them into chat or code. If one leaks, rotate it at the provider and update both places.
