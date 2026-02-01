# Deploying Ringo to Railway

## Step-by-Step Guide

### 1. Create Railway Account
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub (recommended) or email
3. You'll get $5/month free credit

### 2. Create New Project
1. Click "New Project"
2. Select "Deploy from GitHub repo" (recommended) or "Empty Project"
3. If using GitHub:
   - Connect your GitHub account
   - Select the `Ringo` repository
   - Railway will auto-detect it's a Node.js project

### 3. Configure the Service
1. Railway will create a service automatically
2. Click on the service to configure it

### 4. Set Environment Variables
In the service settings, add these environment variables:

**Required:**
- `PORT` - Railway sets this automatically, but you can verify it's set
- `CLIENT_URL` - Your frontend URL (see step 5)

**Example:**
```
CLIENT_URL=https://your-app.vercel.app
```

### 5. Deploy the Frontend (Client)
You need to host the client separately. Recommended: **Vercel** (free)

#### Deploy Client to Vercel:
1. Go to [vercel.com](https://vercel.com) and sign up
2. Click "New Project"
3. Import your GitHub repo
4. Set build settings:
   - **Framework Preset:** Vite
   - **Root Directory:** `client`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. Add Environment Variable:
   - `VITE_SERVER_URL` = Your Railway server URL (e.g., `https://your-app.up.railway.app`)
6. Deploy!

### 6. Update Client Code for Production
The client needs to connect to your Railway server. Update the Socket.IO connection:

In `client/src/hooks/useSocket.js`, make sure it uses:
```javascript
const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'
```

### 7. Update CORS on Server
The server is already configured to use `CLIENT_URL` from environment variables. After deploying:
1. Get your Vercel frontend URL
2. Set `CLIENT_URL` in Railway to that URL

### 8. Deploy!
1. Railway will automatically deploy when you push to GitHub
2. Or click "Deploy" in the Railway dashboard
3. Wait for deployment to complete
4. Get your server URL from Railway (looks like: `https://your-app.up.railway.app`)

### 9. Update Frontend with Server URL
1. Go back to Vercel
2. Add/update environment variable:
   - `VITE_SERVER_URL` = Your Railway server URL
3. Redeploy the frontend

## Railway-Specific Configuration

### Root Directory
If Railway doesn't auto-detect, set:
- **Root Directory:** `server`

### Build Command
Railway will auto-detect, but you can set:
- **Build Command:** (leave empty, or `npm install`)
- **Start Command:** `npm start`

### Health Check (Optional)
Railway can check if your server is running. Add a health endpoint:

In `server/src/server.js`, add:
```javascript
app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})
```

## Troubleshooting

### Server won't start
- Check logs in Railway dashboard
- Verify `PORT` environment variable is set
- Make sure `npm start` works locally

### CORS errors
- Verify `CLIENT_URL` is set correctly in Railway
- Make sure it matches your Vercel frontend URL exactly

### Socket.IO connection fails
- Check that WebSocket is enabled (Railway supports it by default)
- Verify the server URL in your client code
- Check Railway logs for connection errors

### Free tier limits
- Railway gives $5/month free credit
- For a small game server, this should be plenty
- Monitor usage in Railway dashboard

## Quick Commands

### Local Testing with Railway URL
```bash
# Test server locally but connect to Railway
CLIENT_URL=https://your-frontend.vercel.app npm start
```

### Check Railway Logs
- Go to Railway dashboard
- Click on your service
- Click "Deployments" → Select deployment → View logs

## Next Steps
1. Set up custom domain (optional, paid)
2. Enable auto-deploy from GitHub
3. Set up monitoring/alerts
4. Configure backups (if needed)
