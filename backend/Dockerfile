# syntax=docker/dockerfile:1
#
# Flight Radar India - API image.
#   docker build -t flightradar-api ./backend
#
# Two stages: compile TypeScript with all dependencies, then ship only the
# compiled output, production dependencies and the data files.

# Node 24 (npm 11): the lock files are written by npm 11, and npm 10 (Node 22's
# npm) refuses `npm ci` on them with "Missing: typescript@... from lock file".
# ---- build ------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

# Dependencies first so this layer is cached until package files change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# ---- runtime ----------------------------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# India boundary, neighbouring land mask and the OurAirports extract.
COPY data ./data

# The base image ships an unprivileged "node" user.
USER node
EXPOSE 3000

# /api/health is public and reveals nothing but liveness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
