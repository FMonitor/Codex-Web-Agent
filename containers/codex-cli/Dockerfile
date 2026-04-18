FROM node:22-bookworm-slim

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

RUN npm install -g @openai/codex

RUN useradd -ms /bin/bash codex
USER codex
WORKDIR /home/codex

ENV CODEX_HOME=/home/codex/.codex
ENV PATH="/home/codex/.local/bin:${PATH}"

COPY --chown=codex:codex entrypoint.sh /usr/local/bin/codex-container-entrypoint
RUN chmod +x /usr/local/bin/codex-container-entrypoint

ENTRYPOINT ["codex-container-entrypoint"]
CMD ["sleep", "infinity"]

