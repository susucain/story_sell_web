# Frontend production deployment

GitHub Actions builds the Vite application and uploads only the compressed
`dist` output to ECS. The ECS host does not clone the repository, install
Node.js dependencies, or build the frontend.

## Release layout

```text
/opt/agui-frontend/
  current -> releases/<git-sha>
  incoming/
  releases/
```

Nginx serves `/opt/agui-frontend/current`. A deployment extracts into an
immutable release directory and atomically switches the `current` symlink.
If the HTTP health check fails, the script restores the previous symlink.

## GitHub environment secrets

Create the `production` environment and configure:

```text
ECS_HOST
ECS_PORT
ECS_USER
ECS_SSH_PRIVATE_KEY
ECS_KNOWN_HOSTS
```

These values are repository-specific. Secrets configured in the backend
repository are not automatically available to this repository.
