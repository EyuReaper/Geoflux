# GeoFlux Deployment Guide

This guide outlines the steps required to deploy GeoFlux to a production environment.

## 1. Environment Variables

Ensure all sensitive keys are configured in your production environment. Use `.env.example` files as templates.

### Backend (`backend/.env`)
- `PORT`: Server port (default: 4000).
- `DATABASE_URL`: Connection string for PostgreSQL/PostGIS.
- `REDIS_URL`: Connection string for Redis.
- `JWT_SECRET`: A strong secret for signing JWT tokens.
- `NODE_ENV`: Set to `production`.

### Frontend (`frontend/.env`)
- `VITE_API_URL`: The public URL of your backend API (e.g., `https://api.geoflux.com`).

## 2. Database Migrations

**IMPORTANT:** Always run migrations before starting the backend server in production.

Use the `migrate deploy` command to apply pending migrations without creating new ones or resetting the database:

```bash
cd backend
npx prisma migrate deploy
```

In a CI/CD pipeline, this should be an automated step that runs after a successful build and before the service restart.

## 3. Production Build

### Backend
```bash
cd backend
npm install
npm run build
npm start
```

### Frontend
```bash
cd frontend
npm install
npm run build
```
The build artifacts will be in `frontend/dist`. These should be served by a web server like Nginx.

## 4. Reverse Proxy (Nginx)

A production-ready Nginx configuration is provided in `frontend/nginx.conf`. It handles:
- Static asset serving with caching.
- Gzip compression.
- API request proxying to the backend.
- Security headers.
- Health check endpoint.

Ensure you configure SSL termination (e.g., via Certbot/Let's Encrypt) as shown in the template section of the config.

## 5. Docker Deployment

GeoFlux is containerized for easy deployment. Use `docker-compose.prod.yml` (if available) or the provided `Dockerfile`s.

```bash
# Example build command
docker build -t geoflux-backend ./backend
docker build -t geoflux-frontend ./frontend
```
