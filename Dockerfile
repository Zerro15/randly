FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html styles.css wheel.css settings.css app.js random-core.js favicon.svg /srv/
RUN addgroup -S randly && adduser -S randly -G randly && chown -R randly:randly /srv
USER randly
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
