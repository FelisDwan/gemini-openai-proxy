ARG DENO_VERSION=1
FROM lukechannings/deno:v${DENO_VERSION} as builder
WORKDIR /data
COPY . .
RUN deno cache main_deno.ts
RUN deno compile --allow-all --no-check -o app main_deno.ts

FROM ubuntu
WORKDIR /data
USER root
COPY --from=builder /data/app /data/app
CMD ["/data/app", "--allow-net"]