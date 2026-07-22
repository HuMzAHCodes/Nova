# Nova — Environment & Config

Every environment variable the project needs, what it's for, and where to get it — since the whole project runs on free-tier services, this doc should let anyone reproduce the setup at $0.

## backend/.env (planned)
```
PORT=
NODE_ENV=

# MongoDB Atlas (free M0 tier)
MONGODB_URI=

# JWT
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

# Stripe (test mode)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Cloudinary (free tier)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Redis (Upstash free tier)
REDIS_URL=

# LLM API (Gemini or Groq — free tier)
LLM_API_KEY=
LLM_PROVIDER=   # "gemini" | "groq"
```

## frontend/.env.local (planned)
```
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_SOCKET_URL=
```

## Where to get each key (fill in as we set each service up)
- MongoDB Atlas: _pending_
- Stripe test keys: _pending_
- Cloudinary: _pending_
- Upstash Redis: _pending_
- Gemini/Groq API key: _pending_

---
_Last updated: not yet started._
