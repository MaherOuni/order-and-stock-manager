# Build context is the repository root: docker build -f src/Api/Dockerfile .
#
# Two stages: the SDK image compiles, the much smaller aspnet runtime image ships. Nothing
# from the build stage reaches production except the published output.

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

ENV DOTNET_NOLOGO=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1

# Restore first, from the project files alone: this layer is then cached until a csproj or a
# package version actually changes, which is the difference between a 10-second and a
# 2-minute rebuild on an ordinary code edit.
COPY Directory.Build.props ./
COPY src/Core/Domain/Domain.csproj src/Core/Domain/
COPY src/Core/Application/Application.csproj src/Core/Application/
COPY src/Infrastructure/Infrastructure.csproj src/Infrastructure/
COPY src/Api/Api.csproj src/Api/
RUN dotnet restore src/Api/Api.csproj

COPY src/ src/

# UseAppHost=false drops the native launcher; the entrypoint runs `dotnet Api.dll` anyway.
RUN dotnet publish src/Api/Api.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish \
    /p:UseAppHost=false


FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

LABEL org.opencontainers.image.title="Order & Stock API" \
      org.opencontainers.image.description="Multi-tenant QR ordering and recipe-based inventory." \
      org.opencontainers.image.source="https://github.com/OWNER/order-stock"

# GLOBALIZATION_INVARIANT stays false on purpose: prices are formatted per tenant currency,
# which needs real culture data. (Comments cannot live inside a line continuation.)
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false \
    DOTNET_NOLOGO=1

# Copied as root, then run as the image's non-root user: the app can read its own binaries
# but cannot rewrite them.
COPY --from=build /app/publish .

USER $APP_UID

EXPOSE 8080

# No HEALTHCHECK instruction: this image ships neither curl nor wget, so any shell probe would
# fail permanently and mark a healthy container unhealthy. Probe /health/ready from outside —
# compose does it from the host, Kubernetes does it with an httpGet probe.

ENTRYPOINT ["dotnet", "Api.dll"]
