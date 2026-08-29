# =========================================================================
# Stage 1: Build & Optimize Frontend SPA with Vite (Node.js 20)
# =========================================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend

# Install frontend dependencies
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source and compile optimized production bundle
COPY frontend/ ./
RUN npm run build

# =========================================================================
# Stage 2: Production Python Backend & Pre-Compiled Static Server
# =========================================================================
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python backend dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend Python application code
COPY app/ ./app
COPY docker-compose.yml .

# Copy pre-compiled Vite production bundle from Stage 1 (leaving Node behind)
COPY --from=frontend-builder /frontend/dist /app/frontend/dist

ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
