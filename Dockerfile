FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server.mjs ./server.mjs
COPY server ./server
RUN mkdir -p /var/data && chown -R node:node /app /var/data
USER node
ENV PORT=10000 HOST=0.0.0.0 DATA_DIR=/var/data
EXPOSE 10000
CMD ["node", "server.mjs", "--production"]
