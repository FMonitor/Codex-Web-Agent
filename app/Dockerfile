ARG NPM_MIRROR=https://registry.npmmirror.com
ARG APT_MIRROR=http://mirrors.aliyun.com/debian
ARG APT_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security

FROM node:22-bookworm-slim AS build

ARG NPM_MIRROR

WORKDIR /workspace

ENV NPM_CONFIG_REGISTRY=${NPM_MIRROR}

COPY package.json package-lock.json tsconfig.base.json ./
COPY app/server/package.json app/server/package.json
COPY app/web/package.json app/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm config set registry ${NPM_CONFIG_REGISTRY} && \
    npm ci

COPY app app
COPY packages packages

RUN npm run build

FROM node:22-bookworm-slim

ARG APT_MIRROR
ARG APT_SECURITY_MIRROR

WORKDIR /opt/copilot-console

# Required for CODEX_CLI_COMMAND using docker exec against the CodexCLI container.
RUN printf 'Types: deb\nURIs: %s\nSuites: bookworm bookworm-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: %s\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' \
  "$APT_MIRROR" "$APT_SECURITY_MIRROR" > /etc/apt/sources.list.d/debian.sources
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  docker.io \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /workspace /opt/copilot-console

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["npm", "run", "start", "-w", "@copilot-console/server"]
