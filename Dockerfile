FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json

RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ARG TYPST_VERSION=v0.14.2

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
  && rm -rf /var/lib/apt/lists/* \
  && arch="$(dpkg --print-architecture)" \
  && case "$arch" in \
    amd64) typst_arch="x86_64-unknown-linux-musl" ;; \
    arm64) typst_arch="aarch64-unknown-linux-musl" ;; \
    *) echo "Unsupported architecture: $arch" && exit 1 ;; \
  esac \
  && curl -fsSL "https://github.com/typst/typst/releases/download/${TYPST_VERSION}/typst-${typst_arch}.tar.xz" -o /tmp/typst.tar.xz \
  && tar -xJf /tmp/typst.tar.xz -C /tmp \
  && install -m 0755 /tmp/typst-*/typst /usr/local/bin/typst \
  && rm -rf /tmp/typst* 

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
RUN npm ci --omit=dev --workspace server

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

WORKDIR /app/server
RUN mkdir -p data && chown -R node:node data

ENV NODE_ENV=production
ENV PORT=3000
# HOME is where Typst caches downloaded @preview packages.
ENV HOME=/home/node
EXPOSE 3000
VOLUME /app/server/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

# The entrypoint fixes volume ownership, then runs the server as the unprivileged "node" user.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
