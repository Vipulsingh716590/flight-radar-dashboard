# syntax=docker/dockerfile:1
#
# Flight Radar India - web image: the Angular build served by nginx, with
# /api proxied to the API container (so the browser sees one origin and the
# session cookie stays first-party).
#   docker build -t flightradar-web ./frontend
#
# Runtime settings (environment variables):
#   API_UPSTREAM  where nginx forwards /api to      (default http://api:3000)
#   API_BASE_URL  public API origin if it is NOT served through this nginx
#                 (default empty = same origin)

# Node 24 (npm 11): the lock files are written by npm 11, and npm 10 (Node 22's
# npm) refuses `npm ci` on them with "Missing: typescript@... from lock file".
# ---- build ------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Only these variables are substituted into the nginx template, so nginx's own
# $variables are left alone.
ENV NGINX_ENVSUBST_FILTER=^API_ \
    API_UPSTREAM=http://api:3000 \
    API_BASE_URL=

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY nginx/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
