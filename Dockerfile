FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/media-engine/package.json packages/media-engine/package.json
COPY packages/providers/package.json packages/providers/package.json
RUN npm ci

COPY . .
RUN npm run db:generate && npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000 4000
CMD ["npm", "run", "start:deploy"]
