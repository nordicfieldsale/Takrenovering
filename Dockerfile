# =====================================================================
#  Villa Takrenovering – bokningssystem
#  Bygger webbappen och paketerar den tillsammans med API:t i en image.
#  Ingenting behöver installeras manuellt på servern.
# =====================================================================

# --- Steg 1: bygg webbappen -------------------------------------------
FROM node:20-alpine AS web

WORKDIR /build
COPY web/package.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# --- Steg 2: installera serverberoenden -------------------------------
FROM node:20-alpine AS deps

WORKDIR /build
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# --- Steg 3: körbar image ---------------------------------------------
FROM node:20-alpine AS runtime

# tini hanterar signaler korrekt så att containern stannar snyggt.
RUN apk add --no-cache tini curl

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps  /build/node_modules ./node_modules
COPY server/package.json ./package.json
COPY server/src ./src
COPY server/db  ./db

# Den byggda webbappen serveras av samma server som API:t.
COPY --from=web /build/dist ./public

# Kör som icke-privilegierad användare. Läsrättigheterna sätts explicit så att
# de statiska filerna garanterat kan serveras (annars kan de ge 403).
RUN chown -R node:node /app && chmod -R a+rX /app
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:5000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
