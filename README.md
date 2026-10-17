# DPS AMARPALI - Inventory Management System (Cloud Connected)

This project is configured with **Neon PostgreSQL** and prepared for **1-Click Deployment to Vercel**.

---

## 🚀 Quick Start (Local Testing)

1. Start the server:
   ```bash
   npm start
   ```
2. Open your browser at:
   ```
   http://localhost:3000/
   ```
3. You will see the **☁️ Neon DB** cloud sync badge in the top right header!

---

## 🌐 Deploy to Vercel (Step-by-Step)

### Option 1: Deploy via GitHub (Recommended)

1. **Push this code to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "DPS Inventory with Neon PostgreSQL"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```

2. **Import into Vercel:**
   - Go to [vercel.com](https://vercel.com/) and click **"Add New" > "Project"**.
   - Select your GitHub repository.

3. **Add Environment Variable in Vercel:**
   - In the **Environment Variables** section before deploying:
     - **Key**: `DATABASE_URL`
     - **Value**: *(Paste your private Neon PostgreSQL connection string from your local .env)*
   - Click **Deploy**!

---

### Option 2: Deploy directly via Vercel CLI

1. Install Vercel CLI globally (if not installed):
   ```bash
   npm i -g vercel
   ```
2. Run deploy command:
   ```bash
   vercel
   ```
3. Set the environment variable:
   ```bash
   vercel env add DATABASE_URL
   ```
   (Paste the connection string when prompted)
4. Deploy to production:
   ```bash
   vercel --prod
   ```

---

## ⚙️ How Cloud Sync Works

1. **Instant UI Response:** Data loads immediately from `localStorage` so there is zero waiting time.
2. **Neon Cloud Sync:** Background sync updates all items, faculties, bills, and logs to Neon PostgreSQL.
3. **Multi-Device Support:** All staff members, principals, and admin devices opening the Vercel URL will automatically see the exact same real-time inventory!
