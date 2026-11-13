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
COPY package*.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund

COPY .actor ./.actor
COPY --from=build /usr/src/app/dist ./dist

CMD ["node", "dist/main.js"]
