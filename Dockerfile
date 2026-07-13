# Production image for Railway (and any single-container host).
# Builds the Node/Express API and bundles the static front-end into PUBLIC_DIR,
# so one container serves both the site and the API. Reads PORT, DATABASE_URL,
# ADMIN_PASSCODE, SESSION_SECRET from the environment.
FROM node:20-alpine
WORKDIR /app

# API dependencies
COPY api/package.json ./
RUN npm install --omit=dev

# API code
COPY api/server.js ./

# Static front-end (served from PUBLIC_DIR)
RUN mkdir -p public
COPY index.html app.js app.css survey-data.js noc-data.js cip-data.js translations.js colors_and_type.css ./public/
COPY assets ./public/assets
COPY fonts ./public/fonts

ENV PUBLIC_DIR=/app/public
# PORT is provided by the host (Railway); server.js falls back to 3000 locally.
CMD ["node", "server.js"]
