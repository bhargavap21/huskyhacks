# Public link: https://vantis-huskyhack.vercel.app (and the older https://second-look-demo.vercel.app)

This Vercel project (`second-look`, team `workstream`) runs no code. It forwards every request to the
demo server running on the laptop, which is reached through a Cloudflare quick tunnel. The laptop must stay
awake and online.

Vercel Authentication is off for this project so judges can open it without signing in.

## If the tunnel URL changes
1. Put the new `https://….trycloudflare.com` URL in `vercel.json`.
2. `cd deploy/vercel-proxy && vercel link --project second-look --yes && vercel deploy --prod --yes`
3. `vercel alias set <new-deployment-url> vantis-huskyhack.vercel.app` and the same for `second-look-demo.vercel.app`

The server only accepts browser actions from origins it knows: keep `ALLOWED_ORIGIN_HOSTS=second-look-demo.vercel.app,vantis-huskyhack.vercel.app` in `.env`.
