# Project: Order & Stock SaaS (Multi-Tenant QR Ordering + Recipe Inventory)

## Core Stack Architecture
- **Backend**: .NET 8 Web API (Clean Architecture / Vertical Slices)
- **Database**: PostgreSQL 16 using Entity Framework Core (EF Core)
- **Frontend**: Angular 18+ (Standalone Components, Signals, RxJS)
- **Containerization**: Docker, Docker Compose, Kubernetes (Helm / K8s manifests)
- **Frontend Hosting**: Vercel-ready SSG/SPA configuration

## Code Guidelines & Standards

### .NET Backend (.NET 8)
- **Structure**: Use Clean Architecture (Domain, Application, Infrastructure, API).
- **Multi-Tenancy**: Every database table (except system-wide tables) MUST include a `TenantId` column. Intercept requests using a custom Middleware/Tenant Resolver from HTTP Headers (`X-Tenant-Id`).
- **Entity Framework Core**: Use Fluent API for configuration (no attributes in Domain models). Always use DB Migrations.
- **Transactions**: Inventory deductions during order creation MUST run inside an explicit EF Core database transaction with `IsolationLevel.ReadCommitted` or strict locking.

### Angular Frontend (Angular 18+)
- **Architecture**: Use Standalone Components exclusively (`standalone: true`). Do not use `NgModule`.
- **State & Reactivity**: Use Angular Signals for UI state management. Use RxJS only for HTTP streaming/effects.
- **Deployment**: Design for Vercel deployment. Ensure `vercel.json` rewrite rules for Angular SPA routes are included.

### Database (PostgreSQL)
- Snake_case naming convention for PostgreSQL tables and columns.
- Use decimal types for monetary and weight fields (`decimal(18,4)` for stock quantities, `decimal(10,2)` for prices).

## Quick Developer Commands
- Backend Run: `dotnet run --project src/Api/Api.csproj`
- DB Migration: `dotnet ef migrations add <Name> --project src/Infrastructure/Infrastructure.csproj --startup-project src/Api/Api.csproj`
- Frontend Run: `cd frontend && npm start`
- Frontend Build: `cd frontend && npm run build`