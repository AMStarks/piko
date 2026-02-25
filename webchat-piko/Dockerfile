# Piko WebChat — Phase 5.3. Run Ollama on host; set OLLAMA_URL to host (e.g. http://host.docker.internal:11434).
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

ENV NODE_ENV=production
ENV PIKO_DATA_DIR=/app/data

VOLUME /app/data

CMD ["node", "server.js"]
