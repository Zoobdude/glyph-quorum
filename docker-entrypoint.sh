#!/bin/sh
# Start as root only long enough to make the data volume writable (volumes created by
# older releases are root-owned), then drop to the unprivileged "node" user.
set -e
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/server/data
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
