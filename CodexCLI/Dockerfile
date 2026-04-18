ARG NPM_MIRROR=https://registry.npmmirror.com
ARG APT_MIRROR=http://mirrors.aliyun.com/debian
ARG APT_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security

FROM node:22-bookworm-slim

ARG NPM_MIRROR
ARG APT_MIRROR
ARG APT_SECURITY_MIRROR

ENV NPM_CONFIG_REGISTRY=${NPM_MIRROR}

RUN printf 'Types: deb\nURIs: %s\nSuites: bookworm bookworm-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: %s\nSuites: bookworm-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' \
  "$APT_MIRROR" "$APT_SECURITY_MIRROR" > /etc/apt/sources.list.d/debian.sources
RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  git \
  jq \
  less \
  openssh-client \
  procps \
  ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN npm config set registry ${NPM_CONFIG_REGISTRY} && \
    npm install -g @openai/codex

RUN useradd -ms /bin/bash codex
USER codex
WORKDIR /home/codex

ENV CODEX_HOME=/home/codex/.codex
ENV PATH="/home/codex/.local/bin:${PATH}"

COPY --chown=codex:codex entrypoint.sh /usr/local/bin/codex-container-entrypoint
RUN chmod +x /usr/local/bin/codex-container-entrypoint

ENTRYPOINT ["codex-container-entrypoint"]
CMD ["sleep", "infinity"]

