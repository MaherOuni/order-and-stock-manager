using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Api.IntegrationTests;

/// <summary>
/// Sign-in, token rotation, and the rule the whole admin side now rests on: the tenant a
/// request runs against comes from the bearer token, never from the X-Tenant-Id header.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class AuthenticationTests
{
    private const string Password = "correct-horse-battery";

    private readonly PostgresApiFactory _factory;

    public AuthenticationTests(PostgresApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Login_returns_tokens_carrying_the_users_tenant()
    {
        var tenant = await TenantApi.ProvisionAsync(_factory, "auth");
        var email = await CreateStaffAsync(tenant.Id, AppRoles.Manager);

        var response = await SignInAsync(email, Password);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = (await response.Content.ReadFromJsonAsync<AuthBody>(TenantApi.Json))!;

        Assert.Equal(tenant.Id, body.TenantId);
        Assert.Contains(AppRoles.Manager, body.Roles);
        Assert.NotEmpty(body.RefreshToken);

        // The claim is what the middleware reads; assert on it rather than on the response body.
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(body.AccessToken);
        var tenantClaim = jwt.Claims.Single(c => c.Type == AppClaims.TenantId).Value;

        Assert.Equal(tenant.Id.ToString(), tenantClaim);
    }

    [Fact]
    public async Task Login_rejects_a_bad_password()
    {
        var tenant = await TenantApi.ProvisionAsync(_factory, "auth");
        var email = await CreateStaffAsync(tenant.Id, AppRoles.Staff);

        var response = await SignInAsync(email, "wrong-password-entirely");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// An empty password is a malformed request, not a failed credential check, so it is
    /// rejected by model validation before reaching the account. That distinction is safe to
    /// expose: it says nothing about whether the account exists.
    /// </summary>
    [Fact]
    public async Task Login_rejects_an_empty_password_as_a_bad_request()
    {
        var tenant = await TenantApi.ProvisionAsync(_factory, "auth");
        var email = await CreateStaffAsync(tenant.Id, AppRoles.Staff);

        var response = await SignInAsync(email, string.Empty);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Login_rejects_an_unknown_account()
    {
        var response = await SignInAsync($"nobody-{Guid.NewGuid():N}@example.test", Password);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_rejects_a_deactivated_account()
    {
        var tenant = await TenantApi.ProvisionAsync(_factory, "auth");
        var email = await CreateStaffAsync(tenant.Id, AppRoles.Staff);

        await WithUserManagerAsync(async users =>
        {
            var user = await users.FindByEmailAsync(email);
            user!.IsActive = false;
            await users.UpdateAsync(user);
        });

        var response = await SignInAsync(email, Password);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// The regression this whole phase exists to prevent. Before authentication, the header
    /// alone chose the tenant, so anyone could read and rewrite another restaurant's menu by
    /// sending its slug.
    /// </summary>
    [Fact]
    public async Task Staff_cannot_reach_another_tenant_by_changing_the_header()
    {
        var mine = await TenantApi.ProvisionAsync(_factory, "mine");
        var theirs = await TenantApi.ProvisionAsync(_factory, "theirs");

        var email = await CreateStaffAsync(mine.Id, AppRoles.Manager);
        var token = await AccessTokenAsync(email);

        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        client.DefaultRequestHeaders.Add("X-Tenant-Id", theirs.Slug);

        var response = await client.GetAsync("/api/v1/products");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_header_naming_the_users_own_tenant_is_allowed()
    {
        var tenant = await TenantApi.ProvisionAsync(_factory, "same");
        var email = await CreateStaffAsync(tenant.Id, AppRoles.Manager);
        var token = await AccessTokenAsync(email);

        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        client.DefaultRequestHeaders.Add("X-Tenant-Id", tenant.Slug);

        var response = await client.GetAsync("/api/v1/products");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task A_token_with_no_header_still_resolves_the_users_tenant()
    {
        var tenant = await TenantApi.ProvisionAsync(_factory, "notenanthdr");
        var email = await CreateStaffAsync(tenant.Id, AppRoles.Manager);
        var token = await AccessTokenAsync(email);

        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/v1/products");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(tenant.Id.ToString(), response.Headers.GetValues("X-Tenant-Id").Single());
    }

    [Fact]
    public async Task Refresh_rotates_the_token_and_refuses_the_old_one()
    {
        var tenant = await TenantApi.ProvisionAsync(_factory, "rotate");
        var email = await CreateStaffAsync(tenant.Id, AppRoles.Staff);

        var first = (await (await SignInAsync(email, Password))
            .Content.ReadFromJsonAsync<AuthBody>(TenantApi.Json))!;

        using var client = _factory.CreateClient();

        var rotated = await client.PostAsJsonAsync("/api/v1/auth/refresh",
            new { refreshToken = first.RefreshToken }, TenantApi.Json);

        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);

        var second = (await rotated.Content.ReadFromJsonAsync<AuthBody>(TenantApi.Json))!;
        Assert.NotEqual(first.RefreshToken, second.RefreshToken);
        Assert.Equal(tenant.Id, second.TenantId);

        // Replaying the spent token must fail — that is what makes rotation worth anything.
        var replay = await client.PostAsJsonAsync("/api/v1/auth/refresh",
            new { refreshToken = first.RefreshToken }, TenantApi.Json);

        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
    }

    [Fact]
    public async Task A_revoked_refresh_token_stops_working()
    {
        var tenant = await TenantApi.ProvisionAsync(_factory, "logout");
        var email = await CreateStaffAsync(tenant.Id, AppRoles.Staff);

        var issued = (await (await SignInAsync(email, Password))
            .Content.ReadFromJsonAsync<AuthBody>(TenantApi.Json))!;

        using var client = _factory.CreateClient();

        var loggedOut = await client.PostAsJsonAsync("/api/v1/auth/logout",
            new { refreshToken = issued.RefreshToken }, TenantApi.Json);

        Assert.Equal(HttpStatusCode.NoContent, loggedOut.StatusCode);

        var afterwards = await client.PostAsJsonAsync("/api/v1/auth/refresh",
            new { refreshToken = issued.RefreshToken }, TenantApi.Json);

        Assert.Equal(HttpStatusCode.Unauthorized, afterwards.StatusCode);
    }

    // ------------------------------------------------------------------------- helpers --

    private sealed record AuthBody(
        string AccessToken,
        DateTimeOffset AccessTokenExpiresAt,
        string RefreshToken,
        DateTimeOffset RefreshTokenExpiresAt,
        Guid TenantId,
        string DisplayName,
        IReadOnlyList<string> Roles);

    private Task<HttpResponseMessage> SignInAsync(string email, string password)
    {
        var client = _factory.CreateClient();

        return client.PostAsJsonAsync("/api/v1/auth/login",
            new { email, password }, TenantApi.Json);
    }

    private async Task<string> AccessTokenAsync(string email)
    {
        var body = (await (await SignInAsync(email, Password))
            .Content.ReadFromJsonAsync<AuthBody>(TenantApi.Json))!;

        return body.AccessToken;
    }

    /// <summary>Creates an active staff account in the given tenant and returns its email.</summary>
    private async Task<string> CreateStaffAsync(Guid tenantId, string role)
    {
        var email = $"staff-{Guid.NewGuid():N}@example.test";

        using var scope = _factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<AppRole>>();

        if (!await roles.RoleExistsAsync(role))
            await roles.CreateAsync(new AppRole(role));

        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            UserName = email,
            Email = email,
            DisplayName = "Test Staff",
            TenantId = tenantId,
            EmailConfirmed = true
        };

        var created = await users.CreateAsync(user, Password);
        Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));

        await users.AddToRoleAsync(user, role);

        return email;
    }

    private async Task WithUserManagerAsync(Func<UserManager<AppUser>, Task> action)
    {
        using var scope = _factory.Services.CreateScope();
        await action(scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>());
    }
}
