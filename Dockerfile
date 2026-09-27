# The whole app as one small image: Next's standalone server plus the data files
# it reads at request time. No credentials are needed; a language-model key may
# be passed with -e (see .env.example), and without one the template is used.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# Read at request time: forecast regimes, the sequence library, slab depths and
# the forecast ledger (a snapshot as of the build; the live one is in the repository).
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/data ./data
COPY --from=build --chown=app:app /app/ledger ./ledger
RUN mkdir .cache && chown app:app .cache
USER app
EXPOSE 3000
CMD ["node", "server.js"]
