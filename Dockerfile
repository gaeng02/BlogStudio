FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.txt \
    && useradd --uid 10001 --create-home studio \
    && mkdir -p /data && chown studio:studio /data
COPY app/ ./app/
COPY scripts/ ./scripts/
COPY --from=frontend /build/dist ./frontend/dist
USER studio
EXPOSE 8000
# Single worker serializes publishing; access logs would expose OAuth callback codes.
CMD ["uvicorn", "app.main:get_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
