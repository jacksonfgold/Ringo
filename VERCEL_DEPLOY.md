# Deploying Ringo Client to Vercel

## Quick Setup Steps

### 1. Sign Up / Login
1. Go to [vercel.com](https://vercel.com)
2. Sign up with GitHub (recommended) or email

### 2. Create New Project
1. Click "Add New..." → "Project"
2. Import your GitHub repository (Ringo)
3. Vercel will auto-detect it's a Vite project

### 3. Configure Project Settings

**Framework Preset:** Vite (should auto-detect)

**Root Directory:** 
- Click "Edit" next to Root Directory
- Set to: `client`

**Build and Output Settings:**
- **Build Command:** `npm run build` (auto-filled)
- **Output Directory:** `dist` (auto-filled)
- **Install Command:** `npm install` (auto-filled)

### 4. Set Environment Variables

Click "Environment Variables" and add:

**Variable Name:** `VITE_SERVER_URL`  
**Value:** Your Railway server URL (e.g., `https://ringo-server.up.railway.app`)

**Important:** 
- Make sure to add this for all environments (Production, Preview, Development)
- The variable name MUST start with `VITE_` for Vite to expose it to your client code

### 5. Deploy!
1. Click "Deploy"
2. Wait for build to complete (~1-2 minutes)
3. Get your Vercel URL (e.g., `https://ringo.vercel.app`)

### 6. Update Railway with Frontend URL

After Vercel deployment:
1. Go back to Railway
2. Add/Update environment variable:
   - **Variable:** `CLIENT_URL`
   - **Value:** Your Vercel URL (e.g., `https://ringo.vercel.app`)
3. Railway will automatically redeploy

## Environment Variables Summary

### Vercel (Client):
```
VITE_SERVER_URL=https://your-railway-server.up.railway.app
```

### Railway (Server):
```
CLIENT_URL=https://your-vercel-app.vercel.app
PORT=3001 (auto-set by Railway)
```

## Custom Domain (Optional)

### On Vercel:
1. Go to your project → Settings → Domains
2. Add your custom domain
3. Follow DNS setup instructions

### Update Railway:
1. Update `CLIENT_URL` in Railway to your custom domain
2. Redeploy

## Troubleshooting

### Build Fails
- Check build logs in Vercel dashboard
- Verify `client/package.json` has correct build script
- Make sure all dependencies are in `dependencies` (not just `devDependencies`)

### Socket.IO Connection Fails
- Verify `VITE_SERVER_URL` is set correctly in Vercel
- Check that Railway server is running
- Verify CORS is configured on server (should use `CLIENT_URL` env var)
- Check browser console for connection errors

### 404 Errors on Refresh
- The `vercel.json` includes rewrites to handle SPA routing
- If you still get 404s, check that `vercel.json` is in the `client/` directory

### Environment Variables Not Working
- Make sure variable name starts with `VITE_`
- Redeploy after adding variables
- Check that you're using `import.meta.env.VITE_SERVER_URL` in code (already done)

## Auto-Deploy

Vercel automatically deploys on:
- Push to `main` branch → Production
- Push to other branches → Preview deployment
- Pull requests → Preview deployment

## Next Steps

1. ✅ Deploy client to Vercel
2. ✅ Set `VITE_SERVER_URL` in Vercel
3. ✅ Set `CLIENT_URL` in Railway
4. ✅ Test the full app
5. ✅ Share your Vercel URL with friends!
