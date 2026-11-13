# Ceki real-browser fetch actor.
#
# Two stages: build compiles TypeScript with dev deps, runtime keeps only the
# production dependency tree. This keeps the published image small and means
# `apify push` works without a local prebuild step.

FROM apify/actor-node:20 AS build

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --include=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM apify/actor-node:20 AS runtime

WORKDIR /usr/src/app

# The base image is Alpine (musl), but @roamhq/wrtc ships a prebuilt binary
# linked against glibc — without a compatibility layer Node fails at import
# time with "Error loading shared library ld-linux-x86-64.so.2". gcompat
# provides that loader, so the WebRTC transport @ceki/sdk depends on can load.
USER root
RUN apk add --no-cache gcompat libstdc++

COPY package*.json ./
# Install @roamhq/wrtc-linux-x64 explicitly: @roamhq/wrtc pulls it in as an
# *optional* dependency, and optional-dep resolution is not reliable across
# npm versions and lockfile states.
RUN npm install --omit=dev --include=optional --no-audit --no-fund \
    && npm install @roamhq/wrtc-linux-x64 --no-save --no-audit --no-fund \
    && node -e "require('@roamhq/wrtc'); console.log('wrtc binary OK')"

USER myuser

COPY .actor ./.actor
COPY --from=build /usr/src/app/dist ./dist

CMD ["node", "dist/main.js"]
