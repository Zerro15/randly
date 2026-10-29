FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html styles.css wheel.css settings.css app.js random-core.js favicon.svg account.html account.css account.js room.html room.css room.js control.html control.css control.js /srv/
RUN addgroup -S randly && adduser -S randly -G randly && chown -R randly:randly /srv
# Caddy upstream may have cap_net_bind_service file capabilities.
# Copying it drops xattrs so it can run with cap_drop: ALL.
RUN cp /usr/bin/caddy /usr/local/bin/randly-caddy && chmod 0755 /usr/local/bin/randly-caddy
USER randly
ENTRYPOINT ["/usr/local/bin/randly-caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
