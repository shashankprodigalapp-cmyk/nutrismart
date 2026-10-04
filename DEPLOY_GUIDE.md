# NutriSmart — Complete Deployment Guide
### For Non-Technical Founders · Step-by-Step · No Assumptions

This guide takes you from zero to a live app. Every click, every field, every copy-paste is spelled out. You need four things before you start:

- A laptop (Windows or Mac — both work)
- Your email address
- About 2–3 hours of uninterrupted time
- The file: `nutrismart-final-audited.zip` (already in your Downloads)

---

## BEFORE ANYTHING ELSE — Create Your Four Accounts

Create all four accounts first so the credentials are ready when you need them.

---

### Account 1: GitHub (your code's home)
1. Open a browser, go to **github.com**
2. Click **Sign up** (top right)
3. Enter your email, create a password, choose a username (e.g. `shashank-nutrismart`)
4. Verify your email — they'll send a 6-digit code
5. Done with GitHub for now

---

### Account 2: Supabase (your database)
1. Go to **supabase.com**
2. Click **Start your project**
3. Click **Continue with GitHub** — sign in with the GitHub account you just made
4. Done with Supabase for now

---

### Account 3: Netlify (publishes your app online)
1. Go to **netlify.com**
2. Click **Sign up**
3. Click **Sign up with GitHub**
4. Done with Netlify for now

---

### Account 4: Google AI Studio (for Gemini food search AI)
1. Go to **aistudio.google.com**
2. Sign in with any Google account you have
3. Done for now — you will come back to get a key in Step 3

---

## STEP 1 — Put Your Code on GitHub

GitHub is a safe online locker for your code. Netlify reads from it automatically whenever something changes.

### 1A — Unzip the project folder
1. Find `nutrismart-final-audited.zip` in your Downloads folder
2. **Windows:** right-click it → **Extract All** → click **Extract**
3. **Mac:** just double-click it
4. A folder called `nutrismart` will appear — move it to your Desktop so it's easy to find

### 1B — Create a repository on GitHub
1. Go to **github.com** and sign in
2. Click the **+** icon (top right corner) → **New repository**
3. Fill in:
   - **Repository name:** `nutrismart`
   - **Description:** `NutriSmart nutrition tracking app`
   - Select **Private**
   - Leave all checkboxes unticked
4. Click the green **Create repository** button

### 1C — Upload your files
1. On the next page, look for the text "uploading an existing file" and click it
2. Open your `nutrismart` folder on your Desktop
3. Press **Ctrl+A** (Windows) or **Cmd+A** (Mac) to select everything inside the folder
4. Drag the selected files into the GitHub upload box in your browser
5. Wait for all files to finish uploading (progress bars will appear)
6. Scroll down on the GitHub page
7. In the box that says "Add files via upload", type: `Initial commit`
8. Click the green **Commit changes** button
9. Wait 1–2 minutes for the upload to complete

**✅ Check:** You should now see a list of files and folders on your GitHub page, including folders named `src`, `netlify`, `supabase`, and a file called `package.json`. If you see them, this step is done.

---

## STEP 2 — Set Up Your Database (Supabase)

Supabase is where all your user data lives — food logs, accounts, payments, everything. This step builds the entire database structure.

### 2A — Create a new project
1. Go to **supabase.com** and sign in
2. Click **New project**
3. Fill in:
   - **Name:** `nutrismart`
   - **Database Password:** Make a strong password and save it immediately — in your notes app, a password manager, anywhere. You will need it later.
   - **Region:** Select **South Asia (Mumbai ap-south-1)** — closest to your users
4. Click **Create new project**
5. Wait 3–4 minutes. You'll see a loading animation. Don't close the tab.

### 2B — Enable three required extensions
Your database needs three features turned on. Think of these like plugins.

1. In the left sidebar (the vertical menu on the left), click **Database**
2. Click **Extensions** (submenu appears)
3. In the search box, type `vector`
   - Find `vector` in the results
   - Click the grey toggle next to it to turn it **ON** (it turns green)
4. Clear the search box, type `pg_trgm`
   - If there is a toggle, turn it ON. If it already shows as enabled, leave it.
5. Clear the search box, type `pg_cron`
   - Click the toggle to turn it **ON**

### 2C — Create the photo storage bucket
This is where payment screenshots and meal photos will be stored securely.

1. In the left sidebar, click **Storage**
2. Click **New bucket**
3. Fill in:
   - **Name:** `meal-photos` ← type this exactly, lowercase, with a hyphen
   - **Public bucket toggle:** make sure it is **OFF** (grey, not green)
4. Click **Create bucket**
5. You'll see `meal-photos` appear in the list on the left
6. Click on `meal-photos`
7. Click the **Configuration** tab
8. Find **File size limit** — type `5` and make sure the unit says `MB`
9. Click **Save**

### 2D — Run the 9 database migrations

This is the most important part of the setup. Migrations are instruction files that build your database — all the tables, rules, and security. You run them one at a time in a specific order.

1. In the left sidebar, click **SQL Editor**
2. You'll see a large empty white/grey text area — this is where you paste and run code

**Here is the process you will repeat 9 times:**

> 1. Open the migration file on your computer (in Notepad or TextEdit)
> 2. Select all the text (Ctrl+A or Cmd+A)
> 3. Copy it (Ctrl+C or Cmd+C)
> 4. Click inside the Supabase SQL Editor text area
> 5. Paste (Ctrl+V or Cmd+V)
> 6. Click the green **Run** button (or press Ctrl+Enter / Cmd+Enter)
> 7. Wait for the green "Success" confirmation at the bottom
> 8. **Select all the text in the editor and delete it** before the next migration

The migration files are in your `nutrismart` folder → `supabase` → `migrations`. Run them in this exact order:

| # | File to run | What it does |
|---|-------------|--------------|
| 1 | `001_initial_schema.sql` | Creates all database tables |
| 2 | `002_rls_policies.sql` | Adds security rules |
| 3 | `003_admin_cms_rpc.sql` | Sets up food database management |
| 4 | `004_upi_gifted_ai_limits.sql` | Sets up AI limits and gifting |
| 5 | `005_payment_submissions.sql` | Sets up payment processing |
| 6 | `006_vector_cache.sql` | Sets up AI search caching |
| 7 | `007_provisional_pro.sql` | Sets up instant Pro access |
| 8 | `008_growth_optimization.sql` | Sets up analytics and retention |
| 9 | `009_community_gamification.sql` | Sets up community features |

**If migration 009 gives an error mentioning `pg_cron`:**
1. Go back to **Database → Extensions**, find `pg_cron`, make sure it's enabled
2. Then in the SQL editor, paste ONLY this one line and click Run:
```sql
SELECT cron.schedule('refresh-community-stats','30 19 * * *',$$REFRESH MATERIALIZED VIEW CONCURRENTLY public.daily_community_stats$$);
```

**✅ Check:** After all 9 migrations, click **Table Editor** in the left sidebar. You should see a long list of tables including `users`, `daily_logs`, `master_foods`, `subscriptions`, `payment_submissions`. If you see them, the database is built correctly.

### 2E — Copy your Supabase keys

You need three values from Supabase. Open a Notepad or notes file and copy them there.

1. In the left sidebar, click the **Settings** icon (looks like a gear ⚙️) at the very bottom
2. Click **API** in the submenu
3. Copy and save these — label them clearly:

   **Value 1 — Project URL:**
   Looks like: `https://abcdefghijkl.supabase.co`
   Label it: `SUPABASE_URL`

   **Value 2 — anon / public key:**
   A very long string starting with `eyJ`
   Label it: `SUPABASE_ANON_KEY`

4. Scroll down the same page to the **Service Role** section
5. Click **Reveal** next to the service role key

   **Value 3 — service_role key:**
   Another very long string starting with `eyJ`
   Label it: `SUPABASE_SERVICE_ROLE_KEY`
   ⚠️ This one is SECRET — never share it, never put it in a public place

---

## STEP 3 — Collect Your API Keys

API keys are passwords that let your app talk to AI services. You need three.

### 3A — Gemini API Key (food search and photo recognition)
1. Go to **aistudio.google.com**
2. Click **Get API key** (top left area)
3. Click **Create API key in new project**
4. A key will appear — it starts with `AIzaSy`
5. Copy and save it, label it: `GEMINI_API_KEY`

### 3B — Claude API Key (Hinglish understanding)
1. Go to **console.anthropic.com**
2. Sign up with your email if you don't have an account
3. Click **API Keys** in the left menu
4. Click **Create Key**
5. Name it `nutrismart`
6. Copy the key — it starts with `sk-ant-api03-`
7. Save it, label it: `CLAUDE_API_KEY`
   ⚠️ This key only shows ONCE — copy it immediately

### 3C — VAPID Keys (for push notifications)
VAPID keys let NutriSmart send Morning Verdict notifications to phones. You generate them yourself for free.

1. Go to **vapidkeys.com**
2. Click **Generate VAPID Keys**
3. Two keys will appear. Copy and save both:
   - The long string starting with `B` → label it: `VAPID_PUBLIC_KEY`
   - The other long string → label it: `VAPID_PRIVATE_KEY`

### 3D — Create your own Cron Secret
This is a password you make up. It protects your scheduled notification jobs.

1. Make up any combination of letters and numbers, like: `NutriSmart2026Launch`
2. Write it down. Label it: `CRON_SECRET`
3. It can be anything — just remember it and don't share it publicly

---

## STEP 4 — Deploy on Netlify

Netlify is the service that takes your code from GitHub and turns it into a live website anyone can visit.

### 4A — Connect GitHub to Netlify
1. Go to **netlify.com** and sign in
2. Click **Add new site** → **Import an existing project**
3. Click **GitHub**
4. A popup will appear asking for permission — click **Authorize Netlify**
5. You'll see a list of your repositories — click **nutrismart**
6. Netlify will auto-detect settings. Confirm they show:
   - **Branch to deploy:** `main`
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
7. Click **Deploy nutrismart**

The first deploy will fail — that's expected because you haven't added the environment variables yet. Don't worry.

### 4B — Add all environment variables
This is where you paste all the keys you collected. This is critical — the app won't work without these.

1. In Netlify, click on your site
2. Click **Site configuration** in the top menu
3. Click **Environment variables** in the left sub-menu
4. Click **Add a variable** for each row in the table below

For each one:
- Click **Add a variable**
- Paste the **Key** (left column) in the "Key" field
- Paste the **Value** (right column) in the "Value" field
- Click **Save**

| Key (copy this exactly) | Value (paste your actual key/info) |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase Project URL (from Step 2E) |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key (from Step 2E) |
| `SUPABASE_URL` | Your Supabase Project URL (paste it again, same value) |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service_role key (the secret one, from Step 2E) |
| `GEMINI_API_KEY` | Your Gemini key starting with AIzaSy (from Step 3A) |
| `CLAUDE_API_KEY` | Your Claude key starting with sk-ant (from Step 3B) |
| `VAPID_PUBLIC_KEY` | The public VAPID key starting with B (from Step 3C) |
| `VAPID_PRIVATE_KEY` | The private VAPID key (from Step 3C) |
| `CRON_SECRET` | The password you invented in Step 3D |
| `APP_URL` | Come back and fill this after step 4C below |
| `RAZORPAY_KEY_ID` | Type the word: `placeholder` |
| `RAZORPAY_KEY_SECRET` | Type the word: `placeholder` |
| `RAZORPAY_WEBHOOK_SECRET` | Type the word: `placeholder` |
| `RAZORPAY_PLAN_ID_PRO` | Type the word: `placeholder` |
| `RAZORPAY_MODE` | Type: `test` |

### 4C — Find your site URL and add it
1. Click **Deploys** in the top Netlify menu
2. At the top you'll see your site's URL — it looks like `https://dazzling-beaver-12345.netlify.app`
3. Copy that URL
4. Go back to **Environment variables** → find `APP_URL` → edit it → paste your URL → Save

### 4D — Tell Supabase your app's address
1. Go back to **supabase.com** → your project
2. Click **Authentication** in the left sidebar
3. Click **URL Configuration**
4. In **Site URL**, paste your Netlify URL (e.g. `https://dazzling-beaver-12345.netlify.app`)
5. Click **Save**

### 4E — Trigger a fresh deploy
1. In Netlify, click **Deploys**
2. Click **Trigger deploy** → **Deploy site**
3. Watch the log that appears. It will show a lot of text scrolling by.
4. Wait 3–5 minutes. The last line should say **"Site is live ✓"** or **"Published"** in green.

**✅ Check:** Open your Netlify URL in a browser. You should see a dark screen with the NutriSmart app loading. If you see the login screen, this step is complete.

---

## STEP 5 — Personalise and Verify

### 5A — Add your UPI ID and WhatsApp number
Before anyone can pay you, you need to add your own UPI ID to the app.

1. Go to **github.com** → your `nutrismart` repository
2. Click on the `src` folder → `components` folder → click the file `UpiPaymentFlow.tsx`
3. Click the pencil ✏️ **Edit** icon (top right of the file view)
4. Look for these two lines near the top (around line 13):
   ```
   const YOUR_UPI_ID          = 'yourname@ybl';
   const YOUR_WHATSAPP_NUMBER = '919876543210';
   ```
5. Change `yourname@ybl` to your actual UPI ID
   - To find your UPI ID: open GPay or PhonePe → tap your profile photo → look for "UPI ID" — it looks like `name@okicici` or `mobile@ybl`
6. Change `919876543210` to your WhatsApp number:
   - Format: `91` followed by your 10-digit number, no spaces, no +
   - Example: if your number is 9876543210, type `919876543210`
7. Scroll down, click **Commit changes**
8. A box appears — click **Commit changes** again

### 5B — Add your UPI QR code image
1. Open GPay or PhonePe on your phone
2. Go to the screen where people can pay you → find the QR code
3. Screenshot it and crop so only the QR code is visible
4. Send the image to your laptop (WhatsApp Web, email, AirDrop — any method)
5. Rename the image file to exactly `upi-qr.png`
6. In GitHub, click on the `public` folder
7. Click **Add file** → **Upload files**
8. Drag your `upi-qr.png` into the upload box
9. Click **Commit changes**

Netlify will automatically redeploy in about 2 minutes after any GitHub change.

### 5C — Create your account in the app
1. Open your Netlify URL
2. Click **Sign up** / **Get Started**
3. Enter your email and create a password
4. Complete the onboarding — enter your name, weight goal, and kitchen style when asked
5. You're now a user in your own app

### 5D — Give yourself admin access
1. Go back to **supabase.com** → your project → **SQL Editor**
2. Paste this, replacing the email with the one you used to sign up:
```sql
INSERT INTO admin_users (user_id, role)
SELECT id, 'super_admin' FROM auth.users WHERE email = 'your@email.com';
```
3. Click **Run**
4. Go back to your app in the browser and refresh the page
5. You should now see an **Admin** tab at the bottom of the screen

### 5E — Add starter foods to the database
Your app needs foods to search from. Run this to add 10 common Indian foods:

1. In Supabase → **SQL Editor**, paste and run:
```sql
INSERT INTO master_foods (name, portion, weight_g, calories, protein, carbs, fat, gl, category)
VALUES
  ('Roti (Chapati)', '1 medium', 40, 120, 3, 24, 2, 11, 'Bread & Rice'),
  ('Basmati Rice (Cooked)', '1 katori (150g)', 150, 195, 4, 43, 0.4, 26, 'Bread & Rice'),
  ('Dal Tadka', '1 katori (150ml)', 150, 180, 9, 22, 6, 8, 'Lentils & Pulses'),
  ('Paneer (Cottage Cheese)', '50g', 50, 140, 8, 1, 12, 0, 'Dairy'),
  ('Egg (Boiled)', '1 large', 60, 78, 6, 0.6, 5, 0, 'Eggs'),
  ('Poha', '1 plate (200g)', 200, 270, 5, 50, 8, 22, 'Snacks'),
  ('Chole (Chickpea Curry)', '1 katori (150ml)', 150, 210, 9, 30, 7, 10, 'Lentils & Pulses'),
  ('Banana', '1 medium', 120, 105, 1, 27, 0.3, 16, 'Fruits'),
  ('Dahi (Curd)', '1 katori (150g)', 150, 75, 5, 8, 2, 4, 'Dairy'),
  ('Aloo Sabzi', '1 katori (150g)', 150, 195, 3, 32, 7, 15, 'Vegetables');
```
2. Click **Run** — you should see "10 rows inserted" or similar

### 5F — Verify the Morning Verdict cron is running
The app sends personalised morning insights to users every day at 7:30 AM IST automatically. Let's confirm it's active.

1. In Netlify, click **Functions** in the top menu
2. Find `cron-morning-verdict` in the list
3. It should show a **clock icon** and `0 2 * * *` next to it — this confirms the schedule is set

To test it manually:
1. Click on `cron-morning-verdict`
2. Click **Test function** (if available) or use this method:
   - Open a new browser tab
   - Go to `https://YOUR-NETLIFY-URL.netlify.app/.netlify/functions/cron-morning-verdict`
   - You'll see an error (that's correct — it needs the secret header)
3. The clock icon being present is enough to confirm it's set up correctly

**✅ Final Check:** Go to your app URL, log a meal, check that the food database search works. The app is live. 🎉

---

## QUICK REFERENCE — Important URLs and Locations

| What you need | Where to find it |
|---|---|
| Your live app | Your Netlify URL (bookmark this) |
| View all user data | supabase.com → Table Editor |
| Run SQL commands | supabase.com → SQL Editor |
| Change environment variables | netlify.com → Site configuration → Environment variables |
| View function logs | netlify.com → Functions |
| Approve payments | Your app → Admin tab → Payments |
| Manage users | Your app → Admin tab → Users |
| Change code | github.com → your repository |

---

## TROUBLESHOOTING

**The app shows a blank white or black screen:**
The most common cause is a missing environment variable. Go to Netlify → Site configuration → Environment variables and check every variable in the table from Step 4B is present and has a value.

**A SQL migration gave a red error:**
- Did you clear the editor between migrations? The editor must be empty before each new migration.
- Did you run them in order? They must go 001, 002, 003... in sequence.
- For 009: was pg_cron enabled first? (Step 2B)

**Users can't sign up or login:**
Check that your Supabase Site URL (Step 4D) matches your Netlify URL exactly, including `https://`.

**The food search AI doesn't work:**
Check your `GEMINI_API_KEY` in Netlify environment variables. Make sure there are no extra spaces before or after the key when you pasted it.

**Payments aren't showing in admin:**
Make sure you ran the admin SQL in Step 5D and refreshed the app. You must be signed into the app with the same email you used in the SQL command.

**Morning notifications not arriving:**
Check that both `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are in Netlify environment variables and were pasted as single continuous strings with no spaces.

---

*You now have a live, AI-powered Indian nutrition tracking app. Everything is built, verified, and ready.*
*Users can sign up, log food, submit UPI payments, and receive personalised morning verdicts.*
*Welcome to launch. 🚀*
