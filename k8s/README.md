# Kubernetes manifests

Plain YAML, no Helm, no Kustomize — enough to run the .NET API and its PostgreSQL on any
cluster, and small enough to read in one sitting. The Angular app is **not** here; it is served
by Vercel from its own domain (see `../frontend/README.md`).

| File | What it is |
| --- | --- |
| `postgres-pv-pvc.yaml` | PersistentVolume + PersistentVolumeClaim for the database. |
| `postgres-secret.yaml` | Database credentials and the API's connection string. **Template — replace before applying.** |
| `postgres-deployment.yaml` | PostgreSQL 16, one replica, `Recreate` strategy. |
| `postgres-service.yaml` | ClusterIP `postgres:5432`. Not exposed outside the cluster. |
| `backend-deployment.yaml` | The API, two replicas, env for the connection string and CORS. |
| `backend-service.yaml` | ClusterIP `orderstock-api:80`. |
| `ingress.yaml` | `api.example.com` → the API, TLS via cert-manager. |
| `migrate-job.yaml` | Applies EF Core migrations. Run before each rollout that carries one. |

## Edit these four things first

1. **`postgres-secret.yaml`** — the password, in both keys. Better still, don't apply this file
   at all; create the Secret out of band (the file's header has the `kubectl create secret`
   command) and keep credentials out of the repository entirely.
2. **`backend-deployment.yaml` and `migrate-job.yaml`** — `image:`, in both, to your registry
   and the same tag.
3. **`backend-deployment.yaml`** — `Cors__AllowedOrigins__0`, to the Vercel domain the frontend
   is actually served from. Getting this wrong produces a site that loads and then cannot fetch
   anything, with the reason visible only in the browser console.
4. **`ingress.yaml`** — `host:` and `tls.hosts`, to your API domain.

On a managed cluster also delete the PersistentVolume from `postgres-pv-pvc.yaml` and give the
claim a real `storageClassName`; the `hostPath` volume in there only makes sense on a
single-node cluster like minikube or kind.

## Applying

```bash
kubectl create namespace orderstock
kubectl config set-context --current --namespace=orderstock

kubectl apply -f k8s/
```

Nothing in these files hardcodes a namespace, so they land wherever the current context points.

Order matters slightly on a first install: the API pods come up before PostgreSQL is ready and
fail their readiness probe until it is. That is the probe doing its job — they join the Service
once the database answers. If you would rather not watch the restarts:

```bash
kubectl apply -f k8s/postgres-pv-pvc.yaml -f k8s/postgres-secret.yaml
kubectl apply -f k8s/postgres-deployment.yaml -f k8s/postgres-service.yaml
kubectl rollout status deployment/postgres

kubectl apply -f k8s/migrate-job.yaml
kubectl wait --for=condition=complete job/orderstock-migrate --timeout=180s

kubectl apply -f k8s/backend-deployment.yaml -f k8s/backend-service.yaml -f k8s/ingress.yaml
kubectl rollout status deployment/orderstock-api
```

## Migrations

The API pods run with `Database__MigrateOnStartup=false` on purpose: with two replicas, both
would race each other through EF Core's migration history table on boot. Schema changes go
through the Job, which runs the same image with `--migrate` and exits:

```bash
kubectl delete job orderstock-migrate --ignore-not-found
kubectl apply -f k8s/migrate-job.yaml
kubectl wait --for=condition=complete job/orderstock-migrate --timeout=180s
kubectl logs job/orderstock-migrate
```

Run it **before** rolling out an image whose code expects the new schema.

## Checking it works

```bash
kubectl get pods -l app.kubernetes.io/part-of=orderstock
kubectl logs -l app.kubernetes.io/name=orderstock-api --tail=50

# Liveness has no dependencies; readiness includes PostgreSQL.
kubectl port-forward svc/orderstock-api 8080:80
curl -i localhost:8080/health/ready

curl -s https://api.example.com/api/v1/tenants | head
```

A pod stuck `0/1 Running` is almost always readiness failing on the database — check the
connection string in the Secret and that `svc/postgres` has endpoints
(`kubectl get endpoints postgres`).

## What is deliberately not here

- **Autoscaling, PodDisruptionBudgets, NetworkPolicies.** Worth adding; not needed to run.
- **Database backups.** The `Retain` reclaim policy stops a deleted claim from destroying the
  volume, which is not the same thing as a backup. Schedule `pg_dump` somewhere.
- **A managed database.** For anything with real customers, RDS/Cloud SQL is a better answer
  than a PostgreSQL pod on a PersistentVolume; delete the three `postgres-*` files and point
  the connection string at it.
- **Authentication.** `/api/v1/tenants` provisions restaurants and the whole admin surface is
  open. The Ingress publishes all of it. Put an auth proxy in front, or finish the auth story,
  before this faces the internet.
