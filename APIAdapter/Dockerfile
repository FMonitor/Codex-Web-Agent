ARG NPM_MIRROR=https://registry.npmmirror.com

FROM node:22-bookworm-slim

ARG NPM_MIRROR

WORKDIR /app

COPY responses-compat-proxy.mjs /app/responses-compat-proxy.mjs

ENV NPM_CONFIG_REGISTRY=${NPM_MIRROR}
ENV PORT=11434

EXPOSE 11434

CMD ["node", "/app/responses-compat-proxy.mjs"]
