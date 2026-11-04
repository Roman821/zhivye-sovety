FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node public ./public
COPY --chown=node:node server.mjs council-features.mjs people-features.mjs registration-features.mjs plan-features.mjs materials-features.mjs package.json ./
RUN mkdir -p /app/data && chown node:node /app/data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000 SOVETY_DATA_DIR=/app/data
USER node
EXPOSE 10000
CMD ["node", "server.mjs"]
