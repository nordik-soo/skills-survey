FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
ENV PUBLIC_DIR=/app/public
EXPOSE 3000
CMD ["node", "server.js"]
